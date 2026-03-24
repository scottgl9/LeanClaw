/**
 * IPC Watcher for LeanClaw
 * Polls per-group IPC directories for commands written by agents inside containers.
 * Supports: message sending, task CRUD, group registration.
 */
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

import { DATA_DIR, IPC_POLL_INTERVAL, TIMEZONE, isValidGroupFolder } from './config.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { logger } from './logger.js';
import type { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  onTasksChanged: () => void;
}

let ipcWatcherRunning = false;
let ipcTimer: ReturnType<typeof setTimeout> | null = null;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) return;
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        try {
          return fs.statSync(path.join(ipcBaseDir, f)).isDirectory() && f !== 'errors';
        } catch {
          return false;
        }
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      ipcTimer = setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    // Build folder→isMain lookup
    const folderIsMain = new Map<string, boolean>();
    for (const group of Object.values(registeredGroups)) {
      if (group.isMain) folderIsMain.set(group.folder, true);
    }

    for (const sourceGroup of groupFolders) {
      const isMain = folderIsMain.get(sourceGroup) === true;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages
      await processIpcMessages(messagesDir, sourceGroup, isMain, registeredGroups, deps);

      // Process tasks
      await processIpcTasks(tasksDir, sourceGroup, isMain, registeredGroups, deps);
    }

    ipcTimer = setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started');
}

export function stopIpcWatcher(): void {
  ipcWatcherRunning = false;
  if (ipcTimer) {
    clearTimeout(ipcTimer);
    ipcTimer = null;
  }
}

async function processIpcMessages(
  messagesDir: string,
  sourceGroup: string,
  isMain: boolean,
  registeredGroups: Record<string, RegisteredGroup>,
  deps: IpcDeps,
): Promise<void> {
  try {
    if (!fs.existsSync(messagesDir)) return;

    const messageFiles = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.json'));
    for (const file of messageFiles) {
      const filePath = path.join(messagesDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (data.type === 'message' && data.chatJid && data.text) {
          // Authorization: verify this group can send to this chatJid
          const targetGroup = registeredGroups[data.chatJid];
          if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
            await deps.sendMessage(data.chatJid, data.text);
            logger.info({ chatJid: data.chatJid, sourceGroup }, 'IPC message sent');
          } else {
            logger.warn({ chatJid: data.chatJid, sourceGroup }, 'Unauthorized IPC message attempt blocked');
          }
        }
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.error({ file, sourceGroup, err }, 'Error processing IPC message');
        moveToErrorDir(filePath, sourceGroup, file);
      }
    }
  } catch (err) {
    logger.error({ err, sourceGroup }, 'Error reading IPC messages directory');
  }
}

async function processIpcTasks(
  tasksDir: string,
  sourceGroup: string,
  isMain: boolean,
  registeredGroups: Record<string, RegisteredGroup>,
  deps: IpcDeps,
): Promise<void> {
  try {
    if (!fs.existsSync(tasksDir)) return;

    const taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
    for (const file of taskFiles) {
      const filePath = path.join(tasksDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        await processTaskCommand(data, sourceGroup, isMain, registeredGroups, deps);
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.error({ file, sourceGroup, err }, 'Error processing IPC task');
        moveToErrorDir(filePath, sourceGroup, file);
      }
    }
  } catch (err) {
    logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
  }
}

function moveToErrorDir(filePath: string, sourceGroup: string, file: string): void {
  const errorDir = path.join(DATA_DIR, 'ipc', 'errors');
  try {
    fs.mkdirSync(errorDir, { recursive: true });
    fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${file}`));
  } catch { /* best effort */ }
}

async function processTaskCommand(
  data: Record<string, unknown>,
  sourceGroup: string,
  isMain: boolean,
  registeredGroups: Record<string, RegisteredGroup>,
  deps: IpcDeps,
): Promise<void> {
  switch (data.type) {
    case 'schedule_task': {
      if (!data.prompt || !data.schedule_type || !data.schedule_value || !data.targetJid) break;

      const targetJid = data.targetJid as string;
      const targetGroupEntry = registeredGroups[targetJid];
      if (!targetGroupEntry) {
        logger.warn({ targetJid }, 'Cannot schedule task: target group not registered');
        break;
      }

      const targetFolder = targetGroupEntry.folder;
      if (!isMain && targetFolder !== sourceGroup) {
        logger.warn({ sourceGroup, targetFolder }, 'Unauthorized schedule_task attempt blocked');
        break;
      }

      const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';
      let nextRun: string | null = null;

      if (scheduleType === 'cron') {
        try {
          const interval = CronExpressionParser.parse(data.schedule_value as string, { tz: TIMEZONE });
          nextRun = interval.next().toISOString();
        } catch {
          logger.warn({ scheduleValue: data.schedule_value }, 'Invalid cron expression');
          break;
        }
      } else if (scheduleType === 'interval') {
        const ms = parseInt(data.schedule_value as string, 10);
        if (isNaN(ms) || ms <= 0) break;
        nextRun = new Date(Date.now() + ms).toISOString();
      } else if (scheduleType === 'once') {
        const date = new Date(data.schedule_value as string);
        if (isNaN(date.getTime())) break;
        nextRun = date.toISOString();
      }

      const taskId = (data.taskId as string) || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contextMode = data.context_mode === 'group' ? 'group' : 'isolated';

      createTask({
        id: taskId,
        group_folder: targetFolder,
        chat_jid: targetJid,
        prompt: data.prompt as string,
        schedule_type: scheduleType,
        schedule_value: data.schedule_value as string,
        context_mode: contextMode,
        next_run: nextRun,
        status: 'active',
        created_at: new Date().toISOString(),
      });
      logger.info({ taskId, sourceGroup, targetFolder }, 'Task created via IPC');
      deps.onTasksChanged();
      break;
    }

    case 'pause_task': {
      const task = data.taskId ? getTaskById(data.taskId as string) : undefined;
      if (task && (isMain || task.group_folder === sourceGroup)) {
        updateTask(data.taskId as string, { status: 'paused' });
        logger.info({ taskId: data.taskId, sourceGroup }, 'Task paused via IPC');
        deps.onTasksChanged();
      }
      break;
    }

    case 'resume_task': {
      const task = data.taskId ? getTaskById(data.taskId as string) : undefined;
      if (task && (isMain || task.group_folder === sourceGroup)) {
        updateTask(data.taskId as string, { status: 'active' });
        logger.info({ taskId: data.taskId, sourceGroup }, 'Task resumed via IPC');
        deps.onTasksChanged();
      }
      break;
    }

    case 'cancel_task': {
      const task = data.taskId ? getTaskById(data.taskId as string) : undefined;
      if (task && (isMain || task.group_folder === sourceGroup)) {
        deleteTask(data.taskId as string);
        logger.info({ taskId: data.taskId, sourceGroup }, 'Task cancelled via IPC');
        deps.onTasksChanged();
      }
      break;
    }

    case 'register_group': {
      if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized register_group attempt blocked');
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder as string)) {
          logger.warn({ folder: data.folder }, 'Invalid register_group request - unsafe folder');
          break;
        }
        deps.registerGroup(data.jid as string, {
          name: data.name as string,
          folder: data.folder as string,
          trigger: data.trigger as string,
          added_at: new Date().toISOString(),
          requiresTrigger: data.requiresTrigger as boolean | undefined,
        });
        logger.info({ jid: data.jid, folder: data.folder, sourceGroup }, 'Group registered via IPC');
      }
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}
