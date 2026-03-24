import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initTestDatabase,
  storeChatMetadata,
  getAllChats,
  storeMessage,
  getMessagesSince,
  getNewMessages,
  createTask,
  getTaskById,
  getAllTasks,
  getTasksForGroup,
  updateTask,
  deleteTask,
  getDueTasks,
  updateTaskAfterRun,
  logTaskRun,
  getRouterState,
  setRouterState,
  getSession,
  setSession,
  getAllSessions,
  getRegisteredGroup,
  setRegisteredGroup,
  getAllRegisteredGroups,
  logAuditEvent,
  getAuditEvents,
  trackProviderUsage,
  getProviderUsage,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('chats', () => {
  it('stores and retrieves chat metadata', () => {
    storeChatMetadata('chat1', '2024-01-01T00:00:00Z', 'Test Chat', 'telegram', true);
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('chat1');
    expect(chats[0].name).toBe('Test Chat');
    expect(chats[0].channel).toBe('telegram');
    expect(chats[0].is_group).toBe(1);
  });

  it('updates chat metadata on conflict', () => {
    storeChatMetadata('chat1', '2024-01-01T00:00:00Z', 'Old Name');
    storeChatMetadata('chat1', '2024-01-02T00:00:00Z', 'New Name');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('New Name');
    expect(chats[0].last_message_time).toBe('2024-01-02T00:00:00Z');
  });
});

describe('messages', () => {
  it('stores and retrieves messages', () => {
    storeChatMetadata('chat1', '2024-01-01T00:00:00Z');
    storeMessage({
      id: 'msg1',
      chat_jid: 'chat1',
      sender: 'user1',
      sender_name: 'User',
      content: 'Hello',
      timestamp: '2024-01-01T00:01:00Z',
    });

    const msgs = getMessagesSince('chat1', '2024-01-01T00:00:00Z', 'Andy');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hello');
  });

  it('filters bot messages', () => {
    storeChatMetadata('chat1', '2024-01-01T00:00:00Z');
    storeMessage({
      id: 'msg1',
      chat_jid: 'chat1',
      sender: 'user1',
      sender_name: 'User',
      content: 'Hello',
      timestamp: '2024-01-01T00:01:00Z',
    });
    storeMessage({
      id: 'msg2',
      chat_jid: 'chat1',
      sender: 'bot',
      sender_name: 'Bot',
      content: 'Andy: Response',
      timestamp: '2024-01-01T00:02:00Z',
      is_bot_message: true,
    });

    const msgs = getMessagesSince('chat1', '2024-01-01T00:00:00Z', 'Andy');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('msg1');
  });

  it('getNewMessages across multiple JIDs', () => {
    storeChatMetadata('chat1', '2024-01-01T00:00:00Z');
    storeChatMetadata('chat2', '2024-01-01T00:00:00Z');
    storeMessage({
      id: 'msg1', chat_jid: 'chat1', sender: 'u1', sender_name: 'U1',
      content: 'A', timestamp: '2024-01-01T00:01:00Z',
    });
    storeMessage({
      id: 'msg2', chat_jid: 'chat2', sender: 'u2', sender_name: 'U2',
      content: 'B', timestamp: '2024-01-01T00:02:00Z',
    });

    const result = getNewMessages(['chat1', 'chat2'], '2024-01-01T00:00:00Z', 'Andy');
    expect(result.messages).toHaveLength(2);
    expect(result.newTimestamp).toBe('2024-01-01T00:02:00Z');
  });

  it('returns empty for no JIDs', () => {
    const result = getNewMessages([], '2024-01-01T00:00:00Z', 'Andy');
    expect(result.messages).toHaveLength(0);
  });
});

