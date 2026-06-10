'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { monitoringApi, engineApi, dagApi } from '@/lib/api';
import { NodeMetrics, DAGMetrics, MetricsTimeSeries, DAGInfo } from '@/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import toast, { Toaster } from 'react-hot-toast';

export default function MonitoringPage() {
  const params = useParams();
  const router = useRouter();
  const dagId = params.dag_id as string;

  const [dag, setDag] = useState<DAGInfo | null>(null);
  const [metrics, setMetrics] = useState<DAGMetrics | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [timeseries, setTimeseries] = useState<MetricsTimeSeries | null>(null);
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    loadData();
    connectWS();
    const interval = setInterval(loadData, 5000);
    return () => {
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, [dagId]);

  useEffect(() => {
    if (selectedNode) loadTimeseries();
  }, [selectedNode]);

  const loadData = async () => {
    try {
      const [dagRes, metricsRes, statusRes] = await Promise.all([
        dagApi.get(dagId),
        monitoringApi.dagMetrics(dagId),
        engineApi.status(dagId),
      ]);
      setDag(dagRes.data);
      setMetrics(metricsRes.data);
      setEngineStatus(statusRes.data);
    } catch {}
  };

  const loadTimeseries = async () => {
    if (!selectedNode) return;
    try {
      const res = await monitoringApi.nodeTimeseries(dagId, selectedNode);
      setTimeseries(res.data);
    } catch {}
  };

  const connectWS = () => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';
    const ws = new WebSocket(`${wsUrl}/monitoring/${dagId}`);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const m: Record<string, NodeMetrics> = {};
        data.forEach((item: NodeMetrics) => { m[item.node_id] = item; });
        if (metrics) {
          setMetrics({ ...metrics, node_metrics: data });
        }
      } catch {}
    };
    wsRef.current = ws;
  };

  const handleStart = async () => {
    try {
      await engineApi.start(dagId);
      loadData();
      toast.success('引擎已启动');
    } catch {
      toast.error('启动失败');
    }
  };

  const handleStop = async () => {
    try {
      await engineApi.stop(dagId);
      loadData();
      toast.success('引擎已停止');
    } catch {
      toast.error('停止失败');
    }
  };

  const healthColor = (health: string) => {
    if (health === 'green') return 'text-green-400 border-green-400';
    if (health === 'yellow') return 'text-yellow-400 border-yellow-400';
    return 'text-red-400 border-red-400';
  };

  const healthBg = (health: string) => {
    if (health === 'green') return 'bg-green-900/20 border-green-700';
    if (health === 'yellow') return 'bg-yellow-900/20 border-yellow-700';
    return 'bg-red-900/20 border-red-700';
  };

  const chartData = timeseries ? timeseries.timestamps.map((t, i) => ({
    time: new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    throughput: timeseries.throughput[i] || 0,
    latency: timeseries.latency[i] || 0,
    error_rate: (timeseries.error_rate[i] || 0) * 100,
  })) : [];

  return (
    <div className="min-h-screen bg-[#0f172a]">
      <Toaster position="top-right" />

      <nav className="bg-[#1e293b] border-b border-slate-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/dashboard')} className="text-slate-400 hover:text-slate-200 text-sm">← 返回</button>
          <h1 className="text-xl font-bold text-blue-400">{dag?.name || '监控'}</h1>
          <span className={`px-2 py-0.5 rounded-full text-xs text-white ${
            dag?.status === 'running' ? 'bg-green-600' : dag?.status === 'grayscale' ? 'bg-yellow-600' : 'bg-red-600'
          }`}>
            {dag?.status === 'running' ? '运行中' : dag?.status === 'grayscale' ? '灰度中' : '已停止'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push(`/editor/${dagId}`)} className="px-3 py-1.5 text-sm bg-slate-600 rounded hover:bg-slate-500">编辑器</button>
          {engineStatus?.running ? (
            <button onClick={handleStop} className="px-3 py-1.5 text-sm bg-red-600 rounded hover:bg-red-700">停止</button>
          ) : (
            <button onClick={handleStart} className="px-3 py-1.5 text-sm bg-green-600 rounded hover:bg-green-700">启动</button>
          )}
        </div>
      </nav>

      <div className="p-6">
        {metrics && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">总吞吐量</div>
              <div className="text-3xl font-bold text-blue-400">{metrics.total_throughput.toFixed(0)} <span className="text-sm">条/秒</span></div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">平均延迟</div>
              <div className="text-3xl font-bold text-cyan-400">{metrics.total_latency.toFixed(1)} <span className="text-sm">ms</span></div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">背压状态</div>
              <div className={`text-3xl font-bold ${engineStatus?.backpressure ? 'text-red-400' : 'text-green-400'}`}>
                {engineStatus?.backpressure ? '异常' : '正常'}
              </div>
            </div>
            <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm">运行时长</div>
              <div className="text-3xl font-bold text-slate-300">
                {engineStatus?.started_at ? Math.floor((Date.now() - new Date(engineStatus.started_at).getTime()) / 60000) : 0} <span className="text-sm">分钟</span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <h2 className="text-lg font-semibold mb-4">节点状态</h2>
            <div className="grid grid-cols-2 gap-3">
              {metrics?.node_metrics.map(nm => (
                <div
                  key={nm.node_id}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedNode === nm.node_id ? 'ring-2 ring-blue-500' : ''
                  } ${healthBg(nm.health)}`}
                  onClick={() => setSelectedNode(nm.node_id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{nm.node_id}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      nm.health === 'green' ? 'bg-green-600' : nm.health === 'yellow' ? 'bg-yellow-600' : 'bg-red-600'
                    }`}>
                      {nm.health === 'green' ? '健康' : nm.health === 'yellow' ? '警告' : '异常'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-slate-400">吞吐</div>
                      <div className="font-bold text-blue-300">{nm.throughput.toFixed(0)}/s</div>
                    </div>
                    <div>
                      <div className="text-slate-400">延迟</div>
                      <div className={`font-bold ${nm.health === 'green' ? 'text-green-300' : nm.health === 'yellow' ? 'text-yellow-300' : 'text-red-300'}`}>
                        {nm.latency_ms.toFixed(1)}ms
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">积压</div>
                      <div className={`font-bold ${nm.backlog > 100 ? 'text-red-300' : 'text-slate-300'}`}>
                        {nm.backlog}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">
              {selectedNode ? `节点 ${selectedNode} 详情` : '选择节点查看详情'}
            </h2>
            {selectedNode && timeseries && (
              <div className="space-y-4">
                <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
                  <h3 className="text-sm font-medium mb-2">吞吐量曲线</h3>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                      <Line type="monotone" dataKey="throughput" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
                  <h3 className="text-sm font-medium mb-2">延迟曲线</h3>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                      <Line type="monotone" dataKey="latency" stroke="#06b6d4" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-[#1e293b] rounded-lg p-4 border border-slate-700">
                  <h3 className="text-sm font-medium mb-2">错误率曲线</h3>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                      <Line type="monotone" dataKey="error_rate" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
