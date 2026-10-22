/**
 * Sending one file to one member over the room's UDP packets: how it is cut up, what the name is allowed to be, and
 * how far along it is. All of it is pure so the parts of a transfer that matter can be tested without a socket.
 */
import type { PingId } from './pings';

/** The largest file the room will carry. */
export const FILE_MAX_BYTES = 200 * 1024 * 1024;
/**
 * Raw bytes in one part. base64 of this is 960 characters, and a part's message plus its signature and the packet's
 * 29 bytes of encryption overhead stays under MAX_PACKET (1200): 202 bytes of fields + 960 + 29 = 1191.
 */
export const PART_BYTES = 720;
/** Base64 characters a part may carry, checked on the wire. */
export const PART_B64_MAX = 960;
/** The most parts a file at the limit can need. */
export const MAX_PARTS = Math.ceil(FILE_MAX_BYTES / PART_BYTES);
/** A file name as shown and saved: enough to recognise, short enough for one message. */
export const MAX_FILE_NAME = 120;

export const TRANSFER_ID_RE = /^[0-9a-f]{8}$/;

/** How many parts a file of `size` bytes needs; an empty file still needs none. */
export function partCount(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.ceil(size / PART_BYTES);
}

/** How many bytes the part at `index` carries: every part is full but the last. */
export function partLength(size: number, index: number): number {
  const left = size - index * PART_BYTES;
  return Math.max(0, Math.min(PART_BYTES, left));
}

/** Whether this file may go at all: non-empty, and inside the limit. */
export function withinLimit(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= FILE_MAX_BYTES;
}

/**
 * A name that is safe to show and to save: no directory part, nothing Windows refuses, no control characters or bidi
 * marks that could disguise an extension, and never empty. The receiver saves under this name, so a sender cannot
 * choose where it lands.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim();
  const chars = [...cleaned];
  const cut = chars.length > MAX_FILE_NAME ? chars.slice(0, MAX_FILE_NAME).join('') : cleaned;
  return cut === '' || cut === '.' || cut === '..' ? 'file' : cut;
}

/** 0 to 100, from the last part received (or sent) of how many. */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const part = Math.min(Math.max(done, 0), total);
  return Math.floor((part / total) * 100);
}

/** A size as the card shows it: bytes, KB, MB or GB, one decimal from MB up. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** The wheel slice that sends a file: `push` keeps its place on the wheel, and its meaning changed. */
export const FILE_SHARE_PING: PingId = 'push';

/** How a transfer ended, as the card words it. */
export type TransferResult = 'ok' | 'refused' | 'cancelled' | 'gone' | 'lost' | 'failed' | 'mismatch';

/** What the transfer card needs to draw one transfer, on either side of it. */
export interface TransferState {
  view: 'transfer';
  lang: 'en' | 'zh-CN';
  /** `ask` is only ever the receiver: somebody wants to send us a file and is waiting for an answer. */
  phase: 'ask' | 'sending' | 'receiving' | 'done' | 'failed';
  peerName: string;
  fileName: string;
  size: number;
  /** Parts done of how many, for the bar. */
  done: number;
  total: number;
  result?: TransferResult;
}

/** How many parts may be in flight before the sender waits for an acknowledgement. */
export const WINDOW_PARTS = 32;
/** A sender that hears nothing for this long gives up: the receiver is gone, or the room is too lossy. */
export const TRANSFER_IDLE_MS = 8000;
/** How long an offer waits for an answer before it is dropped. */
export const OFFER_MS = 30000;
