'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';
import { alertApi, dagApi } from '@/lib/api';
import { AlertRule, AlertHistoryItem, AlertPushMessage, DAGInfo, DAGDetail } from '@/types';

const METRIC_TYPES = [
  { value: 'throughput', label: '吞吐量 (条/秒)' },
  { value: 'latency', label: '延迟 (ms)' },
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

export default function AlertCenterPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'rules' | 'history'>('rules');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [dags, setDags] = useState<DAGInfo[]>([]);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [form, setForm] = useState({
    name: '',
    dag_id: '',
    node_id: '',
    metric_type: 'latency',
    condition: '>',
    threshold: 500,
    duration_seconds: 10,
    severity: 'warning' as 'info' | 'warning' | 'critical',
  });

  const [selectedDagDetail, setSelectedDagDetail] = useState<DAGDetail | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }
    loadData();
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (form.dag_id && dags.length > 0) {
      loadDagDetail(form.dag_id);
    } else {
      setSelectedDagDetail(null);
      setForm(prev => ({ ...prev, node_id: '' }));
    }
  }, [form.dag_id, dags]);

  const connectWebSocket = () => {
    const wsUrl = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080') + '/ws/alerts';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as AlertPushMessage;
        if (data.type === 'alert') {
          showAlertToast(data);
          if (activeTab === 'history') {
            loadHistory();
          }
        }
      } catch (e) {
        console.error('WebSocket parse error:', e);
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 3000);
    };
  };

  const showAlertToast = (alert: AlertPushMessage) => {
    const severity = alert.severity;
    const bgColors: Record<string, string> = {
      info: 'bg-blue-600',
      warning: 'bg-yellow-600',
      critical: 'bg-red-600',
    };
    const durations: Record<string, number> = {
      info: 3000,
      warning: 5000,
      critical: Infinity,
    };

    toast(
      <div className="flex flex-col">
        <div className="font-semibold">{alert.rule_name}</div>
        <div className="text-xs opacity-90">
          {alert.dag_name} - 当前值: {alert.current_value.toFixed(2)} / 阈值: {alert.threshold}
        </div>
      </div>,
      {
        duration: durations[severity],
        style: {
          background: 'transparent',
          padding: 0,
        },
        iconTheme: {
          primary: severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#ca8a04' : '#2563eb',
          secondary: '#fff',
        },
        className: `!p-0 !m-0 !bg-transparent`,
      }
    );
  };

  const loadData = async () => {
    try {
      const [rulesRes, dagsRes] = await Promise.all([
        alertApi.listAllRules(),
        dagApi.list(),
      ]);
      setRules(rulesRes.data);
      setDags(dagsRes.data);
    } catch (err) {
      toast.error('加载数据失败');
    }
  };

  const loadDagDetail = async (dagId: string) => {
    try {
      const res = await dagApi.get(dagId);
      setSelectedDagDetail(res.data);
    } catch (err) {
      setSelectedDagDetail(null);
    }
  };

  const loadHistory = async () => {
    try {
      const params: any = { limit: 500 };
      if (severityFilter) params.severity = severityFilter;
      if (startTime) params.start_time = startTime;
      if (endTime) params.end_time = endTime;
      const res = await alertApi.listAllHistory(params);
      setHistory(res.data);
    } catch (err) {
      toast.error('加载历史记录失败');
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab, severityFilter, startTime, endTime]);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.dag_id || !form.node_id) {
      toast.error('请填写完整信息');
      return;
    }

    try {
      if (editingRule) {
        await alertApi.updateRule(editingRule.id, form);
        toast.success('规则更新成功');
      } else {
        await alertApi.createRule(form.dag_id, form);
        toast.success('规则创建成功');
      }
      closeModal();
      loadData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '操作失败');
    }
  };

  const handleToggle = async (ruleId: string) => {
    try {
      await alertApi.toggleRule(ruleId);
      loadData();
    } catch (err) {}
  };

  const handleDelete = async (ruleId: string) => {
    if (!confirm('确定要删除此规则吗？')) return;
    try {
      await alertApi.deleteRule(ruleId);
      loadData();
      toast.success('已删除');
    } catch (err) {}
  };

  const handleResolve = async (alertId: string) => {
    try {
      await alertApi.resolveAlert(alertId);
      loadHistory();
      toast.success('已标记为已恢复');
    } catch (err) {}
  };

  const openEditModal = (rule: AlertRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      dag_id: rule.dag_id,
      node_id: rule.node_id,
      metric_type: rule.metric_type,
      condition: rule.condition,
      threshold: rule.threshold,
      duration_seconds: rule.duration_seconds,
      severity: rule.severity,
    });
    setShowCreateModal(true);
  };

  const openCreateModal = () => {
    setEditingRule(null);
    setForm({
      name: '',
      dag_id: dags[0]?.id || '',
      node_id: '',
      metric_type: 'latency',
      condition: '>',
      threshold: 500,
      duration_seconds: 10,
      severity: 'warning',
    });
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingRule(null);
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

  return (
    <div className="min-h-screen bg-[#0f172a]">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1e293b',
            color: '#f1f5f9',
            border: '1px solid #334155',
          },
        }}
      />

      <nav className="bg-[#1e293b] border-b border-slate-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-blue-400 cursor-pointer" onClick={() => router.push('/dashboard')}>
            DAG Orchestra
          </h1>
          <span className="text-slate-500">/</span>
          <span className="text-slate-200 font-medium">告警中心</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="px-3 py-1.5 text-sm bg-slate-600 rounded hover:bg-slate-500"
          >
            仪表盘
          </button>
          <button
            onClick={() => { localStorage.removeItem('token'); router.push('/login'); }}
            className="px-3 py-1.5 text-sm bg-slate-600 rounded hover:bg-slate-500"
          >
            退出
          </button>
        </div>
      </nav>

      <div className="p-6">
        <div className="flex gap-4 mb-6 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'rules'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            告警规则
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            历史记录
          </button>
        </div>

        {activeTab === 'rules' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">告警规则列表</h2>
              <button
                onClick={openCreateModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium"
              >
                + 新建规则
              </button>
            </div>

            <div className="space-y-3">
              {rules.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  暂无告警规则，点击上方按钮创建
                </div>
              ) : (
                rules.map(rule => (
                  <div
                    key={rule.id}
                    className={`p-4 bg-[#1e293b] rounded-lg border ${
                      !rule.is_valid ? 'border-red-800 opacity-60' : 'border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-medium text-slate-100">{rule.name}</span>
                          <span className={`px-2 py-0.5 rounded text-xs text-white ${getSeverityColor(rule.severity)}`}>
                            {getSeverityLabel(rule.severity)}
                          </span>
                          {!rule.is_valid && (
                            <span className="px-2 py-0.5 rounded text-xs bg-red-900 text-red-300">
                              无效 - {rule.invalid_reason}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-slate-400 space-y-1">
                          <div>
                            关联DAG: <span className="text-slate-300">{rule.dag_name || rule.dag_id}</span>
                            {' | '}
                            节点: <span className="text-slate-300">{rule.node_label || rule.node_id}</span>
                          </div>
                          <div>
                            监控指标: <span className="text-slate-300">{getMetricLabel(rule.metric_type)}</span>
                            {' | '}
                            条件: <span className="text-slate-300">
                              {rule.condition} {rule.threshold}
                              {rule.duration_seconds > 0 && ` 持续${rule.duration_seconds}秒`}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleToggle(rule.id)}
                          className={`px-3 py-1 text-xs rounded ${
                            rule.enabled
                              ? 'bg-green-600 hover:bg-green-700'
                              : 'bg-slate-600 hover:bg-slate-500'
                          }`}
                        >
                          {rule.enabled ? '已启用' : '已停用'}
                        </button>
                        <button
                          onClick={() => openEditModal(rule)}
                          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 rounded"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <h2 className="text-lg font-semibold">告警历史记录</h2>
              <div className="flex items-center gap-2 ml-auto">
                <select
                  value={severityFilter}
                  onChange={e => setSeverityFilter(e.target.value)}
                  className="px-3 py-2 bg-[#1e293b] border border-slate-600 rounded text-sm text-slate-100"
                >
                  <option value="">全部级别</option>
                  <option value="info">信息</option>
                  <option value="warning">警告</option>
                  <option value="critical">严重</option>
                </select>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="px-3 py-2 bg-[#1e293b] border border-slate-600 rounded text-sm text-slate-100"
                />
                <span className="text-slate-400">至</span>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="px-3 py-2 bg-[#1e293b] border border-slate-600 rounded text-sm text-slate-100"
                />
                <button
                  onClick={loadHistory}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                >
                  查询
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {history.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  暂无告警历史记录
                </div>
              ) : (
                history.map(item => (
                  <div
                    key={item.id}
                    className="bg-[#1e293b] rounded-lg border border-slate-700 overflow-hidden"
                  >
                    <div
                      className="p-4 cursor-pointer hover:bg-[#273449] transition-colors"
                      onClick={() => setExpandedHistoryId(expandedHistoryId === item.id ? null : item.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 rounded text-xs text-white ${getSeverityColor(item.severity)}`}>
                            {getSeverityLabel(item.severity)}
                          </span>
                          <span className="font-medium">{item.rule_name}</span>
                          <span className="text-slate-500">|</span>
                          <span className="text-slate-400 text-sm">{item.dag_name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            item.status === 'active' ? 'bg-red-600' : item.status === 'resolved' ? 'bg-green-600' : 'bg-slate-600'
                          }`}>
                            {item.status === 'active' ? '活跃' : item.status === 'resolved' ? '已恢复' : '已静默'}
                          </span>
                          <span className="text-slate-400 text-sm">
                            {new Date(item.triggered_at).toLocaleString('zh-CN')}
                          </span>
                          <span className="text-slate-500">
                            {expandedHistoryId === item.id ? '▲' : '▼'}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-slate-400">
                        {getMetricLabel(item.metric_type)} {item.condition} {item.threshold}，当前值: {item.current_value.toFixed(2)}
                      </div>
                    </div>

                    {expandedHistoryId === item.id && (
                      <div className="border-t border-slate-700 p-4 bg-[#0f172a]">
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <div className="text-slate-500 text-xs mb-1">节点ID</div>
                            <div className="text-slate-300">{item.node_id}</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs mb-1">持续时长</div>
                            <div className="text-slate-300">{item.duration_seconds} 秒</div>
                          </div>
                        </div>

                        <div className="mb-4">
                          <div className="text-slate-500 text-xs mb-2">触发时各节点指标快照</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-700">
                                  <th className="text-left py-2 px-3 text-slate-400 font-medium">节点</th>
                                  <th className="text-right py-2 px-3 text-slate-400 font-medium">吞吐量</th>
                                  <th className="text-right py-2 px-3 text-slate-400 font-medium">延迟(ms)</th>
                                  <th className="text-right py-2 px-3 text-slate-400 font-medium">错误率</th>
                                  <th className="text-right py-2 px-3 text-slate-400 font-medium">积压量</th>
                                  <th className="text-right py-2 px-3 text-slate-400 font-medium">健康状态</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(item.context_snapshot.node_metrics).map(([nodeId, metrics]) => (
                                  <tr
                                    key={nodeId}
                                    className={nodeId === item.context_snapshot.triggered_node ? 'bg-blue-900/30' : ''}
                                  >
                                    <td className="py-2 px-3 text-slate-300">
                                      {nodeId}
                                      {nodeId === item.context_snapshot.triggered_node && (
                                        <span className="ml-2 text-xs text-blue-400">← 触发节点</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-right text-slate-300">{metrics.throughput.toFixed(0)}</td>
                                    <td className="py-2 px-3 text-right text-slate-300">{metrics.latency_ms.toFixed(1)}</td>
                                    <td className="py-2 px-3 text-right text-slate-300">{(metrics.error_rate * 100).toFixed(2)}%</td>
                                    <td className="py-2 px-3 text-right text-slate-300">{metrics.backlog}</td>
                                    <td className="py-2 px-3 text-right">
                                      <span className={`px-2 py-0.5 rounded text-xs ${
                                        metrics.health === 'green' ? 'bg-green-700' :
                                        metrics.health === 'yellow' ? 'bg-yellow-700' : 'bg-red-700'
                                      }`}>
                                        {metrics.health === 'green' ? '正常' : metrics.health === 'yellow' ? '警告' : '异常'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {item.status === 'active' && (
                          <button
                            onClick={() => handleResolve(item.id)}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm"
                          >
                            标记为已恢复
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[#1e293b] rounded-xl p-6 w-full max-w-lg border border-slate-600 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">
                {editingRule ? '编辑告警规则' : '新建告警规则'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">规则名称</label>
                  <input
                    placeholder="输入规则名称"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">关联DAG</label>
                  <select
                    value={form.dag_id}
                    onChange={e => setForm({ ...form, dag_id: e.target.value, node_id: '' })}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">请选择DAG</option>
                    {dags.map(dag => (
                      <option key={dag.id} value={dag.id}>{dag.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">关联节点</label>
                  <select
                    value={form.node_id}
                    onChange={e => setForm({ ...form, node_id: e.target.value })}
                    disabled={!selectedDagDetail || selectedDagDetail.nodes.length === 0}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  >
                    <option value="">请选择节点</option>
                    {selectedDagDetail?.nodes.map(node => (
                      <option key={node.id} value={node.id}>{node.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">监控指标</label>
                  <select
                    value={form.metric_type}
                    onChange={e => setForm({ ...form, metric_type: e.target.value })}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {METRIC_TYPES.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm text-slate-400 mb-1">判定条件</label>
                    <select
                      value={form.condition}
                      onChange={e => setForm({ ...form, condition: e.target.value })}
                      className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      {CONDITIONS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-slate-400 mb-1">阈值</label>
                    <input
                      type="number"
                      step="any"
                      value={form.threshold}
                      onChange={e => setForm({ ...form, threshold: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">持续时长 (秒)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.duration_seconds}
                    onChange={e => setForm({ ...form, duration_seconds: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-500 mt-1">连续N秒满足条件才触发，避免瞬时毛刺误报</p>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">告警级别</label>
                  <select
                    value={form.severity}
                    onChange={e => setForm({ ...form, severity: e.target.value as any })}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {SEVERITY_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2 justify-end pt-4">
                  <button
                    onClick={closeModal}
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
