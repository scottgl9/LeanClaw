// --- Mount & Container Security ---

export interface AdditionalMount {
  hostPath: string;
  containerPath?: string;
  readonly?: boolean;
}

export interface MountAllowlist {
  allowedRoots: AllowedRoot[];
  blockedPatterns: string[];
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  path: string;
  allowReadWrite: boolean;
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
}

// --- Groups & Messages ---

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean;
  isMain?: boolean;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
}

// --- Scheduled Tasks ---

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

// --- Trigger & Heartbeat (OpenClaw issues #49370, #50773) ---

export interface PreHookConfig {
  command: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface TriggerConfig {
  preHook?: PreHookConfig;
}

export interface HeartbeatConfig {
  enabled: boolean;
  interval: number;
  skipWhenBusy?: boolean;
}

// --- LLM Providers ---

export interface ProviderAuthConfig {
  apiKey?: string;
  oauthToken?: string;
  oauthRefreshToken?: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  expiresAt?: Date;
}

export interface LLMProvider {
  id: string;
  name: string;
  authenticate(config: ProviderAuthConfig): Promise<AuthResult>;
  countTokens(text: string): number;
  getContainerEnv(): Record<string, string>;
  estimateCost(inputTokens: number, outputTokens: number): number;
  isConfigured(): boolean;
  /** Direct API call for session compaction. Optional — defaults to not supported. */
  summarize?(text: string, instructions?: string, model?: string): Promise<string>;
  /** Context window size in tokens for the default model */
  contextWindowSize?: number;
}

export interface ProviderConfig {
  id: string;
  auth: ProviderAuthConfig;
  model?: string;
}

export interface TokenBudget {
  group: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  maxTokens?: number;
  resetAt?: string;
}

// --- Channel Abstraction ---

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  syncGroups?(force: boolean): Promise<void>;
}

export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;

// --- Audit ---

export interface AuditEntry {
  id?: number;
  timestamp: string;
  event_type: string;
  actor: string;
  target: string;
  details: string;
  outcome: string;
}

// --- Health ---

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  uptime: number;
  activeContainers: number;
  queuedMessages: number;
  memoryUsageMb: number;
  connectedChannels: number;
  tokenUsage?: Record<string, { input: number; output: number }>;
}

// --- Gateway Protocol ---

export interface GatewayMessage {
  id: number;
  method: string;
  params?: unknown;
}

export interface GatewayResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface GatewayEvent {
  event: string;
  data: unknown;
}

// --- Agent Execution ---

export interface AgentRun {
  runId: string;
  groupFolder: string;
  chatJid: string;
  clientId: string;
  startedAt: string;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
}

// --- Session Compaction ---

export interface CompactionResult {
  groupFolder: string;
  originalTokens: number;
  compactedTokens: number;
  model: string;
  compactedAt: string;
}

// --- Exec Approvals ---

export interface PendingApproval {
  id: string;
  runId: string;
  toolName: string;
  args: unknown;
  requestedAt: number;
  expiresAt: number;
  clientId: string;
}

// --- Skills ---

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  commands?: string[];
  userInvocable?: boolean;
  main?: string;
}

// --- Plugin ---

export interface PluginManifest {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  skills?: string[];
  channels?: string[];
  providers?: string[];
  // OpenClaw-compatible fields
  kind?: string;
  providerAuthEnvVars?: Record<string, string[]>;
  providerAuthChoices?: unknown[];
  configSchema?: unknown;
  contracts?: {
    speech?: { tts?: boolean; stt?: boolean };
    mediaUnderstanding?: boolean;
    imageGeneration?: boolean;
    webSearch?: boolean;
    toolOwnership?: string[];
  };
  [key: string]: unknown; // Allow additional OpenClaw fields
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  status: 'loaded' | 'error' | 'unloaded';
  rootDir: string;
  manifest: PluginManifest;
  runtime?: unknown;
  error?: string;
  tools?: Array<{ name: string; description: string; pluginId: string }>;
}
