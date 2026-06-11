import asyncio
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select, delete, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, UserRole
from app.config import settings
from app.database import get_db, async_session
from app.models import AlertRule, AlertHistory, AlertSeverity, AlertStatus, DAG, DAGVersion, User
from app.schemas import (
    AlertRuleCreate, AlertRuleOut, AlertHistoryOut, AlertHistoryDetail,
    AlertPushMessage, SilencePeriod, BatchRuleIds, BatchOperationResult,
)

router = APIRouter(prefix="/alerts", tags=["alerts"])
ws_router = APIRouter(tags=["alerts-ws"])

_alert_ws_connections: set[WebSocket] = set()
_rule_state: dict[str, dict] = {}


def _evaluate_condition(value: float, condition: str, threshold: float) -> bool:
    if condition == ">":
        return value > threshold
    elif condition == "<":
        return value < threshold
    elif condition == ">=":
        return value >= threshold
    elif condition == "<=":
        return value <= threshold
    elif condition == "==":
        return value == threshold
    return False


def _get_metric_value(metrics, metric_type: str) -> Optional[float]:
    if not metrics:
        return None
    if metric_type == "throughput":
        return metrics.throughput
    elif metric_type == "latency":
        return metrics.latency_ms
    elif metric_type == "error_rate":
        return metrics.error_rate
    elif metric_type == "backlog":
        return float(metrics.backlog)
    return None


def _is_in_silence_period(silence_periods: list, now: datetime) -> bool:
    if not silence_periods:
        return False
    for period in silence_periods:
        if isinstance(period, dict):
            repeat_mode = period.get("repeat_mode", "daily")
            start_time_str = period.get("start_time", "")
            end_time_str = period.get("end_time", "")
            weekday = period.get("weekday")
            date_str = period.get("date")
        else:
            continue

        if not start_time_str or not end_time_str:
            continue

        try:
            start_parts = start_time_str.split(":")
            end_parts = end_time_str.split(":")
            start_hour, start_minute = int(start_parts[0]), int(start_parts[1])
            end_hour, end_minute = int(end_parts[0]), int(end_parts[1])
        except (ValueError, IndexError):
            continue

        if repeat_mode == "once":
            if not date_str:
                continue
            try:
                period_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                continue
            if now.date() != period_date:
                continue
            start_dt = now.replace(hour=start_hour, minute=start_minute, second=0, microsecond=0)
            end_dt = now.replace(hour=end_hour, minute=end_minute, second=0, microsecond=0)
            if start_dt <= now <= end_dt:
                return True

        elif repeat_mode == "daily":
            start_dt = now.replace(hour=start_hour, minute=start_minute, second=0, microsecond=0)
            end_dt = now.replace(hour=end_hour, minute=end_minute, second=0, microsecond=0)
            if start_dt <= now <= end_dt:
                return True

        elif repeat_mode == "weekly":
            if weekday is None:
                continue
            if now.weekday() != weekday:
                continue
            start_dt = now.replace(hour=start_hour, minute=start_minute, second=0, microsecond=0)
            end_dt = now.replace(hour=end_hour, minute=end_minute, second=0, microsecond=0)
            if start_dt <= now <= end_dt:
                return True

    return False


def _build_rule_out(rule: AlertRule, dag_name: Optional[str], node_label: Optional[str]) -> AlertRuleOut:
    silence_periods_data = rule.silence_periods or []
    parsed_periods = []
    for p in silence_periods_data:
        if isinstance(p, dict):
            parsed_periods.append(SilencePeriod(**p))
    now = datetime.now()
    is_silenced = _is_in_silence_period(silence_periods_data, now)
    return AlertRuleOut(
        id=rule.id,
        dag_id=rule.dag_id,
        dag_name=dag_name,
        name=rule.name,
        metric_type=rule.metric_type,
        node_id=rule.node_id,
        node_label=node_label,
        condition=rule.condition,
        threshold=rule.threshold,
        duration_seconds=rule.duration_seconds,
        severity=rule.severity.value,
        enabled=rule.enabled,
        is_valid=rule.is_valid,
        invalid_reason=rule.invalid_reason,
        silence_periods=parsed_periods,
        is_silenced=is_silenced,
        created_at=rule.created_at,
    )


async def _get_dag_nodes(db: AsyncSession, dag: DAG) -> list:
    if not dag:
        return []
    ver_result = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag.id).order_by(DAGVersion.version_number.desc()).limit(1)
    )
    latest = ver_result.scalar_one_or_none()
    if latest and latest.nodes:
        return latest.nodes or []
    return dag.nodes or []


