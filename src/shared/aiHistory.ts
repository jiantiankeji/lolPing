/** One question and the answer it got: what the answer card pages through, and what a follow-up builds on. */
export interface AiTurn {
  /** The question as typed; empty when the built-in one was asked. */
  question: string;
  /** The answer, whole. */
  answer: string;
  /** When the answer arrived, ms since epoch. */
  at: number;
  /** A deep (thinking) ask: a follow-up keeps the mode it continues. */
  deep: boolean;
}

/** How many turns are kept: enough to scroll back through a session, few enough to stay a small file. */
export const MAX_AI_TURNS = 30;
/** A single answer longer than this is cut when it is stored, so one runaway reply cannot bloat the file. */
export const MAX_AI_ANSWER_CHARS = 20000;
export const MAX_AI_QUESTION_CHARS = 2000;

/** Rebuilds stored turns from `unknown`: anything unusable is dropped, never trusted. */
export function normalizeTurns(raw: unknown): AiTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: AiTurn[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const answer = typeof row.answer === 'string' ? row.answer.trim() : '';
    if (answer === '') continue;
    turns.push({
      question: typeof row.question === 'string' ? row.question.trim().slice(0, MAX_AI_QUESTION_CHARS) : '',
      answer: answer.slice(0, MAX_AI_ANSWER_CHARS),
      at: typeof row.at === 'number' && Number.isFinite(row.at) ? Math.trunc(row.at) : 0,
      deep: row.deep === true,
    });
    if (turns.length >= MAX_AI_TURNS) break;
  }
  return turns;
}

/** The newest turn first, so the card opens on the answer that just arrived and "older" walks back. */
export function recordTurn(turns: readonly AiTurn[], turn: AiTurn): AiTurn[] {
  const kept = turns.filter((existing) => existing.answer !== turn.answer || existing.question !== turn.question);
  return [turn, ...kept].slice(0, MAX_AI_TURNS);
}
