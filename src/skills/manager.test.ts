import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSkills, searchSkills, getSkillStatus, installSkill } from './manager.js';

describe('SkillManager', () => {
  const tmpDir = path.join(os.tmpdir(), `skills-test-${Date.now()}`);
  const skillsDir = path.join(tmpDir, 'skills');

  beforeEach(() => {
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSkill(name: string, manifest: Record<string, unknown>): string {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'skill.json'), JSON.stringify(manifest));
    return dir;
  }

  describe('listSkills (via scanSkillDir indirectly)', () => {
    it('returns empty for no skills', () => {
      // listSkills uses config dirs, so we test via searchSkills with empty
      const result = searchSkills('nonexistent-query-xyz');
      expect(result).toEqual([]);
    });
  });

  describe('installSkill', () => {
    it('installs a valid skill', () => {
      const sourceDir = path.join(tmpDir, 'source-skill');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'skill.json'), JSON.stringify({
        name: 'test-skill',
        version: '1.0.0',
        description: 'A test skill',
        commands: ['test'],
        userInvocable: true,
      }));
      fs.writeFileSync(path.join(sourceDir, 'index.js'), 'module.exports = {};');

      const result = installSkill(sourceDir, skillsDir);

      expect(result.name).toBe('test-skill');
      expect(result.version).toBe('1.0.0');
      expect(result.status).toBe('installed');
      expect(result.commands).toEqual(['test']);
      expect(fs.existsSync(path.join(skillsDir, 'test-skill', 'skill.json'))).toBe(true);
      expect(fs.existsSync(path.join(skillsDir, 'test-skill', 'index.js'))).toBe(true);
    });

    it('throws for missing source', () => {
      expect(() => installSkill('/nonexistent/path', skillsDir))
        .toThrow('Source path does not exist');
    });

    it('throws for missing manifest', () => {
      const noManifest = path.join(tmpDir, 'no-manifest');
      fs.mkdirSync(noManifest, { recursive: true });
      expect(() => installSkill(noManifest, skillsDir))
        .toThrow('No skill.json found');
    });

    it('throws for duplicate installation', () => {
      const sourceDir = path.join(tmpDir, 'dup-source');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'skill.json'), JSON.stringify({
        name: 'dup-skill',
        version: '1.0.0',
      }));

      installSkill(sourceDir, skillsDir);
      expect(() => installSkill(sourceDir, skillsDir))
        .toThrow('already installed');
    });
  });

  describe('getSkillStatus', () => {
    it('returns null for unknown skill', () => {
      expect(getSkillStatus('nonexistent')).toBeNull();
    });
  });
});
