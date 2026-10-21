import { describe, expect, it } from 'vitest';
import {
  AiPing, AI_ANSWER_OWNER, AI_MIN_GAP_MS, AI_THINKING_OWNER, type AiPingDeps,
} from '../../src/main/aiPing';
import type { VisionResult } from '../../src/main/deepseekVision';
import { askPrompt } from '../../src/shared/aiAsk';
import { strings, type Lang } from '../../src/shared/i18n';

const SHOT = new Uint8Array([1, 2, 3]);
const SPOT = { displayId: 2, x: 100, y: 200 };

function harness(over: Partial<AiPingDeps> = {}): {
  ai: AiPing;
  deps: AiPingDeps;
  shown: Array<{ displayId: number; x: number; y: number; text: string; owner: string; sticky?: boolean }>;
  toasts: Array<{ title: string; body: string }>;
  captures: number[];
  asked: Array<{ key: string; prompt: string; jpeg: Uint8Array; deep: boolean }>;
  cleared: string[];
  released: () => number;
  setNow(ms: number): void;
} {
  const shown: Array<{ displayId: number; x: number; y: number; text: string; owner: string; sticky?: boolean }> = [];
  const toasts: Array<{ title: string; body: string }> = [];
  const captures: number[] = [];
  const asked: Array<{ key: string; prompt: string; jpeg: Uint8Array; deep: boolean }> = [];
  const cleared: string[] = [];
  let released = 0;
  let nowMs = 1_000_000;
  const deps: AiPingDeps = {
    settings: () => ({ aiAsk: true, deepseekKey: 'sk-test', deepPrompt: '' }),
    lang: (): Lang => 'en',
    text: () => strings('en'),
    capture: async (displayId) => {
      captures.push(displayId);
      return SHOT;
    },
    vision: async (input) => {
      asked.push(input);
      return { ok: true, text: 'Wait for the wave.' };
    },
    show: (p) => shown.push(p),
    clearText: (owner) => cleared.push(owner),
    releasePing: () => {
      released++;
    },
    toast: (title, body) => toasts.push({ title, body }),
    now: () => nowMs,
    ...over,
  };
  return {
    ai: new AiPing(deps), deps, shown, toasts, captures, asked, cleared,
    released: () => released,
    setNow: (ms) => { nowMs = ms; },
  };
}

