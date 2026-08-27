import type {
  Endpoint, Project, RequestDetail, RequestSummary, Stats,
} from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/__api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(data?.error ?? `http_${res.status}`, res.status);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => call<{ authenticated: boolean }>('/auth/me'),
  config: () => call<{ wildcard_host: string }>('/config'),
  login: (token: string) =>
    call<{ ok: true }>('/auth/login', { method: 'POST', body: JSON.stringify({ token }) }),
  logout: () => call<{ ok: true }>('/auth/logout', { method: 'POST' }),

  projects: () => call<Project[]>('/projects'),
  createProject: (data: Partial<Project>) =>
    call<{ id: string; slug: string }>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: string, data: Partial<Project>) =>
    call<{ ok: true }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProject: (id: string) => call<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),

  endpoints: (projectId: string) => call<Endpoint[]>(`/projects/${projectId}/endpoints`),
  createEndpoint: (data: Partial<Endpoint>) =>
    call<{ id: string }>('/endpoints', { method: 'POST', body: JSON.stringify(data) }),
  updateEndpoint: (id: string, data: Partial<Endpoint>) =>
    call<{ ok: true }>(`/endpoints/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteEndpoint: (id: string) => call<{ ok: true }>(`/endpoints/${id}`, { method: 'DELETE' }),
  duplicateEndpoint: (id: string) =>
    call<{ id: string }>(`/endpoints/${id}/duplicate`, { method: 'POST' }),

  requests: (params: {
    project?: string; endpoint?: string; matched?: string; method?: string;
    status?: string; q?: string; since?: number; before?: number; limit?: number;
  }) => call<RequestSummary[]>(`/requests${qs(params)}`),
  request: (id: string) => call<RequestDetail>(`/requests/${id}`),
  clearRequests: (project?: string) =>
    call<{ ok: true }>(`/requests${qs({ project })}`, { method: 'DELETE' }),

  stats: (project?: string) => call<Stats>(`/stats${qs({ project })}`),

  preview: (payload: {
    body: string;
    path?: Record<string, string>;
    query?: Record<string, string>;
    header?: Record<string, string>;
    json?: unknown;
    method?: string;
  }) => call<{ rendered: string }>('/preview', { method: 'POST', body: JSON.stringify(payload) }),
};
