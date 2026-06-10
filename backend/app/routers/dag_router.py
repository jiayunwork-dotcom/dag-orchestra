import uuid
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_role, UserRole
from app.config import settings
from app.database import get_db
from app.models import DAG, DAGStatus, DAGVersion, DAGPermission, User
from app.schemas import (
    DAGCreate, DAGUpdate, DAGOut, DAGDetail, NodeData, EdgeData,
    ValidationResult, VersionOut, VersionDiff, GrayscaleUpdate, PublishRequest,
    Position,
)

router = APIRouter(prefix="/dags", tags=["dags"])


def _detect_cycles(nodes: list[NodeData], edges: list[EdgeData]) -> list[str]:
    adj = defaultdict(list)
    for e in edges:
        adj[e.source_id].append(e.target_id)

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n.id: WHITE for n in nodes}
    cycle_nodes = set()

    def dfs(node_id):
        color[node_id] = GRAY
        for nb in adj[node_id]:
            if color[nb] == GRAY:
                cycle_nodes.add(nb)
                cycle_nodes.add(node_id)
                return True
            if color[nb] == WHITE and dfs(nb):
                if node_id in cycle_nodes or any(color.get(x) == GRAY for x in adj[node_id]):
                    cycle_nodes.add(node_id)
                return True
        color[node_id] = BLACK
        return False

    for n in nodes:
        if color[n.id] == WHITE:
            dfs(n.id)
    return list(cycle_nodes)


def _find_orphans(nodes: list[NodeData], edges: list[EdgeData]) -> list[str]:
    if not nodes:
        return []
    connected = set()
    for e in edges:
        connected.add(e.source_id)
        connected.add(e.target_id)
    return [n.id for n in nodes if n.id not in connected]


def _check_schemas(nodes: list[NodeData], edges: list[EdgeData]) -> dict:
    errors = {}
    node_map = {n.id: n for n in nodes}
    for e in edges:
        src = node_map.get(e.source_id)
        tgt = node_map.get(e.target_id)
        if not src or not tgt:
            continue
        if src.output_schema and tgt.input_schema:
            src_fields = {f.name: f.type for f in src.output_schema.fields}
            tgt_fields = {f.name: f.type for f in tgt.input_schema.fields}
            mismatches = []
            for name, typ in tgt_fields.items():
                if name not in src_fields:
                    mismatches.append(f"Missing field: {name}")
                elif src_fields[name] != typ:
                    mismatches.append(f"Type mismatch on '{name}': expected {typ}, got {src_fields[name]}")
            if mismatches:
                errors[e.id] = mismatches
    return errors


def _validate_dag(nodes: list[NodeData], edges: list[EdgeData]) -> ValidationResult:
    errors = []
    warnings = []

    if len(nodes) > settings.MAX_NODES_PER_DAG:
        errors.append(f"DAG exceeds maximum of {settings.MAX_NODES_PER_DAG} nodes. Please split into sub-DAGs.")

    cycle_nodes = _detect_cycles(nodes, edges)
    if cycle_nodes:
        errors.append(f"Cycle detected involving nodes: {', '.join(cycle_nodes)}")

    orphan_nodes = _find_orphans(nodes, edges)
    if orphan_nodes:
        warnings.append(f"Orphan nodes detected: {', '.join(orphan_nodes)}")

    unconfigured = [n.id for n in nodes if not n.is_configured]
    if unconfigured:
        errors.append(f"Unconfigured nodes: {', '.join(unconfigured)}")

    for n in nodes:
        if n.type.value == "sql_transform" and n.config.sql_statement:
            if len(n.config.sql_statement) > settings.MAX_SQL_LENGTH:
                errors.append(f"Node '{n.label}': SQL exceeds {settings.MAX_SQL_LENGTH} characters")
        if n.type.value in ("tumbling_window", "sliding_window", "session_window"):
            dur = n.config.window_duration or 0
            if dur < settings.MIN_WINDOW_DURATION:
                errors.append(f"Node '{n.label}': Window duration must be at least {settings.MIN_WINDOW_DURATION}s")
            if dur > settings.MAX_WINDOW_DURATION:
                errors.append(f"Node '{n.label}': Window duration cannot exceed {settings.MAX_WINDOW_DURATION}s")
        if n.type.value == "stream_join":
            jw = n.config.join_window or 0
            if jw > settings.MAX_JOIN_WINDOW:
                errors.append(f"Node '{n.label}': Join window cannot exceed {settings.MAX_JOIN_WINDOW}s")

    schema_errors = _check_schemas(nodes, edges)
    for eid, msgs in schema_errors.items():
        for m in msgs:
            errors.append(f"Edge {eid}: {m}")

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        cycle_nodes=cycle_nodes,
        orphan_nodes=orphan_nodes,
        unconfigured_nodes=unconfigured,
    )


