import axios from 'axios';
import { useAuthStore } from './store';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  // Get token from Zustand store (persisted via middleware)
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth state in store (also clears localStorage)
      useAuthStore.getState().clearAuth();
      // Only redirect if not already on login page
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  register: (username: string, email: string, password: string) =>
    api.post('/auth/register', { username, email, password }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/auth/password', { currentPassword, newPassword }),
};

// Playbooks API
export const playbooksApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }) => api.get('/playbooks', { params }),
  get: (id: string) => api.get(`/playbooks/${id}`),
  create: (data: {
    name: string;
    description?: string;
    content: string;
    prompt?: string;
    template?: string;
    tags?: string[];
  }) => api.post('/playbooks', data),
  update: (id: string, data: {
    name?: string;
    description?: string;
    content?: string;
    tags?: string[];
  }) => api.put(`/playbooks/${id}`, data),
  delete: (id: string) => api.delete(`/playbooks/${id}`),
  generate: (data: {
    prompt: string;
    template?: string;
    context?: Record<string, any>;
  }) => api.post('/playbooks/generate', data),
  validate: (id: string) => api.post(`/playbooks/${id}/validate`),
  execute: (id: string, data: {
    inventory: string;
    extraVars?: Record<string, any>;
    checkMode?: boolean;
    tags?: string[];
  }) => api.post(`/playbooks/${id}/execute`, data),
  lint: (id: string) => api.post(`/playbooks/${id}/lint`),
  refine: (id: string, feedback: string, validationErrors?: string[]) =>
    api.post(`/playbooks/${id}/refine`, { feedback, validationErrors }),
};

// Executions API
export const executionsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    offset?: number;
    status?: string;
    playbookId?: string;
  }) => api.get('/executions', { params }),
  get: (id: string) => api.get(`/executions/${id}`),
  getOutput: (id: string) => api.get(`/executions/${id}/output`),
  getLogs: (id: string) => api.get(`/executions/${id}/logs`),
  stop: (id: string) => api.post(`/executions/${id}/stop`),
  stats: () => api.get('/executions/stats/summary'),
};

// Templates API
export const templatesApi = {
  list: (params?: { category?: string; search?: string }) =>
    api.get('/templates', { params }),
  get: (id: string) => api.get(`/templates/${id}`),
  categories: () => api.get('/templates/meta/categories'),
  enrich: (id: string, prompt: string, variables?: Record<string, any>) =>
    api.post(`/templates/${id}/enrich`, { prompt, variables }),
};

// Jobs API
export const jobsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    type?: string;
  }) => api.get('/jobs', { params }),
  get: (id: string) => api.get(`/jobs/${id}`),
  cancel: (id: string) => api.post(`/jobs/${id}/cancel`),
  queueStats: () => api.get('/jobs/stats/queue'),
};

// Health API
export const healthApi = {
  check: () => api.get('/health'),
  stats: () => api.get('/stats'),
};

export default api;
