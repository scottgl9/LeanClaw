/**
 * Scenario 11: Cron/Task Lifecycle
 * Verifies scheduled task CRUD via gateway methods.
 * 8 tests covering add, list, remove, validation, broadcast events.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { makeEvent } from '../../src/gateway/protocol.js';
import { _initTestDatabase, createTask, getAllTasks, getTaskById, deleteTask } from '../../src/db.js';
import { openClawConnect, call } from '../helpers/client.js';
import { assertErrorShape } from '../helpers/assertions.js';

let server: GatewayServer | null = null;
let testPort = 32000;

beforeAll(() => {
  _initTestDatabase();
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

/**
 * Register cron methods on the gateway server, mirroring runtime.ts behavior
 * but without container deps.
 */
function registerCronMethods(srv: GatewayServer): void {
  srv.registerMethod('cron.add', async (params) => {
    const { groupFolder, chatJid, prompt, scheduleType, scheduleValue, contextMode } = params as {
      groupFolder?: string; chatJid?: string; prompt?: string;
      scheduleType?: 'cron' | 'interval' | 'once'; scheduleValue?: string; contextMode?: string;
    };
    if (!groupFolder || !chatJid || !prompt || !scheduleType || !scheduleValue) {
      throw new Error('groupFolder, chatJid, prompt, scheduleType, and scheduleValue are required');
    }

    let nextRun: string | null = null;

    if (scheduleType === 'cron') {
      const { CronExpressionParser } = await import('cron-parser');
      try {
        const interval = CronExpressionParser.parse(scheduleValue);
        nextRun = interval.next().toISOString();
      } catch {
        throw new Error(`Invalid cron expression: ${scheduleValue}`);
      }
    } else if (scheduleType === 'interval') {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) throw new Error(`Invalid interval: ${scheduleValue}`);
      nextRun = new Date(Date.now() + ms).toISOString();
    } else if (scheduleType === 'once') {
      nextRun = new Date(scheduleValue).toISOString();
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    createTask({
      id: taskId,
      group_folder: groupFolder,
      chat_jid: chatJid,
      prompt,
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      context_mode: (contextMode as 'group' | 'isolated') || 'isolated',
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    });

    srv.broadcast(makeEvent('cron', { action: 'added', taskId }));
    return { taskId, nextRun };
  });

  srv.registerMethod('cron.list', async () => {
    return getAllTasks();
  });

  srv.registerMethod('cron.remove', async (params) => {
    const { taskId } = params as { taskId?: string };
    if (!taskId) throw new Error('taskId is required');

    const task = getTaskById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    deleteTask(taskId);
    srv.broadcast(makeEvent('cron', { action: 'removed', taskId }));
    return { removed: true };
  });
}

