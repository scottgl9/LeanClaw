import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, STORE_DIR, isValidGroupFolder } from './config.js';
import { logger } from './logger.js';
import type {
  AuditEntry,
  NewMessage,
  RegisteredGroup,
  ScheduledTask,
  TaskRunLog,
  TokenBudget,
} from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT,
      channel TEXT,
      is_group INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      context_mode TEXT DEFAULT 'isolated',
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1,
      is_main INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      target TEXT NOT NULL,
      details TEXT,
      outcome TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);

    CREATE TABLE IF NOT EXISTS provider_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_usage_group ON provider_usage(group_name, recorded_at);

    CREATE TABLE IF NOT EXISTS compaction_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      original_tokens INTEGER NOT NULL,
      compacted_tokens INTEGER NOT NULL,
      model TEXT NOT NULL,
      compacted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compaction_group ON compaction_log(group_folder, compacted_at);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      model TEXT,
      system_prompt TEXT,
      tools TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  // Set initial schema version
  const row = database.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  if (!row) {
    database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'leanclaw.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  createSchema(db);
}

/** @internal — for tests only */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/** @internal — for tests only */
export function _getDb(): Database.Database {
  return db;
}

// --- Chat metadata ---

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;

  if (name) {
    db.prepare(`
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `).run(chatJid, name, timestamp, ch, group);
  } else {
    db.prepare(`
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `).run(chatJid, chatJid, timestamp, ch, group);
  }
}

export function getAllChats(): ChatInfo[] {
  return db.prepare(`
    SELECT jid, name, last_message_time, channel, is_group
    FROM chats ORDER BY last_message_time DESC
  `).all() as ChatInfo[];
}

// --- Messages ---

