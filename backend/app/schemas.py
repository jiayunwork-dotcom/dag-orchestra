from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class NodeType(str, enum.Enum):
    KAFKA_SOURCE = "kafka_source"
    HTTP_SOURCE = "http_source"
    POLL_SOURCE = "poll_source"
    SQL_TRANSFORM = "sql_transform"
    PYTHON_UDF = "python_udf"
    FIELD_MAP = "field_map"
    TYPE_CAST = "type_cast"
    COUNT_AGG = "count_agg"
    SUM_AGG = "sum_agg"
    AVG_AGG = "avg_agg"
    WINDOW_AGG = "window_agg"
    TUMBLING_WINDOW = "tumbling_window"
    SLIDING_WINDOW = "sliding_window"
    SESSION_WINDOW = "session_window"
    STREAM_JOIN = "stream_join"
    DIM_JOIN = "dim_join"
    DB_SINK = "db_sink"
    REDIS_SINK = "redis_sink"
    KAFKA_SINK = "kafka_sink"
    HTTP_SINK = "http_sink"
    FILE_SINK = "file_sink"


class WindowType(str, enum.Enum):
    TUMBLING = "tumbling"
    SLIDING = "sliding"
    SESSION = "session"


class SchemaField(BaseModel):
    name: str
    type: str


class NodeSchema(BaseModel):
    fields: list[SchemaField]


class NodeConfig(BaseModel):
    kafka_topic: Optional[str] = None
    kafka_brokers: Optional[str] = None
    kafka_group: Optional[str] = None
    http_url: Optional[str] = None
    http_method: Optional[str] = None
    http_headers: Optional[dict] = None
    poll_url: Optional[str] = None
    poll_interval: Optional[int] = None
    sql_statement: Optional[str] = None
    python_code: Optional[str] = None
    field_mappings: Optional[list[dict]] = None
    type_casts: Optional[list[dict]] = None
    agg_field: Optional[str] = None
    window_type: Optional[WindowType] = None
    window_duration: Optional[int] = None
    window_slide: Optional[int] = None
    session_gap: Optional[int] = None
    join_type: Optional[str] = None
    join_window: Optional[int] = None
    join_condition: Optional[str] = None
    db_connection: Optional[str] = None
    db_table: Optional[str] = None
    redis_key: Optional[str] = None
    redis_ttl: Optional[int] = None
    kafka_sink_topic: Optional[str] = None
    http_sink_url: Optional[str] = None
    file_path: Optional[str] = None
    file_format: Optional[str] = None


class Position(BaseModel):
    x: float
    y: float


class NodeData(BaseModel):
    id: str
    type: NodeType
    label: str
    position: Position
    config: NodeConfig = Field(default_factory=NodeConfig)
    input_schema: Optional[NodeSchema] = None
    output_schema: Optional[NodeSchema] = None
    is_configured: bool = False


class EdgeData(BaseModel):
    id: str
    source_id: str
    source_port: str = "output"
    target_id: str
    target_port: str = "input"
    schema_compatible: bool = True
    schema_errors: list[str] = Field(default_factory=list)


class DAGCreate(BaseModel):
    name: str
    description: str = ""


class DAGUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[list[NodeData]] = None
    edges: Optional[list[EdgeData]] = None


class DAGOut(BaseModel):
    id: str
    name: str
    description: str
    status: str
    grayscale_ratio: int
    owner_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DAGDetail(DAGOut):
    nodes: list[NodeData] = Field(default_factory=list)
    edges: list[EdgeData] = Field(default_factory=list)


class VersionOut(BaseModel):
    id: str
    dag_id: str
    version_number: int
    nodes: list[Any]
    edges: list[Any]
    is_archived: bool
    created_at: datetime
    created_by: Optional[str]

    model_config = {"from_attributes": True}


class VersionDiff(BaseModel):
    added_nodes: list[NodeData]
    removed_nodes: list[NodeData]
    modified_nodes: list[dict]
    added_edges: list[EdgeData]
    removed_edges: list[EdgeData]
    modified_edges: list[dict]


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str]
    warnings: list[str]
    cycle_nodes: list[str]
    orphan_nodes: list[str]
    unconfigured_nodes: list[str]


class NodeMetrics(BaseModel):
    node_id: str
    throughput: float = 0.0
    latency_ms: float = 0.0
    backlog: int = 0
    error_rate: float = 0.0
    health: str = "green"


class DAGMetrics(BaseModel):
    dag_id: str
    total_throughput: float = 0.0
    total_latency: float = 0.0
    active_dags: int = 0
    failed_tasks: int = 0
    checkpoint_success_rate: float = 100.0
    node_metrics: list[NodeMetrics] = Field(default_factory=list)


class MetricsTimeSeries(BaseModel):
    timestamps: list[str]
    throughput: list[float]
    latency: list[float]
    error_rate: list[float]


class AlertRuleCreate(BaseModel):
    name: str
    metric_type: str
    node_id: Optional[str] = None
    condition: str
    threshold: float
    duration_seconds: int = 0
    severity: str = "warning"
    silence_start: Optional[str] = None
    silence_end: Optional[str] = None


class AlertRuleOut(BaseModel):
    id: str
    dag_id: str
    name: str
    metric_type: str
    node_id: Optional[str]
    condition: str
    threshold: float
    duration_seconds: int
    severity: str
    enabled: bool
    silence_start: Optional[str]
    silence_end: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertHistoryOut(BaseModel):
    id: str
    alert_rule_id: str
    dag_id: str
    current_value: float
    duration_seconds: int
    status: str
    triggered_at: datetime
    resolved_at: Optional[datetime]

    model_config = {"from_attributes": True}


class CommentCreate(BaseModel):
    target_type: str
    target_id: str
    content: str
    mention_ids: list[str] = Field(default_factory=list)


class CommentOut(BaseModel):
    id: str
    dag_id: str
    target_type: str
    target_id: str
    content: str
    author_id: str
    mention_ids: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PermissionSet(BaseModel):
    user_id: str
    can_edit: bool = False


class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str = "viewer"


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    role: str
    avatar_color: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class GrayscaleUpdate(BaseModel):
    ratio: int


class PublishRequest(BaseModel):
    grayscale_ratio: int = 0


class DataSample(BaseModel):
    node_id: str
    samples: list[dict] = Field(default_factory=list)


class LogEntry(BaseModel):
    timestamp: str
    level: str
    message: str


class NodeLogResponse(BaseModel):
    node_id: str
    logs: list[LogEntry] = Field(default_factory=list)


class CollabCursor(BaseModel):
    user_id: str
    username: str
    avatar_color: str
    x: float
    y: float
    selected_nodes: list[str] = Field(default_factory=list)
