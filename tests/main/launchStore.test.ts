import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LaunchStore } from '../../src/main/launchStore';

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'lolping-launch-'));

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('LaunchStore', () => {
  it('starts with one empty plan when there is no file', () => {
    const dir = tempDir();
    const store = new LaunchStore(dir);
    expect(store.load()).toEqual({
      version: 2,
      activePlanId: 'default',
      plans: [{ id: 'default', name: '', items: [] }],
    });
    expect(existsSync(join(dir, 'launch.json'))).toBe(false);
  });

  it('reads what it wrote, plans, ticks and the active plan alike', async () => {
    const dir = tempDir();
    const store = new LaunchStore(dir, 0);
    store.load();
    store.set({
      activePlanId: 'work',
      plans: [
        { id: 'work', name: 'Writing code', items: [
          { id: 'vscode', name: 'VS Code', type: 'app', target: 'C:\\Code.exe', enabled: true, checked: false, order: 0 },
        ] },
        { id: 'ai', name: 'Only AI', items: [
          { id: 'deepseek', name: 'DeepSeek', type: 'url', target: 'https://chat.deepseek.com', enabled: false, checked: true, order: 0 },
        ] },
      ],
    });
    await store.flush();

    const loaded = new LaunchStore(dir).load();
    expect(loaded.activePlanId).toBe('work');
    expect(loaded.plans.map((p) => [p.id, p.name])).toEqual([['work', 'Writing code'], ['ai', 'Only AI']]);
    expect(loaded.plans[0].items[0]).toMatchObject({ id: 'vscode', enabled: true, checked: false });
    expect(loaded.plans[1].items[0]).toMatchObject({ id: 'deepseek', enabled: false, checked: true });
  });

  it('writes the shape the app documents, with requestGather around the plans', async () => {
    const dir = tempDir();
    const store = new LaunchStore(dir, 0);
    store.load();
    store.set({ plans: [{ id: 'work', name: 'Work', items: [{ type: 'url', target: 'https://x.dev' }] }] });
    await store.flush();
    const saved: unknown = JSON.parse(readFileSync(join(dir, 'launch.json'), 'utf8'));
    expect(saved).toMatchObject({
      requestGather: { version: 2, activePlanId: 'work', plans: [{ id: 'work', name: 'Work', items: [{ type: 'url', target: 'https://x.dev' }] }] },
    });
  });

  it('reads a version 1 file as the one plan there is', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'launch.json'), JSON.stringify({
      requestGather: { version: 1, items: [{ id: 'vscode', type: 'app', target: 'C:\\Code.exe' }] },
    }));
    const loaded = new LaunchStore(dir).load();
    expect(loaded.plans).toHaveLength(1);
    expect(loaded.plans[0].items[0].id).toBe('vscode');
  });

  it('backs up a file it cannot read and carries on with one empty plan', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'launch.json'), '{ not json');
    const store = new LaunchStore(dir);
    expect(store.load().plans[0].items).toEqual([]);
    expect(existsSync(join(dir, 'launch.bak.json'))).toBe(true);
    expect(store.problems).toHaveLength(1);
  });

  it('debounces a burst of saves and keeps the last one', async () => {
    const dir = tempDir();
    const store = new LaunchStore(dir, 60);
    store.load();
    store.set({ plans: [{ id: 'one', items: [{ id: 'a', type: 'app', target: 'C:\\one.exe' }] }] });
    store.set({ plans: [{ id: 'two', items: [{ id: 'b', type: 'app', target: 'C:\\two.exe' }] }] });
    await wait(20);
    expect(existsSync(join(dir, 'launch.json'))).toBe(false);
    await wait(150);
    const saved: unknown = JSON.parse(readFileSync(join(dir, 'launch.json'), 'utf8'));
    expect(saved).toMatchObject({ requestGather: { plans: [{ id: 'two', items: [{ id: 'b' }] }] } });
  });
});
