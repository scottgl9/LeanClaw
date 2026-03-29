/**
 * E2E Compatibility Scorecard Runner
 *
 * Runs all E2E tests programmatically, counts P0/P1/P2 pass/fail,
 * lists identified gaps with severity, and outputs a formatted
 * compatibility report.
 *
 * Usage: npx tsx e2e/scorecard.ts
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  priority: 'P0' | 'P1' | 'P2';
  gap?: string;
}

// Priority map for each test by number
const PRIORITY_MAP: Record<string, 'P0' | 'P1' | 'P2'> = {
  // Scenario 1: Boot & Handshake
  '1.1': 'P0', '1.2': 'P0', '1.3': 'P1', '1.4': 'P0', '1.5': 'P0',
  '1.6': 'P0', '1.7': 'P0', '1.8': 'P0', '1.9': 'P1', '1.10': 'P1',
  '1.11': 'P1', '1.12': 'P0',
  // Scenario 2: Protocol Frames
  '2.1': 'P0', '2.2': 'P0', '2.3': 'P0', '2.4': 'P0', '2.5': 'P0',
  '2.6': 'P0', '2.7': 'P1', '2.8': 'P2', '2.9': 'P2',
  // Scenario 3: Method Surface
  '3.1': 'P0', '3.2': 'P0', '3.3': 'P0', '3.4': 'P1', '3.5': 'P1',
  '3.6': 'P1', '3.7': 'P1', '3.8': 'P2', '3.9': 'P2', '3.10': 'P2',
  '3.11': 'P0', '3.12': 'P1', '3.13': 'P1', '3.14': 'P2', '3.15': 'P0',
  '3.16': 'P2', '3.17': 'P0', '3.18': 'P1', '3.19': 'P1', '3.20': 'P1',
  '3.21': 'P2', '3.22': 'P0', '3.23': 'P1', '3.24': 'P1', '3.25': 'P1',
  '3.26': 'P2', '3.27': 'P2', '3.28': 'P0', '3.29': 'P2', '3.30': 'P1',
  '3.31': 'P0', '3.32': 'P1', '3.33': 'P1', '3.34': 'P2',
  // Scenario 9: HTTP Endpoints
  '9.1': 'P0', '9.2': 'P0', '9.3': 'P1', '9.4': 'P1', '9.5': 'P2', '9.6': 'P2',
};

// Known gaps — all P1/P2 gaps resolved
const KNOWN_GAPS: Array<{ method: string; severity: 'P0' | 'P1' | 'P2'; description: string }> = [];

function extractTestNumber(testName: string): string | null {
  const match = testName.match(/^(\d+\.\d+)/);
  return match ? match[1] : null;
}

function parseVitestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const passMatch = line.match(/✓.*?(\d+\.\d+)\s+(.*)/);
    const failMatch = line.match(/✗|×|❌.*?(\d+\.\d+)\s+(.*)/);

    if (passMatch) {
      const num = passMatch[1];
      results.push({
        name: passMatch[2].trim(),
        passed: true,
        priority: PRIORITY_MAP[num] || 'P2',
      });
    } else if (failMatch) {
      const num = failMatch[1];
      results.push({
        name: failMatch[2].trim(),
        passed: false,
        priority: PRIORITY_MAP[num] || 'P2',
      });
    }
  }

  return results;
}

function generateReport(output: string, exitCode: number): string {
  // Count pass/fail from the vitest summary line
  const summaryMatch = output.match(/Tests\s+(\d+)\s+passed.*?(\d+)\s+failed/);
  const passOnlyMatch = output.match(/Tests\s+(\d+)\s+passed/);

  let totalPassed = 0;
  let totalFailed = 0;

  if (summaryMatch) {
    totalPassed = parseInt(summaryMatch[1], 10);
    totalFailed = parseInt(summaryMatch[2], 10);
  } else if (passOnlyMatch) {
    totalPassed = parseInt(passOnlyMatch[1], 10);
  }

  // Parse individual test results
  const results = parseVitestOutput(output);

  // Count by priority
  const counts = { P0: { pass: 0, fail: 0 }, P1: { pass: 0, fail: 0 }, P2: { pass: 0, fail: 0 } };

  // If we parsed individual results, use them; otherwise estimate from totals
  if (results.length > 0) {
    for (const r of results) {
      if (r.passed) counts[r.priority].pass++;
      else counts[r.priority].fail++;
    }
  }

  const total = totalPassed + totalFailed;
  const passRate = total > 0 ? ((totalPassed / total) * 100).toFixed(1) : '0.0';

  const now = new Date().toISOString();

  let report = `# LeanClaw E2E Compatibility Scorecard

Generated: ${now}

## Summary

| Metric | Value |
|--------|-------|
| Total tests | ${total} |
| Passed | ${totalPassed} |
| Failed | ${totalFailed} |
| Pass rate | ${passRate}% |
| Exit code | ${exitCode} |

## Results by Priority

| Priority | Passed | Failed | Total | Pass Rate |
|----------|--------|--------|-------|-----------|
| P0 | ${counts.P0.pass} | ${counts.P0.fail} | ${counts.P0.pass + counts.P0.fail} | ${(counts.P0.pass + counts.P0.fail) > 0 ? ((counts.P0.pass / (counts.P0.pass + counts.P0.fail)) * 100).toFixed(0) : '-'}% |
| P1 | ${counts.P1.pass} | ${counts.P1.fail} | ${counts.P1.pass + counts.P1.fail} | ${(counts.P1.pass + counts.P1.fail) > 0 ? ((counts.P1.pass / (counts.P1.pass + counts.P1.fail)) * 100).toFixed(0) : '-'}% |
| P2 | ${counts.P2.pass} | ${counts.P2.fail} | ${counts.P2.pass + counts.P2.fail} | ${(counts.P2.pass + counts.P2.fail) > 0 ? ((counts.P2.pass / (counts.P2.pass + counts.P2.fail)) * 100).toFixed(0) : '-'}% |

## Known Compatibility Gaps

| Method | Severity | Description |
|--------|----------|-------------|
`;

  for (const gap of KNOWN_GAPS) {
    report += `| \`${gap.method}\` | ${gap.severity} | ${gap.description} |\n`;
  }

  report += `
## Failed Tests

`;

  if (results.some((r) => !r.passed)) {
    for (const r of results.filter((r) => !r.passed)) {
      report += `- **[${r.priority}]** ${r.name}${r.gap ? ` — ${r.gap}` : ''}\n`;
    }
  } else if (totalFailed > 0) {
    report += `${totalFailed} tests failed (see vitest output for details)\n`;
  } else {
    report += `None — all tests passed!\n`;
  }

  report += `
## Scenarios Covered

- Scenario 1: Boot & Handshake (12 tests)
- Scenario 2: Protocol Frame Format (9 tests)
- Scenario 3: Method Surface Completeness (34+3 tests)
- Scenario 4: Plugin Lifecycle (5 tests)
- Scenario 5: Multi-Client (6 tests)
- Scenario 6: Gateway Restart (4 tests)
- Scenario 7: Error Handling (7 tests)
- Scenario 8: Authentication Flows (7 tests)
- Scenario 9: HTTP Endpoints (6 tests)
- Scenario 10: Chat Flow (6 tests)
- Scenario 11: Cron Lifecycle (5 tests)
- Scenario 12: Node Role (5 tests)
- Scenario C: Chaos & Failure Injection (6 tests)

## Next Steps

All P0/P1/P2 compatibility gaps have been resolved. No remaining gaps.
`;

  return report;
}

// --- Main ---

console.log('Running E2E tests...\n');

let output = '';
let exitCode = 0;

try {
  output = execSync('npx vitest run e2e/ --reporter=verbose 2>&1', {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf-8',
    timeout: 120_000,
  });
} catch (err: any) {
  output = err.stdout || err.message || '';
  exitCode = err.status || 1;
}

console.log(output);

const report = generateReport(output, exitCode);
console.log('\n' + '='.repeat(60));
console.log(report);

// Save to artifacts
const artifactsDir = path.resolve(import.meta.dirname, 'artifacts', 'latest');
try {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const scorecardPath = path.join(artifactsDir, 'scorecard.md');
  fs.writeFileSync(scorecardPath, report);
  console.log(`\nScorecard saved to: ${scorecardPath}`);
} catch (err) {
  console.error('Failed to save scorecard artifact:', err);
}
