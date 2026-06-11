import asyncio
import random
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, delete, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session
from app.models import (
    DAG, DAGStatus, SchedulePlan, ExecutionRecord, ExecutionStatus, TriggerType,
    ScheduleOperationLog, ScheduleOperationType,
)
from app.schemas import (
    SchedulePlanCreate, SchedulePlanUpdate, SchedulePlanOut,
    ExecutionRecordOut, ExecutionRecordDetail,
    ScheduleOverview, ScheduleListItem,
    ScheduleOperationLogOut, ExecutionStats, DailyStats,
    CronPreviewResponse,
)

router = APIRouter(prefix="/schedules", tags=["schedules"])

_CRON_REGEX = re.compile(
    r"^(\*|\*\/[0-9]+|[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?)*)\s+"
    r"(\*|\*\/[0-9]+|[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?)*)\s+"
    r"(\*|\*\/[0-9]+|[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?)*)\s+"
    r"(\*|\*\/[0-9]+|[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?)*)\s+"
    r"(\*|\*\/[0-9]+|[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?(?:\/[0-9]+)?)*)$"
)


def validate_cron(expr: str) -> bool:
    if not _CRON_REGEX.match(expr):
        return False
    try:
        croniter(expr, datetime.utcnow())
        return True
    except (ValueError, KeyError):
        return False


def compute_next_trigger(cron_expression: str) -> Optional[datetime]:
    try:
        cron = croniter(cron_expression, datetime.utcnow())
        return cron.get_next(datetime)
    except Exception:
        return None


def compute_next_n_triggers(cron_expression: str, n: int = 5) -> list[datetime]:
    try:
        cron = croniter(cron_expression, datetime.utcnow())
        return [cron.get_next(datetime) for _ in range(n)]
    except Exception:
        return []


def _plan_to_dict(plan: SchedulePlan) -> dict:
    return {
        "cron_expression": plan.cron_expression,
        "enabled": plan.enabled,
        "max_concurrency": plan.max_concurrency,
        "timeout_seconds": plan.timeout_seconds,
        "retry_count": plan.retry_count,
        "retry_interval": plan.retry_interval,
    }


_FIELD_LABELS = {
    "cron_expression": "Cron表达式",
    "enabled": "启用状态",
    "max_concurrency": "最大并发数",
    "timeout_seconds": "超时秒数",
    "retry_count": "重试次数",
    "retry_interval": "重试间隔",
}


def _compute_changed_summary(before: dict, after: dict) -> tuple[list[str], str]:
    changed_fields = []
    changes = []
    for key in _FIELD_LABELS:
        if key in before and key in after and before[key] != after[key]:
            changed_fields.append(key)
            label = _FIELD_LABELS[key]
            if key == "enabled":
                changes.append(f"{label}: {'启用' if before[key] else '禁用'} → {'启用' if after[key] else '禁用'}")
            else:
                changes.append(f"{label}: {before[key]} → {after[key]}")
    summary = "; ".join(changes) if changes else None
    return changed_fields, summary


async def _log_operation(
    db: AsyncSession,
    dag_id: str,
    operation_type: ScheduleOperationType,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
):
    changed_fields = []
    summary = None
    if before and after:
        changed_fields, summary = _compute_changed_summary(before, after)
    elif operation_type == ScheduleOperationType.CREATE:
        summary = "创建调度计划"
    elif operation_type == ScheduleOperationType.DELETE:
        summary = "删除调度计划"
    elif operation_type == ScheduleOperationType.ENABLE:
        summary = "启用调度计划"
    elif operation_type == ScheduleOperationType.DISABLE:
        summary = "禁用调度计划"

    log = ScheduleOperationLog(
        id=str(uuid.uuid4()),
        dag_id=dag_id,
        operation_type=operation_type,
        before_data=before,
        after_data=after,
        changed_fields=changed_fields,
        summary=summary,
    )
    db.add(log)


