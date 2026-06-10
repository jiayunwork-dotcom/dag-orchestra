import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, UserRole
from app.config import settings
from app.database import get_db
from app.models import AlertRule, AlertHistory, AlertSeverity, AlertStatus, DAG, User
from app.schemas import AlertRuleCreate, AlertRuleOut, AlertHistoryOut

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/rules/{dag_id}", response_model=list[AlertRuleOut])
async def list_alert_rules(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.dag_id == dag_id))
    return result.scalars().all()


@router.post("/rules/{dag_id}", response_model=AlertRuleOut, status_code=201)
async def create_alert_rule(
    dag_id: str,
    body: AlertRuleCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(select(AlertRule).where(AlertRule.dag_id == dag_id))
    count = len(count_result.scalars().all())
    if count >= settings.MAX_ALERTS_PER_DAG:
        raise HTTPException(status_code=400, detail=f"Maximum {settings.MAX_ALERTS_PER_DAG} alert rules per DAG")

    rule = AlertRule(
        id=str(uuid.uuid4()),
        dag_id=dag_id,
        name=body.name,
        metric_type=body.metric_type,
        node_id=body.node_id,
        condition=body.condition,
        threshold=body.threshold,
        duration_seconds=body.duration_seconds,
        severity=AlertSeverity(body.severity),
        silence_start=body.silence_start,
        silence_end=body.silence_end,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/rules/{rule_id}", response_model=AlertRuleOut)
async def update_alert_rule(rule_id: str, body: AlertRuleCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")

    rule.name = body.name
    rule.metric_type = body.metric_type
    rule.node_id = body.node_id
    rule.condition = body.condition
    rule.threshold = body.threshold
    rule.duration_seconds = body.duration_seconds
    rule.severity = AlertSeverity(body.severity)
    rule.silence_start = body.silence_start
    rule.silence_end = body.silence_end
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_alert_rule(rule_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    await db.delete(rule)
    await db.commit()


@router.get("/history/{dag_id}", response_model=list[AlertHistoryOut])
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
