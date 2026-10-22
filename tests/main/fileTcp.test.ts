import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { FileListener, sendFileTo, type TransferProgress } from '../../src/main/fileTcp';
import type { TransferEnd } from '../../src/main/fileTcp';

const KEY = randomBytes(32);
const dirs: string[] = [];

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'lolping-tcp-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Pair {
  port: number;
  ends: TransferEnd[];
  progress: TransferProgress[];
  saved: () => string;
}

/** A listener on the loopback interface, and a file to send it: the whole path, over a real socket. */
async function start(over: { refuse?: boolean; fileSize?: number } = {}): Promise<Pair & { listener: FileListener; dir: string }> {
  const dir = tempDir();
  const ends: TransferEnd[] = [];
  const progress: TransferProgress[] = [];
  const listener = new FileListener({
    key: KEY,
    pickSave: async (name) => (over.refuse ? null : join(dir, name)),
    onProgress: (p) => progress.push(p),
    onEnd: (r) => ends.push(r),
  });
  const port = await listener.listen(0);
  return { port, ends, progress, saved: () => join(dir, 'received.bin'), listener, dir };
}

describe('fileTcp', () => {
  it('carries a file over a socket, checksum and all, and finishes on both sides', async () => {
    const size = 3 * 1024 * 1024 + 123;
    const net = await start();
    const source = join(net.dir, 'source.bin');
    const bytes = randomBytes(size);
    writeFileSync(source, bytes);

    const result = await sendFileTo({ host: '127.0.0.1', port: net.port, key: KEY, path: source, name: 'received.bin' }, (p) => net.progress.push(p));
    await new Promise((resolve) => setTimeout(resolve, 50));
    net.listener.close();

    expect(result).toEqual({ ok: true });
    expect(net.ends).toEqual([{ ok: true }]);
    expect(readFileSync(net.saved()).equals(bytes)).toBe(true);
    expect(statSync(net.saved()).size).toBe(size);
    // Progress is reported in bytes, and reaches the whole file.
    const last = net.progress.filter((p) => p.direction === 'send').at(-1);
    expect(last?.bytes).toBe(size);
    expect(last?.total).toBe(size);
    expect(net.progress.some((p) => p.direction === 'receive' && p.bytes === size)).toBe(true);
  });

  it('takes a big file quickly, and leaves nothing half-written behind', async () => {
    const size = 32 * 1024 * 1024;
    const net = await start();
    const source = join(net.dir, 'big.bin');
    const bytes = randomBytes(size);
    writeFileSync(source, bytes);

    const started = Date.now();
    const result = await sendFileTo({ host: '127.0.0.1', port: net.port, key: KEY, path: source, name: 'received.bin' }, () => undefined);
    const ms = Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 100));
    net.listener.close();

    expect(result).toEqual({ ok: true });
    expect(readFileSync(net.saved()).equals(bytes)).toBe(true);
    expect(existsSync(`${net.saved()}.lolping-part`)).toBe(false);
    // Not a benchmark, just a guard against falling back to per-part signing: even a slow machine does this in seconds.
    expect(ms).toBeLessThan(20_000);
  });

  it('refuses a file the receiver does not want, and writes nothing', async () => {
    const net = await start({ refuse: true });
    const source = join(net.dir, 'source.bin');
    writeFileSync(source, randomBytes(4096));
    const result = await sendFileTo({ host: '127.0.0.1', port: net.port, key: KEY, path: source, name: 'received.bin' }, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    net.listener.close();
    expect(result).toEqual({ ok: false, why: 'refused' });
    expect(existsSync(net.saved())).toBe(false);
  });

  it('keeps a file out of the room\'s hands: a stranger with another key cannot read the stream', async () => {
    const net = await start();
    const source = join(net.dir, 'source.bin');
    writeFileSync(source, randomBytes(64 * 1024));
    const result = await sendFileTo(
      { host: '127.0.0.1', port: net.port, key: randomBytes(32), path: source, name: 'received.bin' },
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    net.listener.close();
    // The listener cannot open the first frame, so the sender never gets a yes.
    expect(result.ok).toBe(false);
    expect(existsSync(net.saved())).toBe(false);
  });
});
