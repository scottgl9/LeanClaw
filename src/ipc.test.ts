import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase, createTask, getTaskById, updateTask, deleteTask } from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('IPC task operations via DB', () => {
  it('schedule_task creates a task in the database', () => {
    createTask({
      id: 'ipc-task-1',
      group_folder: 'main',
      chat_jid: 'chat1',
      prompt: 'IPC scheduled task',
      schedule_type: 'once',
      schedule_value: '2025-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: '2025-01-01T00:00:00Z',
      status: 'active',
      created_at: new Date().toISOString(),
    });

    const task = getTaskById('ipc-task-1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('IPC scheduled task');
  });

  it('pause_task updates status', () => {
    createTask({
      id: 'ipc-task-2',
      group_folder: 'main',
      chat_jid: 'chat1',
      prompt: 'Test',
      schedule_type: 'interval',
      schedule_value: '60000',
      context_mode: 'isolated',
      next_run: new Date().toISOString(),
      status: 'active',
      created_at: new Date().toISOString(),
    });

    updateTask('ipc-task-2', { status: 'paused' });

    const task = getTaskById('ipc-task-2');
    expect(task!.status).toBe('paused');
  });

  it('cancel_task deletes from database', () => {
    createTask({
      id: 'ipc-task-3',
      group_folder: 'main',
      chat_jid: 'chat1',
      prompt: 'To cancel',
      schedule_type: 'once',
      schedule_value: '2025-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: '2025-01-01T00:00:00Z',
      status: 'active',
      created_at: new Date().toISOString(),
    });

    deleteTask('ipc-task-3');
    expect(getTaskById('ipc-task-3')).toBeUndefined();
  });
});
