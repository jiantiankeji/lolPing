import { describe, expect, it } from 'vitest';
import { ANSWER_MAX, askPrompt, deepPrompt, oneLine } from '../../src/shared/aiAsk';

describe('aiAsk', () => {
  it('asks for one short answer about development work, in the language the app is in', () => {
    expect(askPrompt('en')).toContain('one sentence');
    expect(askPrompt('zh-CN')).toContain('一句话');
    expect(askPrompt('zh-CN')).not.toBe(askPrompt('en'));
  });

  it('asks about an editor, a terminal or a build, not about a game', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      const prompt = askPrompt(lang);      expect(prompt).not.toMatch(/League of Legends|英雄联盟/);
      expect(prompt).not.toMatch(/game|对局/);
    }
    expect(askPrompt('en')).toContain('terminal');
    expect(askPrompt('zh-CN')).toContain('终端');
  });

  it('keeps code and identifiers as written, and says to ignore lolPing’s own overlay', () => {
    expect(askPrompt('en')).toContain('identifiers');
    expect(askPrompt('en')).toContain('Ignore any ping icon');
    expect(askPrompt('zh-CN')).toContain('标识符');
    expect(askPrompt('zh-CN')).toContain('请忽略 lolPing');
  });

  it('flattens an answer onto one line', () => {
    expect(oneLine('Back off.\n\nTheir jungler\nis coming.')).toBe('Back off. Their jungler is coming.');
  });

  it('drops markdown marks a bubble would show as characters', () => {
    expect(oneLine('**Push** the `wave` and _back_ off #1')).toBe('Push the wave and back off 1');
    expect(oneLine('```\nDanger\n```')).toBe('');
  });

  it('cuts a long answer to one bubble, ending in an ellipsis', () => {
    const out = oneLine('a'.repeat(ANSWER_MAX + 40));
    expect([...out]).toHaveLength(ANSWER_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('keeps an emoji whole when it cuts', () => {
    const out = oneLine('😀'.repeat(ANSWER_MAX + 5));
    expect([...out]).toHaveLength(ANSWER_MAX);
    expect(out).not.toContain('\uFFFD');
  });

  it('leaves a short answer alone', () => {
    expect(oneLine('Wait for the wave.')).toBe('Wait for the wave.');
  });
});

describe('deepPrompt', () => {
  it('uses the built-in question while nobody has written one', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      expect(deepPrompt('', lang)).toBe(askPrompt(lang));
      expect(deepPrompt('   \n\t ', lang)).toBe(askPrompt(lang));
    }
  });

  it('sends the written question, then the one line that keeps the overlay out of the way', () => {
    const en = deepPrompt(' What is broken in this file? ', 'en');
    expect(en.startsWith('What is broken in this file?')).toBe(true);
    expect(en).toContain('Ignore any ping icon or text that lolPing drew');
    expect(en).not.toContain('everyday development work'); // the built-in question is not mixed in
    expect(deepPrompt('这段代码有什么问题？', 'zh-CN')).toContain('请忽略 lolPing 画在截图上的');
  });
});
