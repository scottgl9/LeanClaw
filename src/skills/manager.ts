/**
 * Skill Manager
 * Discovers, lists, installs, and manages skills from local directories.
 * Skills are directories with a skill.json manifest.
 */
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

import { CONFIG_DIR, SKILLS_DIR } from '../config.js';
import { logger } from '../logger.js';
import type { SkillEntry } from './types.js';

const SkillManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  description: z.string().default(''),
  commands: z.array(z.string()).default([]),
  userInvocable: z.boolean().default(false),
  main: z.string().optional(),
});

function getSkillDirs(): string[] {
  const dirs: string[] = [];

  // Global skills directory
  const globalDir = path.join(CONFIG_DIR, 'skills');
  if (fs.existsSync(globalDir)) dirs.push(globalDir);

  // Custom skills directory from config
  if (SKILLS_DIR && fs.existsSync(SKILLS_DIR)) dirs.push(SKILLS_DIR);

  return dirs;
}

function scanSkillDir(dir: string): SkillEntry[] {
  const entries: SkillEntry[] = [];

  let items: string[];
  try {
    items = fs.readdirSync(dir);
  } catch {
    return entries;
  }

  for (const item of items) {
    const skillDir = path.join(dir, item);
    try {
      if (!fs.statSync(skillDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifestPath = path.join(skillDir, 'skill.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const manifest = SkillManifestSchema.parse(raw);

      entries.push({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        dir: skillDir,
        commands: manifest.commands,
        userInvocable: manifest.userInvocable,
        status: 'installed',
      });
    } catch (err) {
      entries.push({
        name: item,
        version: '0.0.0',
        description: '',
        dir: skillDir,
        commands: [],
        userInvocable: false,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return entries;
}

export function listSkills(): SkillEntry[] {
  const dirs = getSkillDirs();
  const all: SkillEntry[] = [];

  for (const dir of dirs) {
    all.push(...scanSkillDir(dir));
  }

  // Deduplicate by name (first found wins)
  const seen = new Set<string>();
  return all.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

export function searchSkills(query: string): SkillEntry[] {
  const q = query.toLowerCase();
  return listSkills().filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );
}

export function getSkillStatus(name: string): SkillEntry | null {
  return listSkills().find((s) => s.name === name) || null;
}

export function installSkill(source: string, targetDir?: string): SkillEntry {
  const dest = targetDir || path.join(CONFIG_DIR, 'skills');
  fs.mkdirSync(dest, { recursive: true });

  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source path does not exist: ${sourcePath}`);
  }

  const manifestPath = path.join(sourcePath, 'skill.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No skill.json found in: ${sourcePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const manifest = SkillManifestSchema.parse(raw);

  const skillDest = path.join(dest, manifest.name);
  if (fs.existsSync(skillDest)) {
    throw new Error(`Skill "${manifest.name}" already installed at ${skillDest}`);
  }

  // Copy skill directory
  fs.cpSync(sourcePath, skillDest, { recursive: true });

  logger.info({ name: manifest.name, version: manifest.version, dest: skillDest }, 'Skill installed');

  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    dir: skillDest,
    commands: manifest.commands,
    userInvocable: manifest.userInvocable,
    status: 'installed',
  };
}

export function updateSkill(name: string): SkillEntry | null {
  const existing = getSkillStatus(name);
  if (!existing) return null;

  // For local skills, "update" just re-validates the manifest
  const manifestPath = path.join(existing.dir, 'skill.json');
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const manifest = SkillManifestSchema.parse(raw);
    return {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      dir: existing.dir,
      commands: manifest.commands,
      userInvocable: manifest.userInvocable,
      status: 'installed',
    };
  } catch (err) {
    return {
      ...existing,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
