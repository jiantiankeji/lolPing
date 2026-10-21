import { fillArgs, isWebUrl, type LaunchFailure, type LaunchItem } from '../shared/launchItems';

/** One entry that did not open, with the reason the toast words. */
export interface LaunchFailed {
  item: LaunchItem;
  failure: LaunchFailure;
}

export interface LaunchReport {
  opened: LaunchItem[];
  failed: LaunchFailed[];
}

export interface LauncherDeps {
  /** Whether a file, folder or program is there right now. */
  exists(path: string): boolean;
  /** `shell.openPath`: resolves to '' on success, otherwise the OS's own message. */
  openPath(path: string): Promise<string>;
  /** `shell.openExternal`: rejects when the OS refuses the link. */
  openUrl(url: string): Promise<void>;
  /** Starts a program detached and resolves once it is running, rejecting when it cannot start. */
  spawn(program: string, args: string[]): Promise<void>;
}

/**
 * Opens the entries in order. A failure never stops the rest: every one is reported back so the caller can name it.
 * No shell is involved anywhere — a program is always started from a program and an argument list.
 */
export async function runLaunchItems(
  items: readonly LaunchItem[],
  deps: LauncherDeps,
): Promise<LaunchReport> {
  const opened: LaunchItem[] = [];
  const failed: LaunchFailed[] = [];
  for (const item of items) {
    const failure = await openOne(item, deps);
    if (failure === null) opened.push(item);
    else failed.push({ item, failure });
  }
  return { opened, failed };
}

/** The reason one entry did not open, or null when it did. */
async function openOne(item: LaunchItem, deps: LauncherDeps): Promise<LaunchFailure | null> {
  if (item.type === 'url') {
    if (!isWebUrl(item.target)) return 'badUrl';
    try {
      await deps.openUrl(item.target);
      return null;
    } catch {
      return 'failed';
    }
  }
  if (!deps.exists(item.target)) return 'missingTarget';
  // A program is startable on its own: there is no association to ask the OS for.
  if (item.type === 'app') {
    try {
      await deps.spawn(item.target, []);
      return null;
    } catch {
      return 'failed';
    }
  }
  if (item.openMode === 'program') {
    if (item.program === '' || !deps.exists(item.program)) return 'missingProgram';
    try {
      await deps.spawn(item.program, fillArgs(item));
      return null;
    } catch {
      return 'failed';
    }
  }
  try {
    const said = await deps.openPath(item.target);
    return said === '' ? null : 'failed';
  } catch {
    return 'failed';
  }
}
