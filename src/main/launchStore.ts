import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeLaunchConfig, type LaunchConfig } from '../shared/launchItems';
import { renameWithRetry } from './settingsStore';

/**
 * Loads, validates and persists launch.json: the request gather workspace. A file it cannot read is backed up and
 * emptied rather than blocking the ping, the same way settings.json is treated.
 */
export class LaunchStore {
  readonly file: string;
  readonly problems: string[] = [];
  private current: LaunchConfig;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string, private readonly debounceMs = 150) {
    this.file = join(dir, 'launch.json');
    this.current = normalizeLaunchConfig(undefined);
  }

  load(): LaunchConfig {
    if (!existsSync(this.file)) {
      this.current = normalizeLaunchConfig(undefined);
      return this.current;
    }
    try {
      this.current = normalizeLaunchConfig(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch (err) {
      let backup = 'it was backed up to launch.bak.json';
      try {
        copyFileSync(this.file, join(this.dir, 'launch.bak.json'));
      } catch (copyErr) {
        backup = `it could not be backed up to launch.bak.json (${(copyErr as Error).message})`;
      }
      this.problems.push(`launch.json could not be read (${(err as Error).message}); ${backup} and the list was emptied.`);
      this.current = normalizeLaunchConfig(undefined);
    }
    return this.current;
  }

  get(): LaunchConfig {
    return this.current;
  }

  /** Saves whatever the settings window sent, as stored: entries it cannot use are dropped, never trusted. */
  set(raw: unknown): LaunchConfig {
    this.current = normalizeLaunchConfig(raw);
    this.scheduleSave();
    return this.current;
  }

  /** Writes now via temp file + rename. Safe to call repeatedly; writes are serialized. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const data = JSON.stringify({ requestGather: this.current }, null, 2);
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
        this.problems.push(`Could not save launch.json: ${err.message}`);
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
