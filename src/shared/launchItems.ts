import type { PingId } from './pings';
import { sanitizeName } from './roomProtocol';
import type { Strings } from './i18n';

/** What the request gather ping can open. */
/**
 * What the request gather ping can open. `vscode` is a project folder opened as a VS Code workspace whose task runs the
 * command on open, which is the only way VS Code can start a project by itself.
 */
export type LaunchType = 'url' | 'app' | 'file' | 'folder' | 'vscode';
/** How it is opened: by the OS's own association, or by a program of the user's choosing. */
export type LaunchOpenMode = 'default' | 'program';
export type LaunchPickKind = 'file' | 'folder' | 'program';

export const LAUNCH_TYPES: readonly LaunchType[] = ['url', 'app', 'file', 'folder', 'vscode'];
export const LAUNCH_OPEN_MODES: readonly LaunchOpenMode[] = ['default', 'program'];

/** What a VS Code project runs when it opens, unless the entry says otherwise. */
export const DEFAULT_VSCODE_COMMAND = 'npm run dev';
export const MAX_LAUNCH_COMMAND = 512;

/** One thing the request gather ping opens. Names follow the JSON the settings window writes. */
export interface LaunchItem {
  id: string;
  name: string;
  type: LaunchType;
  /** A URL for 'url', an absolute local path otherwise. */
  target: string;
  openMode: LaunchOpenMode;
  /** Only for openMode 'program': the program that opens the target. */
  program: string;
  /** Only for openMode 'program': arguments, `{path}` standing for the target. */
  args: string[];
  /**
   * Only for openMode 'program': the directory the program runs in. Empty means the target itself when it is a folder,
   * and lolPing's own directory otherwise — which is why a command like `npm run dev` needs it.
   */
  cwd: string;
  /** Only for type 'vscode': the command its workspace task runs when the project opens. */
  command: string;
  enabled: boolean;
  checked: boolean;
  order: number;
}

/** One workspace: a named list. The request gather ping opens the active one. */
export interface LaunchPlan {
  id: string;
  /** Empty means untitled: the settings window names it "Plan N" in the language in force. */
  name: string;
  items: LaunchItem[];
}

export interface LaunchConfig {
  version: typeof LAUNCH_CONFIG_VERSION;
  /** The plan the ping opens; always one that is in `plans`. */
  activePlanId: string;
  plans: LaunchPlan[];
}

/** Version 2 added plans; a version 1 file holds one list and is read as a single plan. */
export const LAUNCH_CONFIG_VERSION = 2;
/** A workspace of more than this is a mistake, not a request: the rest is ignored. */
export const MAX_LAUNCH_ITEMS = 20;
/** More plans than this is a mistake too. */
export const MAX_LAUNCH_PLANS = 10;
export const MAX_PLAN_NAME = 40;
export const MAX_LAUNCH_NAME = 40;
export const MAX_LAUNCH_TARGET = 2048;
export const MAX_LAUNCH_ARGS = 20;
export const MAX_LAUNCH_ARG = 512;

/** The ping that starts the workspace: League's "Assist Me", the come-here ping. */
export const LAUNCH_PING: PingId = 'assist';

/** The name list a toast can carry before it stops being readable. */
export const LAUNCH_NAMES_MAX = 160;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmptyString = (v: unknown, max: number): string | null =>
  (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null);

export const isWebUrl = (v: string): boolean => /^https?:\/\/\S+$/i.test(v.trim());

/**
 * A name for the target, for the box the form leaves empty: a URL's host, or a path's file name without its extension.
 * It is only a suggestion — whatever the user typed wins.
 */
export function suggestName(target: string, type: LaunchType): string {
  const t = target.trim();
  if (t === '') return '';
  if (type === 'url') {
    try {
      return new URL(t).hostname.replace(/^www\./i, '');
    } catch {
      return t;
    }
  }
  const parts = t.split(/[\\/]+/).filter((part) => part !== '' && part !== '.');
  const last = parts.at(-1) ?? '';
  return type === 'file' ? last.replace(/\.[^.\\/]+$/, '') : last;
}

