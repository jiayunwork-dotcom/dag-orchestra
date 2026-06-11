'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { scheduleApi } from '@/lib/api';
import { ScheduleListItem, ScheduleOverview } from '@/types';
import toast, { Toaster } from 'react-hot-toast';

type SortKey = 'next_trigger_time' | 'last_7d_success_rate' | null;
type SortDir = 'asc' | 'desc';

export default function SchedulesPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<ScheduleOverview | null>(null);
  const [schedules, setSchedules] = useState<ScheduleListItem[]>([]);
  const [dagNameFilter, setDagNameFilter] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.replace('/login'); return; }
    loadData();
  }, []);

  useEffect(() => {
    loadSchedules();
  }, [dagNameFilter, enabledFilter]);

  const loadData = async () => {
    try {
      const res = await scheduleApi.getOverview();
      setOverview(res.data);
    } catch {}
    await loadSchedules();
  };

  const loadSchedules = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (dagNameFilter) params.dag_name = dagNameFilter;
      if (enabledFilter !== '') params.enabled = enabledFilter === 'true';
      const res = await scheduleApi.listAllSchedules(params);
      setSchedules(res.data);
    } catch {}
    setLoading(false);
  };

  const formatTime = (t?: string) => {
    if (!t) return '-';
    return new Date(t).toLocaleString('zh-CN');
  };

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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedSchedules = useMemo(() => {
    if (!sortKey) return schedules;
    return [...schedules].sort((a, b) => {
      let va: any = a[sortKey];
      let vb: any = b[sortKey];
      if (sortKey === 'next_trigger_time') {
        va = va ? new Date(va).getTime() : Infinity;
        vb = vb ? new Date(vb).getTime() : Infinity;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [schedules, sortKey, sortDir]);

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ' ↕';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="min-h-screen bg-[#0f172a]">
      <Toaster position="top-right" />

      <nav className="bg-[#1e293b] border-b border-slate-700 px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-blue-400">DAG Orchestra - 全局调度管理</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="px-3 py-1.5 text-sm bg-slate-600 rounded hover:bg-slate-500"
          >
            仪表盘
          </button>
          <button
            onClick={() => router.push('/alerts')}
            className="px-3 py-1.5 text-sm bg-slate-600 rounded hover:bg-slate-500"
          >
            告警中心
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
        {overview && (
          <div
            className="grid grid-cols-5 gap-4 mb-8 cursor-pointer"
            onClick={() => router.push('/dashboard')}
          >
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">今日触发次数</div>
              <div className="text-2xl font-bold text-blue-400">{overview.today_triggers}</div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">今日成功率</div>
              <div className="text-2xl font-bold text-green-400">{overview.today_success_rate}%</div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">当前运行中</div>
              <div className="text-2xl font-bold text-cyan-400">{overview.running_count}</div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">本周超时</div>
              <div className="text-2xl font-bold text-orange-400">{overview.week_timeout_count || 0}</div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">最近失败</div>
              <div className="text-lg font-bold text-red-400">{overview.last_failed_dag_name || '无'}</div>
              {overview.last_failed_time && (
                <div className="text-xs text-slate-500">{formatTime(overview.last_failed_time)}</div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">调度计划列表</h2>
          <div className="flex items-center gap-3">
            <input
              placeholder="搜索DAG名称..."
              value={dagNameFilter}
              onChange={e => setDagNameFilter(e.target.value)}
              className="px-3 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500 w-48"
            />
            <select
              value={enabledFilter}
              onChange={e => setEnabledFilter(e.target.value)}
              className="bg-[#0f172a] border border-slate-600 text-slate-300 text-sm rounded px-2 py-1.5"
            >
              <option value="">全部状态</option>
              <option value="true">已启用</option>
              <option value="false">已禁用</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-slate-400 py-8">加载中...</div>
        ) : schedules.length === 0 ? (
          <div className="text-center text-slate-500 py-8 bg-[#1e293b] rounded-lg border border-slate-700">
            暂无调度计划
          </div>
        ) : (
          <div className="bg-[#1e293b] rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">DAG名称</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">Cron表达式</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">状态</th>
                  <th
                    className="text-left px-4 py-3 text-sm font-medium text-slate-400 cursor-pointer hover:text-slate-200 select-none"
                    onClick={() => handleSort('next_trigger_time')}
                  >
                    下次触发时间{sortIndicator('next_trigger_time')}
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">最近执行结果</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">最近7天执行次数</th>
                  <th
                    className="text-left px-4 py-3 text-sm font-medium text-slate-400 cursor-pointer hover:text-slate-200 select-none"
                    onClick={() => handleSort('last_7d_success_rate')}
                  >
                    最近7天成功率{sortIndicator('last_7d_success_rate')}
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedSchedules.map(schedule => (
                  <tr key={schedule.plan_id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-sm text-slate-200">{schedule.dag_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-300 font-mono">{schedule.cron_expression}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs text-white ${schedule.enabled ? 'bg-green-600' : 'bg-slate-600'}`}>
                        {schedule.enabled ? '已启用' : '已禁用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {schedule.enabled ? formatTime(schedule.next_trigger_time) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {schedule.last_execution_status ? (
                        <span className={`px-2 py-0.5 rounded text-xs text-white ${statusColors[schedule.last_execution_status] || 'bg-slate-600'}`}>
                          {statusLabels[schedule.last_execution_status] || schedule.last_execution_status}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">无记录</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {schedule.last_7d_executions}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={schedule.last_7d_success_rate >= 80 ? 'text-green-400' : schedule.last_7d_success_rate >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                        {schedule.last_7d_success_rate}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => router.push(`/editor/${schedule.dag_id}`)}
                        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                      >
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
