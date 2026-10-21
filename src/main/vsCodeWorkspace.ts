import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A VS Code workspace file that opens `project` and runs `command` in its integrated terminal as soon as the workspace
 * opens. VS Code has no command line switch for "open and run", so this task is the only way to start a project
 * automatically. VS Code asks once whether to trust the workspace's author; until it is trusted, the task does not run.
 */
export function workspaceContent(project: string, command: string): string {
  const workspace = {
    folders: [{ path: project }],
    settings: { 'task.saveBeforeRun': 'never' },
    tasks: {
      version: '2.0.0',
      tasks: [
        {
          label: 'lolPing: run the project',
          type: 'shell',
          command,
          options: { cwd: '${workspaceFolder}' },
          runOptions: { runOn: 'folderOpen' },
          // The terminal is revealed but keeps the focus, so typing in the editor is not interrupted.
          presentation: { reveal: 'always', panel: 'dedicated', focus: false, clear: false },
          problemMatcher: [],
        },
      ],
    },
  };
  return `${JSON.stringify(workspace, null, 2)}\n`;
}

/** A stable file name for a project and command, so repeated pings reuse one workspace file. */
export function workspaceFileName(project: string, command: string): string {
  const digest = createHash('sha1').update(`${project}\n${command}`).digest('hex').slice(0, 16);
  return `project-${digest}.code-workspace`;
}

/**
 * Writes that file under `dir` and returns its path. It is only rewritten when its content changed, so VS Code is not
 * sent a new file (and asked to reload) on every ping.
 */
export function writeWorkspaceFile(dir: string, project: string, command: string): string {
  const file = join(dir, workspaceFileName(project, command));
  const content = workspaceContent(project, command);
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return file;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, content, 'utf8');
  return file;
}
