import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { FILE_MAX_BYTES, sanitizeFileName, type TransferResult } from '../shared/fileShare';

/**
 * Files travel over a TCP connection between two members of the same room, not over the room's UDP packets.
 *
 * Why: a room message is capped at 1200 bytes and every one of them is signed and verified, so a big file meant a
 * quarter of a million sign+verify pairs (measured: 0.3 ms each, ~72 s of pure CPU for 163 MB) and a 1.5 s wait for
 * every lost packet. A TCP stream carries 64 KB frames, needs no acknowledgement scheme and no per-frame signature.
 *
 * The frames are still sealed with the room's key, so only someone who knows the room code can read them or write into
 * the stream, and the whole file is checked against a sha256 that the sender states up front.
 */

/** Payload bytes per frame: 64 KB of file goes into one sealed frame. */
export const FRAME_BYTES = 64 * 1024;
const NONCE = 12;
const TAG = 16;
const CONTROL = 1;
const DATA = 2;
/** A frame's sealed length: one type byte, the 64 KB itself, and the nonce and tag around it. */
const MAX_FRAME = 1 + FRAME_BYTES + NONCE + TAG;

/**
 * The host inside a LAN peer key, which reads `lan:192.168.1.5:47474` (the transport puts a kind prefix on every key).
 * Splitting on the last colon alone keeps the `lan:` and hands DNS a host that cannot exist.
 */
export function hostFromPeerKey(key: string): string | null {
  const m = /^lan:(.+):(\d+)$/.exec(key);
  if (!m) return null;
  // A bracketed IPv6 address arrives as `[::1]`, and a socket wants it without the brackets.
  const host = m[1].startsWith('[') && m[1].endsWith(']') ? m[1].slice(1, -1) : m[1];
  return host === '' ? null : host;
}

export interface TransferProgress {
  direction: 'send' | 'receive';
  bytes: number;
  total: number;
}

export type TransferEnd =
  | { ok: true }
  | { ok: false; why: 'refused' | 'cancelled' | 'gone' | 'lost' | 'failed' | 'mismatch' };

interface Control {
  k: 'offer' | 'accept' | 'seal' | 'finish' | 'abort';
  id?: string;
  name?: string;
  size?: number;
  sha?: string;
  ok?: boolean;
}

/** One sealed frame: the room key keeps a stranger out, and the type byte says whether it is control or file data. */
function sealFrame(key: Buffer, type: number, payload: Buffer): Buffer {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from([type]), payload])), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

function openFrame(key: Buffer, sealed: Buffer): { type: number; payload: Buffer } | null {
  if (sealed.length < NONCE + TAG + 1) return null;
  const nonce = sealed.subarray(0, NONCE);
  const tag = sealed.subarray(sealed.length - TAG);
  const body = sealed.subarray(NONCE, sealed.length - TAG);
  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return null;
  }
  if (plain.length < 1) return null;
  return { type: plain[0], payload: plain.subarray(1) };
}

const frame = (key: Buffer, type: number, payload: Buffer): Buffer => {
  const sealed = sealFrame(key, type, payload);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(sealed.length, 0);
  return Buffer.concat([head, sealed]);
};

const controlFrame = (key: Buffer, control: Control): Buffer =>
  frame(key, CONTROL, Buffer.from(JSON.stringify(control), 'utf8'));

/** Splits a socket's bytes into sealed frames, whatever the chunks look like on the wire. */
class FrameReader {
  private pending: Buffer = Buffer.alloc(0);

  constructor(
    private readonly key: Buffer,
    private readonly onFrame: (type: number, payload: Buffer) => void,
    private readonly onBad: (why: TransferEnd) => void,
  ) {}

  push(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32BE(0);
      // A frame this large cannot be ours: either a broken stream or something else talking on the port.
      if (length > MAX_FRAME) return this.onBad({ ok: false, why: 'failed' });
      if (this.pending.length < 4 + length) return;
      const sealed = this.pending.subarray(4, 4 + length);
      this.pending = this.pending.subarray(4 + length);
      const opened = openFrame(this.key, sealed);
      if (!opened) return this.onBad({ ok: false, why: 'failed' });
      this.onFrame(opened.type, opened.payload);
    }
  }
}

export interface SendOptions {
  host: string;
  port: number;
  key: Buffer;
  path: string;
  name: string;
  signal?: AbortSignal;
}

export interface SendResult {
  ok: boolean;
  why?: TransferResult;
}

/**
 * Sends one file to `host:port`: offer, wait for the answer, then the bytes as fast as the socket takes them, then the
 * checksum. Progress is reported as bytes, not frames.
 */