describe('AiPing', () => {
  it('does nothing at all while the AI setting is off', async () => {
    const h = harness({ settings: () => ({ aiAsk: false, deepseekKey: 'sk-test', deepPrompt: '' }) });
    await h.ai.ping(SPOT);
    expect(h.captures).toHaveLength(0);
    expect(h.asked).toHaveLength(0);
    expect(h.shown).toHaveLength(0);
    expect(h.toasts).toHaveLength(0);
  });

  it('sends nothing without a key, and says where the key goes', async () => {
    const h = harness({ settings: () => ({ aiAsk: true, deepseekKey: '', deepPrompt: '' }) });
    await h.ai.ping(SPOT);
    expect(h.captures).toHaveLength(0);
    expect(h.toasts).toEqual([{ title: strings('en').aiNoKey, body: strings('en').aiNoKeyBody }]);
  });

  it('gives that hint once, since the setting is on until someone turns it off', async () => {
    const h = harness({ settings: () => ({ aiAsk: true, deepseekKey: '', deepPrompt: '' }) });
    await h.ai.ping(SPOT);
    await h.ai.ping(SPOT);
    await h.ai.ping(SPOT);
    expect(h.toasts).toHaveLength(1);
    expect(h.captures).toHaveLength(0);
  });

  it('sends one screenshot of the display the ping went to, and shows the answer there', async () => {
    const h = harness();
    await h.ai.ping(SPOT);
    expect(h.captures).toEqual([2]);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toMatchObject({ key: 'sk-test', prompt: askPrompt('en'), jpeg: SHOT });
    expect(h.shown).toEqual([{ ...SPOT, text: 'Wait for the wave.', owner: AI_ANSWER_OWNER }]);
    expect(h.toasts).toHaveLength(0);
  });

  it('asks for the quick answer unless it was told to think', async () => {
    const h = harness();
    await h.ai.ping(SPOT);
    expect(h.asked[0].deep).toBe(false);
    // A quick answer keeps nothing on screen, so there is no held ping to let go.
    expect(h.released()).toBe(0);
  });

  it('thinks it through when asked, saying so a line above where the answer will land', async () => {
    const h = harness();
    await h.ai.ping(SPOT, true);
    expect(h.asked[0].deep).toBe(true);
    expect(h.shown).toEqual([
      {
        displayId: SPOT.displayId, x: SPOT.x, y: 160, text: strings('en').aiThinking,
        owner: AI_THINKING_OWNER, sticky: true,
      },
      { ...SPOT, text: 'Wait for the wave.', owner: AI_ANSWER_OWNER },
    ]);
  });

  it('keeps that line up for the whole ask and clears it when the answer takes its place', async () => {
    // The pending line is not timed: it lives exactly as long as the thinking does.
    const h = harness();
    await h.ai.ping(SPOT, true);
    expect(h.shown.map((p) => p.owner)).toEqual([AI_THINKING_OWNER, AI_ANSWER_OWNER]);
    expect(h.cleared).toEqual([AI_THINKING_OWNER]);
    // The held ping is let go at the same moment: the icon stays for exactly as long as the thinking.
    expect(h.released()).toBe(1);
  });

  it('clears the pending line when the ask fails too', async () => {
    const h = harness({ vision: async () => ({ ok: false, kind: 'auth' }) });
    await h.ai.ping(SPOT, true);
    expect(h.cleared).toEqual([AI_THINKING_OWNER]);
    expect(h.shown.map((p) => p.owner)).toEqual([AI_THINKING_OWNER]);
    expect(h.toasts).toHaveLength(1);
    expect(h.released()).toBe(1);
  });

  it('asks the question typed in the box on a deep ask, and the built-in one when it was sent empty', async () => {
    const written = harness();
    await written.ai.ping(SPOT, true, 'What is broken in this file?');
    expect(written.asked[0].prompt).toContain('What is broken in this file?');

    const empty = harness();
    await empty.ai.ping(SPOT, true, '');
    expect(empty.asked[0].prompt).toBe(askPrompt('en'));
  });

  it('leaves the quick question alone, whatever was typed for the deep one', async () => {
    const h = harness();
    await h.ai.ping(SPOT, false, 'What is broken in this file?');
    expect(h.asked[0].prompt).toBe(askPrompt('en'));
  });

  it('asks in the language the app is in', async () => {
    const h = harness({ lang: () => 'zh-CN', text: () => strings('zh-CN') });
    await h.ai.ping(SPOT);
    expect(h.asked[0].prompt).toBe(askPrompt('zh-CN'));
  });

  it('says so when the screen could not be captured', async () => {
    const h = harness({ capture: async () => null });
    await h.ai.ping(SPOT);
    expect(h.asked).toHaveLength(0);
    expect(h.toasts).toEqual([{ title: strings('en').aiFailCapture, body: strings('en').aiFailCaptureBody }]);
  });

  it('words every way DeepSeek can fail', async () => {
    const t = strings('en');
    const cases: Array<[VisionResult, string]> = [
      [{ ok: false, kind: 'auth' }, t.aiFailAuth],
      [{ ok: false, kind: 'rate' }, t.aiFailRate],
      [{ ok: false, kind: 'timeout' }, t.aiFailTimeout],
      [{ ok: false, kind: 'network' }, t.aiFailNetwork],
      [{ ok: false, kind: 'empty' }, t.aiFailEmpty],
      [{ ok: false, kind: 'shape' }, t.aiFailShape],
    ];
    for (const [result, title] of cases) {
      const h = harness({ vision: async () => result });
      await h.ai.ping(SPOT);
      expect(h.toasts[0].title, title).toBe(title);
      expect(h.shown).toHaveLength(0);
    }
  });

  it('flattens and cuts what the model answered', async () => {
    const h = harness({ vision: async () => ({ ok: true, text: '**Back** off,\nthey are coming.' }) });
    await h.ai.ping(SPOT);
    expect(h.shown[0].text).toBe('Back off, they are coming.');
  });

  it('ignores a second question while the first is still out', async () => {
    let release: (r: VisionResult) => void = () => undefined;
    const pending = harness({
      vision: () => new Promise<VisionResult>((resolve) => {
        release = resolve;
      }),
    });
    const first = pending.ai.ping(SPOT);
    await pending.ai.ping(SPOT);
    expect(pending.captures).toHaveLength(1);
    release({ ok: true, text: 'Go.' });
    await first;
    expect(pending.shown).toHaveLength(1);
  });

  it('keeps a gap between two questions, then answers again', async () => {
    const h = harness();
    await h.ai.ping(SPOT);
    h.setNow(h.deps.now() + AI_MIN_GAP_MS - 1);
    await h.ai.ping(SPOT);
    expect(h.captures).toHaveLength(1);
    h.setNow(h.deps.now() + 1);
    await h.ai.ping(SPOT);
    expect(h.captures).toHaveLength(2);
  });
});
