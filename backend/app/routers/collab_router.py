import asyncio
import json
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.database import async_session
from app.models import DAG, DAGVersion, User
from app.schemas import CollabCursor, NodeData

router = APIRouter(tags=["collaboration"])

_room_connections: dict[str, dict[str, WebSocket]] = {}
_room_cursors: dict[str, dict[str, CollabCursor]] = {}
_room_states: dict[str, dict] = {}
_conflict_tracker: dict[str, dict] = {}


@router.websocket("/ws/collab/{dag_id}")
async def collab_websocket(websocket: WebSocket, dag_id: str):
    await websocket.accept()
    user_id = None

    try:
        init_msg = await websocket.receive_json()
        user_id = init_msg.get("user_id", "anonymous")
        username = init_msg.get("username", "Anonymous")
        avatar_color = init_msg.get("avatar_color", "#4A90D9")

        if dag_id not in _room_connections:
            _room_connections[dag_id] = {}
            _room_cursors[dag_id] = {}
            _room_states[dag_id] = {}
            _conflict_tracker[dag_id] = {}

        _room_connections[dag_id][user_id] = websocket
        _room_cursors[dag_id][user_id] = CollabCursor(
            user_id=user_id, username=username, avatar_color=avatar_color,
            x=0, y=0, selected_nodes=[],
        )

        async with async_session() as db:
            ver = await db.execute(
                select(DAGVersion).where(DAGVersion.dag_id == dag_id)
                .order_by(DAGVersion.version_number.desc()).limit(1)
            )
            latest = ver.scalar_one_or_none()
            if latest:
                await websocket.send_json({
                    "type": "full_sync",
                    "nodes": latest.nodes or [],
                    "edges": latest.edges or [],
                })

        for uid, ws in _room_connections[dag_id].items():
            if uid != user_id:
                try:
                    await ws.send_json({
                        "type": "user_joined",
                        "user_id": user_id,
                        "username": username,
                        "avatar_color": avatar_color,
                    })
                except Exception:
                    pass

        for uid, cursor in _room_cursors[dag_id].items():
            if uid != user_id:
                await websocket.send_json({
                    "type": "cursor_update",
                    **cursor.model_dump(),
                })

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "cursor_move":
                if user_id in _room_cursors.get(dag_id, {}):
                    _room_cursors[dag_id][user_id].x = data.get("x", 0)
                    _room_cursors[dag_id][user_id].y = data.get("y", 0)
                    _room_cursors[dag_id][user_id].selected_nodes = data.get("selected_nodes", [])

                    for uid, ws in _room_connections[dag_id].items():
                        if uid != user_id:
                            try:
                                await ws.send_json({
                                    "type": "cursor_update",
                                    **_room_cursors[dag_id][user_id].model_dump(),
                                })
                            except Exception:
                                pass

            elif msg_type == "node_update":
                node_id = data.get("node_id")
                node_data = data.get("node_data", {})

                if dag_id in _conflict_tracker and node_id in _conflict_tracker[dag_id]:
                    other_user = _conflict_tracker[dag_id][node_id]
                    await websocket.send_json({
                        "type": "conflict",
                        "node_id": node_id,
                        "conflicting_user": other_user,
                        "message": f"Node {node_id} is being edited by {other_user}. Choose: overwrite or merge?",
                    })
                else:
                    if dag_id not in _conflict_tracker:
                        _conflict_tracker[dag_id] = {}
                    _conflict_tracker[dag_id][node_id] = username

                    for uid, ws in _room_connections[dag_id].items():
                        if uid != user_id:
                            try:
                                await ws.send_json({
                                    "type": "node_update",
                                    "node_id": node_id,
                                    "node_data": node_data,
                                    "updated_by": user_id,
                                })
                            except Exception:
                                pass

            elif msg_type == "node_update_end":
                node_id = data.get("node_id")
                if dag_id in _conflict_tracker and node_id in _conflict_tracker[dag_id]:
                    del _conflict_tracker[dag_id][node_id]

            elif msg_type == "edge_update":
                for uid, ws in _room_connections[dag_id].items():
                    if uid != user_id:
                        try:
                            await ws.send_json({
                                "type": "edge_update",
                                "edge_data": data.get("edge_data"),
                                "updated_by": user_id,
                            })
                        except Exception:
                            pass

            elif msg_type == "conflict_resolution":
                node_id = data.get("node_id")
                action = data.get("action")
                if action == "overwrite":
                    for uid, ws in _room_connections[dag_id].items():
                        try:
                            await ws.send_json({
                                "type": "node_update",
                                "node_id": node_id,
                                "node_data": data.get("node_data"),
                                "updated_by": user_id,
                            })
                        except Exception:
                            pass
                if dag_id in _conflict_tracker and node_id in _conflict_tracker[dag_id]:
                    del _conflict_tracker[dag_id][node_id]

    except WebSocketDisconnect:
        if dag_id in _room_connections and user_id:
            _room_connections[dag_id].pop(user_id, None)
            _room_cursors[dag_id].pop(user_id, None)

            for uid, ws in _room_connections.get(dag_id, {}).items():
                try:
                    await ws.send_json({"type": "user_left", "user_id": user_id})
                except Exception:
                    pass

            if not _room_connections.get(dag_id):
                _room_connections.pop(dag_id, None)
                _room_cursors.pop(dag_id, None)
                _room_states.pop(dag_id, None)
                _conflict_tracker.pop(dag_id, None)
