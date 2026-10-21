const BASE = "/api";

let _token: string | null = null;
export function setToken(t: string | null) { _token = t; }
export function getToken() { return _token; }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.detail ?? JSON.stringify(j); } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ token: string }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  listWorkflows: () => request<Workflow[]>("/workflows"),
  createWorkflow: (name: string, description: string | null, dagDefinition: object) =>
    request<Workflow>("/workflows", { method: "POST", body: JSON.stringify({ name, description, dag_definition: dagDefinition }) }),

  listRuns: () => request<Run[]>("/runs"),
  getRun: (id: string) => request<RunDetail>(`/runs/${id}`),
  triggerRun: (workflowId: string, input?: object) =>
    request<Run>(`/workflows/${workflowId}/runs`, { method: "POST", body: JSON.stringify({ input: input ?? {} }) }),

  listWorkers: () => request<Worker[]>("/workers"),
};

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  dag_definition: object;
  version: number;
  created_at: string;
}

export interface Run {
  id: string;
  workflow_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_msg: string | null;
}

export interface StepExecution {
  id: string;
  step_name: string;
  step_type: string;
  status: string;
  attempt_count: number;
  error_msg: string | null;
  output?: object | null;
}

export interface RunDetail extends Run {
  step_executions: StepExecution[];
}

export interface Worker {
  id: string;
  hostname: string;
  status: string;
  capacity: number;
  last_heartbeat_at: string;
}