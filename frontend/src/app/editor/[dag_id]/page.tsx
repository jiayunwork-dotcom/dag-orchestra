'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { dagApi, engineApi, alertApi, commentApi } from '@/lib/api';
import { useDAGStore } from '@/lib/store';
import {
  NodeData, EdgeData, NodeType, NODE_CATEGORIES, getNodeCategory,
  getNodeLabel, ValidationResult, VersionInfo, Comment, AlertRule,
  AlertHistoryItem, UserInfo,
} from '@/types';
import { v4 as uuidv4 } from 'uuid';
import toast, { Toaster } from 'react-hot-toast';

import NodePanel from '@/components/NodePanel';
import ConfigPanel from '@/components/ConfigPanel';
import VersionPanel from '@/components/VersionPanel';
import AlertPanel from '@/components/AlertPanel';
import CommentPanel from '@/components/CommentPanel';

function CustomNode({ data, id }: NodeProps) {
  const d = data as { label: string; nodeType: string; icon: string; isConfigured: boolean; config: any };
  const store = useDAGStore();
  const metrics = store.metrics[id];
  const category = getNodeCategory(d.nodeType as NodeType);
  const categoryColors: Record<string, string> = {
    source: '#3b82f6', transform: '#a855f7', aggregate: '#f59e0b',
    window: '#06b6d4', join: '#f97316', sink: '#22c55e',
  };
  const borderColor = categoryColors[category] || '#475569';
  const healthClass = metrics?.health === 'green' ? 'health-green' : metrics?.health === 'yellow' ? 'health-yellow' : metrics?.health === 'red' ? 'health-red' : '';

  return (
    <div
      className={`px-4 py-3 rounded-lg bg-[#1e293b] border-2 min-w-[180px] shadow-lg ${healthClass}`}
      style={{ borderColor }}
      onDoubleClick={() => store.setConfigNodeId(id)}
    >
      {category !== 'sink' && (
        <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
      )}
      {category !== 'source' && (
        <Handle type="target" position={Position.Left} style={{ background: borderColor }} />
      )}
      {category === 'source' && (
        <>
          <Handle type="source" position={Position.Right} id="output1" style={{ top: '30%', background: borderColor }} />
          <Handle type="source" position={Position.Right} id="output2" style={{ top: '70%', background: borderColor }} />
        </>
      )}
      {category === 'sink' && (
        <>
          <Handle type="target" position={Position.Left} id="input1" style={{ top: '30%', background: borderColor }} />
          <Handle type="target" position={Position.Left} id="input2" style={{ top: '70%', background: borderColor }} />
        </>
      )}

      <div className="flex items-center gap-2">
        <span className="text-lg">{d.icon}</span>
        <div>
          <div className="text-sm font-medium text-slate-100">{d.label}</div>
          <div className="text-xs text-slate-400">{d.nodeType ? getNodeLabel(d.nodeType as NodeType) : ''}</div>
        </div>
      </div>

      {metrics && (
        <div className="mt-2 text-xs space-y-0.5 border-t border-slate-600 pt-1">
          <div className="flex justify-between text-slate-300">
            <span>吞吐</span><span>{metrics.throughput.toFixed(0)}/s</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>延迟</span><span>{metrics.latency_ms.toFixed(1)}ms</span>
          </div>
          {metrics.backlog > 0 && (
            <div className="flex justify-between text-yellow-400">
              <span>积压</span><span>{metrics.backlog}</span>
            </div>
          )}
        </div>
      )}

      {!d.isConfigured && (
        <div className="mt-1 text-xs text-red-400">未配置</div>
      )}
    </div>
  );
}

