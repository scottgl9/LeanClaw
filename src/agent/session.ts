import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import * as db from '../db.js';

export class SessionManager {
  getSession(groupFolder: string): string | undefined {
    return db.getSession(groupFolder);
  }

  setSession(groupFolder: string, sessionId: string): void {
    db.setSession(groupFolder, sessionId);
  }

  getAllSessions(): Record<string, string> {
    return db.getAllSessions();
  }

  getSessionDir(groupFolder: string): string {
    return path.join(DATA_DIR, 'sessions', groupFolder, '.claude');
  }

  ensureSessionDir(groupFolder: string): string {
    const dir = this.getSessionDir(groupFolder);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Read all conversation transcript files from the session directory */
  getSessionHistory(groupFolder: string): string {
    const dir = this.getSessionDir(groupFolder);
    if (!fs.existsSync(dir)) return '';

    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.txt'))
      .sort();

    const parts: string[] = [];
    for (const file of files) {
      try {
        parts.push(fs.readFileSync(path.join(dir, file), 'utf-8'));
      } catch {
        // Skip unreadable files
      }
    }

    return parts.join('\n');
  }

  /** Replace session history with compacted content */
  replaceSessionHistory(groupFolder: string, compacted: string): void {
    const dir = this.ensureSessionDir(groupFolder);

    // Remove old transcript files
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.txt'));

    for (const file of files) {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch {
        // Skip unremovable files
      }
    }

    // Write compacted summary
    const compactedFile = path.join(dir, 'compacted-summary.txt');
    fs.writeFileSync(compactedFile, compacted, 'utf-8');
  }
}
