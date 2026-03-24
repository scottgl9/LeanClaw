import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { GroupQueue } from './group-queue.js';

vi.mock('../config.js', () => ({
  DATA_DIR: '/tmp/leanclaw-test-data',
  MAX_CONCURRENT_CONTAINERS: 2,
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
    },
  };
});

describe('GroupQueue', () => {
  let queue: GroupQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new GroupQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only runs one container per group at a time', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    queue.setProcessMessagesFn(async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((resolve) => setTimeout(resolve, 100));
      concurrentCount--;
      return true;
    });

    queue.enqueueMessageCheck('group1@g.us');
    queue.enqueueMessageCheck('group1@g.us');
    await vi.advanceTimersByTimeAsync(200);
    expect(maxConcurrent).toBe(1);
  });

  it('respects global concurrency limit', async () => {
    let activeCount = 0;
    let maxActive = 0;
    const completionCallbacks: Array<() => void> = [];

    queue.setProcessMessagesFn(async () => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise<void>((resolve) => completionCallbacks.push(resolve));
      activeCount--;
      return true;
    });

    queue.enqueueMessageCheck('group1@g.us');
    queue.enqueueMessageCheck('group2@g.us');
    queue.enqueueMessageCheck('group3@g.us');
    await vi.advanceTimersByTimeAsync(10);

    expect(maxActive).toBe(2);
    expect(activeCount).toBe(2);

    completionCallbacks[0]();
    await vi.advanceTimersByTimeAsync(10);
    expect(maxActive).toBe(2);
  });

  it('drains tasks before messages for same group', async () => {
    const executionOrder: string[] = [];
    let resolveFirst: () => void;

    queue.setProcessMessagesFn(async () => {
      if (executionOrder.length === 0) {
        await new Promise<void>((resolve) => { resolveFirst = resolve; });
      }
      executionOrder.push('messages');
      return true;
    });

    queue.enqueueMessageCheck('group1@g.us');
    await vi.advanceTimersByTimeAsync(10);

    queue.enqueueTask('group1@g.us', 'task-1', async () => { executionOrder.push('task'); });
    queue.enqueueMessageCheck('group1@g.us');

    resolveFirst!();
    await vi.advanceTimersByTimeAsync(10);

    expect(executionOrder[0]).toBe('messages');
    expect(executionOrder[1]).toBe('task');
  });

  it('retries with exponential backoff on failure', async () => {
    let callCount = 0;
    queue.setProcessMessagesFn(async () => { callCount++; return false; });
    queue.enqueueMessageCheck('group1@g.us');

    await vi.advanceTimersByTimeAsync(10);
    expect(callCount).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10);
    expect(callCount).toBe(2);

    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(10);
    expect(callCount).toBe(3);
  });

  it('prevents new enqueues after shutdown', async () => {
    const processMessages = vi.fn(async () => true);
    queue.setProcessMessagesFn(processMessages);
    await queue.shutdown(1000);
    queue.enqueueMessageCheck('group1@g.us');
    await vi.advanceTimersByTimeAsync(100);
    expect(processMessages).not.toHaveBeenCalled();
  });

  it('stops retrying after MAX_RETRIES', async () => {
    let callCount = 0;
    queue.setProcessMessagesFn(async () => { callCount++; return false; });
    queue.enqueueMessageCheck('group1@g.us');

    await vi.advanceTimersByTimeAsync(10);
    const retryDelays = [5000, 10000, 20000, 40000, 80000];
    for (let i = 0; i < retryDelays.length; i++) {
      await vi.advanceTimersByTimeAsync(retryDelays[i] + 10);
      expect(callCount).toBe(i + 2);
    }

    const countAfterMax = callCount;
    await vi.advanceTimersByTimeAsync(200000);
    expect(callCount).toBe(countAfterMax);
  });

  it('drains waiting groups when active slots free up', async () => {
    const processed: string[] = [];
    const completionCallbacks: Array<() => void> = [];

    queue.setProcessMessagesFn(async (groupJid: string) => {
      processed.push(groupJid);
      await new Promise<void>((resolve) => completionCallbacks.push(resolve));
      return true;
    });

    queue.enqueueMessageCheck('group1@g.us');
    queue.enqueueMessageCheck('group2@g.us');
    await vi.advanceTimersByTimeAsync(10);
    queue.enqueueMessageCheck('group3@g.us');
    await vi.advanceTimersByTimeAsync(10);

    expect(processed).toEqual(['group1@g.us', 'group2@g.us']);

    completionCallbacks[0]();
    await vi.advanceTimersByTimeAsync(10);
    expect(processed).toContain('group3@g.us');
  });

  it('rejects duplicate enqueue of a currently-running task', async () => {
    let resolveTask: () => void;
    let taskCallCount = 0;

    queue.enqueueTask('group1@g.us', 'task-1', async () => {
      taskCallCount++;
      await new Promise<void>((resolve) => { resolveTask = resolve; });
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(taskCallCount).toBe(1);

    const dupFn = vi.fn(async () => {});
    queue.enqueueTask('group1@g.us', 'task-1', dupFn);
    await vi.advanceTimersByTimeAsync(10);
    expect(dupFn).not.toHaveBeenCalled();

    resolveTask!();
    await vi.advanceTimersByTimeAsync(10);
    expect(taskCallCount).toBe(1);
  });

  it('preempts idle container when task is enqueued', async () => {
    const fsModule = await import('fs');
    let resolveProcess: () => void;

    queue.setProcessMessagesFn(async () => {
      await new Promise<void>((resolve) => { resolveProcess = resolve; });
      return true;
    });

    queue.enqueueMessageCheck('group1@g.us');
    await vi.advanceTimersByTimeAsync(10);

    queue.registerProcess('group1@g.us', {} as any, 'container-1', 'test-group');
    queue.notifyIdle('group1@g.us');

    const writeFileSync = vi.mocked(fsModule.default.writeFileSync);
    writeFileSync.mockClear();

    queue.enqueueTask('group1@g.us', 'task-1', async () => {});

    const closeWrites = writeFileSync.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].endsWith('_close'),
    );
    expect(closeWrites).toHaveLength(1);

    resolveProcess!();
    await vi.advanceTimersByTimeAsync(10);
  });

  it('sendMessage returns false for task containers', async () => {
    let resolveTask: () => void;

    queue.enqueueTask('group1@g.us', 'task-1', async () => {
      await new Promise<void>((resolve) => { resolveTask = resolve; });
    });
    await vi.advanceTimersByTimeAsync(10);
    queue.registerProcess('group1@g.us', {} as any, 'container-1', 'test-group');

    expect(queue.sendMessage('group1@g.us', 'hello')).toBe(false);

    resolveTask!();
    await vi.advanceTimersByTimeAsync(10);
  });
});
