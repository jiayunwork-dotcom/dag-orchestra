'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dagApi, monitoringApi } from '@/lib/api';
import { DAGInfo, DashboardStats } from '@/types';
import toast from 'react-hot-toast';
import { Toaster } from 'react-hot-toast';

export default function DashboardPage() {
  const router = useRouter();
  const [dags, setDags] = useState<DAGInfo[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.replace('/login'); return; }
    loadData();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [dagRes, statsRes] = await Promise.all([dagApi.list(), monitoringApi.dashboard()]);
      setDags(dagRes.data);
      setStats(statsRes.data);
    } catch {}
  };

  const loadStats = async () => {
    try {
      const res = await monitoringApi.dashboard();
      setStats(res.data);
    } catch {}
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await dagApi.create({ name: newName, description: newDesc });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      loadData();
      toast.success('DAG创建成功');
    } catch (err: any) {
      toast.error('创建失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此DAG吗？')) return;
    try {
      await dagApi.delete(id);
      loadData();
      toast.success('已删除');
    } catch {}
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-slate-500', published: 'bg-blue-500', running: 'bg-green-500',
    stopped: 'bg-red-500', grayscale: 'bg-yellow-500',
  };
  const statusLabels: Record<string, string> = {
    draft: '草稿', published: '已发布', running: '运行中',
    stopped: '已停止', grayscale: '灰度中',
  };

  return (
    <div className="min-h-screen bg-[#0f172a]">
      <Toaster position="top-right" />

      <nav className="bg-[#1e293b] border-b border-slate-700 px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-blue-400">DAG Orchestra</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="px-3 py-1.5 text-sm bg-blue-600 rounded hover:bg-blue-700"
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
        {stats && (
          <div className="grid grid-cols-5 gap-4 mb-8">
            {[
              { label: '总吞吐量', value: `${stats.total_throughput.toFixed(0)} 条/秒`, color: 'text-blue-400' },
              { label: '平均延迟', value: `${stats.total_latency.toFixed(1)} ms`, color: 'text-cyan-400' },
              { label: '活跃DAG', value: stats.active_dags, color: 'text-green-400' },
              { label: '失败任务', value: stats.failed_tasks, color: 'text-red-400' },
              { label: 'Checkpoint成功率', value: `${stats.checkpoint_success_rate}%`, color: 'text-yellow-400' },
            ].map((s, i) => (
              <div key={i} className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
                <div className="text-slate-400 text-sm">{s.label}</div>
                <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">DAG列表</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium"
          >
            + 新建DAG
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dags.map(dag => (
            <div key={dag.id} className="bg-[#1e293b] rounded-lg border border-slate-700 p-4 hover:border-blue-500 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-100">{dag.name}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs text-white ${statusColors[dag.status] || 'bg-slate-500'}`}>
                  {statusLabels[dag.status] || dag.status}
                </span>
              </div>
              <p className="text-slate-400 text-sm mb-3">{dag.description || '无描述'}</p>
              {dag.status === 'grayscale' && (
                <div className="text-xs text-yellow-400 mb-2">灰度流量: {dag.grayscale_ratio}%</div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => router.push(`/editor/${dag.id}`)}
                  className="px-3 py-1.5 text-xs bg-blue-600 rounded hover:bg-blue-700"
                >
                  编辑
                </button>
                <button
                  onClick={() => router.push(`/monitoring/${dag.id}`)}
                  className="px-3 py-1.5 text-xs bg-cyan-600 rounded hover:bg-cyan-700"
                >
                  监控
                </button>
                <button
                  onClick={() => handleDelete(dag.id)}
                  className="px-3 py-1.5 text-xs bg-red-600 rounded hover:bg-red-700"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[#1e293b] rounded-xl p-6 w-full max-w-md border border-slate-600">
              <h3 className="text-lg font-semibold mb-4">新建DAG</h3>
              <div className="space-y-3">
                <input
                  placeholder="DAG名称"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                />
                <textarea
                  placeholder="描述（可选）"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500 h-20 resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-600 rounded hover:bg-slate-500 text-sm">取消</button>
                  <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 text-sm">创建</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