const nodeTypes = { custom: CustomNode };

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const dagId = params.dag_id as string;

  const store = useDAGStore();
  const [dagName, setDagName] = useState('');
  const [dagStatus, setDagStatus] = useState('draft');
  const [grayscaleRatio, setGrayscaleRatio] = useState(0);
  const [rfNodes, setRfNodes] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges] = useEdgesState<Edge>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const collabWsRef = useRef<WebSocket | null>(null);
  const [clipboard, setClipboard] = useState<{ nodes: NodeData[]; edges: EdgeData[] } | null>(null);

  useEffect(() => {
    loadDAG();
    connectMetricsWS();
    connectCollabWS();
    return () => {
      wsRef.current?.close();
      collabWsRef.current?.close();
    };
  }, [dagId]);

  const loadDAG = async () => {
    try {
      const res = await dagApi.get(dagId);
      const dag = res.data;
      setDagName(dag.name);
      setDagStatus(dag.status);
      setGrayscaleRatio(dag.grayscale_ratio);
      store.loadDAG(dag.nodes || [], dag.edges || []);
      syncToReactFlow(dag.nodes || [], dag.edges || []);
    } catch {
      toast.error('加载DAG失败');
      router.push('/dashboard');
    }
  };

  const syncToReactFlow = (nodes: NodeData[], edges: EdgeData[]) => {
    const rfN: Node[] = nodes.map(n => ({
      id: n.id,
      type: 'custom',
      position: n.position,
      data: {
        label: n.label,
        nodeType: n.type,
        icon: NODE_CATEGORIES[getNodeCategory(n.type) as keyof typeof NODE_CATEGORIES]?.types.find(t => t.type === n.type)?.icon || '',
        isConfigured: n.is_configured,
        config: n.config,
      },
    }));
    const rfE: Edge[] = edges.map(e => ({
      id: e.id,
      source: e.source_id,
      target: e.target_id,
      sourceHandle: e.source_port,
      targetHandle: e.target_port,
      animated: true,
      style: { stroke: e.schema_compatible ? '#3b82f6' : '#ef4444' },
      markerEnd: { type: MarkerType.ArrowClosed, color: e.schema_compatible ? '#3b82f6' : '#ef4444' },
    }));
    setRfNodes(rfN);
    setRfEdges(rfE);
  };

  const syncFromReactFlow = () => {
    const nodes: NodeData[] = rfNodes.map(n => ({
      id: n.id,
      type: (n.data as any).nodeType as NodeType,
      label: (n.data as any).label as string,
      position: n.position,
      config: (n.data as any).config || {},
      is_configured: (n.data as any).isConfigured || false,
    }));
    const edges: EdgeData[] = rfEdges.map(e => ({
      id: e.id,
      source_id: e.source,
      source_port: (e.sourceHandle as string) || 'output',
      target_id: e.target,
      target_port: (e.targetHandle as string) || 'input',
      schema_compatible: !(e.style as any)?.stroke?.includes('ef4444'),
      schema_errors: [],
    }));
    store.setNodes(nodes);
    store.setEdges(edges);
    return { nodes, edges };
  };

  const connectMetricsWS = () => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';
    const ws = new WebSocket(`${wsUrl}/monitoring/${dagId}`);
    ws.onmessage = (e) => {
      try {
        const metrics = JSON.parse(e.data);
        const m: Record<string, any> = {};
        metrics.forEach((item: any) => { m[item.node_id] = item; });
        store.setMetrics(m);
      } catch {}
    };
    wsRef.current = ws;
  };

  const connectCollabWS = () => {
    const userStr = localStorage.getItem('user');
    if (!userStr) return;
    const user = JSON.parse(userStr);
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';
    const ws = new WebSocket(`${wsUrl}/collab/${dagId}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'init',
        user_id: user.id,
        username: user.username,
        avatar_color: user.avatar_color,
      }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'cursor_update') {
          store.setCollabCursors({ ...store.collabCursors, [msg.user_id]: msg });
        } else if (msg.type === 'conflict') {
          toast.error(msg.message, { duration: 10000 });
        }
      } catch {}
    };
    collabWsRef.current = ws;
  };

  const handleSave = async () => {
    const { nodes, edges } = syncFromReactFlow();
    try {
      await dagApi.update(dagId, { name: dagName, nodes, edges });
      toast.success('保存成功');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail?.validation) {
        setValidation(detail.validation);
        toast.error('DAG验证未通过');
      } else {
        toast.error('保存失败');
      }
    }
  };

  const handleValidate = async () => {
    const { nodes, edges } = syncFromReactFlow();
    try {
      const res = await dagApi.validate(dagId, {
        nodes: nodes.map(n => ({ ...n, position: { x: n.position.x, y: n.position.y } })),
        edges,
      });
      setValidation(res.data);
      if (res.data.valid) toast.success('验证通过');
      else toast.error('验证未通过');
    } catch {
      toast.error('验证失败');
    }
  };

  const handleAutoLayout = async () => {
    try {
      const res = await dagApi.autoLayout(dagId);
      const layoutedNodes: NodeData[] = res.data;
      store.setNodes(layoutedNodes);
      syncToReactFlow(layoutedNodes, store.edges);
      toast.success('自动布局完成');
    } catch {
      toast.error('自动布局失败');
    }
  };

  const handlePublish = async (grayscale = 0) => {
    try {
      await dagApi.publish(dagId, grayscale);
      await engineApi.start(dagId);
      loadDAG();
      toast.success(grayscale > 0 ? `灰度发布 ${grayscale}%` : '已发布并启动');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || '发布失败');
    }
  };

  const handleStop = async () => {
    try {
      await engineApi.stop(dagId);
      await dagApi.stop(dagId);
      loadDAG();
      toast.success('已停止');
    } catch {
      toast.error('停止失败');
    }
  };

  const handleGrayscaleChange = async (ratio: number) => {
    try {
      await dagApi.updateGrayscale(dagId, ratio);
      setGrayscaleRatio(ratio);
      toast.success(`灰度比例调整为 ${ratio}%`);
    } catch {
      toast.error('调整失败');
    }
  };

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const edge: Edge = {
      id: uuidv4(),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      animated: true,
      style: { stroke: '#3b82f6' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
    };
    setRfEdges(eds => addEdge(edge, eds));
  }, [setRfEdges]);

  const onNodeDragStop = useCallback(() => {
    syncFromReactFlow();
  }, [rfNodes]);

  const onEdgesDelete = useCallback(() => {
    setTimeout(() => syncFromReactFlow(), 0);
  }, [rfEdges]);

  const handleAddNode = (type: NodeType) => {
    const label = getNodeLabel(type);
    const category = getNodeCategory(type);
    const icon = NODE_CATEGORIES[category as keyof typeof NODE_CATEGORIES]?.types.find(t => t.type === type)?.icon || '';
    const id = uuidv4();
    const newNode: Node = {
      id,
      type: 'custom',
      position: { x: 300 + Math.random() * 200, y: 200 + Math.random() * 200 },
      data: { label, nodeType: type, icon, isConfigured: false, config: {} },
    };
    setRfNodes(nds => [...nds, newNode]);
  };

  const handleCopy = () => {
    const { nodes, edges } = syncFromReactFlow();
    const selected = store.selectedNodes;
    if (selected.length === 0) return;
    const selNodes = nodes.filter(n => selected.includes(n.id));
    const selEdges = edges.filter(e => selected.includes(e.source_id) && selected.includes(e.target_id));
    setClipboard({ nodes: selNodes, edges: selEdges });
    toast.success('已复制');
  };

  const handlePaste = () => {
    if (!clipboard) return;
    const idMap: Record<string, string> = {};
    const newNodes = clipboard.nodes.map(n => {
      const newId = uuidv4();
      idMap[n.id] = newId;
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + 50, y: n.position.y + 50 },
      };
    });
    const newEdges = clipboard.edges.map(e => ({
      ...e,
      id: uuidv4(),
      source_id: idMap[e.source_id] || e.source_id,
      target_id: idMap[e.target_id] || e.target_id,
    }));
    const allNodes = [...store.nodes, ...newNodes];
    const allEdges = [...store.edges, ...newEdges];
    store.loadDAG(allNodes, allEdges);
    syncToReactFlow(allNodes, allEdges);
    toast.success('已粘贴');
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); store.undo(); syncToReactFlow(store.nodes, store.edges); }
        if (e.key === 'y') { e.preventDefault(); store.redo(); syncToReactFlow(store.nodes, store.edges); }
        if (e.key === 's') { e.preventDefault(); handleSave(); }
        if (e.key === 'c') { handleCopy(); }
        if (e.key === 'v') { handlePaste(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clipboard, store.nodes, store.edges]);

  return (
    <div className="h-screen flex flex-col bg-[#0f172a]">
      <Toaster position="top-right" />

      <div className="flex items-center justify-between px-4 py-2 bg-[#1e293b] border-b border-slate-700">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-slate-400 hover:text-slate-200 text-sm">
            ← 返回
          </button>
          <input
            value={dagName}
            onChange={e => setDagName(e.target.value)}
            className="bg-transparent border-b border-slate-600 text-slate-100 text-lg font-semibold focus:outline-none focus:border-blue-500 px-1"
          />
          <span className={`px-2 py-0.5 rounded-full text-xs text-white ${
            dagStatus === 'running' ? 'bg-green-600' : dagStatus === 'grayscale' ? 'bg-yellow-600' : dagStatus === 'stopped' ? 'bg-red-600' : 'bg-slate-600'
          }`}>
            {dagStatus === 'running' ? '运行中' : dagStatus === 'grayscale' ? `灰度 ${grayscaleRatio}%` : dagStatus === 'stopped' ? '已停止' : '草稿'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleValidate} className="px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 rounded">验证</button>
          <button onClick={handleAutoLayout} className="px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 rounded">自动布局</button>
          <button onClick={handleSave} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 rounded">保存 (Ctrl+S)</button>

          {dagStatus === 'draft' && (
            <button onClick={() => handlePublish(0)} className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 rounded">发布</button>
          )}
          {dagStatus === 'draft' && (
            <button onClick={() => handlePublish(10)} className="px-3 py-1.5 text-xs bg-yellow-600 hover:bg-yellow-700 rounded">灰度发布</button>
          )}
          {(dagStatus === 'running' || dagStatus === 'grayscale') && (
            <button onClick={handleStop} className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 rounded">停止</button>
          )}
          {dagStatus === 'grayscale' && (
            <select
              value={grayscaleRatio}
              onChange={e => handleGrayscaleChange(Number(e.target.value))}
              className="bg-slate-600 text-white text-xs rounded px-2 py-1.5"
            >
              <option value={10}>10%</option>
              <option value={30}>30%</option>
              <option value={50}>50%</option>
              <option value={100}>100%</option>
            </select>
          )}

          <button onClick={() => setShowVersions(!showVersions)} className="px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 rounded">版本</button>
          <button onClick={() => setShowAlerts(!showAlerts)} className="px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 rounded">告警</button>
          <button onClick={() => setShowComments(!showComments)} className="px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 rounded">评论</button>
        </div>
      </div>

      {validation && (
        <div className={`px-4 py-2 text-sm ${validation.valid ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
          {validation.valid ? '✓ 验证通过' : `✗ ${validation.errors.join('; ')}`}
          {validation.warnings.length > 0 && <span className="ml-4 text-yellow-300">⚠ {validation.warnings.join('; ')}</span>}
        </div>
      )}

      <div className="flex-1 flex">
        <NodePanel onAddNode={handleAddNode} />

        <div className="flex-1 relative">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onConnect={onConnect}
            onNodesChange={(changes) => setRfNodes(nds => applyNodeChanges(changes, nds))}
            onEdgesChange={(changes) => setRfEdges(eds => applyEdgeChanges(changes, eds))}
            onNodeDragStop={onNodeDragStop}
            onEdgesDelete={onEdgesDelete}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
            multiSelectionKeyCode="Shift"
            className="bg-[#0f172a]"
          >
            <Background color="#334155" gap={20} />
            <Controls className="bg-[#1e293b] border-slate-600" />
            <MiniMap
              nodeColor={(n) => {
                const cat = getNodeCategory((n.data as any)?.nodeType as NodeType);
                const colors: Record<string, string> = {
                  source: '#3b82f6', transform: '#a855f7', aggregate: '#f59e0b',
                  window: '#06b6d4', join: '#f97316', sink: '#22c55e',
                };
                return colors[cat] || '#475569';
              }}
              className="bg-[#1e293b] border-slate-600"
            />
          </ReactFlow>

          {Object.values(store.collabCursors).map(cursor => (
            <div
              key={cursor.user_id}
              className="pointer-events-none absolute z-50"
              style={{ left: cursor.x, top: cursor.y }}
            >
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cursor.avatar_color }} />
                <span className="text-xs px-1 rounded" style={{ backgroundColor: cursor.avatar_color + '40' }}>
                  {cursor.username}
                </span>
              </div>
            </div>
          ))}
        </div>

        {store.configNodeId && (
          <ConfigPanel
            nodeId={store.configNodeId}
            onClose={() => store.setConfigNodeId(null)}
            onSave={(nodeData) => {
              store.updateNode(store.configNodeId!, nodeData);
              const updatedNodes = store.nodes.map(n => n.id === store.configNodeId ? { ...n, ...nodeData } : n);
              syncToReactFlow(updatedNodes, store.edges);
              store.setConfigNodeId(null);
              store.pushHistory();
            }}
          />
        )}

        {store.detailNodeId && (
          <div className="w-80 bg-[#1e293b] border-l border-slate-700 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">节点详情</h3>
              <button onClick={() => store.setDetailNodeId(null)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>
            <NodeDetailPanel nodeId={store.detailNodeId} dagId={dagId} />
          </div>
        )}
      </div>

      {showVersions && <VersionPanel dagId={dagId} onClose={() => setShowVersions(false)} onLoadVersion={(nodes, edges) => {
        store.loadDAG(nodes, edges);
        syncToReactFlow(nodes, edges);
      }} />}
      {showAlerts && <AlertPanel dagId={dagId} onClose={() => setShowAlerts(false)} />}
      {showComments && <CommentPanel dagId={dagId} onClose={() => setShowComments(false)} />}
    </div>
  );
}

