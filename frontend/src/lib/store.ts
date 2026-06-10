import { create } from 'zustand';
import { NodeData, EdgeData, NodeMetrics, CollabCursor, UserInfo, Comment, AlertHistoryItem } from '@/types';

interface HistoryEntry {
  nodes: NodeData[];
  edges: EdgeData[];
}

interface DAGStore {
  nodes: NodeData[];
  edges: EdgeData[];
  selectedNodes: string[];
  selectedEdge: string | null;
  history: HistoryEntry[];
  historyIndex: number;
  metrics: Record<string, NodeMetrics>;
  collabCursors: Record<string, CollabCursor>;
  currentUser: UserInfo | null;
  comments: Comment[];
  alertHistory: AlertHistoryItem[];
  configNodeId: string | null;
  detailNodeId: string | null;
  isReadOnly: boolean;
  viewingVersion: number | null;

  setNodes: (nodes: NodeData[]) => void;
  setEdges: (edges: EdgeData[]) => void;
  addNode: (node: NodeData) => void;
  updateNode: (id: string, data: Partial<NodeData>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: EdgeData) => void;
  removeEdge: (id: string) => void;
  updateEdge: (id: string, data: Partial<EdgeData>) => void;
  setSelectedNodes: (ids: string[]) => void;
  setSelectedEdge: (id: string | null) => void;
  setConfigNodeId: (id: string | null) => void;
  setDetailNodeId: (id: string | null) => void;
  setMetrics: (metrics: Record<string, NodeMetrics>) => void;
  setCollabCursors: (cursors: Record<string, CollabCursor>) => void;
  setCurrentUser: (user: UserInfo | null) => void;
  setComments: (comments: Comment[]) => void;
  setAlertHistory: (history: AlertHistoryItem[]) => void;
  setIsReadOnly: (readOnly: boolean) => void;
  setViewingVersion: (version: number | null) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  loadDAG: (nodes: NodeData[], edges: EdgeData[]) => void;
  clearAll: () => void;
}

export const useDAGStore = create<DAGStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodes: [],
  selectedEdge: null,
  history: [],
  historyIndex: -1,
  metrics: {},
  collabCursors: {},
  currentUser: null,
  comments: [],
  alertHistory: [],
  configNodeId: null,
  detailNodeId: null,
  isReadOnly: false,
  viewingVersion: null,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  addNode: (node) => {
    const { nodes } = get();
    if (nodes.length >= 100) return;
    set({ nodes: [...nodes, node] });
    get().pushHistory();
  },

  updateNode: (id, data) => {
    const { nodes } = get();
    set({ nodes: nodes.map(n => n.id === id ? { ...n, ...data } : n) });
  },

  removeNode: (id) => {
    const { nodes, edges } = get();
    set({
      nodes: nodes.filter(n => n.id !== id),
      edges: edges.filter(e => e.source_id !== id && e.target_id !== id),
    });
    get().pushHistory();
  },

  addEdge: (edge) => {
    const { edges } = get();
    const exists = edges.some(e => e.source_id === edge.source_id && e.target_id === edge.target_id);
    if (!exists) {
      set({ edges: [...edges, edge] });
      get().pushHistory();
    }
  },

  removeEdge: (id) => {
    const { edges } = get();
    set({ edges: edges.filter(e => e.id !== id) });
    get().pushHistory();
  },

  updateEdge: (id, data) => {
    const { edges } = get();
    set({ edges: edges.map(e => e.id === id ? { ...e, ...data } : e) });
  },

  setSelectedNodes: (ids) => set({ selectedNodes: ids }),
  setSelectedEdge: (id) => set({ selectedEdge: id }),
  setConfigNodeId: (id) => set({ configNodeId: id }),
  setDetailNodeId: (id) => set({ detailNodeId: id }),
  setMetrics: (metrics) => set({ metrics }),
  setCollabCursors: (cursors) => set({ collabCursors: cursors }),
  setCurrentUser: (user) => set({ currentUser: user }),
  setComments: (comments) => set({ comments }),
  setAlertHistory: (history) => set({ alertHistory: history }),
  setIsReadOnly: (readOnly) => set({ isReadOnly: readOnly }),
  setViewingVersion: (version) => set({ viewingVersion: version }),

  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    if (newHistory.length > 50) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      set({ nodes: prev.nodes, edges: prev.edges, historyIndex: historyIndex - 1 });
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      set({ nodes: next.nodes, edges: next.edges, historyIndex: historyIndex + 1 });
    }
  },

  loadDAG: (nodes, edges) => {
    set({ nodes, edges, history: [{ nodes, edges }], historyIndex: 0 });
  },

  clearAll: () => set({
    nodes: [], edges: [], selectedNodes: [], selectedEdge: null,
    history: [], historyIndex: -1, metrics: {}, collabCursors: {},
    configNodeId: null, detailNodeId: null, isReadOnly: false, viewingVersion: null,
  }),
}));
