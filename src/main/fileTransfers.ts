import {
  OFFER_MS, PART_BYTES, TRANSFER_IDLE_MS, WINDOW_PARTS, partCount, partLength,
} from '../shared/fileShare';
import type { FileMsg } from '../shared/roomProtocol';

/** What a card shows about one transfer, on either side of it. */
export interface TransferProgress {
  id: string;
  /** The member on the other end. */
  peer: string;
  name: string;
  size: number;
  direction: 'send' | 'receive';
  /** Parts done so far: acknowledged when sending, written when receiving. */
  done: number;
  total: number;
}

/** How a transfer ended, or why it did not. */
export type TransferEnd =
  | { ok: true }
  | { ok: false; why: 'refused' | 'cancelled' | 'gone' | 'lost' | 'failed' | 'mismatch' };

/** A part that has not been acknowledged for this long is sent again: on a busy LAN a packet goes missing now and then. */
const RESEND_MS = 1500;

export interface SenderDeps {
  /** Reads `length` bytes at `offset`, or null when the file cannot be read any more. */
  read(offset: number, length: number): Promise<Uint8Array | null>;
  /** sha256 of the whole file, lower-case hex, taken once the last part is out. */
  sha256(): Promise<string>;
  send(to: string, body: Record<string, unknown>): void;
  progress(p: TransferProgress): void;
  end(result: TransferEnd): void;
  now(): number;
}

/**
 * One file leaving this machine for one member. It offers the file, waits to be taken, then keeps a window of parts in
 * flight until an acknowledgement moves it on; `tick` is what notices a part gone missing and the member gone quiet.
 */
export class FileSender {
  private next = 0;
  private acked = 0;
  private readonly inFlight = new Map<number, number>();
  private offeredAt: number | null = null;
  private acceptedAt: number | null = null;
  private sealed = false;
  private finished = false;
  private pumping = false;
  private pumpAgain = false;
  private lastHeard: number;

  constructor(
    private readonly deps: SenderDeps,
    readonly peer: string,
    readonly id: string,
    readonly name: string,
    readonly size: number,
  ) {
    this.lastHeard = deps.now();
  }

  get total(): number {
    return partCount(this.size);
  }

  /** Parts the member has confirmed: what a progress bar for a file going out counts. */
  get done(): number {
    return this.acked;
  }

  offer(): void {
    if (this.offeredAt !== null) return;
    this.offeredAt = this.deps.now();
    this.deps.send(this.peer, { t: 'offer', to: this.peer, id: this.id, name: this.name, size: this.size, n: this.total });
  }

  /** Everything the member says about this transfer. Anything else is ignored. */
  onMessage(msg: FileMsg): void {
    if (msg.t === 'abort' && msg.id === this.id) return this.finish({ ok: false, why: 'cancelled' });
    if (msg.id !== this.id || this.finished) return;
    this.lastHeard = this.deps.now();
    switch (msg.t) {
      case 'accept':
        if (!msg.took) return this.finish({ ok: false, why: 'refused' });
        if (this.acceptedAt === null) {
          this.acceptedAt = this.lastHeard;
          void this.pump();
        }
        return;
      case 'ack':
        if (msg.next > this.acked) {
          this.acked = Math.min(msg.next, this.total);
          for (const index of [...this.inFlight.keys()]) if (index < this.acked) this.inFlight.delete(index);
          this.report();
          void this.pump();
        }
        return;
      case 'finish':
        return this.finish(msg.ok ? { ok: true } : { ok: false, why: 'mismatch' });
      default:
        return;
    }
  }

  /** Time moves: resend what went missing, and give up on a member that has gone quiet. */
  tick(now: number): void {
    if (this.finished) return;
    if (this.acceptedAt === null) {
      if (this.offeredAt !== null && now - this.offeredAt > OFFER_MS) this.finish({ ok: false, why: 'gone' });
      return;
    }
    if (now - this.lastHeard > TRANSFER_IDLE_MS) return this.finish({ ok: false, why: 'lost' });
    for (const [index, at] of [...this.inFlight]) {
      if (now - at > RESEND_MS) void this.sendPart(index);
    }
  }

  cancel(): void {
    if (this.finished) return;
    this.deps.send(this.peer, { t: 'abort', id: this.id });
    this.finish({ ok: false, why: 'cancelled' });
  }

  private async pump(): Promise<void> {
    // An acknowledgement that lands while the loop below is awaiting must not be lost: it asks for one more pass
    // instead of returning, or the window would stop moving and the transfer would sit there until the idle timer.
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    if (this.finished || this.acceptedAt === null) return;
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        while (!this.finished && this.next < this.total && this.next < this.acked + WINDOW_PARTS) {
          await this.sendPart(this.next);
          this.next++;
        }
        // Sealed once the receiver has acknowledged every part. Waiting for an empty window instead would never
        // happen when a part is acknowledged out of step, and the receiver would wait for a seal that never comes.
        if (!this.finished && this.acked >= this.total && !this.sealed) await this.seal();
      } while (this.pumpAgain && !this.finished);
    } finally {
      this.pumping = false;
    }
  }

  private async sendPart(index: number): Promise<void> {
    if (this.finished) return;
    const bytes = await this.deps.read(index * PART_BYTES, partLength(this.size, index));
    if (bytes === null) return this.finish({ ok: false, why: 'failed' });
    this.inFlight.set(index, this.deps.now());
    this.deps.send(this.peer, { t: 'part', id: this.id, i: index, b: Buffer.from(bytes).toString('base64') });
  }

  private async seal(): Promise<void> {
    this.sealed = true;
    const sha = await this.deps.sha256();
    if (this.finished) return;
    this.deps.send(this.peer, { t: 'seal', id: this.id, sha });
  }

  private report(): void {
    this.deps.progress({
      id: this.id, peer: this.peer, name: this.name, size: this.size, direction: 'send',
      done: this.acked, total: this.total,
    });
  }

  private finish(result: TransferEnd): void {
    if (this.finished) return;
    this.finished = true;
    this.deps.end(result);
  }
}

