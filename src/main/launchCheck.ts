import { statSync } from 'node:fs';
import {
  LAUNCH_TYPES, isWebUrl, type LaunchOpenMode, type LaunchProblem, type LaunchType,
} from '../shared/launchItems';

/** Whether a path is there, whatever kind of thing it is. */
export function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The form's own check, before anything is saved: the URL's shape, and whether the paths are really there. The draft
 * comes from the settings window and is read from `unknown`, field by field.
 */
export function checkLaunchDraft(raw: unknown, exists: (path: string) => boolean = pathExists): LaunchProblem[] {
  const d = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const type: LaunchType = typeof d.type === 'string' && (LAUNCH_TYPES as readonly string[]).includes(d.type)
    ? (d.type as LaunchType) : 'app';
  const target = typeof d.target === 'string' ? d.target.trim() : '';
  const openMode: LaunchOpenMode = d.openMode === 'program' && (type === 'file' || type === 'folder') ? 'program' : 'default';
  const program = typeof d.program === 'string' ? d.program.trim() : '';
  const problems: LaunchProblem[] = [];
  if (target === '') problems.push({ field: 'target', reason: 'empty' });
  else if (type === 'url') {
    if (!isWebUrl(target)) problems.push({ field: 'target', reason: 'badUrl' });
  } else if (!exists(target)) {
    problems.push({ field: 'target', reason: 'missing' });
  }
  if (openMode === 'program') {
    if (program === '') problems.push({ field: 'program', reason: 'empty' });
    else if (!exists(program)) problems.push({ field: 'program', reason: 'missing' });
  }
  return problems;
}