def _get_node_label_from_nodes(nodes: list, node_id: str) -> Optional[str]:
    for n in nodes:
        if isinstance(n, dict) and n.get("id") == node_id:
            return n.get("label", node_id)
    return node_id


def _check_node_exists_in_nodes(nodes: list, node_id: str) -> bool:
    for n in nodes:
        if isinstance(n, dict) and n.get("id") == node_id:
            return True
    return False


async def _invalidate_rules_for_dag(db: AsyncSession, dag_id: str, reason: str):
    result = await db.execute(select(AlertRule).where(AlertRule.dag_id == dag_id))
    rules = result.scalars().all()
    for rule in rules:
        rule.is_valid = False
        rule.invalid_reason = reason
    await db.commit()


async def _check_and_invalidate_rules(db: AsyncSession, dag_id: str, current_node_ids: set[str]):
    result = await db.execute(select(AlertRule).where(AlertRule.dag_id == dag_id))
    rules = result.scalars().all()
    for rule in rules:
        if rule.node_id and rule.node_id not in current_node_ids:
            rule.is_valid = False
            rule.invalid_reason = f"节点 {rule.node_id} 已被移除"
    await db.commit()


@router.get("/rules", response_model=list[AlertRuleOut])
async def list_all_alert_rules(
    enabled_only: Optional[bool] = None,
    valid_only: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(AlertRule)
    if enabled_only is not None:
        query = query.where(AlertRule.enabled == enabled_only)
    if valid_only is not None:
        query = query.where(AlertRule.is_valid == valid_only)
    query = query.order_by(AlertRule.created_at.desc())
    result = await db.execute(query)
    rules = result.scalars().all()

    out_list = []
    for rule in rules:
        dag_result = await db.execute(select(DAG).where(DAG.id == rule.dag_id))
        dag = dag_result.scalar_one_or_none()
        nodes = await _get_dag_nodes(db, dag) if dag else []
        out_list.append(_build_rule_out(
            rule,
            dag.name if dag else None,
            _get_node_label_from_nodes(nodes, rule.node_id),
        ))
    return out_list


@router.post("/rules/batch/enable", response_model=BatchOperationResult)
async def batch_enable_rules(body: BatchRuleIds, db: AsyncSession = Depends(get_db)):
    updated_count = 0
    skipped_count = 0
    for rule_id in body.rule_ids:
        result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            skipped_count += 1
            continue
        if not rule.is_valid:
            skipped_count += 1
            continue
        rule.enabled = True
        updated_count += 1
    await db.commit()
    return BatchOperationResult(
        updated_count=updated_count,
        skipped_count=skipped_count,
        skipped_reason=f"{skipped_count}条无效规则已跳过" if skipped_count > 0 else None,
    )


@router.post("/rules/batch/disable", response_model=BatchOperationResult)
async def batch_disable_rules(body: BatchRuleIds, db: AsyncSession = Depends(get_db)):
    updated_count = 0
    skipped_count = 0
    for rule_id in body.rule_ids:
        result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            skipped_count += 1
            continue
        if not rule.is_valid:
            skipped_count += 1
            continue
        rule.enabled = False
        updated_count += 1
    await db.commit()
    return BatchOperationResult(
        updated_count=updated_count,
        skipped_count=skipped_count,
        skipped_reason=f"{skipped_count}条无效规则已跳过" if skipped_count > 0 else None,
    )


@router.post("/rules/batch/delete", response_model=BatchOperationResult)
async def batch_delete_rules(body: BatchRuleIds, db: AsyncSession = Depends(get_db)):
    deleted_count = 0
    skipped_count = 0
    for rule_id in body.rule_ids:
        result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
        rule = result.scalar_one_or_none()
        if not rule:
            skipped_count += 1
            continue
        await db.delete(rule)
        deleted_count += 1
        if rule_id in _rule_state:
            del _rule_state[rule_id]
    await db.commit()
    return BatchOperationResult(
        updated_count=deleted_count,
        skipped_count=skipped_count,
    )


@router.get("/rules/{dag_id}", response_model=list[AlertRuleOut])
async def list_alert_rules(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.dag_id == dag_id))
    rules = result.scalars().all()

    dag_result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = dag_result.scalar_one_or_none()
    nodes = await _get_dag_nodes(db, dag) if dag else []

    out_list = []
    for rule in rules:
        out_list.append(_build_rule_out(
            rule,
            dag.name if dag else None,
            _get_node_label_from_nodes(nodes, rule.node_id),
        ))
    return out_list


