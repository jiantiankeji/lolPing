import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { shell } from 'electron';
import type { LauncherDeps } from './launcher';
import { pathExists } from './launchCheck';
import { writeWorkspaceFile } from './vsCodeWorkspace';

/** Where VS Code puts itself on Windows: a user install first, then the machine-wide ones. */
function vsCodeCandidates(): string[] {
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  return [
    ...(local === undefined ? [] : [join(local, 'Programs', 'Microsoft VS Code', 'Code.exe')]),
    ...(programFiles === undefined ? [] : [join(programFiles, 'Microsoft VS Code', 'Code.exe')]),
    ...(programFilesX86 === undefined ? [] : [join(programFilesX86, 'Microsoft VS Code', 'Code.exe')]),
  ];
}

/** The real system: the OS's own associations for files and folders, detached processes for programs and apps. */
export function makeSystemLauncher(workspaceDir: string): LauncherDeps {
  return {
    exists: pathExists,
    openPath: (path) => shell.openPath(path),
    openUrl: (url) => shell.openExternal(url),
    findVsCode: () => vsCodeCandidates().find((path) => pathExists(path)) ?? null,
    writeWorkspace: (project, command) => writeWorkspaceFile(workspaceDir, project, command),
    spawn: (program, args, cwd) => new Promise<void>((resolve, reject) => {
      try {
        // No shell, no command line: the program and each argument travel as separate values, so spaces and quotes in a
        // path are never re-read as syntax. `detached` gives a console program (cmd.exe, npm) a window of its own, which
        // is how a dev server's output becomes visible; `cwd` is what lets it find the project.
        const child = spawn(program, args, {
          detached: true, stdio: 'ignore', windowsHide: false, ...(cwd === null ? {} : { cwd }),
        });
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
}