def _auto_layout(nodes: list[NodeData], edges: list[EdgeData]) -> list[NodeData]:
    if not nodes:
        return nodes

    adj = defaultdict(list)
    in_degree = defaultdict(int)
    node_ids = {n.id for n in nodes}

    for e in edges:
        if e.source_id in node_ids and e.target_id in node_ids:
            adj[e.source_id].append(e.target_id)
            in_degree[e.target_id] += 1

    layers = []
    remaining = set(node_ids)
    current = [nid for nid in node_ids if in_degree[nid] == 0]

    while current:
        layers.append(current)
        next_layer = []
        for nid in current:
            remaining.discard(nid)
            for nb in adj[nid]:
                in_degree[nb] -= 1
                if in_degree[nb] == 0 and nb in remaining:
                    next_layer.append(nb)
        current = next_layer

    if remaining:
        for nid in remaining:
            layers.append([nid])

    node_map = {n.id: n for n in nodes}
    h_gap = 280
    v_gap = 120

    for li, layer in enumerate(layers):
        total_height = (len(layer) - 1) * v_gap
        start_y = -total_height / 2
        for ni, nid in enumerate(layer):
            node_map[nid].position = Position(x=li * h_gap + 100, y=start_y + ni * v_gap + 300)

    return list(node_map.values())


@router.get("", response_model=list[DAGOut])
async def list_dags(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAG).order_by(DAG.updated_at.desc()))
    return result.scalars().all()


@router.post("", response_model=DAGOut, status_code=201)
async def create_dag(body: DAGCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    dag = DAG(id=str(uuid.uuid4()), name=body.name, description=body.description, owner_id=user.id)
    db.add(dag)
    await db.commit()
    await db.refresh(dag)
    return dag


@router.get("/{dag_id}", response_model=DAGDetail)
async def get_dag(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    ver_result = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc()).limit(1)
    )
    latest = ver_result.scalar_one_or_none()

    nodes_data = []
    edges_data = []
    if latest:
        nodes_data = [NodeData(**n) for n in (latest.nodes or [])]
        edges_data = [EdgeData(**e) for e in (latest.edges or [])]

    return DAGDetail(
        id=dag.id,
        name=dag.name,
        description=dag.description,
        status=dag.status.value,
        grayscale_ratio=dag.grayscale_ratio,
        owner_id=dag.owner_id,
        created_at=dag.created_at,
        updated_at=dag.updated_at,
        nodes=nodes_data,
        edges=edges_data,
    )


@router.put("/{dag_id}", response_model=DAGDetail)
async def update_dag(
    dag_id: str,
    body: DAGUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    perm_result = await db.execute(
        select(DAGPermission).where(DAGPermission.dag_id == dag_id, DAGPermission.user_id == user.id)
    )
    perm = perm_result.scalar_one_or_none()
    if dag.owner_id != user.id and user.role != UserRole.ADMIN and (not perm or not perm.can_edit):
        raise HTTPException(status_code=403, detail="No edit permission")

    if body.name is not None:
        dag.name = body.name
    if body.description is not None:
        dag.description = body.description
    dag.updated_at = datetime.utcnow()

    if body.nodes is not None or body.edges is not None:
        ver_result = await db.execute(
            select(func.max(DAGVersion.version_number)).where(DAGVersion.dag_id == dag_id)
        )
        max_ver = ver_result.scalar() or 0

        current_ver = await db.execute(
            select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc()).limit(1)
        )
        current = current_ver.scalar_one_or_none()
        cur_nodes = current.nodes if current else []
        cur_edges = current.edges if current else []

        new_nodes = [n.model_dump() for n in (body.nodes or [NodeData(**n) for n in cur_nodes])]
        new_edges = [e.model_dump() for e in (body.edges or [EdgeData(**e) for e in cur_edges])]

        if dag.status == DAGStatus.DRAFT and body.nodes is not None and body.edges is not None:
            validation = _validate_dag(body.nodes, body.edges)
            hard_errors = [e for e in validation.errors if not e.startswith("Unconfigured nodes")]
            if hard_errors:
                raise HTTPException(status_code=400, detail={"validation": {
                    "valid": False,
                    "errors": hard_errors,
                    "warnings": validation.warnings + [e for e in validation.errors if e.startswith("Unconfigured nodes")],
                    "cycle_nodes": validation.cycle_nodes,
                    "orphan_nodes": validation.orphan_nodes,
                    "unconfigured_nodes": validation.unconfigured_nodes,
                }})

        version = DAGVersion(
            id=str(uuid.uuid4()),
            dag_id=dag_id,
            version_number=max_ver + 1,
            nodes=new_nodes,
            edges=new_edges,
            created_by=user.id,
        )
        db.add(version)

        total = await db.execute(select(func.count()).where(DAGVersion.dag_id == dag_id))
        if (total.scalar() or 0) > settings.MAX_VERSIONS:
            oldest = await db.execute(
                select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.asc()).limit(1)
            )
            old = oldest.scalar_one_or_none()
            if old:
                old.is_archived = True

    await db.commit()
    await db.refresh(dag)

    latest_ver = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc()).limit(1)
    )
    latest = latest_ver.scalar_one_or_none()

    return DAGDetail(
        id=dag.id,
        name=dag.name,
        description=dag.description,
        status=dag.status.value,
        grayscale_ratio=dag.grayscale_ratio,
        owner_id=dag.owner_id,
        created_at=dag.created_at,
        updated_at=dag.updated_at,
        nodes=[NodeData(**n) for n in (latest.nodes or [])] if latest else [],
        edges=[EdgeData(**e) for e in (latest.edges or [])] if latest else [],
    )


