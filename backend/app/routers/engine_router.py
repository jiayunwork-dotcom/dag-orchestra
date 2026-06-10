import asyncio
import json
import time
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import DAG, DAGStatus, DAGVersion, Checkpoint
from app.schemas import NodeData, EdgeData

router = APIRouter(prefix="/engine", tags=["engine"])

_running_instances: dict[str, dict] = {}
_backpressure_state: dict[str, dict] = {}
_paused_nodes: dict[str, set] = {}
_node_logs: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
_node_samples: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))


class StreamingEngine:
    def __init__(self, dag_id: str, nodes: list[NodeData], edges: list[EdgeData]):
        self.dag_id = dag_id
        self.nodes = {n.id: n for n in nodes}
        self.edges = edges
        self.adj = defaultdict(list)
        self.reverse_adj = defaultdict(list)
        self.queues: dict[str, asyncio.Queue] = {}
        self.window_states: dict[str, dict] = {}
        self.running = False
        self.last_checkpoint = time.time()

        for e in edges:
            self.adj[e.source_id].append(e.target_id)
            self.reverse_adj[e.target_id].append(e.source_id)
            if e.source_id not in self.queues:
                self.queues[e.source_id] = asyncio.Queue(maxsize=10000)
            if e.target_id not in self.queues:
                self.queues[e.target_id] = asyncio.Queue(maxsize=10000)

    async def process_node(self, node_id: str):
        node = self.nodes[node_id]
        q = self.queues.get(node_id, asyncio.Queue(maxsize=10000))
        while self.running:
            paused = node_id in _paused_nodes.get(self.dag_id, set())
            if paused:
                await asyncio.sleep(0.5)
                continue

            try:
                data = await asyncio.wait_for(q.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            if q.qsize() > 8000:
                for src_id in self.reverse_adj.get(node_id, []):
                    _backpressure_state[self.dag_id] = {
                        "source": src_id,
                        "target": node_id,
                        "timestamp": time.time(),
                    }

            try:
                result = await self._execute_node(node, data)
                self._add_log(node_id, "INFO", f"Processed data record successfully")
            except Exception as e:
                result = {"_error": True, "_original": data}
                self._add_log(node_id, "ERROR", str(e))

            if result:
                samples = _node_samples[self.dag_id][node_id]
                samples.append(result)
                if len(samples) > 10:
                    _node_samples[self.dag_id][node_id] = samples[-10:]

            for target_id in self.adj[node_id]:
                if result:
                    target_q = self.queues.get(target_id, asyncio.Queue(maxsize=10000))
                    try:
                        target_q.put_nowait(result)
                    except asyncio.QueueFull:
                        self._add_log(node_id, "ERROR", f"Queue full for target {target_id}")

            if time.time() - self.last_checkpoint >= settings.CHECKPOINT_INTERVAL:
                await self._save_checkpoint()
                self.last_checkpoint = time.time()

    def _add_log(self, node_id: str, level: str, message: str):
        logs = _node_logs[self.dag_id][node_id]
        logs.append({
            "timestamp": datetime.utcnow().isoformat(),
            "level": level,
            "message": message,
        })
        if len(logs) > 100:
            _node_logs[self.dag_id][node_id] = logs[-100:]

    async def _execute_node(self, node: NodeData, data: dict) -> Optional[dict]:
        ntype = node.type.value

        if ntype in ("kafka_source", "http_source", "poll_source"):
            return data

        if ntype == "sql_transform":
            return data

        if ntype == "python_udf":
            try:
                result = await asyncio.wait_for(
                    self._run_udf(node.config.python_code, data),
                    timeout=settings.PYTHON_UDF_TIMEOUT,
                )
                return result
            except asyncio.TimeoutError:
                return {"_error": True, "_original": data, "_reason": "UDF timeout"}

        if ntype in ("field_map", "type_cast"):
            return data

        if ntype in ("count_agg", "sum_agg", "avg_agg", "window_agg"):
            return data

        if ntype in ("tumbling_window", "sliding_window", "session_window"):
            return await self._process_window(node, data)

        if ntype in ("stream_join", "dim_join"):
            return data

        if ntype in ("db_sink", "redis_sink", "kafka_sink", "http_sink", "file_sink"):
            return data

        return data

    async def _run_udf(self, code: str, data: dict) -> dict:
        local_vars = {"data": data, "result": None}

        def _exec():
            exec(code, {}, local_vars)

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _exec)
        return local_vars.get("result", data)

    async def _process_window(self, node: NodeData, data: dict) -> Optional[dict]:
        nid = node.id
        if nid not in self.window_states:
            self.window_states[nid] = {"buffer": [], "last_trigger": time.time()}

        state = self.window_states[nid]
        state["buffer"].append(data)

        ntype = node.type.value
        duration = node.config.window_duration or 60
        now = time.time()

        should_trigger = False
        if ntype == "tumbling_window":
            if now - state["last_trigger"] >= duration:
                should_trigger = True
        elif ntype == "sliding_window":
            slide = node.config.window_slide or duration // 2
            if now - state["last_trigger"] >= slide:
                should_trigger = True
        elif ntype == "session_window":
            gap = node.config.session_gap or 30
            if now - state.get("last_data_time", now) >= gap:
                should_trigger = True

        state["last_data_time"] = now

        if should_trigger:
            result = {"_window_results": state["buffer"], "_count": len(state["buffer"])}
            state["buffer"] = []
            state["last_trigger"] = now
            return result

        return None

    async def _save_checkpoint(self):
        from app.database import async_session
        state_data = {
            "window_states": {k: {"last_trigger": v["last_trigger"], "count": len(v["buffer"])}
                              for k, v in self.window_states.items()},
            "timestamp": time.time(),
        }
        async with async_session() as db:
            cp = Checkpoint(
                id=str(uuid.uuid4()),
                dag_id=self.dag_id,
                state_data=state_data,
            )
            db.add(cp)
            await db.commit()

    async def start(self):
        self.running = True
        tasks = []
        for node_id in self.nodes:
            tasks.append(asyncio.create_task(self.process_node(node_id)))
        self._tasks = tasks

    async def stop(self):
        self.running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)