export async function sendFileTo(
  opts: SendOptions,
  onProgress: (p: TransferProgress) => void,
): Promise<SendResult> {
  const info = await stat(opts.path).catch(() => null);
  if (!info || !info.isFile() || info.size === 0 || info.size > FILE_MAX_BYTES) return { ok: false, why: 'failed' };
  const id = randomBytes(4).toString('hex');
  const name = sanitizeFileName(opts.name);

  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const done = (result: SendResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = connect({ host: opts.host, port: opts.port });
    socket.setNoDelay(true);
    const reader = new FrameReader(opts.key, (type, payload) => {
      if (type !== CONTROL) return done({ ok: false, why: 'failed' });
      let control: Control;
      try {
        control = JSON.parse(payload.toString('utf8')) as Control;
      } catch {
        return done({ ok: false, why: 'failed' });
      }
      if (control.k === 'accept') {
        if (control.ok !== true) return done({ ok: false, why: 'refused' });
        void pump();
        return;
      }
      if (control.k === 'finish') return done({ ok: control.ok === true, why: control.ok === true ? undefined : 'mismatch' });
      if (control.k === 'abort') return done({ ok: false, why: 'cancelled' });
    }, (why) => done({ ok: false, why: why.ok ? 'failed' : why.why }));

    const hash = createHash('sha256');
    let sent = 0;
    let pumping = false;

    const pump = async (): Promise<void> => {
      if (pumping) return;
      pumping = true;
      try {
        const handle = await open(opts.path, 'r');
        const buffer = Buffer.alloc(FRAME_BYTES);
        try {
          while (sent < info.size) {
            if (socket.destroyed) return;
            const want = Math.min(FRAME_BYTES, info.size - sent);
            const { bytesRead } = await handle.read(buffer, 0, want, sent);
            if (bytesRead === 0) return done({ ok: false, why: 'failed' });
            const slice = buffer.subarray(0, bytesRead);
            hash.update(slice);
            const sealed = frame(opts.key, DATA, slice);
            if (!socket.write(sealed)) {
              // Wait for the socket to drain: TCP has its own flow control, and writing past it only piles up memory.
              await new Promise<void>((resolve, reject) => {
                const onDrain = (): void => {
                  socket.off('error', onError);
                  resolve();
                };
                const onError = (): void => {
                  socket.off('drain', onDrain);
                  reject(new Error('socket closed'));
                };
                socket.once('drain', onDrain);
                socket.once('error', onError);
              }).catch(() => undefined);
            }
            sent += bytesRead;
            onProgress({ direction: 'send', bytes: sent, total: info.size });
          }
          socket.write(controlFrame(opts.key, { k: 'seal', id, sha: hash.digest('hex') }));
        } finally {
          await handle.close().catch(() => undefined);
        }
      } catch {
        done({ ok: false, why: 'failed' });
      } finally {
        pumping = false;
      }
    };

    socket.once('connect', () => {
      socket.write(controlFrame(opts.key, { k: 'offer', id, name, size: info.size }));
    });
    socket.on('data', (chunk: Buffer) => reader.push(chunk));
    socket.once('error', () => done({ ok: false, why: 'lost' }));
    socket.once('close', () => done({ ok: false, why: 'lost' }));
    opts.signal?.addEventListener('abort', () => done({ ok: false, why: 'cancelled' }), { once: true });
  });
}

export interface ReceiveDeps {
  key: Buffer;
  /** Asks where the file should go. Null refuses it. */
  pickSave(name: string, size: number): Promise<string | null>;
  onProgress(p: TransferProgress): void;
  /** How this receiving ended: the card words it. */
  onEnd(result: TransferEnd): void;
}

interface Incoming {
  name: string;
  size: number;
  handle: FileHandle | null;
  temp: string;
  target: string;
  hash: ReturnType<typeof createHash>;
  written: number;
  /** Writes go one at a time: two at once on the same handle would land in whatever order the thread pool chose. */
  queue: Promise<void>;
}

/**
 * One TCP listener for the room: whoever knows the room key may offer a file, one at a time. Nothing is written until
 * the receiver has picked a place for it, and the file only takes its real name once the checksum matches.
 */
export class FileListener {
  private server: Server | null = null;
  private incoming: Incoming | null = null;

  constructor(private readonly deps: ReceiveDeps) {}

