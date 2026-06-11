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


class SilencePeriod(BaseModel):
    repeat_mode: str = "daily"
    start_time: str
    end_time: str
    weekday: Optional[int] = None
    date: Optional[str] = None


class AlertRuleCreate(BaseModel):
    name: str
    metric_type: str
    node_id: str
    condition: str
    threshold: float
    duration_seconds: int = 0
    severity: str = "warning"
    silence_periods: Optional[list[SilencePeriod]] = None


class AlertRuleOut(BaseModel):
    id: str
    dag_id: str
    dag_name: Optional[str] = None
    name: str
    metric_type: str
    node_id: str
    node_label: Optional[str] = None
    condition: str
    threshold: float
    duration_seconds: int
    severity: str
    enabled: bool
    is_valid: bool
    invalid_reason: Optional[str] = None
    silence_periods: list[SilencePeriod] = Field(default_factory=list)
    is_silenced: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertHistoryOut(BaseModel):
    id: str
    alert_rule_id: str
    dag_id: str
    rule_name: str
    dag_name: str
    metric_type: str
    node_id: str
    current_value: float
    threshold: float
    condition: str
    duration_seconds: int
    severity: str
    status: str
    context_snapshot: dict
    triggered_at: datetime
    resolved_at: Optional[datetime]

    model_config = {"from_attributes": True}


class AlertHistoryDetail(AlertHistoryOut):
    pass


class AlertPushMessage(BaseModel):
    type: str = "alert"
    id: str
    rule_name: str
    dag_id: str
    dag_name: str
    severity: str
    current_value: float
    threshold: float
    triggered_at: datetime


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


class BatchRuleIds(BaseModel):
    rule_ids: list[str]


class BatchOperationResult(BaseModel):
    updated_count: int
    skipped_count: int
    skipped_reason: Optional[str] = None


class SchedulePlanCreate(BaseModel):
    cron_expression: str
    enabled: bool = True
    max_concurrency: int = Field(default=1, ge=1, le=5)
    timeout_seconds: int = Field(default=3600, ge=1)
    retry_count: int = Field(default=0, ge=0, le=3)
    retry_interval: int = Field(default=60, ge=1)


class SchedulePlanUpdate(BaseModel):
    cron_expression: Optional[str] = None
    enabled: Optional[bool] = None
    max_concurrency: Optional[int] = Field(default=None, ge=1, le=5)
    timeout_seconds: Optional[int] = Field(default=None, ge=1)
    retry_count: Optional[int] = Field(default=None, ge=0, le=3)
    retry_interval: Optional[int] = Field(default=None, ge=1)


class SchedulePlanOut(BaseModel):
    id: str
    dag_id: str
    dag_name: Optional[str] = None
    cron_expression: str
    enabled: bool
    max_concurrency: int
    timeout_seconds: int
    retry_count: int
    retry_interval: int
    next_trigger_time: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ExecutionRecordOut(BaseModel):
    id: str
    dag_id: str
    schedule_plan_id: Optional[str] = None
    trigger_type: str
    status: str
    retry_attempt: int
    parent_execution_id: Optional[str] = None
    error_message: Optional[str] = None
    triggered_at: datetime
    finished_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    is_retry: bool = False
    retry_label: Optional[str] = None

    model_config = {"from_attributes": True}


class ExecutionRecordDetail(ExecutionRecordOut):
    pass


class ScheduleOverview(BaseModel):
    today_triggers: int
    today_success_rate: float
    running_count: int
    last_failed_dag_name: Optional[str] = None
    last_failed_time: Optional[datetime] = None
    week_timeout_count: int = 0


class ScheduleListItem(BaseModel):
    plan_id: str
    dag_id: str
    dag_name: str
    cron_expression: str
    enabled: bool
    next_trigger_time: Optional[datetime] = None
    last_execution_status: Optional[str] = None
    last_7d_executions: int = 0
    last_7d_success_rate: float = 0.0


class ScheduleOperationLogOut(BaseModel):
    id: str
    dag_id: str
    operation_type: str
    changed_fields: list[str] = Field(default_factory=list)
    summary: Optional[str] = None
    operated_at: datetime

    model_config = {"from_attributes": True}


class DailyStats(BaseModel):
    date: str
    success: int = 0
    failed: int = 0
    timeout: int = 0


class ExecutionStats(BaseModel):
    daily_stats: list[DailyStats]
    total_executions: int = 0
    success_rate: float = 0.0
    avg_duration_seconds: float = 0.0
    max_duration_seconds: float = 0.0
    has_data: bool = False


class CronPreviewResponse(BaseModel):
    valid: bool
    error_message: Optional[str] = None
    next_times: list[str] = Field(default_factory=list)
