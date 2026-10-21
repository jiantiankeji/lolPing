import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workspaceContent, workspaceFileName, writeWorkspaceFile } from '../../src/main/vsCodeWorkspace';

interface Workspace {
  folders: Array<{ path: string }>;
  tasks: { tasks: Array<{ command: string; options: { cwd: string }; runOptions: { runOn: string } }> };
}

const read = (file: string): Workspace => JSON.parse(readFileSync(file, 'utf8')) as Workspace;

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'lolping-workspace-'));

describe('vsCodeWorkspace', () => {
  it('opens the project as a workspace whose one task runs the command when the folder opens', () => {
    const workspace = JSON.parse(workspaceContent('D:\\code\\p', 'npm run dev')) as Workspace;
    expect(workspace.folders).toEqual([{ path: 'D:\\code\\p' }]);
    expect(workspace.tasks.tasks).toHaveLength(1);
    const task = workspace.tasks.tasks[0];
    expect(task.command).toBe('npm run dev');
    expect(task.options).toEqual({ cwd: '${workspaceFolder}' }); // the project, not lolPing's own folder
    expect(task.runOptions).toEqual({ runOn: 'folderOpen' }); // this is what makes it start by itself
  });

  it('names the file after the project and the command, so the same entry reuses one workspace', () => {
    const name = workspaceFileName('D:\\code\\p', 'npm run dev');
    expect(name).toMatch(/^project-[0-9a-f]{16}\.code-workspace$/);
    expect(workspaceFileName('D:\\code\\p', 'npm run dev')).toBe(name);
    expect(workspaceFileName('D:\\code\\p', 'npm test')).not.toBe(name);
    expect(workspaceFileName('D:\\code\\other', 'npm run dev')).not.toBe(name);
  });

  it('writes the file, and leaves it untouched when nothing about it changed', () => {
    const dir = tempDir();
    try {
      const file = writeWorkspaceFile(dir, 'D:\\code\\p', 'npm run dev');
      expect(existsSync(file)).toBe(true);
      expect(read(file).tasks.tasks[0].command).toBe('npm run dev');
      const past = new Date('2020-01-01T00:00:00Z');
      utimesSync(file, past, past);
      expect(writeWorkspaceFile(dir, 'D:\\code\\p', 'npm run dev')).toBe(file);
      expect(statSync(file).mtimeMs).toBe(past.getTime()); // not rewritten: VS Code is not asked to reload
      writeFileSync(file, '{}\n');
      writeWorkspaceFile(dir, 'D:\\code\\p', 'npm run dev');
      expect(read(file).tasks.tasks[0].command).toBe('npm run dev'); // a changed file is put back
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