describe('Scenario 11: Cron/Task Lifecycle', () => {
  // 11.1 cron.add with cron expression — returns {taskId, nextRun}
  it('11.1 cron.add with cron expression', async () => {
    server = await startGatewayServer(testPort);
    registerCronMethods(server);

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'cron.add', {
      groupFolder: 'test-group',
      chatJid: 'test-chat@e2e',
      prompt: 'Run daily report',
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
    });

    expect(res.ok).toBe(true);
    expect(typeof res.payload.taskId).toBe('string');
    expect(res.payload.taskId.length).toBeGreaterThan(0);
    expect(typeof res.payload.nextRun).toBe('string');

    ws.close();
  });

  // 11.2 cron.add with interval — returns {taskId, nextRun}
  it('11.2 cron.add with interval', async () => {
    server = await startGatewayServer(testPort);
    registerCronMethods(server);

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'cron.add', {
      groupFolder: 'test-group',
      chatJid: 'test-chat@e2e',
      prompt: 'Check status',
      scheduleType: 'interval',
      scheduleValue: '300000', // 5 minutes
    });

    expect(res.ok).toBe(true);
    expect(typeof res.payload.taskId).toBe('string');
    expect(typeof res.payload.nextRun).toBe('string');

    ws.close();
  });

  // 11.3 cron.add with once timestamp — returns {taskId, nextRun}
  it('11.3 cron.add with once timestamp', async () => {
    server = await startGatewayServer(testPort);
    registerCronMethods(server);

    const { ws } = await openClawConnect(testPort);
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const res = await call(ws, 'cron.add', {
      groupFolder: 'test-group',
      chatJid: 'test-chat@e2e',
      prompt: 'One-time task',
      scheduleType: 'once',
      scheduleValue: futureDate,
    });

    expect(res.ok).toBe(true);
    expect(typeof res.payload.taskId).toBe('string');
    expect(typeof res.payload.nextRun).toBe('string');

    ws.close();
  });

  // 11.4 cron.list shows added task
  it('11.4 cron.list shows added task', async () => {
    server = await startGatewayServer(testPort);
    registerCronMethods(server);

    const { ws } = await openClawConnect(testPort);

    // Add a task
    const addRes = await call(ws, 'cron.add', {
      groupFolder: 'list-test-group',
      chatJid: 'list-test@e2e',
      prompt: 'List test task',
      scheduleType: 'interval',
      scheduleValue: '60000',
    });
    expect(addRes.ok).toBe(true);

    // List tasks
    const listRes = await call(ws, 'cron.list');
    expect(listRes.ok).toBe(true);
    expect(Array.isArray(listRes.payload)).toBe(true);

    const found = listRes.payload.find((t: any) => t.id === addRes.payload.taskId);
    expect(found).toBeDefined();
    expect(found.prompt).toBe('List test task');

    ws.close();
  });

  // 11.5 cron.remove deletes task — task no longer in list
  it('11.5 cron.remove deletes task', async () => {
    server = await startGatewayServer(testPort);
    registerCronMethods(server);

    const { ws } = await openClawConnect(testPort);

    // Add a task
    const addRes = await call(ws, 'cron.add', {
      groupFolder: 'remove-test-group',
      chatJid: 'remove-test@e2e',
      prompt: 'Remove test task',
      scheduleType: 'interval',
      scheduleValue: '60000',
    });
    const taskId = addRes.payload.taskId;

    // Remove it
    const removeRes = await call(ws, 'cron.remove', { taskId });
    expect(removeRes.ok).toBe(true);
    expect(removeRes.payload.removed).toBe(true);

    // Verify it's gone from list
    const listRes = await call(ws, 'cron.list');
    const found = listRes.payload.find((t: any) => t.id === taskId);
    expect(found).toBeUndefined();

    ws.close();
  });

  // 11.6 cron.add with invalid cron expression — error thrown
  it('11.6 cron.add with invalid cron expression — error', async () => {
    server = await startGatewayServer(testPort);
    registerCronMethods(server);

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'cron.add', {
      groupFolder: 'test-group',
      chatJid: 'test-chat@e2e',
      prompt: 'Bad cron',
      scheduleType: 'cron',
      scheduleValue: 'not a valid cron expression',
    });

    expect(res.ok).toBe(false);
    assertErrorShape(res.error);

    ws.close();
  });

  // 11.7 cron.add missing required fields — error thrown
  it('11.7 cron.add missing required fields — error', async () => {
    server = await startGatewayServer(testPort);
    registerCronMethods(server);

    const { ws } = await openClawConnect(testPort);

    // Missing prompt and scheduleValue
    const res = await call(ws, 'cron.add', {
      groupFolder: 'test-group',
      chatJid: 'test-chat@e2e',
    });

    expect(res.ok).toBe(false);
    assertErrorShape(res.error);

    ws.close();
  });

  // 11.8 Broadcast event fired on task add
  it('11.8 Broadcast event fired on task add', async () => {
    server = await startGatewayServer(testPort);
    registerCronMethods(server);

    const c1 = await openClawConnect(testPort, { clientName: 'listener' });
    const c2 = await openClawConnect(testPort, { clientName: 'adder' });

    // Listen for cron event on c1
    const eventPromise = new Promise<any>((resolve) => {
      c1.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event' && msg.event === 'cron') resolve(msg);
      });
    });

    // Add task via c2
    const addRes = await call(c2.ws, 'cron.add', {
      groupFolder: 'broadcast-test',
      chatJid: 'broadcast-test@e2e',
      prompt: 'Broadcast test',
      scheduleType: 'interval',
      scheduleValue: '60000',
    });
    expect(addRes.ok).toBe(true);

    // c1 should receive the broadcast event
    const event = await eventPromise;
    expect(event.event).toBe('cron');
    expect(event.payload.action).toBe('added');
    expect(event.payload.taskId).toBe(addRes.payload.taskId);

    c1.ws.close();
    c2.ws.close();
  });
});
