'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { scheduleApi } from '@/lib/api';
import {
  SchedulePlan, ExecutionRecord, ExecutionListResponse,
  ScheduleOperationLog, ExecutionStats, CronPreviewResponse,
} from '@/types';
import toast from 'react-hot-toast';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

interface SchedulePanelProps {
  dagId: string;
  dagStatus: string;
  onClose: () => void;
}

const OPERATION_TYPE_LABELS: Record<string, string> = {
  enable: '启用',
  disable: '禁用',
  edit: '编辑',
  delete: '删除',
  create: '创建',
};

export default function SchedulePanel({ dagId, dagStatus, onClose }: SchedulePanelProps) {
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [cronExpression, setCronExpression] = useState('0 * * * *');
  const [enabled, setEnabled] = useState(true);
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [timeoutSeconds, setTimeoutSeconds] = useState(3600);
  const [retryCount, setRetryCount] = useState(0);
  const [retryInterval, setRetryInterval] = useState(60);

  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [execTotal, setExecTotal] = useState(0);
  const [execPage, setExecPage] = useState(1);
  const [execStatusFilter, setExecStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<ExecutionRecord | null>(null);

  const [operations, setOperations] = useState<ScheduleOperationLog[]>([]);
  const [showOperations, setShowOperations] = useState(false);

  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [showStats, setShowStats] = useState(true);

  const [cronPreview, setCronPreview] = useState<CronPreviewResponse | null>(null);
  const cronDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const canCreatePlan = dagStatus === 'published' || dagStatus === 'running' || dagStatus === 'grayscale';

  useEffect(() => {
    loadPlan();
    loadExecutions();
    loadStats();
    loadOperations();
  }, [dagId]);

  useEffect(() => {
    loadExecutions();
  }, [execPage, execStatusFilter]);

  useEffect(() => {
    if (!showForm) return;
    if (cronDebounceRef.current) {
      clearTimeout(cronDebounceRef.current);
    }
    cronDebounceRef.current = setTimeout(async () => {
      try {
        const res = await scheduleApi.previewCron(cronExpression);
        setCronPreview(res.data);
      } catch {
        setCronPreview(null);
      }
    }, 300);
    return () => {
      if (cronDebounceRef.current) clearTimeout(cronDebounceRef.current);
    };
  }, [cronExpression, showForm]);

  const loadPlan = async () => {
    setLoading(true);
    try {
      const res = await scheduleApi.getPlan(dagId);
      if (res.data) {
        setPlan(res.data);
        setCronExpression(res.data.cron_expression);
        setEnabled(res.data.enabled);
        setMaxConcurrency(res.data.max_concurrency);
        setTimeoutSeconds(res.data.timeout_seconds);
        setRetryCount(res.data.retry_count);
        setRetryInterval(res.data.retry_interval);
      } else {
        setPlan(null);
      }
    } catch {
      setPlan(null);
    }
    setLoading(false);
  };

  const loadExecutions = async () => {
    try {
      const params: any = { page: execPage, page_size: 20 };
      if (execStatusFilter) params.status = execStatusFilter;
      const res = await scheduleApi.listExecutions(dagId, params);
      const data: ExecutionListResponse = res.data;
      setExecutions(data.items);
      setExecTotal(data.total);
    } catch {}
  };

  const loadStats = async () => {
    try {
      const res = await scheduleApi.getExecutionStats(dagId);
      setStats(res.data);
    } catch {
      setStats(null);
    }
  };

  const loadOperations = async () => {
    try {
      const res = await scheduleApi.listOperations(dagId, 20);
      setOperations(res.data);
    } catch {
      setOperations([]);
    }
  };

  const handleSave = async () => {
    if (maxConcurrency > 1 && retryCount > 0) {
      const confirmed = window.confirm(
        '高并发+重试可能产生大量执行记录，确认继续？'
      );
      if (!confirmed) return;
    }

    const data = {
      cron_expression: cronExpression,
      enabled,
      max_concurrency: maxConcurrency,
      timeout_seconds: timeoutSeconds,
      retry_count: retryCount,
      retry_interval: retryInterval,
    };
    try {
      if (plan) {
        const res = await scheduleApi.updatePlan(dagId, data);
        setPlan(res.data);
        toast.success('调度计划已更新');
      } else {
        const res = await scheduleApi.createPlan(dagId, data);
        setPlan(res.data);
        toast.success('调度计划已创建');
      }
      setEditing(false);
      setShowForm(false);
      loadExecutions();
      loadOperations();
    } catch (err: any) {
      const errorMsg = err?.response?.data?.detail || err?.message || '保存失败';
      console.error('Save error:', err);
      toast.error(errorMsg);
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定要删除调度计划吗？相关的执行历史也将被清除。')) return;
    try {
      await scheduleApi.deletePlan(dagId);
      setPlan(null);
      setExecutions([]);
      setExecTotal(0);
      toast.success('调度计划已删除');
      loadOperations();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleManualTrigger = async () => {
    try {
      await scheduleApi.manualTrigger(dagId);
      toast.success('已触发手动执行');
      setTimeout(loadExecutions, 1000);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '触发失败');
    }
  };

  const handleToggleEnabled = async () => {
    if (!plan) return;
    try {
      const res = await scheduleApi.updatePlan(dagId, { enabled: !plan.enabled });
      setPlan(res.data);
      setEnabled(res.data.enabled);
      toast.success(res.data.enabled ? '调度计划已启用' : '调度计划已禁用');
      loadOperations();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '操作失败');
    }
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    try {
      const res = await scheduleApi.getExecutionDetail(id);
      setExpandedDetail(res.data);
    } catch {}
  };

  const totalPages = Math.ceil(execTotal / 20);

  const statusColors: Record<string, string> = {
    running: 'bg-blue-600', success: 'bg-green-600',
    failed: 'bg-red-600', retrying: 'bg-yellow-600',
    timeout: 'bg-orange-500',
  };
  const statusLabels: Record<string, string> = {
    running: '运行中', success: '成功',
    failed: '失败', retrying: '重试中',
    timeout: '超时',
  };
  const triggerLabels: Record<string, string> = {
    scheduled: '定时触发', manual: '手动触发', retry: '重试',
  };

  const formatTime = (t?: string) => {
    if (!t) return '-';
    return new Date(t).toLocaleString('zh-CN');
  };

  const formatDuration = (seconds?: number) => {
    if (seconds === undefined || seconds === null) return '-';
    if (seconds < 60) return `${seconds.toFixed(1)}秒`;
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(0);
    return `${m}分${s}秒`;
  };

  const chartData = useMemo(() => {
    if (!stats?.has_data) return [];
    return stats.daily_stats.map(d => ({
      ...d,
      date: d.date.slice(5),
    }));
  }, [stats]);

  return (
    <div className="fixed inset-0 bg-black/50 flex z-50">
      <div className="ml-auto w-[680px] bg-[#1e293b] border-l border-slate-700 flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold">调度管理</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {loading ? (
            <div className="text-center text-slate-400 py-8">加载中...</div>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-slate-200">调度计划</h4>
                  <div className="flex gap-2">
                    {plan && (
                      <>
                        <button
                          onClick={handleToggleEnabled}
                          className={`px-3 py-1.5 text-xs rounded ${plan.enabled ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'}`}
                        >
                          {plan.enabled ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => { setEditing(true); setShowForm(true); }}
                          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                        >
                          编辑
                        </button>
                        <button
                          onClick={handleDelete}
                          className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 rounded"
                        >
                          删除
                        </button>
                      </>
                    )}
                    {!plan && canCreatePlan && (
                      <button
                        onClick={() => { setEditing(true); setShowForm(true); }}
                        className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                      >
                        新建调度计划
                      </button>
                    )}
                    {!plan && !canCreatePlan && (
                      <span className="text-xs text-slate-500">只有已发布或运行中的DAG才允许创建调度计划</span>
                    )}
                  </div>
                </div>

                {plan && !showForm && (
                  <div className="bg-[#0f172a] rounded-lg p-4 border border-slate-700 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-slate-400">Cron表达式:</span> <span className="text-slate-200 font-mono">{plan.cron_expression}</span></div>
                      <div><span className="text-slate-400">状态:</span> <span className={plan.enabled ? 'text-green-400' : 'text-red-400'}>{plan.enabled ? '已启用' : '已禁用'}</span></div>
                      <div><span className="text-slate-400">最大并发:</span> <span className="text-slate-200">{plan.max_concurrency}</span></div>
                      <div><span className="text-slate-400">超时时间:</span> <span className="text-slate-200">{plan.timeout_seconds}秒</span></div>
                      <div><span className="text-slate-400">重试次数:</span> <span className="text-slate-200">{plan.retry_count}次</span></div>
                      <div><span className="text-slate-400">重试间隔:</span> <span className="text-slate-200">{plan.retry_interval}秒</span></div>
                    </div>
                    {plan.next_trigger_time && plan.enabled && (
                      <div className="text-sm text-cyan-400 pt-1 border-t border-slate-700 mt-2">
                        下次触发时间: {formatTime(plan.next_trigger_time)}
                      </div>
                    )}
                  </div>
                )}

                {showForm && (
                  <div className="bg-[#0f172a] rounded-lg p-4 border border-slate-700 space-y-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Cron表达式 (标准五段式)</label>
                      <input
                        value={cronExpression}
                        onChange={e => setCronExpression(e.target.value)}
                        placeholder="0 * * * *"
                        className="w-full px-3 py-2 bg-[#1e293b] border border-slate-600 rounded text-slate-100 font-mono text-sm focus:outline-none focus:border-blue-500"
                      />
                      {cronPreview && (
                        <div className="mt-2 text-xs">
                          {cronPreview.valid ? (
                            <div>
                              <div className="text-slate-400 mb-1">下次5次触发时间预览:</div>
                              <ul className="space-y-0.5">
                                {cronPreview.next_times.map((t, i) => (
                                  <li key={i} className="text-green-400 font-mono">
                                    {i + 1}. {formatTime(t)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <div className="text-red-400">{cronPreview.error_message}</div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-slate-400">是否启用</label>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => setEnabled(e.target.checked)}
                        className="rounded"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">最大并发数 (1-5)</label>
                        <input
                          type="number"
                          min={1} max={5}
                          value={maxConcurrency}
                          onChange={e => setMaxConcurrency(Number(e.target.value))}
                          className="w-full px-3 py-2 bg-[#1e293b] border border-slate-600 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">超时时间 (秒)</label>
                        <input
                          type="number"
                          min={1}
                          value={timeoutSeconds}
                          onChange={e => setTimeoutSeconds(Number(e.target.value))}
                          className="w-full px-3 py-2 bg-[#1e293b] border border-slate-600 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">失败重试次数 (0-3)</label>
                        <input
                          type="number"
                          min={0} max={3}
                          value={retryCount}
                          onChange={e => setRetryCount(Number(e.target.value))}
                          className="w-full px-3 py-2 bg-[#1e293b] border border-slate-600 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">重试间隔 (秒)</label>
                        <input
                          type="number"
                          min={1}
                          value={retryInterval}
                          onChange={e => setRetryInterval(Number(e.target.value))}
                          className="w-full px-3 py-2 bg-[#1e293b] border border-slate-600 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                    {maxConcurrency > 1 && retryCount > 0 && (
                      <div className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-700/40 rounded px-3 py-2">
                        ⚠ 高并发+重试可能产生大量执行记录
                      </div>
                    )}
                    <div className="flex gap-2 justify-end pt-2">
                      <button
                        onClick={() => { setShowForm(false); setEditing(false); if (plan) { setCronExpression(plan.cron_expression); setEnabled(plan.enabled); setMaxConcurrency(plan.max_concurrency); setTimeoutSeconds(plan.timeout_seconds); setRetryCount(plan.retry_count); setRetryInterval(plan.retry_interval); }}}
                        className="px-4 py-2 bg-slate-600 rounded hover:bg-slate-500 text-sm"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 text-sm"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-slate-200">手动触发</h4>
                  <button
                    onClick={handleManualTrigger}
                    className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 rounded"
                  >
                    立即执行
                  </button>
                </div>
              </div>

              <div className="bg-[#0f172a] rounded-lg border border-slate-700">
                <button
                  onClick={() => setShowStats(s => !s)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-800/30"
                >
                  <h4 className="font-medium text-slate-200">执行统计 (最近7天)</h4>
                  <span className="text-slate-400">{showStats ? '▼' : '▶'}</span>
                </button>
                {showStats && (
                  <div className="border-t border-slate-700 p-4">
                    {!stats?.has_data ? (
                      <div className="text-sm text-slate-500 text-center py-6">
                        暂无统计数据
                      </div>
                    ) : (
                      <>
                        <div className="h-48 mb-4">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                              <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                              <Tooltip
                                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '4px' }}
                                labelStyle={{ color: '#cbd5e1' }}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px' }} />
                              <Line type="monotone" dataKey="success" name="成功" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                              <Line type="monotone" dataKey="failed" name="失败" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                              <Line type="monotone" dataKey="timeout" name="超时" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="grid grid-cols-4 gap-3 text-center text-xs">
                          <div className="bg-slate-800/50 rounded p-2">
                            <div className="text-slate-400">总执行</div>
                            <div className="text-lg font-bold text-blue-400">{stats.total_executions}</div>
                          </div>
                          <div className="bg-slate-800/50 rounded p-2">
                            <div className="text-slate-400">成功率</div>
                            <div className="text-lg font-bold text-green-400">{stats.success_rate}%</div>
                          </div>
                          <div className="bg-slate-800/50 rounded p-2">
                            <div className="text-slate-400">平均耗时</div>
                            <div className="text-lg font-bold text-cyan-400">{formatDuration(stats.avg_duration_seconds)}</div>
                          </div>
                          <div className="bg-slate-800/50 rounded p-2">
                            <div className="text-slate-400">最长耗时</div>
                            <div className="text-lg font-bold text-orange-400">{formatDuration(stats.max_duration_seconds)}</div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-slate-200">执行历史</h4>
                  <select
                    value={execStatusFilter}
                    onChange={e => { setExecStatusFilter(e.target.value); setExecPage(1); }}
                    className="bg-[#0f172a] border border-slate-600 text-slate-300 text-xs rounded px-2 py-1"
                  >
                    <option value="">全部状态</option>
                    <option value="running">运行中</option>
                    <option value="success">成功</option>
                    <option value="failed">失败</option>
                    <option value="retrying">重试中</option>
                    <option value="timeout">超时</option>
                  </select>
                </div>

                {executions.length === 0 ? (
                  <div className="text-sm text-slate-500 text-center py-4 bg-[#0f172a] rounded-lg border border-slate-700">
                    暂无执行记录
                  </div>
                ) : (
                  <div className="space-y-2">
                    {executions.map(exec => (
                      <div key={exec.id} className="bg-[#0f172a] rounded-lg border border-slate-700">
                        <div
                          className="p-3 cursor-pointer hover:bg-slate-800/50"
                          onClick={() => handleExpand(exec.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs text-slate-400">{exec.id.slice(0, 8)}</span>
                              <span className={`px-2 py-0.5 rounded text-xs text-white ${statusColors[exec.status] || 'bg-slate-600'}`}>
                                {statusLabels[exec.status] || exec.status}
                              </span>
                              {exec.is_retry && (
                                <span className="px-2 py-0.5 rounded text-xs bg-yellow-900 text-yellow-300">
                                  {exec.retry_label}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400">
                              {formatTime(exec.triggered_at)}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                            <span>耗时: {exec.status === 'running' ? '进行中...' : formatDuration(exec.duration_seconds)}</span>
                            {exec.finished_at && <span>结束: {formatTime(exec.finished_at)}</span>}
                          </div>
                        </div>

                        {expandedId === exec.id && expandedDetail && (
                          <div className="border-t border-slate-700 p-3 text-xs space-y-1 bg-slate-800/30">
                            <div className="text-slate-400">完整执行ID: <span className="text-slate-200 font-mono">{expandedDetail.id}</span></div>
                            <div className="text-slate-400">触发原因: <span className="text-slate-200">{triggerLabels[expandedDetail.trigger_type] || expandedDetail.trigger_type}</span></div>
                            {expandedDetail.error_message && (
                              <div className="text-slate-400">错误信息: <span className={expandedDetail.status === 'timeout' ? 'text-orange-400' : 'text-red-400'}>{expandedDetail.error_message}</span></div>
                            )}
                            <div className="text-slate-400">重试次数: <span className="text-slate-200">{expandedDetail.retry_attempt}</span></div>
                            {expandedDetail.parent_execution_id && (
                              <div className="text-slate-400">父执行ID: <span className="text-slate-200 font-mono">{expandedDetail.parent_execution_id}</span></div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 pt-2">
                        <button
                          onClick={() => setExecPage(p => Math.max(1, p - 1))}
                          disabled={execPage <= 1}
                          className="px-3 py-1 text-xs bg-slate-700 rounded disabled:opacity-50 hover:bg-slate-600"
                        >
                          上一页
                        </button>
                        <span className="text-xs text-slate-400">{execPage} / {totalPages}</span>
                        <button
                          onClick={() => setExecPage(p => Math.min(totalPages, p + 1))}
                          disabled={execPage >= totalPages}
                          className="px-3 py-1 text-xs bg-slate-700 rounded disabled:opacity-50 hover:bg-slate-600"
                        >
                          下一页
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-[#0f172a] rounded-lg border border-slate-700">
                <button
                  onClick={() => setShowOperations(s => !s)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-800/30"
                >
                  <h4 className="font-medium text-slate-200">操作记录</h4>
                  <span className="text-slate-400">{showOperations ? '▼' : '▶'}</span>
                </button>
                {showOperations && (
                  <div className="border-t border-slate-700">
                    {operations.length === 0 ? (
                      <div className="text-sm text-slate-500 text-center py-4">
                        暂无操作记录
                      </div>
                    ) : (
                      <ul className="divide-y divide-slate-700/50 max-h-64 overflow-y-auto">
                        {operations.map(op => (
                          <li key={op.id} className="p-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-200">
                                  {OPERATION_TYPE_LABELS[op.operation_type] || op.operation_type}
                                </span>
                              </span>
                              <span className="text-slate-500">{formatTime(op.operated_at)}</span>
                            </div>
                            {op.summary && (
                              <div className="mt-1 text-slate-400">{op.summary}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
