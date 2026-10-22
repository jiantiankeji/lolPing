import { describe, expect, it } from 'vitest';
import {
  MAX_AI_TURNS, normalizeTurns, recordTurn, type AiTurn,
} from '../../src/shared/aiHistory';

const turn = (over: Partial<AiTurn> = {}): AiTurn => ({
  question: 'What is broken?', answer: 'The build fails on line 3.', at: 1000, deep: true, ...over,
});

describe('normalizeTurns', () => {
  it('keeps what a turn needs and drops everything else', () => {
    expect(normalizeTurns([
      { question: ' why? ', answer: ' because ', at: 5.7, deep: true },
      { answer: 'no question asked' },
      { question: 'no answer', answer: '   ' },
      'not a turn',
      null,
      7,
    ])).toEqual([
      { question: 'why?', answer: 'because', at: 5, deep: true },
      { question: '', answer: 'no question asked', at: 0, deep: false },
    ]);
  });

  it('reads an old top-level array and a wrapper the same way', () => {
    expect(normalizeTurns([{ answer: 'a' }])).toHaveLength(1);
    expect(normalizeTurns('nonsense')).toEqual([]);
    expect(normalizeTurns(undefined)).toEqual([]);
  });

  it('cuts a runaway answer instead of letting it into the file whole', () => {
    const long = normalizeTurns([{ answer: 'x'.repeat(30000) }]);
    expect(long[0].answer.length).toBeLessThanOrEqual(20000);
  });

  it('keeps at most the turns the history is allowed', () => {
    const many = Array.from({ length: MAX_AI_TURNS + 5 }, (_, i) => ({ answer: `a${i}` }));
    expect(normalizeTurns(many)).toHaveLength(MAX_AI_TURNS);
  });
});

describe('recordTurn', () => {
  it('puts the answer that just arrived first, so the card opens on it', () => {
    const kept = recordTurn([turn({ answer: 'older' })], turn({ answer: 'newer' }));
    expect(kept.map((t) => t.answer)).toEqual(['newer', 'older']);
  });

  it('replaces a turn with an identical one instead of keeping both', () => {
    const kept = recordTurn([turn()], turn());
    expect(kept).toHaveLength(1);
  });

  it('drops the oldest once the history is full', () => {
    let turns: AiTurn[] = [];
    for (let i = 0; i < MAX_AI_TURNS + 3; i++) turns = recordTurn(turns, turn({ answer: `a${i}` }));
    expect(turns).toHaveLength(MAX_AI_TURNS);
    expect(turns[0].answer).toBe(`a${MAX_AI_TURNS + 2}`); // newest first
    expect(turns.some((t) => t.answer === 'a0')).toBe(false);
  });
});
