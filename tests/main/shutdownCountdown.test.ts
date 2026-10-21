import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHUTDOWN_SECONDS, ShutdownCountdown } from '../../src/main/shutdownCountdown';
import type { Lang } from '../../src/shared/i18n';
import type { CountdownState } from '../../src/shared/ipc';

interface Harness {
  cd: ShutdownCountdown;
  /** Every draw in order, so the order against the shutdown can be checked too. */
  order: string[];
  shown: Array<CountdownState | null>;
  shutdowns: () => number;
  setLang(lang: Lang): void;
  setHotkey(hotkey: string): void;
}

function harness(seconds?: number): Harness {
  const order: string[] = [];
  const shown: Array<CountdownState | null> = [];
  let shutdowns = 0;
  let lang: Lang = 'en';
  let hotkey = 'Ctrl+Alt+P';
  const cd = new ShutdownCountdown({
    now: () => Date.now(),
    lang: () => lang,
    hotkey: () => hotkey,
    show: (s) => {
      order.push(s ? `show:${s.secondsLeft}` : 'hide');
      shown.push(s);
    },
    shutdown: () => {
      order.push('shutdown');
      shutdowns++;
    },
  }, seconds);
  return {
    cd, order, shown,
    shutdowns: () => shutdowns,
    setLang: (l) => { lang = l; },
    setHotkey: (h) => { hotkey = h; },
  };
}

/** The seconds the card showed, in order. */
const numbers = (h: Harness): number[] => h.shown.flatMap((s) => (s ? [s.secondsLeft] : []));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ShutdownCountdown', () => {
  it('counts 5, 4, 3, 2, 1 and then shuts the machine down', () => {
    const h = harness();
    h.cd.start();
    expect(numbers(h)).toEqual([SHUTDOWN_SECONDS]);
    for (let s = 4; s >= 1; s--) {
      vi.advanceTimersByTime(1000);
      expect(numbers(h).at(-1)).toBe(s);
    }
    expect(h.shutdowns()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(h.shutdowns()).toBe(1);
  });

  it('takes the card away before the shutdown runs, so nothing counts at zero', () => {
    const h = harness();
    h.cd.start();
    vi.advanceTimersByTime(SHUTDOWN_SECONDS * 1000);
    expect(h.order.slice(-2)).toEqual(['hide', 'shutdown']);
  });

  it('does not count again once it has shut down', () => {
    const h = harness();
    h.cd.start();
    vi.advanceTimersByTime(SHUTDOWN_SECONDS * 1000 + 5000);
    expect(h.shutdowns()).toBe(1);
    expect(h.cd.running()).toBe(false);
  });

  it('is called off by a second retreat ping', () => {
    const h = harness();
    h.cd.start();
    vi.advanceTimersByTime(2000);
    h.cd.ping();
    expect(h.cd.running()).toBe(false);
    expect(h.shown.at(-1)).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(h.shutdowns()).toBe(0);
  });

  it('starts the countdown again on the next retreat ping', () => {
    const h = harness();
    h.cd.start();
    h.cd.ping(); // off
    h.cd.ping(); // on again
    expect(h.cd.running()).toBe(true);
    expect(numbers(h).at(-1)).toBe(SHUTDOWN_SECONDS);
    vi.advanceTimersByTime(SHUTDOWN_SECONDS * 1000);
    expect(h.shutdowns()).toBe(1);
  });

  it('cancels quietly when no countdown is running', () => {
    const h = harness();
    h.cd.cancel();
    expect(h.shown).toEqual([]);
    expect(h.cd.running()).toBe(false);
  });

  it('leaves nothing behind when lolPing quits', () => {
    const h = harness();
    h.cd.start();
    vi.advanceTimersByTime(1000);
    h.cd.dispose();
    vi.advanceTimersByTime(10000);
    expect(h.shutdowns()).toBe(0);
    expect(h.cd.running()).toBe(false);
  });

  it('draws a second once, not four times', () => {
    const h = harness();
    h.cd.start();
    vi.advanceTimersByTime(1000);
    expect(numbers(h)).toEqual([5, 4]);
    expect(h.shown).toHaveLength(2);
  });

  it('redraws in the language and with the shortcut in force at that moment', () => {
    const h = harness();
    h.cd.start();
    expect(h.shown[0]).toMatchObject({ lang: 'en', hotkey: 'Ctrl+Alt+P' });
    h.setLang('zh-CN');
    h.setHotkey('Ctrl+Alt+K');
    vi.advanceTimersByTime(1000);
    expect(h.shown.at(-1)).toMatchObject({ lang: 'zh-CN', hotkey: 'Ctrl+Alt+K' });
  });

  it('counts whatever length it was given', () => {
    const h = harness(3);
    h.cd.start();
    expect(numbers(h)).toEqual([3]);
    vi.advanceTimersByTime(3000);
    expect(h.shutdowns()).toBe(1);
  });
});