def _build_plan_out(plan: SchedulePlan, dag_name: Optional[str] = None) -> SchedulePlanOut:
    next_tt = compute_next_trigger(plan.cron_expression) if plan.enabled else None
    return SchedulePlanOut(
        id=plan.id,
        dag_id=plan.dag_id,
        dag_name=dag_name,
        cron_expression=plan.cron_expression,
        enabled=plan.enabled,
        max_concurrency=plan.max_concurrency,
        timeout_seconds=plan.timeout_seconds,
        retry_count=plan.retry_count,
        retry_interval=plan.retry_interval,
        next_trigger_time=next_tt,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def _build_execution_out(record: ExecutionRecord) -> ExecutionRecordOut:
    duration = None
    if record.finished_at and record.triggered_at:
        duration = (record.finished_at - record.triggered_at).total_seconds()
    is_retry = record.retry_attempt > 0
    retry_label = f"重试第{record.retry_attempt}次" if is_retry else None
    return ExecutionRecordOut(
        id=record.id,
        dag_id=record.dag_id,
        schedule_plan_id=record.schedule_plan_id,
        trigger_type=record.trigger_type.value,
        status=record.status.value,
        retry_attempt=record.retry_attempt,
        parent_execution_id=record.parent_execution_id,
        error_message=record.error_message,
        triggered_at=record.triggered_at,
        finished_at=record.finished_at,
        duration_seconds=duration,
        is_retry=is_retry,
        retry_label=retry_label,
    )


def _build_log_out(log: ScheduleOperationLog) -> ScheduleOperationLogOut:
    return ScheduleOperationLogOut(
        id=log.id,
        dag_id=log.dag_id,
        operation_type=log.operation_type.value,
        changed_fields=log.changed_fields or [],
        summary=log.summary,
        operated_at=log.operated_at,
    )


@router.get("/plans/{dag_id}", response_model=Optional[SchedulePlanOut])
async def get_schedule_plan(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SchedulePlan).where(SchedulePlan.dag_id == dag_id))
    plan = result.scalar_one_or_none()
    if not plan:
        return None
    dag_result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = dag_result.scalar_one_or_none()
    return _build_plan_out(plan, dag.name if dag else None)


