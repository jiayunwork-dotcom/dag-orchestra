from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session


async def _migrate_add_dag_nodes_edges():
    async with engine.begin() as conn:
        try:
            cols = await conn.execute(text("PRAGMA table_info(dags)"))
            col_names = {c[1] for c in cols.fetchall()}
            if "nodes" not in col_names:
                await conn.execute(text("ALTER TABLE dags ADD COLUMN nodes JSON DEFAULT '[]'"))
            if "edges" not in col_names:
                await conn.execute(text("ALTER TABLE dags ADD COLUMN edges JSON DEFAULT '[]'"))
        except Exception:
            pass


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_add_dag_nodes_edges()
