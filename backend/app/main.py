import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import (
    auth_router,
    dag_router,
    alert_router,
    alert_ws_router,
    comment_router,
    monitoring_router,
    monitoring_ws_router,
    engine_router,
    collab_router,
    schedule_router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from app.routers.alert_router import _evaluate_rules_loop
    from app.routers.schedule_router import _schedule_loop
    eval_task = asyncio.create_task(_evaluate_rules_loop())
    schedule_task = asyncio.create_task(_schedule_loop())
    yield
    eval_task.cancel()
    schedule_task.cancel()


app = FastAPI(title="DAG Orchestra", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(dag_router, prefix="/api")
app.include_router(alert_router, prefix="/api")
app.include_router(comment_router, prefix="/api")
app.include_router(monitoring_router, prefix="/api")
app.include_router(engine_router, prefix="/api")
app.include_router(collab_router, prefix="/ws")
app.include_router(monitoring_ws_router, prefix="/ws")
app.include_router(alert_ws_router, prefix="/ws")
app.include_router(schedule_router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
