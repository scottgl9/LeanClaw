/**
 * Artifact capture utility for E2E test runs.
 * Creates timestamped artifact directories and writes test logs.
 */
import fs from 'fs';
import path from 'path';

const ARTIFACTS_ROOT = path.resolve(import.meta.dirname, '..', 'artifacts');

let currentDir: string | null = null;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get or create the artifact directory for the current test run.
 */
export function getArtifactDir(): string {
  if (currentDir) return currentDir;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  currentDir = path.join(ARTIFACTS_ROOT, timestamp);
  ensureDir(currentDir);

  // Also maintain a "latest" symlink
  const latestLink = path.join(ARTIFACTS_ROOT, 'latest');
  try {
    if (fs.existsSync(latestLink)) fs.unlinkSync(latestLink);
    fs.symlinkSync(currentDir, latestLink);
  } catch {
    // Symlink may fail on some systems — not critical
  }

  return currentDir;
}

/**
 * Capture artifacts (logs, data) for a specific test.
 */
export function captureArtifacts(testName: string, data: Record<string, unknown>): void {
  const dir = getArtifactDir();
  const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(dir, `${safeName}.json`);

  fs.writeFileSync(filePath, JSON.stringify({
    test: testName,
    timestamp: new Date().toISOString(),
    ...data,
  }, null, 2));
}

/**
 * Write a scorecard markdown file to the artifact directory.
 */
export function writeScorecardArtifact(content: string): string {
  const dir = getArtifactDir();
  const filePath = path.join(dir, 'scorecard.md');
  fs.writeFileSync(filePath, content);
  return filePath;
}
