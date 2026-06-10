import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  register: (data: { username: string; email: string; password: string; role: string }) =>
    api.post('/auth/register', data),
  login: (data: { username: string; password: string }) =>
    api.post('/auth/login', data),
  getUsers: () => api.get('/auth/users'),
};

export const dagApi = {
  list: () => api.get('/dags'),
  get: (id: string) => api.get(`/dags/${id}`),
  create: (data: { name: string; description: string }) => api.post('/dags', data),
  update: (id: string, data: any) => api.put(`/dags/${id}`, data),
  delete: (id: string) => api.delete(`/dags/${id}`),
  validate: (id: string, data?: { nodes: any[]; edges: any[] }) => api.post(`/dags/${id}/validate`, data || {}),
  autoLayout: (id: string) => api.post(`/dags/${id}/auto-layout`),
  publish: (id: string, grayscale_ratio: number = 0) => api.post(`/dags/${id}/publish`, { grayscale_ratio }),
  stop: (id: string) => api.post(`/dags/${id}/stop`),
  updateGrayscale: (id: string, ratio: number) => api.put(`/dags/${id}/grayscale`, { ratio }),
  rollback: (id: string, version: number) => api.post(`/dags/${id}/rollback/${version}`),
  listVersions: (id: string) => api.get(`/dags/${id}/versions`),
  getVersion: (id: string, ver: number) => api.get(`/dags/${id}/versions/${ver}`),
  diffVersions: (id: string, v1: number, v2: number) => api.get(`/dags/${id}/versions/${v1}/diff/${v2}`),
  getPermissions: (id: string) => api.get(`/dags/${id}/permissions`),
  setPermissions: (id: string, perms: Array<{ user_id: string; can_edit: boolean }>) =>
    api.put(`/dags/${id}/permissions`, perms),
};

export const alertApi = {
  listRules: (dagId: string) => api.get(`/alerts/rules/${dagId}`),
  createRule: (dagId: string, data: any) => api.post(`/alerts/rules/${dagId}`, data),
  updateRule: (ruleId: string, data: any) => api.put(`/alerts/rules/${ruleId}`, data),
  deleteRule: (ruleId: string) => api.delete(`/alerts/rules/${ruleId}`),
  listHistory: (dagId: string) => api.get(`/alerts/history/${dagId}`),
  resolveAlert: (alertId: string) => api.post(`/alerts/history/${alertId}/resolve`),
};

export const commentApi = {
  list: (dagId: string) => api.get(`/comments/${dagId}`),
  create: (dagId: string, data: any) => api.post(`/comments/${dagId}`, data),
  update: (commentId: string, data: any) => api.put(`/comments/${commentId}`, data),
  delete: (commentId: string) => api.delete(`/comments/${commentId}`),
};

export const monitoringApi = {
  dashboard: () => api.get('/monitoring/dashboard'),
  dagMetrics: (dagId: string) => api.get(`/monitoring/${dagId}/metrics`),
  nodeTimeseries: (dagId: string, nodeId: string) => api.get(`/monitoring/${dagId}/metrics/${nodeId}`),
  listCheckpoints: (dagId: string) => api.get(`/monitoring/${dagId}/checkpoints`),
  createCheckpoint: (dagId: string) => api.post(`/monitoring/${dagId}/checkpoint`),
};

export const engineApi = {
  start: (dagId: string) => api.post(`/engine/${dagId}/start`),
  stop: (dagId: string) => api.post(`/engine/${dagId}/stop`),
  status: (dagId: string) => api.get(`/engine/${dagId}/status`),
};

export default api;
