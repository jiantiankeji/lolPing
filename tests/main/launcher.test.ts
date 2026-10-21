import { describe, expect, it, vi } from 'vitest';
import { runLaunchItems, type LauncherDeps } from '../../src/main/launcher';
import type { LaunchItem } from '../../src/shared/launchItems';

const item = (over: Partial<LaunchItem> = {}): LaunchItem => ({
  id: 'a', name: 'A', type: 'app', target: 'C:\\Code.exe', openMode: 'default', program: '', args: [],
  enabled: true, checked: true, order: 0, ...over,
});

interface Harness {
  deps: LauncherDeps;
  opened: string[];
  spawned: Array<{ program: string; args: string[] }>;
  paths: string[];
  urls: string[];
  /** Paths that do not exist, by exact string. */
  missing: Set<string>;
  /** `shell.openPath` messages, by path. */
  refuses: Map<string, string>;
  /** Programs that fail to start. */
  noStart: Set<string>;
}

function harness(): Harness {
  const h: Harness = {
    opened: [], spawned: [], paths: [], urls: [], missing: new Set(), refuses: new Map(), noStart: new Set(),
    deps: {
      exists: (path) => !h.missing.has(path),
      openPath: async (path) => {
        h.paths.push(path);
        return h.refuses.get(path) ?? '';
      },
      openUrl: async (url) => {
        h.urls.push(url);
      },
      spawn: async (program, args) => {
        if (h.noStart.has(program)) throw new Error('ENOENT');
        h.spawned.push({ program, args });
      },
    },
  };
  return h;
}

describe('runLaunchItems', () => {
  it('opens a URL in the browser and a program as itself', async () => {
    const h = harness();
    const report = await runLaunchItems([
      item({ id: 'u', name: 'DeepSeek', type: 'url', target: 'https://chat.deepseek.com' }),
      item({ id: 'a', name: 'VS Code', type: 'app', target: 'C:\\Code.exe' }),
    ], h.deps);
    expect(h.urls).toEqual(['https://chat.deepseek.com']);
    expect(h.spawned).toEqual([{ program: 'C:\\Code.exe', args: [] }]);
    expect(report.opened.map((i) => i.id)).toEqual(['u', 'a']);
    expect(report.failed).toEqual([]);
  });

  it('hands a file or folder to the OS when the open mode is the system default', async () => {
    const h = harness();
    await runLaunchItems([
      item({ id: 'f', type: 'file', target: 'D:\\notes\\day1.md' }),
      item({ id: 'd', type: 'folder', target: 'D:\\code\\p' }),
    ], h.deps);
    expect(h.paths).toEqual(['D:\\notes\\day1.md', 'D:\\code\\p']);
    expect(h.spawned).toEqual([]);
  });

  it('starts the chosen program with the target as its argument', async () => {
    const h = harness();
    await runLaunchItems([
      item({ id: 'd', type: 'folder', target: 'D:\\code\\p', openMode: 'program', program: 'C:\\Code.exe', args: ['-n', '{path}'] }),
    ], h.deps);
    expect(h.spawned).toEqual([{ program: 'C:\\Code.exe', args: ['-n', 'D:\\code\\p'] }]);
    expect(h.paths).toEqual([]);
  });

  it('passes the target itself when no arguments were given', async () => {
    const h = harness();
    await runLaunchItems([
      item({ id: 'd', type: 'folder', target: 'D:\\code\\p', openMode: 'program', program: 'C:\\idea64.exe' }),
    ], h.deps);
    expect(h.spawned[0].args).toEqual(['D:\\code\\p']);
  });

  it('keeps going after a failure, and names each one', async () => {
    const h = harness();
    h.missing.add('D:\\gone');
    h.missing.add('C:\\missing.exe');
    h.refuses.set('D:\\locked', 'access denied');
    h.noStart.add('C:\\broken.exe');
    const report = await runLaunchItems([
      item({ id: 'bad-url', name: 'Bad URL', type: 'url', target: 'file:///C:/x' }),
      item({ id: 'gone', name: 'Gone', type: 'file', target: 'D:\\gone' }),
      item({ id: 'locked', name: 'Locked', type: 'file', target: 'D:\\locked' }),
      item({ id: 'broken', name: 'Broken', type: 'app', target: 'C:\\broken.exe' }),
      item({ id: 'no-program', name: 'No program', type: 'folder', target: 'D:\\code', openMode: 'program', program: 'C:\\missing.exe' }),
      item({ id: 'ok', name: 'Fine', type: 'folder', target: 'D:\\code' }),
    ], h.deps);
    expect(report.opened.map((i) => i.id)).toEqual(['ok']);
    expect(report.failed.map((f) => [f.item.id, f.failure])).toEqual([
      ['bad-url', 'badUrl'],
      ['gone', 'missingTarget'],
      ['locked', 'failed'],
      ['broken', 'failed'],
      ['no-program', 'missingProgram'],
    ]);
  });

  it('never runs a program that is not there, and never asks a shell to interpret anything', async () => {
    const h = harness();
    h.missing.add('C:\\Code.exe');
    const report = await runLaunchItems([
      item({ id: 'd', type: 'folder', target: 'D:\\code\\with space & quote\'s', openMode: 'program', program: 'C:\\Code.exe' }),
    ], h.deps);
    expect(report.failed[0].failure).toBe('missingProgram');
    expect(h.spawned).toEqual([]);
  });

  it('does nothing at all for an empty list', async () => {
    const h = harness();
    const report = await runLaunchItems([], h.deps);
    expect(report).toEqual({ opened: [], failed: [] });
    expect(h.paths).toEqual([]);
    expect(h.spawned).toEqual([]);
  });

  it('opens the entries one after another, in the order given', async () => {
    const order: string[] = [];
    const deps: LauncherDeps = {
      exists: () => true,
      openPath: async (path) => { order.push(path); return ''; },
      openUrl: async () => undefined,
      spawn: async () => undefined,
    };
    await runLaunchItems([item({ id: '1', type: 'file', target: '1' }), item({ id: '2', type: 'file', target: '2' })], deps);
    expect(order).toEqual(['1', '2']);
  });

  it('treats a thrown openUrl as a failure, not as an error out of the whole run', async () => {
    const deps: LauncherDeps = {
      exists: () => true,
      openPath: async () => '',
      openUrl: vi.fn(async () => { throw new Error('no browser'); }),
      spawn: async () => undefined,
    };
    const report = await runLaunchItems([item({ type: 'url', target: 'https://x.dev' })], deps);
    expect(report.failed[0].failure).toBe('failed');
  });
});