/** The arguments a program is started with: `{path}` becomes the target, and an empty list means the target itself. */
export function fillArgs(item: Pick<LaunchItem, 'openMode' | 'args' | 'target'>): string[] {
  const args = item.args.map((arg) => arg.split('{path}').join(item.target));
  return args.length > 0 ? args : [item.target];
}

/**
 * The directory a program runs in: the entry's own working directory, or the target itself while that is a folder, or
 * null to leave it to lolPing. A command such as `npm run dev` only works with one of the first two.
 */
export function resolvedCwd(item: Pick<LaunchItem, 'openMode' | 'cwd' | 'target' | 'type'>): string | null {
  if (item.openMode !== 'program') return null;
  if (item.cwd !== '') return item.cwd;
  return item.type === 'folder' ? item.target : null;
}

/** What the form sends before anything is saved, for the check. */
export interface LaunchDraft {
  type: LaunchType;
  target: string;
  openMode: LaunchOpenMode;
  program: string;
  cwd: string;
  command: string;
}

/** One stored entry, or null when it cannot be used. Fields are rebuilt, never trusted. */
function normalizeItem(raw: unknown, index: number): LaunchItem | null {
  if (!isObj(raw)) return null;
  const type = typeof raw.type === 'string' && (LAUNCH_TYPES as readonly string[]).includes(raw.type)
    ? (raw.type as LaunchType) : null;
  const target = nonEmptyString(raw.target, MAX_LAUNCH_TARGET);
  if (type === null || target === null) return null;
  // A URL goes to the browser and an app is started as itself: neither has an "open with" of its own.
  const openMode: LaunchOpenMode = raw.openMode === 'program' && (type === 'file' || type === 'folder')
    ? 'program' : 'default';
  const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : `item-${index + 1}`;
  const rawArgs = Array.isArray(raw.args) ? raw.args : [];
  // A VS Code project runs its command through the workspace task: it takes no arguments of its own.
  const args = type === 'vscode' ? [] : rawArgs
    .filter((a): a is string => typeof a === 'string' && a.length <= MAX_LAUNCH_ARG)
    .slice(0, MAX_LAUNCH_ARGS);
  const program = openMode === 'program' ? (nonEmptyString(raw.program, MAX_LAUNCH_TARGET) ?? '') : '';
  const cwd = openMode === 'program' ? (nonEmptyString(raw.cwd, MAX_LAUNCH_TARGET) ?? '') : '';
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? Math.trunc(raw.order) : index;
  // A VS Code project keeps its own VS Code executable in `program` (empty: found on this machine) and its command.
  const command = type === 'vscode'
    ? (typeof raw.command === 'string' ? raw.command.trim().slice(0, MAX_LAUNCH_COMMAND) : '')
    : '';
  const vsCode = type === 'vscode' ? (nonEmptyString(raw.program, MAX_LAUNCH_TARGET) ?? '') : '';
  const name = typeof raw.name === 'string' && raw.name.trim() !== ''
    ? sanitizeName(raw.name, suggestName(target, type), MAX_LAUNCH_NAME)
    : suggestName(target, type) || target.slice(0, MAX_LAUNCH_NAME).toUpperCase();
  return {
    id,
    name,
    type,
    target,
    openMode,
    program: type === 'vscode' ? vsCode : program,
    args,
    cwd,
    command,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    checked: typeof raw.checked === 'boolean' ? raw.checked : true,
    order,
  };
}

/** One plan's entries: rebuilt field by field, bad ones dropped, ids unique, `order` renumbered 0..n-1. */
function normalizeItems(raw: unknown): LaunchItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const items: LaunchItem[] = [];
  for (const [index, entry] of list.entries()) {
    const item = normalizeItem(entry, index);
    if (!item) continue;
    if (seen.has(item.id)) item.id = `${item.id}-${index + 1}`;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= MAX_LAUNCH_ITEMS) break;
  }
  items.sort((a, b) => a.order - b.order);
  return items.map((item, index) => ({ ...item, order: index }));
}