async def start_engine(dag_id: str, db: AsyncSession):
    ver_result = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc()).limit(1)
    )
    latest = ver_result.scalar_one_or_none()
    if not latest:
        raise HTTPException(status_code=400, detail="No version to run")

    nodes = [NodeData(**n) for n in (latest.nodes or [])]
    edges = [EdgeData(**e) for e in (latest.edges or [])]

    engine = StreamingEngine(dag_id, nodes, edges)
    _running_instances[dag_id] = {"engine": engine, "started_at": datetime.utcnow()}
    await engine.start()


async def stop_engine(dag_id: str):
    instance = _running_instances.get(dag_id)
    if instance:
        await instance["engine"].stop()
        del _running_instances[dag_id]


@router.post("/{dag_id}/start")
async def start_dag_engine(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")
    if dag_id in _running_instances:
        raise HTTPException(status_code=400, detail="DAG already running")

    dag.status = DAGStatus.RUNNING
    await db.commit()
    await start_engine(dag_id, db)
    return {"status": "running"}


@router.post("/{dag_id}/stop")
async def stop_dag_engine(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    await stop_engine(dag_id)
    dag.status = DAGStatus.STOPPED
    await db.commit()
    return {"status": "stopped"}


@router.get("/{dag_id}/status")
async def engine_status(dag_id: str):
    instance = _running_instances.get(dag_id)
    if not instance:
        return {"running": False}
    bp = _backpressure_state.get(dag_id)
    return {
        "running": True,
        "started_at": instance["started_at"].isoformat(),
        "backpressure": bp is not None and (time.time() - bp.get("timestamp", 0)) < 5,
        "paused_nodes": list(_paused_nodes.get(dag_id, set())),
    }


@router.post("/{dag_id}/nodes/{node_id}/pause")
async def pause_node(dag_id: str, node_id: str):
    if dag_id not in _running_instances:
        raise HTTPException(status_code=400, detail="DAG not running")
    if dag_id not in _paused_nodes:
        _paused_nodes[dag_id] = set()
    _paused_nodes[dag_id].add(node_id)
    return {"status": "paused", "node_id": node_id}


@router.post("/{dag_id}/nodes/{node_id}/resume")
async def resume_node(dag_id: str, node_id: str):
    if dag_id in _paused_nodes:
        _paused_nodes[dag_id].discard(node_id)
    return {"status": "resumed", "node_id": node_id}


@router.get("/{dag_id}/nodes/{node_id}/samples")
async def get_node_samples(dag_id: str, node_id: str):
    samples = _node_samples.get(dag_id, {}).get(node_id, [])
    return {"node_id": node_id, "samples": samples[-10:]}


@router.get("/{dag_id}/nodes/{node_id}/logs")
async def get_node_logs(dag_id: str, node_id: str, level: Optional[str] = None):
    logs = _node_logs.get(dag_id, {}).get(node_id, [])
    if level:
        logs = [l for l in logs if l.get("level") == level]
    return {"node_id": node_id, "logs": logs[-100:]}