export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id, msg.chat_jid, msg.sender, msg.sender_name,
    msg.content, msg.timestamp, msg.is_from_me ? 1 : 0, msg.is_bot_message ? 1 : 0,
  );
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
  limit: number = 200,
): NewMessage[] {
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me
      FROM messages
      WHERE chat_jid = ? AND timestamp > ?
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp
  `;
  return db.prepare(sql).all(chatJid, sinceTimestamp, `${botPrefix}:%`, limit) as NewMessage[];
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
  limit: number = 200,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me
      FROM messages
      WHERE timestamp > ? AND chat_jid IN (${placeholders})
        AND is_bot_message = 0 AND content NOT LIKE ?
        AND content != '' AND content IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp
  `;

  const rows = db.prepare(sql).all(lastTimestamp, ...jids, `${botPrefix}:%`, limit) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

// --- Scheduled Tasks ---

export function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void {
  db.prepare(`
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id, task.group_folder, task.chat_jid, task.prompt,
    task.schedule_type, task.schedule_value, task.context_mode || 'isolated',
    task.next_run, task.status, task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTask | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db.prepare(
    'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
  ).all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<Pick<ScheduledTask, 'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteTask(id: string): void {
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `).all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(id: string, nextRun: string | null, lastResult: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(`
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(log.task_id, log.run_at, log.duration_ms, log.status, log.result, log.error);
}

// --- Router state ---

export function getRouterState(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM router_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)').run(key, value);
}

// --- Sessions ---

export function getSession(groupFolder: string): string | undefined {
  const row = db.prepare('SELECT session_id FROM sessions WHERE group_folder = ?').get(groupFolder) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare('INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)').run(groupFolder, sessionId);
}

export function getAllSessions(): Record<string, string> {
  const rows = db.prepare('SELECT group_folder, session_id FROM sessions').all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered Groups ---

export function getRegisteredGroup(jid: string): (RegisteredGroup & { jid: string }) | undefined {
  const row = db.prepare('SELECT * FROM registered_groups WHERE jid = ?').get(jid) as {
    jid: string; name: string; folder: string; trigger_pattern: string;
    added_at: string; container_config: string | null;
    requires_trigger: number | null; is_main: number | null;
  } | undefined;
  if (!row) return undefined;
  if (!isValidGroupFolder(row.folder)) {
    logger.warn({ jid: row.jid, folder: row.folder }, 'Skipping registered group with invalid folder');
    return undefined;
  }
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig: row.container_config ? JSON.parse(row.container_config) : undefined,
    requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    isMain: row.is_main === 1 ? true : undefined,
  };
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
  }
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, is_main)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid, group.name, group.folder, group.trigger, group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    group.isMain ? 1 : 0,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string; name: string; folder: string; trigger_pattern: string;
    added_at: string; container_config: string | null;
    requires_trigger: number | null; is_main: number | null;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn({ jid: row.jid, folder: row.folder }, 'Skipping registered group with invalid folder');
      continue;
    }
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig: row.container_config ? JSON.parse(row.container_config) : undefined,
      requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
      isMain: row.is_main === 1 ? true : undefined,
    };
  }
  return result;
}

// --- Compaction log ---

export function logCompaction(groupFolder: string, originalTokens: number, compactedTokens: number, model: string): void {
  db.prepare(`
    INSERT INTO compaction_log (group_folder, original_tokens, compacted_tokens, model, compacted_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(groupFolder, originalTokens, compactedTokens, model, new Date().toISOString());
}

export function getCompactionHistory(groupFolder: string, limit: number = 20): Array<{
  group_folder: string; original_tokens: number; compacted_tokens: number; model: string; compacted_at: string;
}> {
  return db.prepare(
    'SELECT * FROM compaction_log WHERE group_folder = ? ORDER BY compacted_at DESC LIMIT ?',
  ).all(groupFolder, limit) as any;
}

// --- Audit log ---

export function logAuditEvent(entry: Omit<AuditEntry, 'id'>): void {
  db.prepare(`
    INSERT INTO audit_log (timestamp, event_type, actor, target, details, outcome)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entry.timestamp, entry.event_type, entry.actor, entry.target, entry.details, entry.outcome);
}

export function getAuditEvents(limit: number = 100): AuditEntry[] {
  return db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit) as AuditEntry[];
}

// --- Provider usage ---

export function trackProviderUsage(group: string, provider: string, inputTokens: number, outputTokens: number): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO provider_usage (group_name, provider, input_tokens, output_tokens, recorded_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(group, provider, inputTokens, outputTokens, now);
}

export function getProviderUsage(group: string, since?: string): TokenBudget[] {
  const sinceDate = since || new Date(0).toISOString();
  return db.prepare(`
    SELECT group_name as "group", provider, SUM(input_tokens) as "inputTokens", SUM(output_tokens) as "outputTokens"
    FROM provider_usage
    WHERE group_name = ? AND recorded_at >= ?
    GROUP BY group_name, provider
  `).all(group, sinceDate) as TokenBudget[];
}

// --- Task run logs ---

export function getTaskRunLogs(taskId: string, limit: number = 50): TaskRunLog[] {
  return db.prepare(
    'SELECT task_id, run_at, duration_ms, status, result, error FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT ?',
  ).all(taskId, limit) as TaskRunLog[];
}

// --- Agents ---

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  model?: string;
  system_prompt?: string;
  tools?: string;
  created_at: string;
  updated_at: string;
}

export function createAgent(agent: Omit<AgentDefinition, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string }): AgentDefinition {
  const now = new Date().toISOString();
  const record: AgentDefinition = {
    ...agent,
    created_at: agent.created_at || now,
    updated_at: agent.updated_at || now,
  };
  db.prepare(`
    INSERT INTO agents (id, name, description, model, system_prompt, tools, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(record.id, record.name, record.description || null, record.model || null,
    record.system_prompt || null, record.tools || null, record.created_at, record.updated_at);
  return record;
}

export function getAgentById(id: string): AgentDefinition | undefined {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentDefinition | undefined;
}

export function getAllAgents(): AgentDefinition[] {
  return db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all() as AgentDefinition[];
}

export function updateAgent(id: string, updates: Partial<Pick<AgentDefinition, 'name' | 'description' | 'model' | 'system_prompt' | 'tools'>>): boolean {
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  values.push(id);
  const result = db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteAgent(id: string): boolean {
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  return result.changes > 0;
}