function NodeDetailPanel({ nodeId, dagId }: { nodeId: string; dagId: string }) {
  const store = useDAGStore();
  const [timeseries, setTimeseries] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await import('@/lib/api').then(m => m.monitoringApi.nodeTimeseries(dagId, nodeId));
        setTimeseries(res.data);
      } catch {}
    };
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [nodeId, dagId]);

  const metrics = store.metrics[nodeId];

  return (
    <div className="space-y-4">
      {metrics && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[#0f172a] rounded p-2">
            <div className="text-xs text-slate-400">吞吐量</div>
            <div className="text-lg font-bold text-blue-400">{metrics.throughput.toFixed(0)}/s</div>
          </div>
          <div className="bg-[#0f172a] rounded p-2">
            <div className="text-xs text-slate-400">延迟</div>
            <div className="text-lg font-bold text-cyan-400">{metrics.latency_ms.toFixed(1)}ms</div>
          </div>
          <div className="bg-[#0f172a] rounded p-2">
            <div className="text-xs text-slate-400">积压</div>
            <div className="text-lg font-bold text-yellow-400">{metrics.backlog}</div>
          </div>
          <div className="bg-[#0f172a] rounded p-2">
            <div className="text-xs text-slate-400">错误率</div>
            <div className="text-lg font-bold text-red-400">{(metrics.error_rate * 100).toFixed(2)}%</div>
          </div>
        </div>
      )}
      {timeseries && (
        <div className="bg-[#0f172a] rounded p-3">
          <h4 className="text-sm font-medium mb-2">延迟曲线 (最近1小时)</h4>
          <div className="h-32 flex items-end gap-px">
            {timeseries.latency.slice(-60).map((v: number, i: number) => (
              <div
                key={i}
                className="flex-1 bg-blue-500 rounded-t"
                style={{ height: `${Math.min((v / 1000) * 100, 100)}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
