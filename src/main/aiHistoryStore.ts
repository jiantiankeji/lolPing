import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeTurns, recordTurn, type AiTurn } from '../shared/aiHistory';
import { renameWithRetry } from './settingsStore';

/**
 * Loads and persists ai-history.json: the answers the card pages through. It is a local file and nothing is sent
 * anywhere; a file it cannot read is backed up and emptied rather than blocking a question.
 */
export class AiHistoryStore {
  readonly file: string;
  readonly problems: string[] = [];
  private current: AiTurn[] = [];
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string, private readonly debounceMs = 150) {
    this.file = join(dir, 'ai-history.json');
  }

  load(): AiTurn[] {
    if (!existsSync(this.file)) {
      this.current = [];
      return this.current;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      const turns = Array.isArray(raw)
        ? raw
        : typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).turns : undefined;
      this.current = normalizeTurns(turns);
    } catch (err) {
      let backup = 'it was backed up to ai-history.bak.json';
      try {
        copyFileSync(this.file, join(this.dir, 'ai-history.bak.json'));
      } catch (copyErr) {
        backup = `it could not be backed up (${(copyErr as Error).message})`;
      }
      this.problems.push(`ai-history.json could not be read (${(err as Error).message}); ${backup} and the history was emptied.`);
      this.current = [];
    }
    return this.current;
  }

  get(): readonly AiTurn[] {
    return this.current;
  }

  /** Adds an answer and returns the list as it now stands, newest first. */
  add(turn: AiTurn): readonly AiTurn[] {
    this.current = recordTurn(normalizeTurns(this.current), turn);
    this.scheduleSave();
    return this.current;
  }

  clear(): readonly AiTurn[] {
    this.current = [];
    this.scheduleSave();
    return this.current;
  }

  /** Writes now via temp file + rename. Safe to call repeatedly; writes are serialized. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const data = JSON.stringify({ version: 1, turns: this.current }, null, 2);
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        const tmp = `${this.file}.tmp`;
        try {
          await writeFile(tmp, data, 'utf8');
          await renameWithRetry(tmp, this.file);
        } catch (err) {
          await rm(tmp, { force: true }).catch(() => undefined);
          throw err;
        }
      })
      .catch((err: Error) => {
        this.problems.push(`Could not save ai-history.json: ${err.message}`);
      });
    return this.writing;
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }
}