@router.delete("/{dag_id}", status_code=204)
async def delete_dag(dag_id: str, user: User = Depends(require_role(UserRole.ADMIN)), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")
    await db.delete(dag)
    await db.commit()


@router.post("/{dag_id}/validate", response_model=ValidationResult)
async def validate_dag(
    dag_id: str,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    nodes: list[NodeData] = []
    edges: list[EdgeData] = []

    if body and "nodes" in body and "edges" in body:
        nodes = [NodeData(**n) for n in (body.get("nodes") or [])]
        edges = [EdgeData(**e) for e in (body.get("edges") or [])]
    else:
        ver = await db.execute(
            select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc()).limit(1)
        )
        latest = ver.scalar_one_or_none()
        if not latest:
            return ValidationResult(valid=True, errors=[], warnings=["DAG is empty — no nodes to validate"], cycle_nodes=[], orphan_nodes=[], unconfigured_nodes=[])
        nodes = [NodeData(**n) for n in (latest.nodes or [])]
        edges = [EdgeData(**e) for e in (latest.edges or [])]

    if not nodes:
        return ValidationResult(valid=True, errors=[], warnings=["DAG is empty — no nodes to validate"], cycle_nodes=[], orphan_nodes=[], unconfigured_nodes=[])

    return _validate_dag(nodes, edges)


@router.post("/{dag_id}/auto-layout", response_model=list[NodeData])
async def auto_layout(dag_id: str, db: AsyncSession = Depends(get_db)):
    ver = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc()).limit(1)
    )
    latest = ver.scalar_one_or_none()
    if not latest:
        raise HTTPException(status_code=404, detail="No version found")

    nodes = [NodeData(**n) for n in (latest.nodes or [])]
    edges = [EdgeData(**e) for e in (latest.edges or [])]
    return _auto_layout(nodes, edges)


@router.post("/{dag_id}/publish")
async def publish_dag(
    dag_id: str,
    body: PublishRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    ver = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc()).limit(1)
    )
    latest = ver.scalar_one_or_none()
    if latest:
        nodes = [NodeData(**n) for n in (latest.nodes or [])]
        edges = [EdgeData(**e) for e in (latest.edges or [])]
        validation = _validate_dag(nodes, edges)
        if not validation.valid:
            raise HTTPException(status_code=400, detail={"validation": validation.model_dump()})

    if body.grayscale_ratio > 0:
        if body.grayscale_ratio not in settings.GRAYSCALE_RATIOS:
            raise HTTPException(status_code=400, detail=f"Invalid grayscale ratio. Must be one of {settings.GRAYSCALE_RATIOS}")
        dag.status = DAGStatus.GRAYSCALE
        dag.grayscale_ratio = body.grayscale_ratio
    else:
        dag.status = DAGStatus.RUNNING
        dag.grayscale_ratio = 100

    dag.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": dag.status.value, "grayscale_ratio": dag.grayscale_ratio}


