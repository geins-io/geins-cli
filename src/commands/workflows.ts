import { request } from '../api/client.ts';

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  tags: string[] | null;
  group: string;
  type: string;
  version: number;
  enabled: boolean;
  cronExpression: string;
  eventName: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface WorkflowListResponse {
  items: WorkflowSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export async function listWorkflows(page = 1, pageSize = 50): Promise<WorkflowListResponse> {
  return request<WorkflowListResponse>('/orchestrator/workflows', {
    query: { page: String(page), pageSize: String(pageSize) },
  });
}

export async function getWorkflow(id: string): Promise<unknown> {
  return request<unknown>(`/orchestrator/workflows/${id}`);
}

export async function createWorkflow(definition: unknown): Promise<unknown> {
  return request<unknown>('/orchestrator/workflows', {
    method: 'POST',
    body: definition,
  });
}

export async function updateWorkflow(id: string, definition: unknown): Promise<unknown> {
  return request<unknown>(`/orchestrator/workflows/${id}`, {
    method: 'PUT',
    body: definition,
  });
}

export async function runWorkflow(id: string, input?: unknown): Promise<unknown> {
  return request<unknown>(`/orchestrator/workflows/${id}/execute`, {
    method: 'POST',
    body: input,
  });
}

export async function getManifest(): Promise<unknown> {
  return request<unknown>('/orchestrator/manifest');
}

export async function getExecutionLogs(workflowId: string): Promise<unknown> {
  return request<unknown>(`/orchestrator/workflows/${workflowId}/logs`);
}

export async function enableWorkflow(id: string): Promise<unknown> {
  return request<unknown>(`/orchestrator/workflows/${id}/enable`, {
    method: 'POST',
  });
}

export async function disableWorkflow(id: string): Promise<unknown> {
  return request<unknown>(`/orchestrator/workflows/${id}/disable`, {
    method: 'POST',
  });
}

export interface ExecutionResponse {
  ExecutionId: string;
  WorkflowId: string;
  AccountKey: string;
  WorkflowType: string;
  Status: string;
  Message: string;
  IsTestRun: boolean;
}

export interface LiveNode {
  Status: string;
  Name?: string;
  StartTime?: string;
  EndTime?: string;
  DurationMs?: number;
  Error?: string;
}

export interface LiveExecution {
  InstanceId: string;
  Seq: number;
  Status: string;
  TotalNodes: number;
  UpdatedAt: string;
  Nodes: Record<string, LiveNode>;
  Events: unknown[];
  OrchestrationStatus: string;
  IsComplete: boolean;
}

export async function testRunWorkflow(id: string, input?: unknown): Promise<ExecutionResponse> {
  return request<ExecutionResponse>(`/orchestrator/workflows/${id}/test-run`, {
    method: 'POST',
    body: input,
  });
}

export async function getLiveExecution(executionId: string): Promise<LiveExecution> {
  return request<LiveExecution>(`/orchestrator/executions/${executionId}/live`);
}

export async function getExecution(executionId: string): Promise<unknown> {
  return request<unknown>(`/orchestrator/executions/${executionId}`);
}

// Variables (global workflow variables)

export interface WorkflowVariable {
  name: string;
  value: unknown;
  description?: string;
}

export async function listVariables(): Promise<WorkflowVariable[]> {
  return request<WorkflowVariable[]>('/orchestrator/variables');
}

export async function getVariable(name: string): Promise<WorkflowVariable> {
  return request<WorkflowVariable>(`/orchestrator/variables/${encodeURIComponent(name)}`);
}

export async function saveVariable(variable: WorkflowVariable): Promise<unknown> {
  return request<unknown>('/orchestrator/variables', {
    method: 'POST',
    body: variable,
  });
}
