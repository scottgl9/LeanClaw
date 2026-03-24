/**
 * LeanClaw Agent Runner
 * Runs inside Docker containers. Reads JSON input from stdin,
 * invokes the AI agent, and outputs results with sentinel markers.
 */
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const OUTPUT_START_MARKER = '---LEANCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---LEANCLAW_OUTPUT_END---';

function emitOutput(output) {
  const json = JSON.stringify(output);
  process.stdout.write(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

async function main() {
  // Read input from stdin
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

  const { prompt, sessionId, groupFolder, chatJid, isMain, isScheduledTask, assistantName } = input;

  // Determine working directory
  const workDir = isMain ? '/workspace/project' : '/workspace/group';

  // Check if claude CLI is available
  let hasClaude = false;
  try {
    execSync('which claude', { stdio: 'pipe' });
    hasClaude = true;
  } catch {
    // Claude CLI not available
  }

  if (hasClaude) {
    // Run Claude Code in non-interactive mode
    try {
      const args = ['--print', '--output-format', 'text'];
      if (sessionId) {
        args.push('--resume', sessionId);
      }
      args.push(prompt);

      const proc = spawn('claude', args, {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CODE_DISABLE_NONINTERACTIVE_HINTS: '1' },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      await new Promise((resolve) => {
        proc.on('close', (code) => {
          if (code === 0) {
            emitOutput({ status: 'success', result: stdout.trim() || null, newSessionId: sessionId });
          } else {
            emitOutput({ status: 'error', result: null, error: `Claude exited with code ${code}: ${stderr.slice(-200)}` });
          }
          resolve();
        });
        proc.on('error', (err) => {
          emitOutput({ status: 'error', result: null, error: `Spawn error: ${err.message}` });
          resolve();
        });
      });
    } catch (err) {
      emitOutput({ status: 'error', result: null, error: `Agent error: ${err.message}` });
    }
  } else {
    // No Claude CLI — echo back prompt as acknowledgment
    emitOutput({
      status: 'success',
      result: `[Agent runner] Received prompt (${prompt.length} chars) for group ${groupFolder}. Claude CLI not available in container.`,
      newSessionId: sessionId,
    });
  }
}

main().catch((err) => {
  emitOutput({ status: 'error', result: null, error: `Fatal: ${err.message}` });
  process.exit(1);
});
