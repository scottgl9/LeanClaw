export { SkillManifest } from '../types.js';

export interface SkillEntry {
  name: string;
  version: string;
  description: string;
  dir: string;
  commands: string[];
  userInvocable: boolean;
  status: 'installed' | 'error';
  error?: string;
}
