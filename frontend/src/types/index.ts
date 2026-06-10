export interface SchemaField {
  name: string;
  type: string;
}

export interface NodeSchema {
  fields: SchemaField[];
}

export interface NodeConfig {
  kafka_topic?: string;
  kafka_brokers?: string;
  kafka_group?: string;
  http_url?: string;
  http_method?: string;
  http_headers?: Record<string, string>;
  poll_url?: string;
  poll_interval?: number;
  sql_statement?: string;
  python_code?: string;
  field_mappings?: Array<{ source: string; target: string }>;
  type_casts?: Array<{ field: string; from_type: string; to_type: string }>;
  agg_field?: string;
  window_type?: 'tumbling' | 'sliding' | 'session';
  window_duration?: number;
  window_slide?: number;
  session_gap?: number;
  join_type?: string;
  join_window?: number;
  join_condition?: string;
  db_connection?: string;
  db_table?: string;
  redis_key?: string;
  redis_ttl?: number;
  kafka_sink_topic?: string;
  http_sink_url?: string;
  file_path?: string;
  file_format?: string;
}

export type NodeType =
  | 'kafka_source' | 'http_source' | 'poll_source'
  | 'sql_transform' | 'python_udf' | 'field_map' | 'type_cast'
  | 'count_agg' | 'sum_agg' | 'avg_agg' | 'window_agg'
  | 'tumbling_window' | 'sliding_window' | 'session_window'
  | 'stream_join' | 'dim_join'
  | 'db_sink' | 'redis_sink' | 'kafka_sink' | 'http_sink' | 'file_sink';

export interface NodeData {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };
  config: NodeConfig;
  input_schema?: NodeSchema;
  output_schema?: NodeSchema;
  is_configured: boolean;
}

export interface EdgeData {
  id: string;
  source_id: string;
  source_port: string;
  target_id: string;
  target_port: string;
  schema_compatible: boolean;
  schema_errors: string[];
}

export interface DAGInfo {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'running' | 'stopped' | 'grayscale';
  grayscale_ratio: number;
  owner_id?: string;
  created_at: string;
  updated_at: string;
}

export interface DAGDetail extends DAGInfo {
  nodes: NodeData[];
  edges: EdgeData[];
}

export interface VersionInfo {
  id: string;
  dag_id: string;
  version_number: number;
  nodes: NodeData[];
  edges: EdgeData[];
  is_archived: boolean;
  created_at: string;
  created_by?: string;
}

export interface VersionDiff {
  added_nodes: NodeData[];
  removed_nodes: NodeData[];
  modified_nodes: Array<{ id: string; before: any; after: any }>;
  added_edges: EdgeData[];
  removed_edges: EdgeData[];
  modified_edges: Array<{ id: string; before: any; after: any }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cycle_nodes: string[];
  orphan_nodes: string[];
  unconfigured_nodes: string[];
}

export interface NodeMetrics {
  node_id: string;
  throughput: number;
  latency_ms: number;
  backlog: number;
  error_rate: number;
  health: 'green' | 'yellow' | 'red';
}

export interface DAGMetrics {
  dag_id: string;
  total_throughput: number;
  total_latency: number;
  node_metrics: NodeMetrics[];
}

export interface MetricsTimeSeries {
  timestamps: string[];
  throughput: number[];
  latency: number[];
  error_rate: number[];
}

export interface DashboardStats {
  total_throughput: number;
  total_latency: number;
  active_dags: number;
  failed_tasks: number;
  checkpoint_success_rate: number;
}

export interface AlertRule {
  id: string;
  dag_id: string;
  name: string;
  metric_type: string;
  node_id?: string;
  condition: string;
  threshold: number;
  duration_seconds: number;
  severity: 'warning' | 'critical';
  enabled: boolean;
  silence_start?: string;
  silence_end?: string;
  created_at: string;
}

export interface AlertHistoryItem {
  id: string;
  alert_rule_id: string;
  dag_id: string;
  current_value: number;
  duration_seconds: number;
  status: 'active' | 'silenced' | 'resolved';
  triggered_at: string;
  resolved_at?: string;
}

export interface Comment {
  id: string;
  dag_id: string;
  target_type: string;
  target_id: string;
  content: string;
  author_id: string;
  mention_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  avatar_color: string;
  created_at: string;
}

export interface CollabCursor {
  user_id: string;
  username: string;
  avatar_color: string;
  x: number;
  y: number;
  selected_nodes: string[];
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface DataSample {
  node_id: string;
  samples: Record<string, any>[];
}

export interface NodeLogResponse {
  node_id: string;
  logs: LogEntry[];
}

export interface EdgeThroughputMap {
  [edgeId: string]: number;
}

export const NODE_CATEGORIES = {
  source: {
    label: '数据源',
    color: '#3b82f6',
    types: [
      { type: 'kafka_source' as NodeType, label: 'Kafka消费', icon: '📨' },
      { type: 'http_source' as NodeType, label: 'HTTP拉取', icon: '🌐' },
      { type: 'poll_source' as NodeType, label: '定时轮询', icon: '🔄' },
    ],
  },
  transform: {
    label: '转换',
    color: '#a855f7',
    types: [
      { type: 'sql_transform' as NodeType, label: 'SQL转换', icon: '🔤' },
      { type: 'python_udf' as NodeType, label: 'Python UDF', icon: '🐍' },
      { type: 'field_map' as NodeType, label: '字段映射', icon: '🔀' },
      { type: 'type_cast' as NodeType, label: '类型转换', icon: '🔄' },
    ],
  },
  aggregate: {
    label: '聚合',
    color: '#f59e0b',
    types: [
      { type: 'count_agg' as NodeType, label: '计数', icon: '#' },
      { type: 'sum_agg' as NodeType, label: '求和', icon: 'Σ' },
      { type: 'avg_agg' as NodeType, label: '平均', icon: 'μ' },
      { type: 'window_agg' as NodeType, label: '窗口聚合', icon: '📊' },
    ],
  },
  window: {
    label: '窗口',
    color: '#06b6d4',
    types: [
      { type: 'tumbling_window' as NodeType, label: '滚动窗口', icon: '⏱' },
      { type: 'sliding_window' as NodeType, label: '滑动窗口', icon: '↔' },
      { type: 'session_window' as NodeType, label: '会话窗口', icon: '💬' },
    ],
  },
  join: {
    label: 'Join',
    color: '#f97316',
    types: [
      { type: 'stream_join' as NodeType, label: '双流Join', icon: '⟷' },
      { type: 'dim_join' as NodeType, label: '维表Join', icon: '📋' },
    ],
  },
  sink: {
    label: 'Sink',
    color: '#22c55e',
    types: [
      { type: 'db_sink' as NodeType, label: '数据库写入', icon: '💾' },
      { type: 'redis_sink' as NodeType, label: 'Redis写入', icon: '⚡' },
      { type: 'kafka_sink' as NodeType, label: 'Kafka生产', icon: '📤' },
      { type: 'http_sink' as NodeType, label: 'HTTP推送', icon: '📡' },
      { type: 'file_sink' as NodeType, label: '文件写出', icon: '📁' },
    ],
  },
} as const;

export function getNodeCategory(type: NodeType): string {
  for (const [cat, data] of Object.entries(NODE_CATEGORIES)) {
    if (data.types.some(t => t.type === type)) return cat;
  }
  return 'transform';
}

export function getNodeLabel(type: NodeType): string {
  for (const data of Object.values(NODE_CATEGORIES)) {
    const found = data.types.find(t => t.type === type);
    if (found) return found.label;
  }
  return type;
}
