/**
 * OpenClaw-compatible gateway protocol types and schemas.
 * Implements Protocol Version 3 for compatibility.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 3;
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;  // 16 MB
export const MAX_BUFFERED_BYTES = 64 * 1024 * 1024; // 64 MB
export const TICK_INTERVAL_MS = 60_000;              // 60s heartbeat
export const HANDSHAKE_TIMEOUT_MS = 30_000;          // 30s handshake

// --- Frame types ---

export const RequestFrameSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});

export const ResponseFrameSchema = z.object({
  type: z.literal('res'),
  id: z.string(),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    retryable: z.boolean().optional(),
    retryAfterMs: z.number().optional(),
  }).optional(),
});

export const EventFrameSchema = z.object({
  type: z.literal('event'),
  event: z.string(),
  payload: z.unknown().optional(),
  seq: z.number().optional(),
});

export type RequestFrame = z.infer<typeof RequestFrameSchema>;
export type ResponseFrame = z.infer<typeof ResponseFrameSchema>;
export type EventFrame = z.infer<typeof EventFrameSchema>;
export type Frame = RequestFrame | ResponseFrame | EventFrame;

// --- Connect handshake ---

export const ConnectClientSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  version: z.string(),
  platform: z.string(),
  deviceFamily: z.string().optional(),
  mode: z.string(),
  instanceId: z.string().optional(),
});

export const ConnectParamsSchema = z.object({
  minProtocol: z.number(),
  maxProtocol: z.number(),
  client: ConnectClientSchema,
  caps: z.array(z.string()).optional(),
  role: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  auth: z.object({
    token: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
  locale: z.string().optional(),
  userAgent: z.string().optional(),
});

export type ConnectParams = z.infer<typeof ConnectParamsSchema>;

// --- Error codes ---

export const ErrorCodes = {
  NOT_LINKED: 'NOT_LINKED',
  NOT_PAIRED: 'NOT_PAIRED',
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAVAILABLE: 'UNAVAILABLE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

// --- Method registry ---

export type MethodHandler = (params: unknown, clientId: string) => Promise<unknown>;

export interface MethodRegistry {
  [method: string]: MethodHandler;
}

// --- Hello-ok response ---

export interface HelloOkPayload {
  type: 'hello-ok';
  protocol: number;
  server: { version: string; connId: string };
  features: { methods: string[]; events: string[] };
  snapshot: {
    presence: unknown[];
    health: Record<string, unknown>;
    stateVersion: { presence: number; health: number };
    uptimeMs: number;
    authMode: string;
    sessionDefaults?: Record<string, unknown>;
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
  };
  canvasHostUrl?: string;
}

// --- Helpers ---

export function makeResponse(id: string, ok: true, payload?: unknown): ResponseFrame;
export function makeResponse(id: string, ok: false, error: { code: string; message: string }): ResponseFrame;
export function makeResponse(id: string, ok: boolean, payloadOrError?: unknown): ResponseFrame {
  if (ok) {
    return { type: 'res', id, ok: true, payload: payloadOrError };
  }
  return { type: 'res', id, ok: false, error: payloadOrError as { code: string; message: string } };
}

export function makeEvent(event: string, payload?: unknown, seq?: number): EventFrame {
  return { type: 'event', event, payload, seq };
}