@router.post("/{dag_id}/stop")
async def stop_dag(dag_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")
    dag.status = DAGStatus.STOPPED
    dag.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": dag.status.value}


@router.put("/{dag_id}/grayscale", response_model=dict)
async def update_grayscale(
    dag_id: str,
    body: GrayscaleUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.ratio not in settings.GRAYSCALE_RATIOS:
        raise HTTPException(status_code=400, detail=f"Invalid grayscale ratio. Must be one of {settings.GRAYSCALE_RATIOS}")

    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    dag.grayscale_ratio = body.ratio
    if body.ratio == 100:
        dag.status = DAGStatus.RUNNING
    elif body.ratio > 0:
        dag.status = DAGStatus.GRAYSCALE
    dag.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": dag.status.value, "grayscale_ratio": dag.grayscale_ratio}


@router.post("/{dag_id}/rollback/{version_number}")
async def rollback_dag(
    dag_id: str,
    version_number: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ver = await db.execute(
        select(DAGVersion).where(
            DAGVersion.dag_id == dag_id,
            DAGVersion.version_number == version_number,
        )
    )
    version = ver.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.is_archived:
        raise HTTPException(status_code=400, detail="Cannot rollback to archived version")

    result = await db.execute(select(DAG).where(DAG.id == dag_id))
    dag = result.scalar_one_or_none()
    if not dag:
        raise HTTPException(status_code=404, detail="DAG not found")

    max_ver = await db.execute(select(func.max(DAGVersion.version_number)).where(DAGVersion.dag_id == dag_id))
    new_ver_num = (max_ver.scalar() or 0) + 1

    new_version = DAGVersion(
        id=str(uuid.uuid4()),
        dag_id=dag_id,
        version_number=new_ver_num,
        nodes=version.nodes,
        edges=version.edges,
        created_by=user.id,
    )
    db.add(new_version)
    dag.updated_at = datetime.utcnow()
    await db.commit()
    return {"version": new_ver_num, "status": "rolled back"}


@router.get("/{dag_id}/versions", response_model=list[VersionOut])
async def list_versions(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id).order_by(DAGVersion.version_number.desc())
    )
    return result.scalars().all()


@router.get("/{dag_id}/versions/{version_number}", response_model=VersionOut)
async def get_version(dag_id: str, version_number: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id, DAGVersion.version_number == version_number)
    )
    ver = result.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Version not found")
    return ver


@router.get("/{dag_id}/versions/{v1}/diff/{v2}", response_model=VersionDiff)
async def diff_versions(dag_id: str, v1: int, v2: int, db: AsyncSession = Depends(get_db)):
    result1 = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id, DAGVersion.version_number == v1)
    )
    ver1 = result1.scalar_one_or_none()
    result2 = await db.execute(
        select(DAGVersion).where(DAGVersion.dag_id == dag_id, DAGVersion.version_number == v2)
    )
    ver2 = result2.scalar_one_or_none()
    if not ver1 or not ver2:
        raise HTTPException(status_code=404, detail="Version not found")

    nodes1 = {n["id"]: n for n in (ver1.nodes or [])}
    nodes2 = {n["id"]: n for n in (ver2.nodes or [])}
    edges1 = {e["id"]: e for e in (ver1.edges or [])}
    edges2 = {e["id"]: e for e in (ver2.edges or [])}

    added_nodes = [NodeData(**nodes2[nid]) for nid in nodes2 if nid not in nodes1]
    removed_nodes = [NodeData(**nodes1[nid]) for nid in nodes1 if nid not in nodes2]
    modified_nodes = []
    for nid in nodes1:
        if nid in nodes2 and nodes1[nid] != nodes2[nid]:
            modified_nodes.append({"id": nid, "before": nodes1[nid], "after": nodes2[nid]})

    added_edges = [EdgeData(**edges2[eid]) for eid in edges2 if eid not in edges1]
    removed_edges = [EdgeData(**edges1[eid]) for eid in edges1 if eid not in edges2]
    modified_edges = []
    for eid in edges1:
        if eid in edges2 and edges1[eid] != edges2[eid]:
            modified_edges.append({"id": eid, "before": edges1[eid], "after": edges2[eid]})

    return VersionDiff(
        added_nodes=added_nodes,
        removed_nodes=removed_nodes,
        modified_nodes=modified_nodes,
        added_edges=added_edges,
        removed_edges=removed_edges,
        modified_edges=modified_edges,
    )


@router.get("/{dag_id}/permissions", response_model=list[dict])
async def get_permissions(dag_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DAGPermission).where(DAGPermission.dag_id == dag_id))
    perms = result.scalars().all()
    return [{"user_id": p.user_id, "can_edit": p.can_edit} for p in perms]


@router.put("/{dag_id}/permissions")
async def set_permissions(dag_id: str, perms: list[dict], user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    for p in perms:
        existing = await db.execute(
            select(DAGPermission).where(DAGPermission.dag_id == dag_id, DAGPermission.user_id == p["user_id"])
        )
        perm = existing.scalar_one_or_none()
        if perm:
            perm.can_edit = p["can_edit"]
        else:
            db.add(DAGPermission(dag_id=dag_id, user_id=p["user_id"], can_edit=p["can_edit"]))
    await db.commit()
    return {"status": "ok"}