@router.post("/plans/{dag_id}", response_model=SchedulePlanOut, status_code=201)
async def create_schedule_plan(
    dag_id: str,
    body: SchedulePlanCreate,
    db: AsyncSession = Depends(get_db),
):
    dag_result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = dag_result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    if dag.status not in (DAGStatus.PUBLISHED, DAGStatus.RUNNING, DAGStatus.GRAYSCALE):
        raise HTTPException(status_code=400, detail="只有已发布或运行中的DAG才允许创建调度计划")

    existing = await db.execute(select(SchedulePlan).where(SchedulePlan.dag_id == dag_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该DAG已存在调度计划，每个DAG最多配置一个")

    if not validate_cron(body.cron_expression):
        raise HTTPException(status_code=400, detail="Cron表达式格式不合法，请输入标准五段式表达式")

    plan = SchedulePlan(
        id=str(uuid.uuid4()),
        dag_id=dag_id,
        cron_expression=body.cron_expression,
        enabled=body.enabled,
        max_concurrency=body.max_concurrency,
        timeout_seconds=body.timeout_seconds,
        retry_count=body.retry_count,
        retry_interval=body.retry_interval,
    )
    db.add(plan)

    after = _plan_to_dict(plan)
    await _log_operation(db, dag_id, ScheduleOperationType.CREATE, None, after)

    await db.commit()
    await db.refresh(plan)
    return _build_plan_out(plan, dag.name)


@router.put("/plans/{dag_id}", response_model=SchedulePlanOut)
async def update_schedule_plan(
    dag_id: str,
    body: SchedulePlanUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SchedulePlan).where(SchedulePlan.dag_id == dag_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="调度计划不存在")

    before = _plan_to_dict(plan)

    enabled_changed = False
    if body.enabled is not None and body.enabled != plan.enabled:
        enabled_changed = True

    if body.cron_expression is not None:
        if not validate_cron(body.cron_expression):
            raise HTTPException(status_code=400, detail="Cron表达式格式不合法，请输入标准五段式表达式")
        plan.cron_expression = body.cron_expression

    if body.enabled is not None:
        if body.enabled:
            dag_result = await db.execute(select(DAG).where(DAG.id == dag_id))
            dag = dag_result.scalar_one_or_none()
            if dag and dag.status not in (DAGStatus.PUBLISHED, DAGStatus.RUNNING, DAGStatus.GRAYSCALE):
                raise HTTPException(status_code=400, detail="DAG当前状态不允许启用调度计划")
        plan.enabled = body.enabled

    if body.max_concurrency is not None:
        plan.max_concurrency = body.max_concurrency
    if body.timeout_seconds is not None:
        plan.timeout_seconds = body.timeout_seconds
    if body.retry_count is not None:
        plan.retry_count = body.retry_count
    if body.retry_interval is not None:
        plan.retry_interval = body.retry_interval

    plan.updated_at = datetime.utcnow()

    after = _plan_to_dict(plan)
    if enabled_changed:
        op_type = ScheduleOperationType.ENABLE if body.enabled else ScheduleOperationType.DISABLE
        await _log_operation(db, dag_id, op_type, before, after)
    if before != after:
        await _log_operation(db, dag_id, ScheduleOperationType.EDIT, before, after)

    await db.commit()
    await db.refresh(plan)

    dag_result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = dag_result.scalar_one_or_none()
    return _build_plan_out(plan, dag.name if dag else None)


@router.delete("/plans/{dag_id}", status_code=204)
async def delete_schedule_plan(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SchedulePlan).where(SchedulePlan.dag_id == dag_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="调度计划不存在")

    before = _plan_to_dict(plan)
    await _log_operation(db, dag_id, ScheduleOperationType.DELETE, before, None)

    await db.delete(plan)
    await db.execute(delete(ExecutionRecord).where(ExecutionRecord.dag_id == dag_id))
    await db.commit()


@router.get("/plans/{dag_id}/operations", response_model=list[ScheduleOperationLogOut])
async def list_schedule_operations(
    dag_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ScheduleOperationLog)
        .where(ScheduleOperationLog.dag_id == dag_id)
        .order_by(ScheduleOperationLog.operated_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()
    return [_build_log_out(log) for log in logs]


@router.post("/trigger/{dag_id}")
async def manual_trigger(dag_id: str, db: AsyncSession = Depends(get_db)):
    dag_result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = dag_result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    plan_result = await db.execute(select(SchedulePlan).where(SchedulePlan.dag_id == dag_id))
    plan = plan_result.scalar_one_or_none()

    max_conc = plan.max_concurrency if plan else 1
    running_count = await db.execute(
        select(func.count()).where(
            ExecutionRecord.dag_id == dag_id,
            ExecutionRecord.status == ExecutionStatus.RUNNING,
        )
    )
    if (running_count.scalar() or 0) >= max_conc:
        raise HTTPException(status_code=400, detail="当前运行中的执行数已达到最大并发数，无法触发")

    record = ExecutionRecord(
        id=str(uuid.uuid4()),
        dag_id=dag_id,
        schedule_plan_id=plan.id if plan else None,
        trigger_type=TriggerType.MANUAL,
        status=ExecutionStatus.RUNNING,
        retry_attempt=0,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    plan_id = plan.id if plan else None
    timeout = plan.timeout_seconds if plan else 3600
    retry_count = plan.retry_count if plan else 0
    retry_interval = plan.retry_interval if plan else 60
    asyncio.create_task(_execute_dag(record.id, dag_id, plan_id, timeout, retry_count, retry_interval))

    return {"execution_id": record.id, "status": "running"}


@router.get("/executions/{dag_id}")
async def list_executions(
    dag_id: str,
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    query = select(ExecutionRecord).where(ExecutionRecord.dag_id == dag_id)
    if status:
        try:
            status_enum = ExecutionStatus(status)
            query = query.where(ExecutionRecord.status == status_enum)
        except ValueError:
            pass

    count_result = await db.execute(
        select(func.count()).select_from(query.subquery())
    )
    total = count_result.scalar() or 0

    query = query.order_by(ExecutionRecord.triggered_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    records = result.scalars().all()

    return {
        "items": [_build_execution_out(r).model_dump() for r in records],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/execution/{execution_id}", response_model=ExecutionRecordDetail)
async def get_execution_detail(execution_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExecutionRecord).where(ExecutionRecord.id == execution_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="执行记录不存在")
    return _build_execution_out(record)


@router.get("/executions/{dag_id}/stats", response_model=ExecutionStats)
async def get_execution_stats(dag_id: str):
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    empty_stats = ExecutionStats(
        daily_stats=[],
        total_executions=0,
        success_rate=0.0,
        avg_duration_seconds=0.0,
        max_duration_seconds=0.0,
        has_data=False,
    )

    daily_map: dict[str, DailyStats] = {}
    for i in range(7):
        d = today_start - timedelta(days=6 - i)
        date_str = d.strftime("%Y-%m-%d")
        daily_map[date_str] = DailyStats(date=date_str)

    total_success = 0
    total_count = 0
    durations = []

    async with async_session() as db:
        try:
            result = await db.execute(text(
                "SELECT status::text as status, triggered_at, finished_at "
                "FROM execution_records "
                "WHERE dag_id = :dag_id AND triggered_at >= :since"
            ), {"dag_id": dag_id, "since": seven_days_ago})
            rows = result.fetchall()
        except Exception as e:
            print(f"execution stats query error: {e}")
            return empty_stats

    if not rows:
        return empty_stats

    for row in rows:
        date_str = row.triggered_at.strftime("%Y-%m-%d")
        if date_str not in daily_map:
            daily_map[date_str] = DailyStats(date=date_str)
        ds = daily_map[date_str]
        status = row.status
        if status == ExecutionStatus.SUCCESS.value:
            ds.success += 1
            total_success += 1
        elif status == ExecutionStatus.FAILED.value:
            ds.failed += 1
        elif status == ExecutionStatus.TIMEOUT.value:
            ds.timeout += 1

        total_count += 1
        if row.finished_at and row.triggered_at:
            dur = (row.finished_at - row.triggered_at).total_seconds()
            durations.append(dur)

    sorted_dates = sorted(daily_map.keys())
    daily_stats = [daily_map[d] for d in sorted_dates[-7:]]

    success_rate = round(total_success / total_count * 100, 1) if total_count > 0 else 0.0
    avg_duration = round(sum(durations) / len(durations), 1) if durations else 0.0
    max_duration = round(max(durations), 1) if durations else 0.0

    return ExecutionStats(
        daily_stats=daily_stats,
        total_executions=total_count,
        success_rate=success_rate,
        avg_duration_seconds=avg_duration,
        max_duration_seconds=max_duration,
        has_data=True,
    )


@router.get("/cron/preview", response_model=CronPreviewResponse)
async def preview_cron(expression: str = Query(..., description="Cron表达式")):
    if not validate_cron(expression):
        return CronPreviewResponse(
            valid=False,
            error_message="Cron表达式格式不合法，请输入标准五段式表达式",
            next_times=[],
        )
    times = compute_next_n_triggers(expression, 5)
    return CronPreviewResponse(
        valid=True,
        error_message=None,
        next_times=[t.isoformat() for t in times],
    )


@router.get("/overview", response_model=ScheduleOverview)
async def schedule_overview():
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    seven_days_ago = datetime.utcnow() - timedelta(days=7)

    today_total = 0
    success_count = 0
    running = 0
    week_timeout_count = 0
    last_failed_dag_name = None
    last_failed_time = None

    async with async_session() as db:
        try:
            res = await db.execute(
                select(func.count()).where(ExecutionRecord.triggered_at >= today_start)
            )
            today_total = res.scalar() or 0
        except Exception as e:
            print(f"overview today_total error: {e}")

    async with async_session() as db:
        try:
            res = await db.execute(
                select(func.count()).where(
                    ExecutionRecord.triggered_at >= today_start,
                    ExecutionRecord.status == ExecutionStatus.SUCCESS,
                )
            )
            success_count = res.scalar() or 0
        except Exception as e:
            print(f"overview success_count error: {e}")

    today_success_rate = (success_count / today_total * 100) if today_total > 0 else 0.0

    async with async_session() as db:
        try:
            res = await db.execute(
                select(func.count()).where(ExecutionRecord.status == ExecutionStatus.RUNNING)
            )
            running = res.scalar() or 0
        except Exception as e:
            print(f"overview running error: {e}")

    async with async_session() as db:
        try:
            res = await db.execute(
                select(func.count()).where(
                    ExecutionRecord.triggered_at >= seven_days_ago,
                    ExecutionRecord.status == ExecutionStatus.TIMEOUT,
                )
            )
            week_timeout_count = res.scalar() or 0
        except Exception as e:
            print(f"overview week_timeout fallback: {e}")
            try:
                raw_res = await db.execute(text(
                    "SELECT COUNT(*) FROM execution_records "
                    "WHERE triggered_at >= :since AND status::text = 'timeout'"
                ), {"since": seven_days_ago})
                week_timeout_count = raw_res.scalar() or 0
            except Exception as e2:
                print(f"overview week_timeout raw also failed: {e2}")

    async with async_session() as db:
        try:
            res = await db.execute(
                select(ExecutionRecord)
                .where(ExecutionRecord.status == ExecutionStatus.FAILED)
                .order_by(ExecutionRecord.finished_at.desc())
                .limit(1)
            )
            failed_record = res.scalar_one_or_none()
            if failed_record:
                last_failed_time = failed_record.finished_at
                dag_result = await db.execute(select(DAG).where(DAG.id == failed_record.dag_id))
                dag = dag_result.scalar_one_or_none()
                last_failed_dag_name = dag.name if dag else None
        except Exception as e:
            print(f"overview last_failed error: {e}")

    return ScheduleOverview(
        today_triggers=today_total,
        today_success_rate=round(today_success_rate, 1),
        running_count=running,
        last_failed_dag_name=last_failed_dag_name,
        last_failed_time=last_failed_time,
        week_timeout_count=week_timeout_count,
    )


async def _compute_dag_7d_stats(db: AsyncSession, dag_id: str) -> tuple[int, float]:
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    try:
        result = await db.execute(text(
            "SELECT status::text as status "
            "FROM execution_records "
            "WHERE dag_id = :dag_id AND triggered_at >= :since"
        ), {"dag_id": dag_id, "since": seven_days_ago})
        rows = result.fetchall()
    except Exception as e:
        print(f"_compute_dag_7d_stats error: {e}")
        return 0, 0.0

    total = len(rows)
    if total == 0:
        return 0, 0.0
    success = sum(1 for r in rows if r.status == ExecutionStatus.SUCCESS.value)
    rate = round(success / total * 100, 1)
    return total, rate


@router.get("/list", response_model=list[ScheduleListItem])
async def list_all_schedules(
    dag_name: Optional[str] = None,
    enabled: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(SchedulePlan)
    if enabled is not None:
        query = query.where(SchedulePlan.enabled == enabled)
    result = await db.execute(query)
    plans = result.scalars().all()

    items = []
    for plan in plans:
        dag_result = await db.execute(select(DAG).where(DAG.id == plan.dag_id))
        dag = dag_result.scalar_one_or_none()
        if not dag:
            continue
        if dag_name and dag_name.lower() not in dag.name.lower():
            continue

        next_tt = compute_next_trigger(plan.cron_expression) if plan.enabled else None

        last_exec = await db.execute(
            select(ExecutionRecord)
            .where(ExecutionRecord.dag_id == plan.dag_id)
            .order_by(ExecutionRecord.triggered_at.desc())
            .limit(1)
        )
        last_record = last_exec.scalar_one_or_none()
        last_status = last_record.status.value if last_record else None

        exec_7d, rate_7d = await _compute_dag_7d_stats(db, plan.dag_id)

        items.append(ScheduleListItem(
            plan_id=plan.id,
            dag_id=plan.dag_id,
            dag_name=dag.name,
            cron_expression=plan.cron_expression,
            enabled=plan.enabled,
            next_trigger_time=next_tt,
            last_execution_status=last_status,
            last_7d_executions=exec_7d,
            last_7d_success_rate=rate_7d,
        ))
    return items


async def _execute_dag(
    execution_id: str,
    dag_id: str,
    plan_id: Optional[str],
    timeout: int,
    retry_count: int,
    retry_interval: int,
    retry_attempt: int = 0,
    parent_execution_id: Optional[str] = None,
):
    simulate_duration = random.randint(3, 10)
    if simulate_duration > timeout:
        simulate_duration = timeout + 2

    timed_out = False
    try:
        await asyncio.wait_for(asyncio.sleep(5), timeout=timeout)
    except asyncio.TimeoutError:
        timed_out = True

    async with async_session() as db:
        result = await db.execute(select(ExecutionRecord).where(ExecutionRecord.id == execution_id))
        record = result.scalar_one_or_none()
        if not record:
            return

        if timed_out:
            record.status = ExecutionStatus.TIMEOUT
            record.error_message = "执行超时被终止"
            record.finished_at = datetime.utcnow()
            await db.commit()
            return

        success = random.random() < 0.7

        if success:
            record.status = ExecutionStatus.SUCCESS
            record.finished_at = datetime.utcnow()
            await db.commit()
        else:
            error_msg = f"执行失败 (模拟随机失败)"
            if retry_attempt < retry_count:
                record.status = ExecutionStatus.RETRYING
                record.error_message = error_msg
                record.finished_at = datetime.utcnow()
                await db.commit()

                await asyncio.sleep(retry_interval)

                async with async_session() as retry_db:
                    retry_record = ExecutionRecord(
                        id=str(uuid.uuid4()),
                        dag_id=dag_id,
                        schedule_plan_id=plan_id,
                        trigger_type=TriggerType.RETRY,
                        status=ExecutionStatus.RUNNING,
                        retry_attempt=retry_attempt + 1,
                        parent_execution_id=execution_id,
                    )
                    retry_db.add(retry_record)
                    await retry_db.commit()
                    await retry_db.refresh(retry_record)

                await _execute_dag(
                    retry_record.id, dag_id, plan_id, timeout,
                    retry_count, retry_interval,
                    retry_attempt + 1, execution_id,
                )
            else:
                record.status = ExecutionStatus.FAILED
                record.error_message = error_msg
                record.finished_at = datetime.utcnow()
                await db.commit()


async def _disable_schedule_for_dag(dag_id: str):
    async with async_session() as db:
        result = await db.execute(select(SchedulePlan).where(SchedulePlan.dag_id == dag_id))
        plan = result.scalar_one_or_none()
        if plan and plan.enabled:
            before = _plan_to_dict(plan)
            plan.enabled = False
            plan.updated_at = datetime.utcnow()
            after = _plan_to_dict(plan)
            await _log_operation(db, dag_id, ScheduleOperationType.DISABLE, before, after)
            await db.commit()


async def _timeout_check_loop():
    while True:
        try:
            async with async_session() as db:
                now = datetime.utcnow()
                result = await db.execute(
                    select(ExecutionRecord, SchedulePlan)
                    .join(SchedulePlan, ExecutionRecord.schedule_plan_id == SchedulePlan.id, isouter=True)
                    .where(ExecutionRecord.status == ExecutionStatus.RUNNING)
                )
                rows = result.all()
                for record, plan in rows:
                    timeout = plan.timeout_seconds if plan else 3600
                    elapsed = (now - record.triggered_at).total_seconds()
                    if elapsed > timeout:
                        record.status = ExecutionStatus.TIMEOUT
                        record.error_message = "执行超时被终止"
                        record.finished_at = now
                await db.commit()
        except Exception as e:
            print(f"Timeout check loop error: {e}")

        await asyncio.sleep(10)


async def _schedule_loop():
    while True:
        try:
            async with async_session() as db:
                result = await db.execute(
                    select(SchedulePlan).where(SchedulePlan.enabled == True)
                )
                plans = result.scalars().all()

                now = datetime.utcnow()

                for plan in plans:
                    dag_result = await db.execute(select(DAG).where(DAG.id == plan.dag_id))
                    dag = dag_result.scalar_one_or_none()
                    if not dag or dag.status == DAGStatus.STOPPED:
                        continue

                    try:
                        cron = croniter(plan.cron_expression, now - timedelta(seconds=30))
                        prev_fire = cron.get_next(datetime)
                        if prev_fire <= now:
                            pass
                        else:
                            continue
                    except Exception:
                        continue

                    running_count = await db.execute(
                        select(func.count()).where(
                            ExecutionRecord.dag_id == plan.dag_id,
                            ExecutionRecord.status == ExecutionStatus.RUNNING,
                        )
                    )
                    if (running_count.scalar() or 0) >= plan.max_concurrency:
                        continue

                    recent = await db.execute(
                        select(ExecutionRecord)
                        .where(
                            ExecutionRecord.dag_id == plan.dag_id,
                            ExecutionRecord.triggered_at >= now - timedelta(seconds=30),
                        )
                    )
                    if recent.scalars().first():
                        continue

                    record = ExecutionRecord(
                        id=str(uuid.uuid4()),
                        dag_id=plan.dag_id,
                        schedule_plan_id=plan.id,
                        trigger_type=TriggerType.SCHEDULED,
                        status=ExecutionStatus.RUNNING,
                        retry_attempt=0,
                    )
                    db.add(record)
                    await db.commit()
                    await db.refresh(record)

                    asyncio.create_task(_execute_dag(
                        record.id, plan.dag_id, plan.id,
                        plan.timeout_seconds, plan.retry_count, plan.retry_interval,
                    ))
        except Exception as e:
            print(f"Schedule loop error: {e}")

        await asyncio.sleep(30)
