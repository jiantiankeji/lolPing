import { describe, expect, it } from 'vitest';
import { answerView, needsRebuild, startsDrag } from '../../src/renderer/panel/answer';
import { strings, type Lang } from '../../src/shared/i18n';

const view = (over: { lang?: Lang; expanded?: boolean; index?: number; count?: number } = {}): ReturnType<typeof answerView> =>
  answerView({ lang: 'en', expanded: false, index: 0, count: 1, ...over });

describe('answerView', () => {
  it('always offers its buttons: show all, follow up, page back, close', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      const t = strings(lang);
      for (const expanded of [false, true]) {
        const v = view({ lang, expanded });
        expect(v.title).toBe(t.aiAnswerTitle);
        expect(v.close).toBe(t.aiClose);
        expect(v.expand).not.toBe('');
        expect(v.followUp).toBe(t.aiFollowUp);
        expect(v.drag).toBe(t.aiDrag);
      }
    }
  });

  it('words the expand button by what it will do: show all of it, or put it back', () => {
    const t = strings('en');
    expect(view({ expanded: false }).expand).toBe(t.aiExpand);
    expect(view({ expanded: true }).expand).toBe(t.aiCollapse);
    expect(view({ lang: 'zh-CN' }).expand).toBe(strings('zh-CN').aiExpand);
    expect(view({ lang: 'zh-CN' }).expand).not.toBe(t.aiExpand);
  });

  it('carries the expanded state through, so the card knows whether to scroll', () => {
    expect(view({ expanded: true }).expanded).toBe(true);
    expect(view({ expanded: false }).expanded).toBe(false);
  });

  it('counts from the newest answer and only offers the way that exists', () => {
    const newest = view({ index: 0, count: 3 });
    expect(newest.position).toBe('1 / 3');
    expect(newest.canNewer).toBe(false); // nothing newer than the answer that just arrived
    expect(newest.canOlder).toBe(true);

    const older = view({ index: 2, count: 3 });
    expect(older.position).toBe('3 / 3');
    expect(older.canOlder).toBe(false);
    expect(older.canNewer).toBe(true);
  });

  it('offers no paging at all with a single answer kept', () => {
    const only = view({ index: 0, count: 1 });
    expect(only.position).toBe('1 / 1');
    expect(only.canOlder).toBe(false);
    expect(only.canNewer).toBe(false);
  });

  it('keeps the counter inside the history, whatever index arrives', () => {
    expect(view({ index: 9, count: 3 }).position).toBe('3 / 3');
    expect(view({ index: -4, count: 3 }).position).toBe('1 / 3');
    expect(view({ index: 0, count: 0 }).position).toBe('1 / 1'); // never "0 / 0"
  });
});

describe('needsRebuild', () => {
  it('builds the card when there is none yet', () => {
    expect(needsRebuild(null, { lang: 'en', text: 'Back off.' })).toBe(true);
  });

  it('keeps the card for the same answer, so expanding does not redraw the text', () => {
    expect(needsRebuild({ lang: 'en', text: 'Back off.' }, { lang: 'en', text: 'Back off.' })).toBe(false);
  });

  it('builds a new card for a new answer, which is what makes the second question visible at all', () => {
    expect(needsRebuild({ lang: 'en', text: 'Back off.' }, { lang: 'en', text: 'Push instead.' })).toBe(true);
  });

  it('builds a new card when the language changes under it', () => {
    expect(needsRebuild({ lang: 'en', text: 'Back off.' }, { lang: 'zh-CN', text: 'Back off.' })).toBe(true);
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
