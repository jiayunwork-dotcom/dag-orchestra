from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://dag:dag_secret_2024@postgres:5432/dag_orchestra"
    REDIS_URL: str = "redis://redis:6379/0"
    CORS_ORIGINS: str = "http://localhost:8080"
    SECRET_KEY: str = "dag-orchestra-secret-key-change-in-production"
    CHECKPOINT_INTERVAL: int = 60
    CHECKPOINT_RETENTION: int = 10
    MAX_NODES_PER_DAG: int = 100
    MAX_VERSIONS: int = 100
    MAX_ALERTS_PER_DAG: int = 20
    PYTHON_UDF_TIMEOUT: int = 30
    MAX_SQL_LENGTH: int = 10000
    MIN_WINDOW_DURATION: int = 10
    MAX_WINDOW_DURATION: int = 86400
    MAX_JOIN_WINDOW: int = 3600
    GRAYSCALE_RATIOS: list = [10, 30, 50, 100]
    BACKPRESSURE_DELAY_MS: int = 100

    class Config:
        env_file = ".env"


settings = Settings()
