'use client';

import { useEffect, useState } from 'react';
import { alertApi, dagApi } from '@/lib/api';
import { AlertRule, AlertHistoryItem, DAGDetail, SilencePeriod } from '@/types';
import toast from 'react-hot-toast';

interface AlertPanelProps {
  dagId: string;
  onClose: () => void;
}

const METRIC_TYPES = [
  { value: 'throughput', label: '吞吐量' },
  { value: 'latency', label: '延迟' },
  { value: 'error_rate', label: '错误率' },
  { value: 'backlog', label: '积压量' },
];

const CONDITIONS = [
  { value: '>', label: '大于' },
  { value: '<', label: '小于' },
  { value: '>=', label: '大于等于' },
  { value: '<=', label: '小于等于' },
  { value: '==', label: '等于' },
];

const SEVERITY_OPTIONS = [
  { value: 'info', label: '信息', color: 'bg-blue-600' },
  { value: 'warning', label: '警告', color: 'bg-yellow-600' },
  { value: 'critical', label: '严重', color: 'bg-red-600' },
];

const REPEAT_MODE_OPTIONS = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'once', label: '单次' },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: '周一' },
  { value: 1, label: '周二' },
  { value: 2, label: '周三' },
  { value: 3, label: '周四' },
  { value: 4, label: '周五' },
  { value: 5, label: '周六' },
  { value: 6, label: '周日' },
];

const EMPTY_SILENCE_PERIOD: SilencePeriod = {
  repeat_mode: 'daily',
  start_time: '02:00',
  end_time: '06:00',
};

