import { spawn } from 'node:child_process';
import { shell } from 'electron';
import type { LauncherDeps } from './launcher';
import { pathExists } from './launchCheck';

/** The real system: the OS's own associations for files and folders, detached processes for programs and apps. */
export const systemLauncher: LauncherDeps = {
  exists: pathExists,
  openPath: (path) => shell.openPath(path),
  openUrl: (url) => shell.openExternal(url),
  spawn: (program, args) => new Promise<void>((resolve, reject) => {
    try {
      // No shell, no command line: the program and each argument travel as separate values, so spaces and quotes in a
      // path are never re-read as syntax.
      const child = spawn(program, args, { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }),
};