export interface ReceiverDeps {
  /** Writes one part at its own place in the file; false when the disk refused. Parts may arrive in any order. */
  write(bytes: Uint8Array, offset: number): Promise<boolean>;
  /** sha256 of everything written so far. */
  sha256(): Promise<string>;
  /** Closes the file and moves it into place; false when it could not be finished. */
  commit(): Promise<boolean>;
  /** Drops what was written. */
  discard(): void;
  send(to: string, body: Record<string, unknown>): void;
  progress(p: TransferProgress): void;
  end(result: TransferEnd): void;
  now(): number;
}

/** How many parts may arrive between two acknowledgements: one every part would be a message per message. */
const ACK_EVERY = 16;

/**
 * One file arriving from one member. Parts may arrive in any order: each is written at its own place in the file, so a
 * lost packet costs one retransmission instead of stalling everything behind the gap (which is what made a large file
 * give up: one gap in every 32-part window, waiting a second and a half for each). `next` is the run from the start
 * that is complete, which is what the sender needs to hear; every part is written as it lands, so a 200 MB file never
 * sits in memory.
 */
export class FileReceiver {
  /** The first part that is still missing: everything below it is written. */
  private next = 0;
  /** Parts written after `next`, waiting for the gap to fill; and parts being written right now. */
  private readonly beyond = new Set<number>();
  private readonly writing = new Set<number>();
  private written = 0;
  /** `next` as it stood at the last acknowledgement: the run from the start is what the sender waits to hear about. */
  private ackedNext = 0;
  private sealedSha: string | null = null;
  private finished = false;
  private lastPart: number;

  constructor(
    private readonly deps: ReceiverDeps,
    readonly peer: string,
    readonly id: string,
    readonly name: string,
    readonly size: number,
  ) {
    this.lastPart = deps.now();
  }

  get total(): number {
    return partCount(this.size);
  }

  /** Parts written so far: what a progress bar for a file coming in counts. */
  get done(): number {
    return this.written;
  }

  /** The answer to the offer, sent before any part can arrive. */
  answer(took: boolean): void {
    this.deps.send(this.peer, { t: 'accept', to: this.peer, id: this.id, took });
    if (!took) this.finished = true;
    else this.ack();
  }

  onMessage(msg: FileMsg): void {
    if (msg.t === 'abort' && msg.id === this.id) return this.finish({ ok: false, why: 'cancelled' });
    if (msg.id !== this.id || this.finished) return;
    if (msg.t === 'part') {
      if (msg.i >= this.total) return;
      // A repeat of something already in hand needs no work, and a part already being written no second write.
      if (msg.i < this.next || this.beyond.has(msg.i) || this.writing.has(msg.i)) return;
      this.writing.add(msg.i);
      this.lastPart = this.deps.now();
      void this.take(msg.i, msg.b);
      return;
    }
    if (msg.t === 'seal') {
      this.sealedSha = msg.sha;
      void this.complete();
    }
  }

  tick(now: number): void {
    if (this.finished) return;
    if (now - this.lastPart > TRANSFER_IDLE_MS) {
      this.deps.send(this.peer, { t: 'abort', id: this.id });
      this.finish({ ok: false, why: 'lost' });
    }
  }

  cancel(): void {
    if (this.finished) return;
    this.deps.send(this.peer, { t: 'abort', id: this.id });
    this.finish({ ok: false, why: 'cancelled' });
  }

  private async take(index: number, base64: string): Promise<void> {
    const bytes = Buffer.from(base64, 'base64');
    const ok = await this.deps.write(bytes, index * PART_BYTES);
    this.writing.delete(index);
    if (this.finished) return;
    if (!ok) {
      this.deps.send(this.peer, { t: 'abort', id: this.id });
      return this.finish({ ok: false, why: 'failed' });
    }
    this.written++;
    if (index === this.next) {
      // The gap is filled: take every part behind it that already landed.
      this.next++;
      while (this.beyond.delete(this.next)) this.next++;
    } else {
      this.beyond.add(index);
    }
    // Acknowledged on how far the run from the start has moved, not on how many parts have been written: filling one
    // gap can move `next` by dozens of parts at once, and the sender is waiting to hear about exactly that.
    if (this.next - this.ackedNext >= ACK_EVERY || this.next >= this.total) this.ack();
    else this.report();
  }

  private async complete(): Promise<void> {
    const sha = await this.deps.sha256();
    const matches = this.sealedSha !== null && sha === this.sealedSha;
    const committed = matches && (await this.deps.commit());
    this.deps.send(this.peer, { t: 'finish', to: this.peer, id: this.id, ok: committed });
    if (!committed) this.deps.discard();
    this.finish(committed ? { ok: true } : { ok: false, why: matches ? 'failed' : 'mismatch' });
  }

  private ack(): void {
    this.ackedNext = this.next;
    this.deps.send(this.peer, { t: 'ack', to: this.peer, id: this.id, next: this.next });
    this.report();
  }

  private report(): void {
    this.deps.progress({
      id: this.id, peer: this.peer, name: this.name, size: this.size, direction: 'receive',
      done: this.next, total: this.total,
    });
  }

  private finish(result: TransferEnd): void {
    if (this.finished) return;
    this.finished = true;
    this.deps.end(result);
  }
}
