'use client';

import { NODE_CATEGORIES, NodeType } from '@/types';

interface NodePanelProps {
  onAddNode: (type: NodeType) => void;
}

export default function NodePanel({ onAddNode }: NodePanelProps) {
  return (
    <div className="w-56 bg-[#1e293b] border-r border-slate-700 overflow-y-auto flex-shrink-0">
      <div className="p-3 border-b border-slate-700">
        <h3 className="text-sm font-semibold text-slate-300">节点面板</h3>
      </div>
      {Object.entries(NODE_CATEGORIES).map(([cat, data]) => (
        <div key={cat} className="p-3 border-b border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.color }} />
            <span className="text-xs font-medium text-slate-400">{data.label}</span>
          </div>
          <div className="space-y-1">
            {data.types.map(t => (
              <button
                key={t.type}
                onClick={() => onAddNode(t.type)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('nodeType', t.type);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700 rounded transition-colors cursor-grab active:cursor-grabbing"
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
