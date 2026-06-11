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
    async with engine.begin() as conn:
        try:
            enum_rows = await conn.execute(text(
                "SELECT t.typname, e.enumlabel "
                "FROM pg_type t "
                "JOIN pg_enum e ON t.oid = e.enumtypid "
                "WHERE t.typname IN ('executionstatus', 'scheduleoperationtype')"
            ))
            enum_map: dict[str, set[str]] = {}
            for typname, enumlabel in enum_rows.fetchall():
                if typname not in enum_map:
                    enum_map[typname] = set()
                enum_map[typname].add(enumlabel)

            execution_status_values = enum_map.get('executionstatus', set())
            if execution_status_values and 'timeout' not in execution_status_values:
                try:
                    await conn.execute(text(
                        "ALTER TYPE executionstatus ADD VALUE 'timeout'"
                    ))
                except Exception as e:
                    print(f"Add executionstatus timeout value warning: {e}")

            table_exists = await conn.execute(text(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'schedule_operation_logs')"
            ))
            schedule_table_exists = table_exists.scalar() or False

            if not schedule_table_exists:
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
                    if 'type "scheduleoperationtype" does not exist' in str(e):
                        try:
                            await conn.execute(text(
                                "CREATE TYPE scheduleoperationtype AS ENUM ('enable', 'disable', 'edit', 'delete', 'create')"
                            ))
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
                        except Exception as e2:
                            print(f"Create schedule tables warning: {e2}")
                    else:
                        print(f"Create schedule_operation_logs warning: {e}")

            try:
                idx_exists = await conn.execute(text(
                    "SELECT indexname FROM pg_indexes WHERE tablename = 'schedule_operation_logs' AND indexname = 'ix_sched_op_dag'"
                ))
                if not idx_exists.fetchone():
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
