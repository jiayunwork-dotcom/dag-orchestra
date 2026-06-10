'use client';

import { useState, useEffect } from 'react';
import { useDAGStore } from '@/lib/store';
import { NodeData, NodeType, NodeConfig } from '@/types';

interface ConfigPanelProps {
  nodeId: string;
  onClose: () => void;
  onSave: (data: Partial<NodeData>) => void;
}

export default function ConfigPanel({ nodeId, onClose, onSave }: ConfigPanelProps) {
  const store = useDAGStore();
  const node = store.nodes.find(n => n.id === nodeId);
  const [label, setLabel] = useState(node?.label || '');
  const [config, setConfig] = useState<NodeConfig>(node?.config || {});
  const [outputSchema, setOutputSchema] = useState(node?.output_schema?.fields || []);

  if (!node) return null;

  const nodeType = node.type;
  const category = getCategory(nodeType);

  function getCategory(type: NodeType): string {
    if (['kafka_source', 'http_source', 'poll_source'].includes(type)) return 'source';
    if (['sql_transform', 'python_udf', 'field_map', 'type_cast'].includes(type)) return 'transform';
    if (['count_agg', 'sum_agg', 'avg_agg', 'window_agg'].includes(type)) return 'aggregate';
    if (['tumbling_window', 'sliding_window', 'session_window'].includes(type)) return 'window';
    if (['stream_join', 'dim_join'].includes(type)) return 'join';
    if (['db_sink', 'redis_sink', 'kafka_sink', 'http_sink', 'file_sink'].includes(type)) return 'sink';
    return 'transform';
  }

  const handleSave = () => {
    const isConfigured = checkConfigured();
    onSave({
      label,
      config,
      is_configured: isConfigured,
      output_schema: outputSchema.length > 0 ? { fields: outputSchema } : undefined,
    });
  };

  const checkConfigured = (): boolean => {
    switch (nodeType) {
      case 'kafka_source': return !!(config.kafka_topic && config.kafka_brokers);
      case 'http_source': return !!config.http_url;
      case 'poll_source': return !!(config.poll_url && config.poll_interval);
      case 'sql_transform': return !!config.sql_statement;
      case 'python_udf': return !!config.python_code;
      case 'db_sink': return !!(config.db_connection && config.db_table);
      case 'redis_sink': return !!config.redis_key;
      case 'kafka_sink': return !!config.kafka_sink_topic;
      case 'http_sink': return !!config.http_sink_url;
      case 'file_sink': return !!config.file_path;
      case 'stream_join': return !!(config.join_condition && config.join_window);
      default: return true;
    }
  };

  const updateConfig = (key: keyof NodeConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const addSchemaField = () => {
    setOutputSchema([...outputSchema, { name: '', type: 'string' }]);
  };

  const removeSchemaField = (index: number) => {
    setOutputSchema(outputSchema.filter((_, i) => i !== index));
  };

  const updateSchemaField = (index: number, key: string, value: string) => {
    const updated = [...outputSchema];
    updated[index] = { ...updated[index], [key]: value };
    setOutputSchema(updated);
  };

  return (
    <div className="w-80 bg-[#1e293b] border-l border-slate-700 overflow-y-auto flex-shrink-0">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h3 className="font-semibold text-sm">节点配置</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">节点名称</label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        {category === 'source' && <SourceConfig type={nodeType} config={config} updateConfig={updateConfig} />}
        {category === 'transform' && <TransformConfig type={nodeType} config={config} updateConfig={updateConfig} />}
        {category === 'aggregate' && <AggregateConfig type={nodeType} config={config} updateConfig={updateConfig} />}
        {category === 'window' && <WindowConfig type={nodeType} config={config} updateConfig={updateConfig} />}
        {category === 'join' && <JoinConfig type={nodeType} config={config} updateConfig={updateConfig} />}
        {category === 'sink' && <SinkConfig type={nodeType} config={config} updateConfig={updateConfig} />}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-slate-400">输出Schema</label>
            <button onClick={addSchemaField} className="text-xs text-blue-400 hover:text-blue-300">+ 添加字段</button>
          </div>
          {outputSchema.map((field, i) => (
            <div key={i} className="flex gap-1 mb-1">
              <input
                value={field.name}
                onChange={e => updateSchemaField(i, 'name', e.target.value)}
                placeholder="字段名"
                className="flex-1 px-2 py-1 bg-[#0f172a] border border-slate-600 rounded text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              />
              <select
                value={field.type}
                onChange={e => updateSchemaField(i, 'type', e.target.value)}
                className="px-2 py-1 bg-[#0f172a] border border-slate-600 rounded text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              >
                {['string', 'int', 'float', 'bool', 'timestamp', 'bytes', 'array', 'map'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button onClick={() => removeSchemaField(i)} className="text-red-400 text-xs px-1">✕</button>
            </div>
          ))}
        </div>

        <button
          onClick={handleSave}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
        >
          保存配置
        </button>
      </div>
    </div>
  );
}

function SourceConfig({ type, config, updateConfig }: { type: NodeType; config: NodeConfig; updateConfig: (k: keyof NodeConfig, v: any) => void }) {
  return (
    <div className="space-y-3">
      {type === 'kafka_source' && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Brokers</label>
            <input value={config.kafka_brokers || ''} onChange={e => updateConfig('kafka_brokers', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
              placeholder="localhost:9092" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Topic</label>
            <input value={config.kafka_topic || ''} onChange={e => updateConfig('kafka_topic', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Consumer Group</label>
            <input value={config.kafka_group || ''} onChange={e => updateConfig('kafka_group', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
        </>
      )}
      {type === 'http_source' && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">URL</label>
            <input value={config.http_url || ''} onChange={e => updateConfig('http_url', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Method</label>
            <select value={config.http_method || 'GET'} onChange={e => updateConfig('http_method', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500">
              <option>GET</option><option>POST</option>
            </select>
          </div>
        </>
      )}
      {type === 'poll_source' && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">URL</label>
            <input value={config.poll_url || ''} onChange={e => updateConfig('poll_url', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">轮询间隔(秒)</label>
            <input type="number" value={config.poll_interval || 60} onChange={e => updateConfig('poll_interval', Number(e.target.value))}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
        </>
      )}
    </div>
  );
}

function TransformConfig({ type, config, updateConfig }: { type: NodeType; config: NodeConfig; updateConfig: (k: keyof NodeConfig, v: any) => void }) {
  return (
    <div className="space-y-3">
      {type === 'sql_transform' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">SQL语句 (最长10000字符)</label>
          <textarea
            value={config.sql_statement || ''}
            onChange={e => { if (e.target.value.length <= 10000) updateConfig('sql_statement', e.target.value); }}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500 h-40 font-mono resize-none"
            placeholder="SELECT * FROM input_stream WHERE value > 0"
          />
          <div className="text-xs text-slate-500 mt-1">{(config.sql_statement || '').length}/10000</div>
        </div>
      )}
      {type === 'python_udf' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">Python代码 (超时30秒)</label>
          <textarea
            value={config.python_code || ''}
            onChange={e => updateConfig('python_code', e.target.value)}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500 h-40 font-mono resize-none"
            placeholder={"result = {**data, 'processed': True}"}
          />
        </div>
      )}
      {type === 'field_map' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">字段映射</label>
          <textarea
            value={config.field_mappings ? JSON.stringify(config.field_mappings, null, 2) : ''}
            onChange={e => { try { updateConfig('field_mappings', JSON.parse(e.target.value)); } catch {} }}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500 h-24 font-mono resize-none"
            placeholder='[{"source":"old_name","target":"new_name"}]'
          />
        </div>
      )}
      {type === 'type_cast' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">类型转换</label>
          <textarea
            value={config.type_casts ? JSON.stringify(config.type_casts, null, 2) : ''}
            onChange={e => { try { updateConfig('type_casts', JSON.parse(e.target.value)); } catch {} }}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500 h-24 font-mono resize-none"
            placeholder='[{"field":"age","from_type":"string","to_type":"int"}]'
          />
        </div>
      )}
    </div>
  );
}

function AggregateConfig({ type, config, updateConfig }: { type: NodeType; config: NodeConfig; updateConfig: (k: keyof NodeConfig, v: any) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">聚合字段</label>
        <input value={config.agg_field || ''} onChange={e => updateConfig('agg_field', e.target.value)}
          className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
      </div>
    </div>
  );
}

function WindowConfig({ type, config, updateConfig }: { type: NodeType; config: NodeConfig; updateConfig: (k: keyof NodeConfig, v: any) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">窗口时长(秒) 10-86400</label>
        <input type="number" min={10} max={86400} value={config.window_duration || 60}
          onChange={e => updateConfig('window_duration', Number(e.target.value))}
          className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
      </div>
      {type === 'sliding_window' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">滑动步长(秒)</label>
          <input type="number" value={config.window_slide || 30}
            onChange={e => updateConfig('window_slide', Number(e.target.value))}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
        </div>
      )}
      {type === 'session_window' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">会话Gap(秒)</label>
          <input type="number" value={config.session_gap || 30}
            onChange={e => updateConfig('session_gap', Number(e.target.value))}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
        </div>
      )}
    </div>
  );
}

function JoinConfig({ type, config, updateConfig }: { type: NodeType; config: NodeConfig; updateConfig: (k: keyof NodeConfig, v: any) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Join类型</label>
        <select value={config.join_type || 'inner'} onChange={e => updateConfig('join_type', e.target.value)}
          className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500">
          <option value="inner">Inner Join</option>
          <option value="left">Left Join</option>
          <option value="right">Right Join</option>
          <option value="full">Full Join</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Join条件</label>
        <input value={config.join_condition || ''} onChange={e => updateConfig('join_condition', e.target.value)}
          className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          placeholder="left.id = right.id" />
      </div>
      {type === 'stream_join' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">时间窗口(秒) 最大3600</label>
          <input type="number" min={1} max={3600} value={config.join_window || 300}
            onChange={e => updateConfig('join_window', Number(e.target.value))}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
        </div>
      )}
    </div>
  );
}

function SinkConfig({ type, config, updateConfig }: { type: NodeType; config: NodeConfig; updateConfig: (k: keyof NodeConfig, v: any) => void }) {
  return (
    <div className="space-y-3">
      {type === 'db_sink' && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">数据库连接</label>
            <input value={config.db_connection || ''} onChange={e => updateConfig('db_connection', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
              placeholder="postgresql://user:pass@host:5432/db" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">表名</label>
            <input value={config.db_table || ''} onChange={e => updateConfig('db_table', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
        </>
      )}
      {type === 'redis_sink' && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Key模板</label>
            <input value={config.redis_key || ''} onChange={e => updateConfig('redis_key', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
              placeholder="user:{id}" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">TTL(秒)</label>
            <input type="number" value={config.redis_ttl || 3600} onChange={e => updateConfig('redis_ttl', Number(e.target.value))}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
        </>
      )}
      {type === 'kafka_sink' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">目标Topic</label>
          <input value={config.kafka_sink_topic || ''} onChange={e => updateConfig('kafka_sink_topic', e.target.value)}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
        </div>
      )}
      {type === 'http_sink' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">推送URL</label>
          <input value={config.http_sink_url || ''} onChange={e => updateConfig('http_sink_url', e.target.value)}
            className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
        </div>
      )}
      {type === 'file_sink' && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">文件路径</label>
            <input value={config.file_path || ''} onChange={e => updateConfig('file_path', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">格式</label>
            <select value={config.file_format || 'json'} onChange={e => updateConfig('file_format', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500">
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="parquet">Parquet</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}