describe('scheduled tasks', () => {
  const baseTask = {
    id: 'task1',
    group_folder: 'main',
    chat_jid: 'chat1',
    prompt: 'Do something',
    schedule_type: 'cron' as const,
    schedule_value: '0 * * * *',
    context_mode: 'isolated' as const,
    next_run: '2024-01-01T01:00:00Z',
    status: 'active' as const,
    created_at: '2024-01-01T00:00:00Z',
  };

  it('creates and retrieves tasks', () => {
    createTask(baseTask);
    const task = getTaskById('task1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('Do something');
    expect(task!.schedule_type).toBe('cron');
  });

  it('gets tasks for group', () => {
    createTask(baseTask);
    createTask({ ...baseTask, id: 'task2', group_folder: 'other' });
    const tasks = getTasksForGroup('main');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task1');
  });

  it('updates task fields', () => {
    createTask(baseTask);
    updateTask('task1', { prompt: 'Updated', status: 'paused' });
    const task = getTaskById('task1');
    expect(task!.prompt).toBe('Updated');
    expect(task!.status).toBe('paused');
  });

  it('deletes tasks and their logs', () => {
    createTask(baseTask);
    logTaskRun({
      task_id: 'task1', run_at: '2024-01-01T01:00:00Z',
      duration_ms: 100, status: 'success', result: 'ok', error: null,
    });
    deleteTask('task1');
    expect(getTaskById('task1')).toBeUndefined();
  });

  it('gets due tasks', () => {
    createTask({ ...baseTask, next_run: '2000-01-01T00:00:00Z' });
    createTask({ ...baseTask, id: 'task2', next_run: '2099-01-01T00:00:00Z' });
    const due = getDueTasks();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('task1');
  });

  it('updates task after run', () => {
    createTask(baseTask);
    updateTaskAfterRun('task1', '2024-01-01T02:00:00Z', 'Success');
    const task = getTaskById('task1');
    expect(task!.last_result).toBe('Success');
    expect(task!.next_run).toBe('2024-01-01T02:00:00Z');
  });
});

describe('router state', () => {
  it('stores and retrieves state', () => {
    setRouterState('key1', 'value1');
    expect(getRouterState('key1')).toBe('value1');
    expect(getRouterState('nonexistent')).toBeUndefined();
  });

  it('overwrites existing state', () => {
    setRouterState('key1', 'value1');
    setRouterState('key1', 'value2');
    expect(getRouterState('key1')).toBe('value2');
  });
});

describe('sessions', () => {
  it('stores and retrieves sessions', () => {
    setSession('main', 'session-abc');
    expect(getSession('main')).toBe('session-abc');
    expect(getSession('nonexistent')).toBeUndefined();
  });

  it('gets all sessions', () => {
    setSession('main', 's1');
    setSession('other', 's2');
    const all = getAllSessions();
    expect(all).toEqual({ main: 's1', other: 's2' });
  });
});

describe('registered groups', () => {
  const group = {
    name: 'Test Group',
    folder: 'testgroup',
    trigger: '@Andy',
    added_at: '2024-01-01T00:00:00Z',
  };

  it('stores and retrieves groups', () => {
    setRegisteredGroup('jid1', group);
    const result = getRegisteredGroup('jid1');
    expect(result).toBeDefined();
    expect(result!.name).toBe('Test Group');
    expect(result!.folder).toBe('testgroup');
  });

  it('rejects invalid folder names', () => {
    expect(() => setRegisteredGroup('jid1', { ...group, folder: '../escape' })).toThrow();
  });

  it('gets all registered groups', () => {
    setRegisteredGroup('jid1', group);
    setRegisteredGroup('jid2', { ...group, name: 'Other', folder: 'other' });
    const all = getAllRegisteredGroups();
    expect(Object.keys(all)).toHaveLength(2);
  });

  it('stores container config as JSON', () => {
    setRegisteredGroup('jid1', {
      ...group,
      containerConfig: { timeout: 60000, additionalMounts: [{ hostPath: '/tmp' }] },
    });
    const result = getRegisteredGroup('jid1');
    expect(result!.containerConfig).toEqual({
      timeout: 60000,
      additionalMounts: [{ hostPath: '/tmp' }],
    });
  });
});

describe('audit log', () => {
  it('logs and retrieves audit events', () => {
    logAuditEvent({
      timestamp: '2024-01-01T00:00:00Z',
      event_type: 'access',
      actor: 'user1',
      target: 'group1',
      details: '{"action":"read"}',
      outcome: 'success',
    });
    const events = getAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('access');
    expect(events[0].actor).toBe('user1');
  });
});

describe('provider usage', () => {
  it('tracks and retrieves usage', () => {
    trackProviderUsage('main', 'anthropic', 100, 50);
    trackProviderUsage('main', 'anthropic', 200, 100);
    const usage = getProviderUsage('main');
    expect(usage).toHaveLength(1);
    expect(usage[0].inputTokens).toBe(300);
    expect(usage[0].outputTokens).toBe(150);
  });
});
