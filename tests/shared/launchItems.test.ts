import { describe, expect, it } from 'vitest';
import {
  LAUNCH_CONFIG_VERSION, MAX_LAUNCH_ITEMS, MAX_LAUNCH_PLANS, activePlan, fillArgs, isWebUrl, launchFailureText,
  launchProblemText, launchableItems, namesForToast, normalizeLaunchConfig, suggestName,
  type LaunchItem, type LaunchPlan,
} from '../../src/shared/launchItems';
import { strings } from '../../src/shared/i18n';

const item = (over: Partial<LaunchItem> = {}): LaunchItem => ({
  id: 'a', name: 'A', type: 'app', target: 'C:\\Code.exe', openMode: 'default', program: '', args: [],
  enabled: true, checked: true, order: 0, ...over,
});

const plan = (items: LaunchItem[], over: Partial<LaunchPlan> = {}): LaunchPlan => ({ id: 'p1', name: '', items, ...over });

describe('launchItems', () => {
  it('reads the stored shape, with requestGather and its plans', () => {
    const parsed = normalizeLaunchConfig({
      requestGather: {
        version: 2,
        activePlanId: 'work',
        plans: [
          { id: 'work', name: 'Writing code', items: [{ id: 'vscode', name: 'VS Code', type: 'app', target: 'C:\\Code.exe' }] },
          { id: 'ai', name: 'Only AI', items: [] },
        ],
      },
    });
    expect(parsed.version).toBe(LAUNCH_CONFIG_VERSION);
    expect(parsed.activePlanId).toBe('work');
    expect(parsed.plans.map((p) => [p.id, p.name])).toEqual([['work', 'Writing code'], ['ai', 'Only AI']]);
    expect(parsed.plans[0].items[0]).toMatchObject({ id: 'vscode', name: 'VS Code', enabled: true, checked: true, order: 0 });
  });

  it('reads a version 1 file as one plan, so a list written before plans keeps working', () => {
    const parsed = normalizeLaunchConfig({
      requestGather: { version: 1, items: [{ id: 'vscode', type: 'app', target: 'C:\\Code.exe' }] },
    });
    expect(parsed.activePlanId).toBe('default');
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.plans[0].items[0].id).toBe('vscode');
  });

  it('always leaves one plan to edit, and points the active one at a plan that exists', () => {
    expect(normalizeLaunchConfig(undefined).plans).toHaveLength(1);
    const parsed = normalizeLaunchConfig({ plans: [{ id: 'a', name: '', items: [] }], activePlanId: 'gone' });
    expect(parsed.activePlanId).toBe('a');
    expect(activePlan({ ...parsed, activePlanId: 'gone' }).id).toBe('a');
  });

  it('keeps plan ids unique and caps how many there are', () => {
    const many = Array.from({ length: MAX_LAUNCH_PLANS + 5 }, () => ({ id: 'same', name: '', items: [] }));
    const parsed = normalizeLaunchConfig({ plans: many });
    expect(parsed.plans).toHaveLength(MAX_LAUNCH_PLANS);
    expect(new Set(parsed.plans.map((p) => p.id)).size).toBe(MAX_LAUNCH_PLANS);
  });

  it('drops entries it cannot use and builds the rest field by field', () => {
    const parsed = normalizeLaunchConfig({
      plans: [{ items: [
        null,
        { type: 'app' }, // no target
        { type: 'mystery', target: 'C:\\x' }, // unknown type
        { type: 'url', target: '   ' }, // empty target
        { type: 'url', target: ' https://chat.deepseek.com ' },
      ] }],
    });
    const items = parsed.plans[0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ target: 'https://chat.deepseek.com', name: 'chat.deepseek.com' });
  });

  it('numbers the entries 0..n-1 in the order they will be started', () => {
    const parsed = normalizeLaunchConfig({
      plans: [{ items: [
        { id: 'b', type: 'app', target: 'C:\\b.exe', order: 5 },
        { id: 'a', type: 'app', target: 'C:\\a.exe', order: 1 },
      ] }],
    });
    expect(parsed.plans[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(parsed.plans[0].items.map((i) => i.order)).toEqual([0, 1]);
  });

  it('keeps entry ids unique inside a plan and caps the list', () => {
    const many = Array.from({ length: MAX_LAUNCH_ITEMS + 5 }, (_, i) => ({ id: 'same', type: 'app', target: `C:\\${i}.exe` }));
    const parsed = normalizeLaunchConfig({ plans: [{ items: many }] });
    expect(parsed.plans[0].items).toHaveLength(MAX_LAUNCH_ITEMS);
    expect(new Set(parsed.plans[0].items.map((i) => i.id)).size).toBe(MAX_LAUNCH_ITEMS);
  });

  it('gives a URL and an app no "open with" of their own', () => {
    const parsed = normalizeLaunchConfig({
      plans: [{ items: [
        { type: 'url', target: 'https://x.dev', openMode: 'program', program: 'C:\\a.exe' },
        { type: 'app', target: 'C:\\a.exe', openMode: 'program', program: 'C:\\b.exe' },
        { type: 'folder', target: 'D:\\code', openMode: 'program', program: 'C:\\Code.exe', args: ['{path}'] },
      ] }],
    });
    const [url, app, folder] = parsed.plans[0].items;
    expect(url).toMatchObject({ openMode: 'default', program: '' });
    expect(app).toMatchObject({ openMode: 'default', program: '' });
    expect(folder).toMatchObject({ openMode: 'program', program: 'C:\\Code.exe' });
  });

  it('opens only what is both ticked and enabled, in order', () => {
    const items = launchableItems(plan([
      item({ id: 'b', order: 1 }),
      item({ id: 'a', order: 0 }),
      item({ id: 'off', order: 2, enabled: false }),
      item({ id: 'unticked', order: 3, checked: false }),
    ]));
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('keeps each plan to its own list', () => {
    const parsed = normalizeLaunchConfig({
      activePlanId: 'ai',
      plans: [
        { id: 'code', items: [{ id: 'vscode', type: 'app', target: 'C:\\Code.exe' }] },
        { id: 'ai', items: [{ id: 'deepseek', type: 'url', target: 'https://chat.deepseek.com', checked: false }] },
      ],
    });
    expect(launchableItems(activePlan(parsed))).toEqual([]); // the AI plan's only entry is unticked
    expect(launchableItems(parsed.plans[0]).map((i) => i.id)).toEqual(['vscode']);
  });

  it('suggests a name from the target', () => {
    expect(suggestName('https://chat.deepseek.com/', 'url')).toBe('chat.deepseek.com');
    expect(suggestName('D:\\code\\my-project', 'folder')).toBe('my-project');
    expect(suggestName('D:\\notes\\day1.md', 'file')).toBe('day1');
    expect(suggestName('C:\\Program Files\\Microsoft VS Code\\Code.exe', 'app')).toBe('Code.exe');
    expect(suggestName('', 'url')).toBe('');
  });

  it('fills {path} and falls back to the target itself', () => {
    expect(fillArgs({ openMode: 'program', args: ['-n', '{path}'], target: 'D:\\p' })).toEqual(['-n', 'D:\\p']);
    expect(fillArgs({ openMode: 'program', args: ['{path}/{path}'], target: 'D:\\p' })).toEqual(['D:\\p/D:\\p']);
    expect(fillArgs({ openMode: 'program', args: [], target: 'D:\\p' })).toEqual(['D:\\p']);
  });

  it('accepts only http and https links', () => {
    expect(isWebUrl('https://chat.deepseek.com')).toBe(true);
    expect(isWebUrl('HTTP://x.dev')).toBe(true);
    expect(isWebUrl('file:///C:/x')).toBe(false);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('chat.deepseek.com')).toBe(false);
  });

  it('shortens the name list for a toast', () => {
    const items = [item({ id: '1', name: 'VS Code' }), item({ id: '2', name: 'IDEA' })];
    expect(namesForToast(items)).toBe('VS Code, IDEA');
    const long = [item({ id: '1', name: 'x'.repeat(200) })];
    expect([...namesForToast(long)]).toHaveLength(160);
  });

  it('words failures and form problems in both languages', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      const t = strings(lang);
      for (const reason of ['badUrl', 'missingTarget', 'missingProgram', 'failed'] as const) {
        expect(launchFailureText(t, reason)).not.toBe('');
      }
      expect(launchProblemText(t, { field: 'target', reason: 'badUrl' })).toBe(t.launchErrBadUrl);
      expect(launchProblemText(t, { field: 'program', reason: 'missing' })).toBe(t.launchErrProgramMissing);
    }
  });
});
