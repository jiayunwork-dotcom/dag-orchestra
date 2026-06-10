'use client';

import { useEffect, useState } from 'react';
import { dagApi } from '@/lib/api';
import { VersionInfo, NodeData, EdgeData } from '@/types';

interface VersionPanelProps {
  dagId: string;
  onClose: () => void;
  onLoadVersion: (nodes: NodeData[], edges: EdgeData[]) => void;
}

export default function VersionPanel({ dagId, onClose, onLoadVersion }: VersionPanelProps) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [selectedV1, setSelectedV1] = useState<number | null>(null);
  const [selectedV2, setSelectedV2] = useState<number | null>(null);
  const [diff, setDiff] = useState<any>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null);

  useEffect(() => {
    loadVersions();
  }, [dagId]);

  const loadVersions = async () => {
    try {
      const res = await dagApi.listVersions(dagId);
      setVersions(res.data);
    } catch {}
  };

  const handleDiff = async () => {
    if (!selectedV1 || !selectedV2) return;
    try {
      const res = await dagApi.diffVersions(dagId, selectedV1, selectedV2);
      setDiff(res.data);
    } catch {}
  };

  const handleViewVersion = async (ver: number) => {
    setViewVersion(ver);
    try {
      const res = await dagApi.getVersion(dagId, ver);
      const v = res.data;
      onLoadVersion(v.nodes || [], v.edges || []);
    } catch {}
  };

  const handleRollback = async (ver: number) => {
    if (!confirm(`确定要回滚到版本 ${ver} 吗？`)) return;
    try {
      await dagApi.rollback(dagId, ver);
      loadVersions();
      alert('回滚成功');
    } catch (err: any) {
      alert(err.response?.data?.detail || '回滚失败');
    }
  };

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-[#1e293b] border-l border-slate-700 z-50 overflow-y-auto shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h3 className="font-semibold">版本管理</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
      </div>

      <div className="p-4">
        <div className="space-y-2 mb-6">
          {versions.map(v => (
            <div key={v.id} className={`flex items-center justify-between p-3 rounded-lg border ${
              viewVersion === v.version_number ? 'border-blue-500 bg-blue-900/20' : 'border-slate-600 bg-[#0f172a]'
            }`}>
              <div>
                <div className="text-sm font-medium">版本 {v.version_number}</div>
                <div className="text-xs text-slate-400">{new Date(v.created_at).toLocaleString('zh-CN')}</div>
                {v.is_archived && <div className="text-xs text-yellow-400">已归档</div>}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleViewVersion(v.version_number)}
                  className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 rounded"
                >
                  查看
                </button>
                {!v.is_archived && v.version_number < (versions[0]?.version_number || 0) && (
                  <button
                    onClick={() => handleRollback(v.version_number)}
                    className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                  >
                    回滚
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-700 pt-4">
          <h4 className="text-sm font-medium mb-3">版本对比</h4>
          <div className="flex gap-2 mb-3">
            <select
              value={selectedV1 || ''}
              onChange={e => setSelectedV1(Number(e.target.value))}
              className="flex-1 px-2 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-xs text-slate-100"
            >
              <option value="">版本1</option>
              {versions.map(v => <option key={v.id} value={v.version_number}>v{v.version_number}</option>)}
            </select>
            <span className="text-slate-400 self-center">vs</span>
            <select
              value={selectedV2 || ''}
              onChange={e => setSelectedV2(Number(e.target.value))}
              className="flex-1 px-2 py-1.5 bg-[#0f172a] border border-slate-600 rounded text-xs text-slate-100"
            >
              <option value="">版本2</option>
              {versions.map(v => <option key={v.id} value={v.version_number}>v{v.version_number}</option>)}
            </select>
          </div>
          <button
            onClick={handleDiff}
            disabled={!selectedV1 || !selectedV2}
            className="w-full py-1.5 text-xs bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
          >
            对比
          </button>

          {diff && (
            <div className="mt-4 space-y-2 text-xs">
              {diff.added_nodes?.length > 0 && (
                <div className="p-2 bg-green-900/30 border border-green-700 rounded">
                  <div className="font-medium text-green-400 mb-1">新增节点</div>
                  {diff.added_nodes.map((n: NodeData) => (
                    <div key={n.id} className="text-green-300">+ {n.label} ({n.type})</div>
                  ))}
                </div>
              )}
              {diff.removed_nodes?.length > 0 && (
                <div className="p-2 bg-red-900/30 border border-red-700 rounded">
                  <div className="font-medium text-red-400 mb-1">删除节点</div>
                  {diff.removed_nodes.map((n: NodeData) => (
                    <div key={n.id} className="text-red-300">- {n.label} ({n.type})</div>
                  ))}
                </div>
              )}
              {diff.modified_nodes?.length > 0 && (
                <div className="p-2 bg-yellow-900/30 border border-yellow-700 rounded">
                  <div className="font-medium text-yellow-400 mb-1">修改节点</div>
                  {diff.modified_nodes.map((n: any) => (
                    <div key={n.id} className="text-yellow-300">~ {n.id}</div>
                  ))}
                </div>
              )}
              {diff.added_edges?.length > 0 && (
                <div className="p-2 bg-green-900/30 border border-green-700 rounded">
                  <div className="font-medium text-green-400 mb-1">新增连线</div>
                  {diff.added_edges.map((e: EdgeData) => (
                    <div key={e.id} className="text-green-300">+ {e.source_id} → {e.target_id}</div>
                  ))}
                </div>
              )}
              {diff.removed_edges?.length > 0 && (
                <div className="p-2 bg-red-900/30 border border-red-700 rounded">
                  <div className="font-medium text-red-400 mb-1">删除连线</div>
                  {diff.removed_edges.map((e: EdgeData) => (
                    <div key={e.id} className="text-red-300">- {e.source_id} → {e.target_id}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
