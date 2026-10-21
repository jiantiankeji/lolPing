import { describe, expect, it } from 'vitest';
import { answerView, startsDrag } from '../../src/renderer/panel/answer';
import { strings } from '../../src/shared/i18n';

describe('answerView', () => {
  it('always offers the two buttons: one for all of the answer, one to close it', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      const t = strings(lang);
      for (const expanded of [false, true]) {
        const view = answerView({ lang, expanded });
        expect(view.title).toBe(t.aiAnswerTitle);
        expect(view.close).toBe(t.aiClose);
        expect(view.expand).not.toBe('');
        // The title bar is the handle: it says so in the language in force.
        expect(view.drag).toBe(t.aiDrag);
        expect(view.drag).not.toBe('');
      }
    }
  });

  it('words the one button by what it will do: show all of it, or put it back', () => {
    const t = strings('en');
    expect(answerView({ lang: 'en', expanded: false }).expand).toBe(t.aiExpand);
    expect(answerView({ lang: 'en', expanded: true }).expand).toBe(t.aiCollapse);
    expect(answerView({ lang: 'zh-CN', expanded: false }).expand).toBe(strings('zh-CN').aiExpand);
    expect(answerView({ lang: 'zh-CN', expanded: false }).expand).not.toBe(t.aiExpand);
  });

  it('carries the state through, so the card knows whether to scroll', () => {
    expect(answerView({ lang: 'en', expanded: true }).expanded).toBe(true);
    expect(answerView({ lang: 'en', expanded: false }).expanded).toBe(false);
  });
});

describe('startsDrag', () => {
  it('starts a drag on the title with the left button', () => {
    expect(startsDrag(0, false)).toBe(true);
  });

  it('leaves a press on a control alone, so its own click still happens', () => {
    // This is the close button: capturing the pointer here is what stopped it closing the card.
    expect(startsDrag(0, true)).toBe(false);
  });

  it('ignores the right and middle buttons', () => {
    expect(startsDrag(1, false)).toBe(false);
    expect(startsDrag(2, false)).toBe(false);
  });
});
