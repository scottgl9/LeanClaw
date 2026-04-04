export interface NodeSession {
  nodeId: string;
  connId: string;
  displayName: string;
  platform: string;
  version: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps: string[];
  commands: string[];
  permissions: Record<string, boolean>;
  connectedAtMs: number;
}

export interface NodeInvokeResult {
  ok: boolean;
  payload?: unknown;
  error?: string;
}

export interface NodeInvokeParams {
  nodeId: string;
  command: string;
  params?: unknown;
  timeoutMs?: number;
  idempotencyKey?: string;
}

export interface PendingWorkItem {
  id: string;
  nodeId: string;
  type: string;
  priority: 'normal' | 'high';
  enqueuedAtMs: number;
  expiresAtMs: number;
  payload?: unknown;
}

export interface PendingWorkEnqueueOpts {
  nodeId: string;
  type: string;
  priority?: 'normal' | 'high';
  expiresMs?: number;
  payload?: unknown;
  idempotencyKey?: string;
}

export interface PairingRequest {
  requestId: string;
  deviceId: string;
  displayName?: string;
  requestedAtMs: number;
  status: 'pending' | 'approved' | 'rejected';
}
