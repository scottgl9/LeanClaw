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
}
