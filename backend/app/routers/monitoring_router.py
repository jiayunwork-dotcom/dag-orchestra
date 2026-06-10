import asyncio
import json
import time
import uuid
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import DAG, DAGStatus, Checkpoint, AlertRule, AlertHistory, AlertSeverity, AlertStatus
from app.schemas import NodeMetrics, DAGMetrics, MetricsTimeSeries, DataSample, LogEntry, NodeLogResponse

router = APIRouter(prefix="/monitoring", tags=["monitoring"])
ws_router = APIRouter(tags=["monitoring-ws"])

_metrics_store: dict[str, dict[str, NodeMetrics]] = {}
_time_series: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
_checkpoints: dict[str, dict] = {}
_running_dags: dict[str, dict] = {}


async def _simulate_node_metrics(dag_id: str, node_ids: list[str]):
    import random
    if dag_id not in _metrics_store:
        _metrics_store[dag_id] = {}
    for nid in node_ids:
        throughput = random.uniform(50, 2000)
        latency = random.uniform(10, 800)
        backlog = random.randint(0, 500)
        error_rate = random.uniform(0, 0.05)
        health = "green" if latency < 100 else ("yellow" if latency < 500 else "red")
        _metrics_store[dag_id][nid] = NodeMetrics(
            node_id=nid, throughput=throughput, latency_ms=latency,
            backlog=backlog, error_rate=error_rate, health=health
        )
        ts = _time_series[dag_id][nid]
        ts.append({
            "timestamp": datetime.utcnow().isoformat(),
            "throughput": throughput,
            "latency": latency,
            "error_rate": error_rate,
        })
        if len(ts) > 720:
            ts.pop(0)


@router.get("/dashboard")
async def global_dashboard(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAG))
    all_dags = result.scalars().all()
    running = [d for d in all_dags if d.status in (DAGStatus.RUNNING, DAGStatus.GRAYSCALE)]
    total_throughput = sum(
        sum(m.throughput for m in _metrics_store.get(d.id, {}).values())
        for d in running
    )
    total_latency = 0
    count = 0
    for d in running:
        for m in _metrics_store.get(d.id, {}).values():
            total_latency += m.latency_ms
            count += 1
    avg_latency = total_latency / count if count > 0 else 0
    failed = sum(1 for d in all_dags if d.status == DAGStatus.STOPPED)
    cp_rate = 100.0
    return {
        "total_throughput": total_throughput,
        "total_latency": avg_latency,
        "active_dags": len(running),
        "failed_tasks": failed,
        "checkpoint_success_rate": cp_rate,
    }


@router.get("/{dag_id}/metrics", response_model=DAGMetrics)
async def dag_metrics(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="DAG not found")

    node_metrics = list(_metrics_store.get(dag_id, {}).values())
    total_t = sum(m.throughput for m in node_metrics)
    avg_l = sum(m.latency_ms for m in node_metrics) / len(node_metrics) if node_metrics else 0

    return DAGMetrics(
        dag_id=dag_id,
        total_throughput=total_t,
        total_latency=avg_l,
        node_metrics=node_metrics,
    )


@router.get("/{dag_id}/metrics/{node_id}", response_model=MetricsTimeSeries)
async def node_timeseries(dag_id: str, node_id: str):
    ts = _time_series.get(dag_id, {}).get(node_id, [])
    recent = ts[-720:]
    return MetricsTimeSeries(
        timestamps=[e["timestamp"] for e in recent],
        throughput=[e["throughput"] for e in recent],
        latency=[e["latency"] for e in recent],
        error_rate=[e["error_rate"] for e in recent],
    )


@router.post("/{dag_id}/checkpoint")
async def create_checkpoint(dag_id: str, db: AsyncSession = Depends(get_db)):
    state = _checkpoints.get(dag_id, {})
    cp = Checkpoint(
        id=str(uuid.uuid4()),
        dag_id=dag_id,
        state_data=state,
    )
    db.add(cp)
    await db.commit()

    cps = await db.execute(
        select(Checkpoint).where(Checkpoint.dag_id == dag_id).order_by(Checkpoint.created_at.asc())
    )
    all_cps = cps.scalars().all()
    while len(all_cps) > settings.CHECKPOINT_RETENTION:
        await db.delete(all_cps[0])
        all_cps.pop(0)
        await db.commit()

    return {"status": "checkpoint_created"}


@router.get("/{dag_id}/checkpoints")
async def list_checkpoints(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Checkpoint).where(Checkpoint.dag_id == dag_id).order_by(Checkpoint.created_at.desc())
    )
    cps = result.scalars().all()
    return [{"id": c.id, "created_at": c.created_at.isoformat()} for c in cps]


@ws_router.websocket("/monitoring/{dag_id}")
async def metrics_websocket(websocket: WebSocket, dag_id: str):
    await websocket.accept()
    db = None
    try:
        from app.database import async_session
        db = async_session()
        result = await db.execute(select(DAG).where(DAG.id == dag_id))
        dag = result.scalar_one_or_none()
        if not dag:
            await websocket.close()
            return

        from app.models import DAGVersion
        from app.schemas import NodeData
        ver = await db.execute(
            select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc()).limit(1)
        )
        latest = ver.scalar_one_or_none()
        node_ids = [n["id"] for n in (latest.nodes or [])] if latest else []
        edges = latest.edges or [] if latest else []

        if not edges and dag:
            dag_nodes = dag.nodes or []
            dag_edges = dag.edges or []
            if not node_ids and dag_nodes:
                node_ids = [n["id"] if isinstance(n, dict) else n.id for n in dag_nodes]
            if not edges and dag_edges:
                edges = dag_edges

        while True:
            await _simulate_node_metrics(dag_id, node_ids)
            metrics = list(_metrics_store.get(dag_id, {}).values())

            from app.routers.engine_router import _paused_nodes
            paused = list(_paused_nodes.get(dag_id, set()))

            edge_throughput = {}
            for e in edges:
                src_id = e.get("source_id") if isinstance(e, dict) else e.source_id
                tgt_id = e.get("target_id") if isinstance(e, dict) else e.target_id
                src_metrics = _metrics_store.get(dag_id, {}).get(src_id)
                if src_metrics:
                    edge_throughput[e.get("id") if isinstance(e, dict) else e.id] = src_metrics.throughput

            await websocket.send_json({
                "metrics": [m.model_dump() for m in metrics],
                "paused_nodes": paused,
                "edge_throughput": edge_throughput,
            })
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
    finally:
        if db:
            await db.close()
