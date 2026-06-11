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
            cols = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'dags'"
            ))
            col_names = {c[0] for c in cols.fetchall()}
            if "nodes" not in col_names:
                await conn.execute(text("ALTER TABLE dags ADD COLUMN nodes JSON DEFAULT '[]'"))
            if "edges" not in col_names:
                await conn.execute(text("ALTER TABLE dags ADD COLUMN edges JSON DEFAULT '[]'"))
        except Exception:
            pass


async def _migrate_alert_tables():
    async with engine.begin() as conn:
        try:
            alert_rule_cols = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'alert_rules'"
            ))
            alert_rule_col_names = {c[0] for c in alert_rule_cols.fetchall()}

            if alert_rule_col_names:
                if "is_valid" not in alert_rule_col_names:
                    await conn.execute(text(
                        "ALTER TABLE alert_rules ADD COLUMN is_valid BOOLEAN DEFAULT TRUE"
                    ))
                if "invalid_reason" not in alert_rule_col_names:
                    await conn.execute(text(
                        "ALTER TABLE alert_rules ADD COLUMN invalid_reason VARCHAR(200)"
                    ))
                if "node_id" in alert_rule_col_names:
                    await conn.execute(text(
                        "ALTER TABLE alert_rules ALTER COLUMN node_id SET NOT NULL"
                    ))

            alert_hist_cols = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'alert_history'"
            ))
            alert_hist_col_names = {c[0] for c in alert_hist_cols.fetchall()}

            if alert_hist_col_names:
                new_columns = [
                    ("rule_name", "VARCHAR(200) NOT NULL DEFAULT ''"),
                    ("dag_name", "VARCHAR(200) NOT NULL DEFAULT ''"),
                    ("metric_type", "VARCHAR(50) NOT NULL DEFAULT ''"),
                    ("node_id", "VARCHAR NOT NULL DEFAULT ''"),
                    ("threshold", "FLOAT NOT NULL DEFAULT 0"),
                    ("condition", "VARCHAR(20) NOT NULL DEFAULT ''"),
                    ("severity", "VARCHAR(20) NOT NULL DEFAULT 'warning'"),
                    ("context_snapshot", "JSON DEFAULT '{}'"),
                ]

                for col_name, col_def in new_columns:
                    if col_name not in alert_hist_col_names:
                        try:
                            await conn.execute(text(f"ALTER TABLE alert_history ADD COLUMN {col_name} {col_def}"))
                        except Exception:
                            pass
        except Exception as e:
            print(f"Migration warning: {e}")
            pass


async def _migrate_enums_and_schedule_tables():
    try:
        has_timeout = False
        enum_exists = False
        async with engine.connect() as conn:
            rows = await conn.execute(text(
                "SELECT t.typname, e.enumlabel "
                "FROM pg_type t "
                "JOIN pg_enum e ON t.oid = e.enumtypid "
                "WHERE t.typname = 'executionstatus'"
            ))
            result = rows.fetchall()
            if result:
                enum_exists = True
                has_timeout = any(r[1] == 'timeout' for r in result)

        if enum_exists and not has_timeout:
            try:
                async with engine.connect() as conn:
                    ac = await conn.get_raw_connection()
                    try:
                        await ac.driver_connection.execute("ALTER TYPE executionstatus ADD VALUE 'timeout'")
                    except Exception as e:
                        msg = str(e).lower()
                        if 'already exists' not in msg and 'duplicate' not in msg:
                            print(f"Add executionstatus timeout via raw warning: {e}")
                    finally:
                        pass
            except Exception as e:
                print(f"Add executionstatus timeout warning: {e}")

        sched_type_exists = False
        async with engine.connect() as conn:
            rows = await conn.execute(text(
                "SELECT 1 FROM pg_type WHERE typname = 'scheduleoperationtype' LIMIT 1"
            ))
            sched_type_exists = rows.fetchone() is not None

        if not sched_type_exists:
            try:
                async with engine.connect() as conn:
                    ac = await conn.get_raw_connection()
                    try:
                        await ac.driver_connection.execute(
                            "CREATE TYPE scheduleoperationtype AS ENUM ('enable', 'disable', 'edit', 'delete', 'create')"
                        )
                    except Exception as e:
                        msg = str(e).lower()
                        if 'already exists' not in msg:
                            print(f"Create scheduleoperationtype warning: {e}")
            except Exception as e:
                print(f"Create scheduleoperationtype outer warning: {e}")

        table_exists = False
        async with engine.connect() as conn:
            rows = await conn.execute(text(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'schedule_operation_logs')"
            ))
            table_exists = rows.scalar() or False

        if not table_exists:
            async with engine.begin() as conn:
                try:
                    await conn.execute(text(
                        """
                        CREATE TABLE IF NOT EXISTS schedule_operation_logs (
                            id VARCHAR PRIMARY KEY,
                            dag_id VARCHAR NOT NULL REFERENCES dags(id) ON DELETE CASCADE,
                            operation_type scheduleoperationtype NOT NULL,
                            before_data JSON,
                            after_data JSON,
                            changed_fields JSON DEFAULT '[]',
                            summary VARCHAR(500),
                            operated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                        """
                    ))
                except Exception as e:
                    print(f"Create schedule_operation_logs warning: {e}")

        async with engine.begin() as conn:
            try:
                idx_rows = await conn.execute(text(
                    "SELECT indexname FROM pg_indexes WHERE tablename = 'schedule_operation_logs' AND indexname = 'ix_sched_op_dag'"
                ))
                if not idx_rows.fetchone():
                    await conn.execute(text(
                        "CREATE INDEX IF NOT EXISTS ix_sched_op_dag ON schedule_operation_logs (dag_id, operated_at)"
                    ))
            except Exception:
                pass

    except Exception as e:
        print(f"Migration enums/schedule warning: {e}")
        pass


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_add_dag_nodes_edges()
    await _migrate_alert_tables()
    await _migrate_enums_and_schedule_tables()
