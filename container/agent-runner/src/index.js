/**
 * LeanClaw Agent Runner
 * Runs inside Docker containers. Reads JSON input from stdin,
 * invokes the AI agent, polls IPC input for follow-up messages,
 * and outputs results with sentinel markers.
 */
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const OUTPUT_START_MARKER = '---LEANCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---LEANCLAW_OUTPUT_END---';
const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_POLL_MS = 1000;

function emitOutput(output) {
  const json = JSON.stringify(output);
  process.stdout.write(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

/**
 * Poll the IPC input directory for follow-up messages and close sentinels.
 * Returns an async generator that yields message texts.
 * Terminates when a _close sentinel is found.
 */
async function* pollIpcInput() {
  while (true) {
    // Check for close sentinel
    const closePath = path.join(IPC_INPUT_DIR, '_close');
    if (fs.existsSync(closePath)) {
      try { fs.unlinkSync(closePath); } catch { /* ignore */ }
      return; // Signal to stop
    }

    // Read message files
    let files;
    try {
      files = fs.existsSync(IPC_INPUT_DIR)
        ? fs.readdirSync(IPC_INPUT_DIR).filter(f => f.endsWith('.json')).sort()
        : [];
    } catch {
      files = [];
    }

    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          yield data.text;
        }
      } catch {
        // Skip malformed files
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }

    await new Promise(resolve => setTimeout(resolve, IPC_POLL_MS));
  }
}

async function main() {
  // Read initial input from stdin
  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  let input;
  try {
    input = JSON.parse(inputData);
  } catch (err) {
    emitOutput({ status: 'error', result: null, error: 'Failed to parse input JSON' });
    process.exit(1);
  }

  const { prompt, sessionId, groupFolder, chatJid, isMain, isScheduledTask, assistantName, model } = input;
  const workDir = isMain ? '/workspace/project' : '/workspace/group';

  // Check if claude CLI is available
  let hasClaude = false;
  try {
    execSync('which claude', { stdio: 'pipe' });
    hasClaude = true;
  } catch {
    // Claude CLI not available
  }

  if (!hasClaude) {
    emitOutput({
      status: 'success',
      result: `[Agent runner] Received prompt (${prompt.length} chars) for group ${groupFolder}. Claude CLI not available in container.`,
      newSessionId: sessionId,
    });
    return;
  }

  // Run initial prompt
  let currentSessionId = sessionId;
  currentSessionId = await runClaude(prompt, currentSessionId, workDir, model);

  // For scheduled tasks, we're done after one turn
  if (isScheduledTask) return;

  // Poll IPC input for follow-up messages (multi-turn conversation)
  for await (const followUpText of pollIpcInput()) {
    currentSessionId = await runClaude(followUpText, currentSessionId, workDir, model);
  }
}

/**
 * Run Claude CLI with a prompt and emit the output.
 * Returns the session ID for continuation.
 */
async function runClaude(prompt, sessionId, workDir, model) {
  const args = ['--print', '--output-format', 'text'];
  if (sessionId) {
    args.push('--resume', sessionId);
  }
  if (model) {
    args.push('--model', model);
  }
  args.push(prompt);

  return new Promise((resolve) => {
    const proc = spawn('claude', args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONINTERACTIVE_HINTS: '1' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        emitOutput({ status: 'success', result: stdout.trim() || null, newSessionId: sessionId });
      } else {
        emitOutput({ status: 'error', result: null, error: `Claude exited with code ${code}: ${stderr.slice(-200)}` });
      }
      resolve(sessionId);
    });

    proc.on('error', (err) => {
      emitOutput({ status: 'error', result: null, error: `Spawn error: ${err.message}` });
      resolve(sessionId);
    });
  });
}

main().catch((err) => {
  emitOutput({ status: 'error', result: null, error: `Fatal: ${err.message}` });
  process.exit(1);
});
