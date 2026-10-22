import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiHistoryStore } from '../../src/main/aiHistoryStore';

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'lolping-aihistory-'));

const waitFor = async (done: () => boolean, ms = 3000): Promise<void> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for ai-history.json');
};

const read = (dir: string): unknown => JSON.parse(readFileSync(join(dir, 'ai-history.json'), 'utf8')) as unknown;

describe('AiHistoryStore', () => {
  it('starts empty when there is no file', () => {
    const dir = tempDir();
    try {
      const store = new AiHistoryStore(dir);
      expect(store.load()).toEqual([]);
      expect(existsSync(join(dir, 'ai-history.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the answers it is given, newest first, and reads them back', async () => {
    const dir = tempDir();
    try {
      const store = new AiHistoryStore(dir, 10);
      store.load();
      store.add({ question: 'first', answer: 'one', at: 1, deep: false });
      store.add({ question: 'second', answer: 'two', at: 2, deep: true });
      await waitFor(() => existsSync(join(dir, 'ai-history.json')) && (read(dir) as { turns: unknown[] }).turns.length === 2);
      expect(read(dir)).toMatchObject({
        version: 1,
        turns: [
          { question: 'second', answer: 'two', at: 2, deep: true },
          { question: 'first', answer: 'one', at: 1, deep: false },
        ],
      });

      const reopened = new AiHistoryStore(dir);
      expect(reopened.load().map((t) => t.answer)).toEqual(['two', 'one']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('empties the history on clear, on disk too', async () => {
    const dir = tempDir();
    try {
      const store = new AiHistoryStore(dir, 10);
      store.load();
      store.add({ question: '', answer: 'one', at: 1, deep: false });
      await waitFor(() => existsSync(join(dir, 'ai-history.json')));
      store.clear();
      await waitFor(() => (read(dir) as { turns: unknown[] }).turns.length === 0);
      expect(store.get()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backs up a file it cannot read and starts empty, without blocking a question', () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'ai-history.json'), '{ not json');
      const store = new AiHistoryStore(dir);
      expect(store.load()).toEqual([]);
      expect(store.problems[0]).toContain('ai-history.json could not be read');
      expect(existsSync(join(dir, 'ai-history.bak.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a bare array too, so a hand-written file is not thrown away', () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'ai-history.json'), JSON.stringify([{ question: 'q', answer: 'a', at: 3, deep: true }]));
      const store = new AiHistoryStore(dir);
      expect(store.load()).toEqual([{ question: 'q', answer: 'a', at: 3, deep: true }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