@router.post("/rules/{dag_id}", response_model=AlertRuleOut, status_code=201)
async def create_alert_rule(
    dag_id: str,
    body: AlertRuleCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    dag_result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = dag_result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    nodes = await _get_dag_nodes(db, dag)
    if not _check_node_exists_in_nodes(nodes, body.node_id):
        raise HTTPException(status_code=400, detail=f"节点 {body.node_id} 不存在于该DAG")

    count_result = await db.execute(select(AlertRule).where(AlertRule.dag_id == dag_id))
    count = len(count_result.scalars().all())
    if count >= settings.MAX_ALERTS_PER_DAG:
        raise HTTPException(status_code=400, detail=f"Maximum {settings.MAX_ALERTS_PER_DAG} alert rules per DAG")

    try:
        severity_enum = AlertSeverity(body.severity)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid severity")

    silence_data = [p.model_dump() for p in body.silence_periods] if body.silence_periods else []

    rule = AlertRule(
        id=str(uuid.uuid4()),
        dag_id=dag_id,
        name=body.name,
        metric_type=body.metric_type,
        node_id=body.node_id,
        condition=body.condition,
        threshold=body.threshold,
        duration_seconds=body.duration_seconds,
        severity=severity_enum,
        silence_periods=silence_data,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    return _build_rule_out(
        rule,
        dag.name,
        _get_node_label_from_nodes(nodes, rule.node_id),
    )


@router.put("/rules/{rule_id}", response_model=AlertRuleOut)
async def update_alert_rule(rule_id: str, body: AlertRuleCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")

    dag_result = await db.execute(select(DAG).where(DAG.id == rule.dag_id))
    dag = dag_result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    nodes = await _get_dag_nodes(db, dag)
    if not _check_node_exists_in_nodes(nodes, body.node_id):
        raise HTTPException(status_code=400, detail=f"节点 {body.node_id} 不存在于该DAG")

    try:
        severity_enum = AlertSeverity(body.severity)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid severity")

    rule.name = body.name
    rule.metric_type = body.metric_type
    rule.node_id = body.node_id
    rule.condition = body.condition
    rule.threshold = body.threshold
    rule.duration_seconds = body.duration_seconds
    rule.severity = severity_enum
    rule.silence_periods = [p.model_dump() for p in body.silence_periods] if body.silence_periods else []
    rule.is_valid = True
    rule.invalid_reason = None
    await db.commit()
    await db.refresh(rule)

    return _build_rule_out(
        rule,
        dag.name,
        _get_node_label_from_nodes(nodes, rule.node_id),
    )


@router.patch("/rules/{rule_id}/toggle", response_model=AlertRuleOut)
async def toggle_alert_rule(rule_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")

    rule.enabled = not rule.enabled
    await db.commit()
    await db.refresh(rule)

    dag_result = await db.execute(select(DAG).where(DAG.id == rule.dag_id))
    dag = dag_result.scalar_one_or_none()
    nodes = await _get_dag_nodes(db, dag) if dag else []

    return _build_rule_out(
        rule,
        dag.name if dag else None,
        _get_node_label_from_nodes(nodes, rule.node_id),
    )


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_alert_rule(rule_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    await db.delete(rule)
    await db.commit()
    if rule_id in _rule_state:
        del _rule_state[rule_id]


@router.get("/history", response_model=list[AlertHistoryOut])
async def list_all_alert_history(
    severity: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    limit: int = Query(500, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    query = select(AlertHistory)
    if severity:
        try:
            sev_enum = AlertSeverity(severity)
            query = query.where(AlertHistory.severity == sev_enum)
        except ValueError:
            pass
    if start_time:
        try:
            start_dt = datetime.fromisoformat(start_time)
            query = query.where(AlertHistory.triggered_at >= start_dt)
        except ValueError:
            pass
    if end_time:
        try:
            end_dt = datetime.fromisoformat(end_time)
            query = query.where(AlertHistory.triggered_at <= end_dt)
        except ValueError:
            pass
    query = query.order_by(AlertHistory.triggered_at.desc()).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/history/{alert_id}", response_model=AlertHistoryDetail)
async def get_alert_history_detail(alert_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertHistory).where(AlertHistory.id == alert_id))
    history = result.scalar_one_or_none()
    if not history:
        raise HTTPException(status_code=404, detail="Alert history not found")
    return history


@router.get("/history/dag/{dag_id}", response_model=list[AlertHistoryOut])
async def list_alert_history(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AlertHistory).where(AlertHistory.dag_id == dag_id).order_by(AlertHistory.triggered_at.desc()).limit(100)
    )
    return result.scalars().all()


@router.post("/history/{alert_id}/resolve")
async def resolve_alert(alert_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertHistory).where(AlertHistory.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = AlertStatus.RESOLVED
    alert.resolved_at = datetime.utcnow()
    await db.commit()
    return {"status": "resolved"}


@ws_router.websocket("/alerts")
async def alerts_websocket(websocket: WebSocket):
    await websocket.accept()
    _alert_ws_connections.add(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            pass
    except WebSocketDisconnect:
        pass
    finally:
        _alert_ws_connections.discard(websocket)


async def _broadcast_alert(message: dict):
    disconnected = set()
    for ws in _alert_ws_connections:
        try:
            await ws.send_json(message)
        except Exception:
            disconnected.add(ws)
    for ws in disconnected:
        _alert_ws_connections.discard(ws)


async def _evaluate_rules_loop():
    from app.routers.monitoring_router import _metrics_store
    while True:
        try:
            db = async_session()
            try:
                result = await db.execute(
                    select(AlertRule).where(
                        and_(AlertRule.enabled == True, AlertRule.is_valid == True)
                    )
                )
                rules = result.scalars().all()

                now_ts = time.time()
                now_dt = datetime.now()

                for rule in rules:
                    if _is_in_silence_period(rule.silence_periods or [], now_dt):
                        if rule.id in _rule_state:
                            del _rule_state[rule.id]
                        continue

                    dag_metrics = _metrics_store.get(rule.dag_id, {})
                    node_metrics = dag_metrics.get(rule.node_id) if rule.node_id else None
                    current_value = _get_metric_value(node_metrics, rule.metric_type)

                    if current_value is None:
                        if rule.id in _rule_state:
                            del _rule_state[rule.id]
                        continue

                    condition_met = _evaluate_condition(current_value, rule.condition, rule.threshold)

                    state = _rule_state.get(rule.id, {
                        "first_met_time": None,
                        "last_triggered": 0,
                    })

                    if condition_met:
                        if state["first_met_time"] is None:
                            state["first_met_time"] = now_ts
                            _rule_state[rule.id] = state

                        duration_met = (now_ts - state["first_met_time"]) >= rule.duration_seconds
                        cooldown_passed = (now_ts - state["last_triggered"]) >= 60

                        if duration_met and cooldown_passed:
                            dag_result = await db.execute(select(DAG).where(DAG.id == rule.dag_id))
                            dag = dag_result.scalar_one_or_none()
                            if not dag:
                                continue

                            context_snapshot = {
                                "node_metrics": {
                                    nid: {
                                        "throughput": m.throughput,
                                        "latency_ms": m.latency_ms,
                                        "backlog": m.backlog,
                                        "error_rate": m.error_rate,
                                        "health": m.health,
                                    } for nid, m in dag_metrics.items()
                                },
                                "triggered_node": rule.node_id,
                                "triggered_value": current_value,
                            }

                            history = AlertHistory(
                                id=str(uuid.uuid4()),
                                alert_rule_id=rule.id,
                                dag_id=rule.dag_id,
                                rule_name=rule.name,
                                dag_name=dag.name,
                                metric_type=rule.metric_type,
                                node_id=rule.node_id,
                                current_value=current_value,
                                threshold=rule.threshold,
                                condition=rule.condition,
                                duration_seconds=rule.duration_seconds,
                                severity=rule.severity,
                                status=AlertStatus.ACTIVE,
                                context_snapshot=context_snapshot,
                            )
                            db.add(history)
                            await db.commit()

                            state["last_triggered"] = now_ts
                            state["first_met_time"] = None
                            _rule_state[rule.id] = state

                            push_msg = AlertPushMessage(
                                id=history.id,
                                rule_name=rule.name,
                                dag_id=rule.dag_id,
                                dag_name=dag.name,
                                severity=rule.severity.value,
                                current_value=current_value,
                                threshold=rule.threshold,
                                triggered_at=history.triggered_at,
                            )
                            await _broadcast_alert(push_msg.model_dump())
                    else:
                        if rule.id in _rule_state:
                            del _rule_state[rule.id]

            finally:
                await db.close()
        except Exception as e:
            print(f"Error in alert evaluation: {e}")

        await asyncio.sleep(10)