export default function AlertPanel({ dagId, onClose }: AlertPanelProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [dagDetail, setDagDetail] = useState<DAGDetail | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    node_id: '',
    metric_type: 'latency',
    condition: '>',
    threshold: 500,
    duration_seconds: 10,
    severity: 'warning' as 'info' | 'warning' | 'critical',
    silence_periods: [] as SilencePeriod[],
  });
  const [newSilencePeriod, setNewSilencePeriod] = useState<SilencePeriod>({ ...EMPTY_SILENCE_PERIOD });

  useEffect(() => {
    loadData();
    loadDagDetail();
  }, [dagId]);

  const loadDagDetail = async () => {
    try {
      const res = await dagApi.get(dagId);
      setDagDetail(res.data);
    } catch {}
  };

  const loadData = async () => {
    try {
      const [rulesRes, histRes] = await Promise.all([
        alertApi.listRules(dagId),
        alertApi.listHistory(dagId),
      ]);
      setRules(rulesRes.data);
      setHistory(histRes.data);
    } catch {}
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.node_id) {
      toast.error('请填写完整信息');
      return;
    }

    try {
      if (editingRule) {
        await alertApi.updateRule(editingRule.id, form);
        toast.success('规则更新成功');
      } else {
        await alertApi.createRule(dagId, form);
        toast.success('告警规则创建成功');
      }
      setShowCreate(false);
      setEditingRule(null);
      loadData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '操作失败');
    }
  };

  const handleToggle = async (ruleId: string) => {
    try {
      await alertApi.toggleRule(ruleId);
      loadData();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此规则吗？')) return;
    try {
      await alertApi.deleteRule(id);
      loadData();
      toast.success('已删除');
    } catch {}
  };

  const handleResolve = async (id: string) => {
    try {
      await alertApi.resolveAlert(id);
      loadData();
      toast.success('已标记为已恢复');
    } catch {}
  };

  const openEditModal = (rule: AlertRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      node_id: rule.node_id,
      metric_type: rule.metric_type,
      condition: rule.condition,
      threshold: rule.threshold,
      duration_seconds: rule.duration_seconds,
      severity: rule.severity,
      silence_periods: rule.silence_periods?.length ? [...rule.silence_periods] : [],
    });
    setNewSilencePeriod({ ...EMPTY_SILENCE_PERIOD });
    setShowCreate(true);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'info': return 'bg-blue-600';
      case 'warning': return 'bg-yellow-600';
      case 'critical': return 'bg-red-600';
      default: return 'bg-slate-600';
    }
  };

  const getSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'info': return '信息';
      case 'warning': return '警告';
      case 'critical': return '严重';
      default: return severity;
    }
  };

  const getMetricLabel = (type: string) => {
    return METRIC_TYPES.find(m => m.value === type)?.label || type;
  };

  const getNodeLabel = (nodeId: string) => {
    if (!dagDetail) return nodeId;
    const node = dagDetail.nodes.find(n => n.id === nodeId);
    return node?.label || nodeId;
  };

  const formatSilencePeriod = (p: SilencePeriod) => {
    const timeRange = `${p.start_time}-${p.end_time}`;
    if (p.repeat_mode === 'daily') {
      return `每天 ${timeRange}`;
    } else if (p.repeat_mode === 'weekly') {
      const weekdayLabel = WEEKDAY_OPTIONS.find(w => w.value === p.weekday)?.label || '';
      return `每${weekdayLabel} ${timeRange}`;
    } else {
      return `${p.date || ''} ${timeRange}`;
    }
  };

  const addSilencePeriod = () => {
    const p = { ...newSilencePeriod };
    if (p.repeat_mode === 'once' && !p.date) {
      toast.error('单次模式需要选择日期');
      return;
    }
    if (p.repeat_mode === 'weekly' && p.weekday === undefined) {
      toast.error('每周模式需要选择星期');
      return;
    }
    setForm(prev => ({
      ...prev,
      silence_periods: [...prev.silence_periods, p],
    }));
    setNewSilencePeriod({ ...EMPTY_SILENCE_PERIOD });
  };

  const removeSilencePeriod = (index: number) => {
    setForm(prev => ({
      ...prev,
      silence_periods: prev.silence_periods.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-[#1e293b] border-l border-slate-700 z-50 overflow-y-auto shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h3 className="font-semibold">告警管理</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium">告警规则</h4>
          <button
            onClick={() => {
              setEditingRule(null);
              setForm({
                name: '',
                node_id: '',
                metric_type: 'latency',
                condition: '>',
                threshold: 500,
                duration_seconds: 10,
                severity: 'warning',
                silence_periods: [],
              });
              setNewSilencePeriod({ ...EMPTY_SILENCE_PERIOD });
              setShowCreate(true);
            }}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
          >
            + 新增
          </button>
        </div>

        <div className="space-y-2 mb-6 max-h-[40vh] overflow-y-auto">
          {rules.length === 0 ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              暂无告警规则
            </div>
          ) : (
            rules.map(r => (
              <div
                key={r.id}
                className={`p-3 bg-[#0f172a] border rounded-lg ${
                  !r.is_valid ? 'border-red-800 opacity-60' : 'border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    {r.is_silenced && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-500 text-slate-200">
                        静默中
                      </span>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${getSeverityColor(r.severity)}`}>
                    {getSeverityLabel(r.severity)}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {getMetricLabel(r.metric_type)} {r.condition} {r.threshold}
                  {r.duration_seconds > 0 && ` 持续${r.duration_seconds}秒`}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  节点: {getNodeLabel(r.node_id)}
                </div>
                {r.silence_periods && r.silence_periods.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.silence_periods.map((p, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-slate-700 rounded text-[10px] text-slate-400">
                        {formatSilencePeriod(p)}
                      </span>
                    ))}
                  </div>
                )}
                {!r.is_valid && (
                  <div className="text-xs text-red-400 mt-1">
                    无效 - {r.invalid_reason}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => handleToggle(r.id)}
                    className={`text-xs px-2 py-0.5 rounded ${
                      r.enabled
                        ? 'bg-green-700 hover:bg-green-600'
                        : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                  >
                    {r.enabled ? '已启用' : '已停用'}
                  </button>
                  <button
                    onClick={() => openEditModal(r)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <h4 className="text-sm font-medium mb-3">告警历史</h4>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {history.length === 0 ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              暂无告警历史
            </div>
          ) : (
            history.map(h => (
              <div
                key={h.id}
                className="p-2 bg-[#0f172a] border border-slate-600 rounded text-xs"
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedHistoryId(expandedHistoryId === h.id ? null : h.id)}
                >
                  <span className={`px-2 py-0.5 rounded ${getSeverityColor(h.severity)}`}>
                    {getSeverityLabel(h.severity)}
                  </span>
                  <span className="text-slate-400">
                    {new Date(h.triggered_at).toLocaleString('zh-CN')}
                  </span>
                </div>
                <div className="mt-1 text-slate-300">
                  <div>{h.rule_name}</div>
                  <div className="text-slate-400">
                    {getMetricLabel(h.metric_type)}: {h.current_value.toFixed(2)} / {h.threshold}
                  </div>
                </div>

                {expandedHistoryId === h.id && (
                  <div className="mt-2 pt-2 border-t border-slate-700">
                    <div className="text-slate-400 mb-1">节点指标快照:</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {Object.entries(h.context_snapshot.node_metrics || {}).map(([nodeId, metrics]: any) => (
                        <div
                          key={nodeId}
                          className={`text-xs ${nodeId === h.context_snapshot.triggered_node ? 'text-blue-400' : 'text-slate-400'}`}
                        >
                          {nodeId}: 吞吐={metrics.throughput.toFixed(0)}, 延迟={metrics.latency_ms.toFixed(1)}ms
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mt-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    h.status === 'active' ? 'bg-red-600' : h.status === 'resolved' ? 'bg-green-600' : 'bg-slate-600'
                  }`}>
                    {h.status === 'active' ? '活跃' : h.status === 'resolved' ? '已恢复' : '已静默'}
                  </span>
                  {h.status === 'active' && (
                    <button
                      onClick={() => handleResolve(h.id)}
                      className="text-blue-400 hover:text-blue-300 text-xs"
                    >
                      标记已恢复
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 left-0">
            <div className="bg-[#1e293b] rounded-xl p-6 w-full max-w-md border border-slate-600 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">
                {editingRule ? '编辑告警规则' : '新建告警规则'}
              </h3>
              <div className="space-y-3">
                <input
                  placeholder="规则名称"
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                />

                <div>
                  <label className="block text-xs text-slate-400 mb-1">关联节点</label>
                  <select
                    value={form.node_id}
                    onChange={e => setForm({...form, node_id: e.target.value})}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">请选择节点</option>
                    {dagDetail?.nodes.map(node => (
                      <option key={node.id} value={node.id}>{node.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">监控指标</label>
                  <select
                    value={form.metric_type}
                    onChange={e => setForm({...form, metric_type: e.target.value})}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {METRIC_TYPES.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-400 mb-1">条件</label>
                    <select
                      value={form.condition}
                      onChange={e => setForm({...form, condition: e.target.value})}
                      className="w-full px-2 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      {CONDITIONS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-slate-400 mb-1">阈值</label>
                    <input
                      type="number"
                      step="any"
                      value={form.threshold}
                      onChange={e => setForm({...form, threshold: Number(e.target.value)})}
                      className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">持续时长(秒)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.duration_seconds}
                    onChange={e => setForm({...form, duration_seconds: Number(e.target.value)})}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">告警级别</label>
                  <select
                    value={form.severity}
                    onChange={e => setForm({...form, severity: e.target.value as any})}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {SEVERITY_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-slate-700 pt-3">
                  <label className="block text-xs text-slate-400 mb-1">静默时段</label>

                  {form.silence_periods.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {form.silence_periods.map((period, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between px-2 py-1 bg-[#0f172a] border border-slate-700 rounded text-xs"
                        >
                          <span className="text-slate-300">{formatSilencePeriod(period)}</span>
                          <button
                            onClick={() => removeSilencePeriod(index)}
                            className="text-red-400 hover:text-red-300 text-xs ml-2"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="p-2 bg-[#0f172a] border border-slate-700 rounded space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <select
                          value={newSilencePeriod.repeat_mode}
                          onChange={e => setNewSilencePeriod({
                            ...newSilencePeriod,
                            repeat_mode: e.target.value as 'daily' | 'weekly' | 'once',
                          })}
                          className="w-full px-2 py-1 bg-[#1e293b] border border-slate-600 rounded text-xs text-slate-100 focus:outline-none"
                        >
                          {REPEAT_MODE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      {newSilencePeriod.repeat_mode === 'weekly' && (
                        <div className="flex-1">
                          <select
                            value={newSilencePeriod.weekday ?? ''}
                            onChange={e => setNewSilencePeriod({
                              ...newSilencePeriod,
                              weekday: e.target.value !== '' ? Number(e.target.value) : undefined,
                            })}
                            className="w-full px-2 py-1 bg-[#1e293b] border border-slate-600 rounded text-xs text-slate-100 focus:outline-none"
                          >
                            <option value="">星期</option>
                            {WEEKDAY_OPTIONS.map(w => (
                              <option key={w.value} value={w.value}>{w.label}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {newSilencePeriod.repeat_mode === 'once' && (
                        <div className="flex-1">
                          <input
                            type="date"
                            value={newSilencePeriod.date || ''}
                            onChange={e => setNewSilencePeriod({
                              ...newSilencePeriod,
                              date: e.target.value,
                            })}
                            className="w-full px-2 py-1 bg-[#1e293b] border border-slate-600 rounded text-xs text-slate-100 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <input
                          type="time"
                          value={newSilencePeriod.start_time}
                          onChange={e => setNewSilencePeriod({
                            ...newSilencePeriod,
                            start_time: e.target.value,
                          })}
                          className="w-full px-2 py-1 bg-[#1e293b] border border-slate-600 rounded text-xs text-slate-100 focus:outline-none"
                        />
                      </div>
                      <div className="flex-1">
                        <input
                          type="time"
                          value={newSilencePeriod.end_time}
                          onChange={e => setNewSilencePeriod({
                            ...newSilencePeriod,
                            end_time: e.target.value,
                          })}
                          className="w-full px-2 py-1 bg-[#1e293b] border border-slate-600 rounded text-xs text-slate-100 focus:outline-none"
                        />
                      </div>
                    </div>
                    <button
                      onClick={addSilencePeriod}
                      className="w-full px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      + 添加
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    onClick={() => { setShowCreate(false); setEditingRule(null); }}
                    className="px-4 py-2 bg-slate-600 rounded hover:bg-slate-500 text-sm"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSubmit}
                    className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 text-sm"
                  >
                    {editingRule ? '保存' : '创建'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
