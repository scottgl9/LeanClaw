/**
 * Container Runner for LeanClaw
 * Spawns agent execution in Docker containers and handles IPC.
 * Replaces NanoClaw's OneCLI SDK with direct gateway credential injection.
 */
import { ChildProcess, exec, execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  TIMEZONE,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from '../config.js';
import { logger } from '../logger.js';
import { validateAdditionalMounts } from '../security/mount-security.js';
import type { RegisteredGroup } from '../types.js';

const CONTAINER_RUNTIME_BIN = 'docker';

const OUTPUT_START_MARKER = '---LEANCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---LEANCLAW_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

// --- Container runtime utilities ---

export function hostGatewayArgs(): string[] {
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

export function stopContainerCmd(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`;
}

export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, { stdio: 'pipe', timeout: 10000 });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    throw new Error('Container runtime is required but failed to start', { cause: err });
  }
}

export function cleanupOrphans(): void {
  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --filter name=leanclaw- --format '{{.Names}}'`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        execSync(stopContainerCmd(name), { stdio: 'pipe' });
      } catch { /* already stopped */ }
    }
    if (orphans.length > 0) {
      logger.info({ count: orphans.length, names: orphans }, 'Stopped orphaned containers');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}

// --- Volume mounts ---

function buildVolumeMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();
  const groupDir = resolveGroupFolderPath(group.folder);

  if (isMain) {
    mounts.push({ hostPath: projectRoot, containerPath: '/workspace/project', readonly: true });

    // Shadow .env so agents cannot read secrets
    const envFile = path.join(projectRoot, '.env');
    if (fs.existsSync(envFile)) {
      mounts.push({ hostPath: '/dev/null', containerPath: '/workspace/project/.env', readonly: true });
    }

    mounts.push({ hostPath: groupDir, containerPath: '/workspace/group', readonly: false });
  } else {
    mounts.push({ hostPath: groupDir, containerPath: '/workspace/group', readonly: false });

    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({ hostPath: globalDir, containerPath: '/workspace/global', readonly: true });
    }
  }

  // Per-group Claude sessions (isolated)
  const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder, '.claude');
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
      env: {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
      },
    }, null, 2) + '\n');
  }

  // Sync skills into per-group .claude/skills/
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      fs.cpSync(srcDir, path.join(skillsDst, skillDir), { recursive: true });
    }
  }
  mounts.push({ hostPath: groupSessionsDir, containerPath: '/home/node/.claude', readonly: false });

  // Per-group IPC namespace
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  mounts.push({ hostPath: groupIpcDir, containerPath: '/workspace/ipc', readonly: false });

  // Agent runner source (per-group writable copy)
  const agentRunnerSrc = path.join(projectRoot, 'container', 'agent-runner', 'src');
  const groupAgentRunnerDir = path.join(DATA_DIR, 'sessions', group.folder, 'agent-runner-src');
  if (!fs.existsSync(groupAgentRunnerDir) && fs.existsSync(agentRunnerSrc)) {
    fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
  }
  mounts.push({ hostPath: groupAgentRunnerDir, containerPath: '/app/src', readonly: false });

  // Additional mounts validated against allowlist
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(group.containerConfig.additionalMounts, group.name, isMain);
    mounts.push(...validatedMounts);
  }

  return mounts;
}

// --- Container args ---

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  providerEnv: Record<string, string>,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  args.push('-e', `TZ=${TIMEZONE}`);

  // Inject provider credentials via environment (gateway-managed, never on disk)
  for (const [key, value] of Object.entries(providerEnv)) {
    args.push('-e', `${key}=${value}`);
  }

  args.push(...hostGatewayArgs());

  // Run as host user for bind-mount file access
  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    args.push('-e', 'HOME=/home/node');
  }

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);
  return args;
}

// --- Run container ---

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  providerEnv: Record<string, string>,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `leanclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName, providerEnv);

  logger.info({ group: group.name, containerName, mountCount: mounts.length, isMain: input.isMain }, 'Spawning container agent');

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    container.stdin.write(JSON.stringify(input));
    container.stdin.end();

    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let timedOut = false;
    let hadStreamingOutput = false;

    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error({ group: group.name, containerName }, 'Container timeout, stopping');
      exec(stopContainerCmd(containerName), { timeout: 15000 }, (err) => {
        if (err) container.kill('SIGKILL');
      });
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    container.stdout.on('data', (data) => {
      const chunk = data.toString();
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
        } else {
          stdout += chunk;
        }
      }

      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break;
          const jsonStr = parseBuffer.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);
          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) newSessionId = parsed.newSessionId;
            hadStreamingOutput = true;
            resetTimeout();
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn({ group: group.name, error: err }, 'Failed to parse streamed output');
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      if (!stderrTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
        if (chunk.length > remaining) {
          stderr += chunk.slice(0, remaining);
          stderrTruncated = true;
        } else {
          stderr += chunk;
        }
      }
    });

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        if (hadStreamingOutput) {
          outputChain.then(() => resolve({ status: 'success', result: null, newSessionId }));
          return;
        }
        resolve({ status: 'error', result: null, error: `Container timed out after ${configTimeout}ms` });
        return;
      }

      // Write log file
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${ts}.log`);
      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
      ];
      fs.writeFileSync(logFile, logLines.join('\n'));

      if (code !== 0) {
        logger.error({ group: group.name, code, duration }, 'Container exited with error');
        resolve({ status: 'error', result: null, error: `Container exited with code ${code}: ${stderr.slice(-200)}` });
        return;
      }

      if (onOutput) {
        outputChain.then(() => {
          resolve({ status: 'success', result: null, newSessionId });
        });
        return;
      }

      // Legacy mode: parse last output marker pair
      try {
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);
        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
        } else {
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }
        const output: ContainerOutput = JSON.parse(jsonLine);
        resolve(output);
      } catch (err) {
        resolve({ status: 'error', result: null, error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}` });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ status: 'error', result: null, error: `Container spawn error: ${err.message}` });
    });
  });
}

// --- Snapshot writers ---

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{ id: string; groupFolder: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string | null }>,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });
  const filteredTasks = isMain ? tasks : tasks.filter((t) => t.groupFolder === groupFolder);
  fs.writeFileSync(path.join(groupIpcDir, 'current_tasks.json'), JSON.stringify(filteredTasks, null, 2));
}

export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: Array<{ jid: string; name: string; lastActivity: string; isRegistered: boolean }>,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });
  const visibleGroups = isMain ? groups : [];
  fs.writeFileSync(path.join(groupIpcDir, 'available_groups.json'), JSON.stringify({ groups: visibleGroups, lastSync: new Date().toISOString() }, null, 2));
}