  /** Starts listening; the port is the one the caller announces in its presence. */
  listen(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.onSocket(socket));
      this.server = server;
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
  }

  get port(): number {
    const address = this.server?.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  cancel(): void {
    if (!this.incoming) return;
    this.drop();
    this.deps.onEnd({ ok: false, why: 'cancelled' });
  }

  close(): void {
    this.drop();
    this.server?.close();
    this.server = null;
  }

  private drop(): void {
    const incoming = this.incoming;
    this.incoming = null;
    if (!incoming) return;
    void incoming.queue.finally(() => incoming.handle?.close().catch(() => undefined));
    if (incoming.temp !== '') void rm(incoming.temp, { force: true }).catch(() => undefined);
  }

  private onSocket(socket: Socket): void {
    if (this.incoming) {
      // One file at a time, as before: a second offer is refused rather than interleaved.
      socket.end(controlFrame(this.deps.key, { k: 'accept', ok: false }));
      return;
    }
    socket.setNoDelay(true);
    const reader = new FrameReader(this.deps.key, (type, payload) => {
      if (type === DATA) return this.take(payload);
      let control: Control;
      try {
        control = JSON.parse(payload.toString('utf8')) as Control;
      } catch {
        return this.fail('failed');
      }
      if (control.k === 'offer') return void this.offer(socket, control);
      if (control.k === 'seal') return void this.seal(socket, control);
      if (control.k === 'abort') return this.fail('cancelled');
    }, () => {
      // A frame we cannot open means the other end is not in this room: say nothing, close, and let it hang up.
      this.fail('failed');
      socket.destroy();
    });
    socket.on('data', (chunk: Buffer) => reader.push(chunk));
    socket.once('error', () => this.fail('lost'));
    socket.once('close', () => {
      if (this.incoming) this.fail('lost');
    });
  }

  private async offer(socket: Socket, control: Control): Promise<void> {
    const name = sanitizeFileName(control.name ?? '');
    const size = control.size ?? 0;
    if (size <= 0 || size > FILE_MAX_BYTES) {
      socket.end(controlFrame(this.deps.key, { k: 'accept', ok: false }));
      return;
    }
    this.incoming = {
      name, size, handle: null, temp: '', target: '',
      hash: createHash('sha256'), written: 0, queue: Promise.resolve(),
    };
    // The sender waits for this answer before its first byte, so the dialog can take as long as it takes.
    const target = await this.deps.pickSave(name, size);
    const incoming = this.incoming;
    if (target === null || !incoming) {
      this.drop();
      socket.end(controlFrame(this.deps.key, { k: 'accept', ok: false }));
      this.deps.onEnd({ ok: false, why: 'refused' });
      return;
    }
    const temp = `${target}.lolping-part`;
    const handle = await open(temp, 'w').catch(() => null);
    if (!handle) {
      this.drop();
      socket.end(controlFrame(this.deps.key, { k: 'accept', ok: false }));
      this.deps.onEnd({ ok: false, why: 'failed' });
      return;
    }
    incoming.handle = handle;
    incoming.temp = temp;
    incoming.target = target;
    socket.write(controlFrame(this.deps.key, { k: 'accept', ok: true }));
  }

  private take(payload: Buffer): void {
    const incoming = this.incoming;
    if (!incoming || !incoming.handle) return;
    incoming.hash.update(payload);
    incoming.written += payload.length;
    const over = incoming.written > incoming.size;
    const handle = incoming.handle;
    incoming.queue = incoming.queue.then(async () => {
      const written = await handle.write(payload).then(() => true).catch(() => false);
      if (!written && this.incoming === incoming) this.fail('failed');
    });
    this.deps.onProgress({ direction: 'receive', bytes: incoming.written, total: incoming.size });
    if (over) this.fail('failed');
  }

  private async seal(socket: Socket, control: Control): Promise<void> {
    const incoming = this.incoming;
    if (!incoming) return;
    await incoming.queue;
    const sha = incoming.hash.digest('hex');
    const complete = incoming.written === incoming.size && control.sha === sha;
    await incoming.handle?.close().catch(() => undefined);
    this.incoming = null;
    const ok = complete && (await rename(incoming.temp, incoming.target).then(() => true).catch(() => false));
    if (!ok) await rm(incoming.temp, { force: true }).catch(() => undefined);
    socket.end(controlFrame(this.deps.key, { k: 'finish', ok }));
    this.deps.onEnd(ok ? { ok: true } : { ok: false, why: complete ? 'failed' : 'mismatch' });
  }

  private fail(why: 'cancelled' | 'failed' | 'lost'): void {
    if (!this.incoming) return;
    this.drop();
    this.deps.onEnd({ ok: false, why });
  }
}

/** Reads a file's sha256 without holding it in memory: the sender states it, the receiver checks it. */
export const hashOf = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk: string | Buffer) => {
        hash.update(chunk);
      })
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