/** One stored plan, or null when it cannot be used. A plan without a usable id gets one from its place. */
function normalizePlan(raw: unknown, index: number): LaunchPlan | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : `plan-${index + 1}`;
  const name = typeof raw.name === 'string' && raw.name.trim() !== ''
    ? sanitizeName(raw.name, '', MAX_PLAN_NAME) : '';
  return { id, name, items: normalizeItems(raw.items) };
}

/**
 * Turns anything (a launch.json, an IPC payload) into a config that can be used. Version 1 held one list and is read
 * as a single untitled plan, so a file written before plans existed keeps working. The active plan is always one of
 * the plans returned, and there is always at least one plan to edit.
 */
export function normalizeLaunchConfig(raw: unknown): LaunchConfig {
  const source = isObj(raw) && isObj(raw.requestGather) ? raw.requestGather : raw;
  const stored = isObj(source) ? source : {};
  const plans: LaunchPlan[] = [];
  const seen = new Set<string>();
  const push = (plan: LaunchPlan | null): void => {
    if (!plan || plans.length >= MAX_LAUNCH_PLANS) return;
    if (seen.has(plan.id)) plan.id = `${plan.id}-${plans.length + 1}`;
    if (seen.has(plan.id)) return;
    seen.add(plan.id);
    plans.push(plan);
  };
  if (Array.isArray(stored.plans)) {
    for (const [index, plan] of stored.plans.entries()) push(normalizePlan(plan, index));
  } else if (Array.isArray(stored.items)) {
    // Version 1: the whole list was the workspace, so it becomes the one plan there is.
    push({ id: 'default', name: '', items: normalizeItems(stored.items) });
  }
  if (plans.length === 0) plans.push({ id: 'default', name: '', items: [] });
  const active = typeof stored.activePlanId === 'string' && plans.some((plan) => plan.id === stored.activePlanId)
    ? stored.activePlanId : plans[0].id;
  return { version: LAUNCH_CONFIG_VERSION, activePlanId: active, plans };
}

/** The plan the request gather ping opens. */
export function activePlan(config: LaunchConfig): LaunchPlan {
  return config.plans.find((plan) => plan.id === config.activePlanId) ?? config.plans[0];
}

/** The entries one plan opens: checked, enabled, in order. */
export function launchableItems(plan: LaunchPlan): LaunchItem[] {
  return plan.items.filter((item) => item.checked && item.enabled).sort((a, b) => a.order - b.order);
}

/** `-` when the list is too long for one toast line. */
export function namesForToast(items: readonly LaunchItem[], max = LAUNCH_NAMES_MAX): string {
  const joined = items.map((item) => item.name).join(', ');
  const chars = [...joined];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : joined;
}

/** Why one entry did not open. */
export type LaunchFailure = 'badUrl' | 'missingTarget' | 'missingProgram' | 'noVsCode' | 'failed';

export interface LaunchProblem {
  /** Which field of the form is at fault. */
  field: 'target' | 'program' | 'cwd' | 'command';
  reason: 'empty' | 'badUrl' | 'missing';
}

/** The reason as the user reads it, in the language the app is in. */
export function launchFailureText(t: Strings, reason: LaunchFailure): string {
  switch (reason) {
    case 'badUrl': return t.launchFailBadUrl;
    case 'missingTarget': return t.launchFailMissingTarget;
    case 'missingProgram': return t.launchFailMissingProgram;
    case 'noVsCode': return t.launchFailNoVsCode;
    default: return t.launchFailFailed;
  }
}

/** A form problem as the user reads it. */
export function launchProblemText(t: Strings, problem: LaunchProblem): string {
  if (problem.field === 'cwd') return t.launchErrCwdMissing;
  if (problem.field === 'command') return t.launchErrCommandEmpty;
  if (problem.field === 'program') {
    return problem.reason === 'empty' ? t.launchErrProgramEmpty : t.launchErrProgramMissing;
  }
  if (problem.reason === 'badUrl') return t.launchErrBadUrl;
  return problem.reason === 'empty' ? t.launchErrTargetEmpty : t.launchErrTargetMissing;
}
