'use client';

import { useEffect, useState } from 'react';
import { alertApi } from '@/lib/api';
import { AlertRule, AlertHistoryItem } from '@/types';
import toast from 'react-hot-toast';

interface AlertPanelProps {
  dagId: string;
  onClose: () => void;
}

export default function AlertPanel({ dagId, onClose }: AlertPanelProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '', metric_type: 'latency', node_id: '', condition: '>',
    threshold: 500, duration_seconds: 180, severity: 'warning',
    silence_start: '', silence_end: '',
  });

  useEffect(() => {
    loadData();
  }, [dagId]);

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

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      await alertApi.createRule(dagId, form);
      setShowCreate(false);
      loadData();
      toast.success('告警规则创建成功');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '创建失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await alertApi.deleteRule(id);
      loadData();
    } catch {}
  };

  const handleResolve = async (id: string) => {
    try {
      await alertApi.resolveAlert(id);
      loadData();
    } catch {}
  };

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-[#1e293b] border-l border-slate-700 z-50 overflow-y-auto shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h3 className="font-semibold">告警管理</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium">告警规则 (最多20条)</h4>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
          >
            + 新增
          </button>
        </div>

        <div className="space-y-2 mb-6">
          {rules.map(r => (
            <div key={r.id} className="p-3 bg-[#0f172a] border border-slate-600 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{r.name}</span>
                <span className={`px-2 py-0.5 rounded text-xs ${r.severity === 'critical' ? 'bg-red-600' : 'bg-yellow-600'}`}>
                  {r.severity === 'critical' ? '严重' : '警告'}
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {r.metric_type} {r.condition} {r.threshold}
                {r.duration_seconds > 0 && ` 持续${r.duration_seconds}秒`}
              </div>
              {r.node_id && <div className="text-xs text-slate-500">节点: {r.node_id}</div>}
              {r.silence_start && r.silence_end && (
                <div className="text-xs text-slate-500">静默: {r.silence_start}-{r.silence_end}</div>
              )}
              <button
                onClick={() => handleDelete(r.id)}
                className="mt-2 text-xs text-red-400 hover:text-red-300"
              >
                删除
              </button>
            </div>
          ))}
        </div>

        <h4 className="text-sm font-medium mb-3">告警历史</h4>
        <div className="space-y-2">
          {history.map(h => (
            <div key={h.id} className="p-2 bg-[#0f172a] border border-slate-600 rounded text-xs">
              <div className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded ${
                  h.status === 'active' ? 'bg-red-600' : h.status === 'silenced' ? 'bg-slate-600' : 'bg-green-600'
                }`}>
                  {h.status === 'active' ? '活跃' : h.status === 'silenced' ? '已静默' : '已恢复'}
                </span>
                <span className="text-slate-400">{new Date(h.triggered_at).toLocaleString('zh-CN')}</span>
              </div>
              <div className="mt-1 text-slate-300">当前值: {h.current_value}</div>
              {h.status === 'active' && (
                <button onClick={() => handleResolve(h.id)} className="mt-1 text-blue-400 hover:text-blue-300">
                  标记已恢复
                </button>
              )}
            </div>
          ))}
        </div>

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[#1e293b] rounded-xl p-6 w-full max-w-md border border-slate-600">
              <h3 className="text-lg font-semibold mb-4">新建告警规则</h3>
              <div className="space-y-3">
                <input placeholder="规则名称" value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100" />
                <select value={form.metric_type} onChange={e => setForm({...form, metric_type: e.target.value})}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100">
                  <option value="latency">延迟</option>
                  <option value="throughput">吞吐量</option>
                  <option value="error_rate">错误率</option>
                  <option value="backlog">积压量</option>
                  <option value="global_throughput_drop">全局吞吐下降</option>
                </select>
                <input placeholder="节点ID (可选)" value={form.node_id}
                  onChange={e => setForm({...form, node_id: e.target.value})}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100" />
                <div className="flex gap-2">
                  <select value={form.condition} onChange={e => setForm({...form, condition: e.target.value})}
                    className="w-20 px-2 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100">
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<=">&lt;=</option>
                    <option value="==">==</option>
                  </select>
                  <input type="number" value={form.threshold} onChange={e => setForm({...form, threshold: Number(e.target.value)})}
                    className="flex-1 px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">持续时长(秒)</label>
                  <input type="number" value={form.duration_seconds} onChange={e => setForm({...form, duration_seconds: Number(e.target.value)})}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100" />
                </div>
                <select value={form.severity} onChange={e => setForm({...form, severity: e.target.value})}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100">
                  <option value="warning">警告</option>
                  <option value="critical">严重</option>
                </select>
                <div className="flex gap-2">
                  <input placeholder="静默开始 HH:MM" value={form.silence_start}
                    onChange={e => setForm({...form, silence_start: e.target.value})}
                    className="flex-1 px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100" />
                  <input placeholder="静默结束 HH:MM" value={form.silence_end}
                    onChange={e => setForm({...form, silence_end: e.target.value})}
                    className="flex-1 px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-sm text-slate-100" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-600 rounded text-sm">取消</button>
                  <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 rounded text-sm">创建</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
