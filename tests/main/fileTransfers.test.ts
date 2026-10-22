import { describe, expect, it } from 'vitest';
import {
  FileReceiver, FileSender, type ReceiverDeps, type SenderDeps, type TransferEnd, type TransferProgress,
} from '../../src/main/fileTransfers';
import { PART_BYTES } from '../../src/shared/fileShare';
import type { FileMsg } from '../../src/shared/roomProtocol';

const PEER = '0123456789abcdef';
const ID = 'abcd1234';

/** Lets every pending await inside the state machines finish before the test looks again. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

interface Net {
  sender: FileSender;
  receiver: FileReceiver;
  /** Bytes the receiver wrote, in order. */
  written: Buffer;
  ends: { sender: TransferEnd | null; receiver: TransferEnd | null };
  progress: TransferProgress[];
  clock: { now: number };
  /** Delivers everything both sides have sent, until both are quiet. */
  run(): Promise<void>;
  /** The file as it was sent. */
  source: Buffer;
}

/**
 * A sender and a receiver wired to each other: each `send` lands in the other's inbox, and `run` keeps shuttling until
 * nothing is left. The clock is ours, so a lost part or a silent member costs no real time.
 */
function pair(size: number, autoAccept = true): Net {
  const source = Buffer.alloc(size);
  for (let i = 0; i < size; i++) source[i] = (i * 7 + 3) % 251;
  const toReceiver: FileMsg[] = [];
  const toSender: FileMsg[] = [];
  // The whole file, written at each part's own offset: a late part lands where it belongs rather than at the end.
  const written = Buffer.alloc(size);
  const progress: TransferProgress[] = [];
  const clock = { now: 1000 };
  const ends: { sender: TransferEnd | null; receiver: TransferEnd | null } = { sender: null, receiver: null };

  const senderDeps: SenderDeps = {
    read: async (offset, length) => {
      if (offset >= source.length) return null;
      return new Uint8Array(source.subarray(offset, offset + length));
    },
    sha256: async () => 'a'.repeat(64),
    send: (_to, body) => toReceiver.push(body as unknown as FileMsg),
    progress: (p) => progress.push(p),
    end: (r) => { ends.sender = r; },
    now: () => clock.now,
  };
  const receiverDeps: ReceiverDeps = {
    write: async (bytes, offset) => {
      // Written where it belongs, so the test sees the file reassembled in the right order even if parts arrive late.
      Buffer.from(bytes).copy(written, offset);
      return true;
    },
    sha256: async () => 'a'.repeat(64),
    commit: async () => true,
    discard: () => undefined,
    send: (_to, body) => toSender.push(body as unknown as FileMsg),
    progress: (p) => progress.push(p),
    end: (r) => { ends.receiver = r; },
    now: () => clock.now,
  };
  const target = Buffer.alloc(size);

  const net: Net = {
    sender: new FileSender(senderDeps, PEER, ID, 'shot.png', size),
    receiver: new FileReceiver(receiverDeps, PEER, ID, 'shot.png', size),
    written,
    ends,
    progress,
    clock,
    source,
    run: async () => {
      let quiet = 0;
      for (let round = 0; round < 400; round++) {
        const forward = toReceiver.splice(0);
        const back = toSender.splice(0);
        for (const m of forward) {
          // The offer is answered by the person, not by the machine: here that is `autoAccept`.
          if (m.t === 'offer' && autoAccept) net.receiver.answer(true);
          else net.receiver.onMessage(m);
        }
        for (const m of back) net.sender.onMessage(m);
        await settle();
        // Two quiet rounds: a resend started by `tick` lands on the queue a moment later, not within this round.
        const empty = forward.length === 0 && back.length === 0 && toReceiver.length === 0 && toSender.length === 0;
        quiet = empty ? quiet + 1 : 0;
        if (quiet >= 2) break;
      }
    },
  };
  return net;
}

describe('FileSender and FileReceiver', () => {
  it('carries a file across in parts, in order, and both sides see it done', async () => {
    const net = pair(3000);
    net.sender.offer();
    await net.run();
    expect(net.ends.sender).toEqual({ ok: true });
    expect(net.ends.receiver).toEqual({ ok: true });
    expect(net.written.equals(net.source)).toBe(true);
    expect(net.sender.total).toBe(Math.ceil(3000 / PART_BYTES));
    expect(net.progress.some((p) => p.direction === 'send')).toBe(true);
    expect(net.progress.some((p) => p.direction === 'receive')).toBe(true);
  });

  it('moves a file larger than one window without leaving parts behind', async () => {
    const size = PART_BYTES * 100 + 17; // well past the window of 32 parts
    const net = pair(size);
    net.sender.offer();
    await net.run();
    expect(net.ends.receiver).toEqual({ ok: true });
    expect(net.receiver.done).toBe(net.receiver.total);
    expect(net.written.equals(net.source)).toBe(true);
  });

  it('stops before sending anything when the member says no', async () => {
    const net = pair(3000, false);
    net.sender.offer();
    net.receiver.answer(false);
    await net.run();
    expect(net.ends.sender).toEqual({ ok: false, why: 'refused' });
    expect(net.receiver.done).toBe(0);
  });

  it('repeats a part that never arrived, then finishes', async () => {
    const net = pair(3000);
    net.sender.offer();
    // Drop one part of the first window on the floor, the way a busy LAN does.
    let dropped = false;
    const realOnMessage = net.receiver.onMessage.bind(net.receiver);
    net.receiver.onMessage = (m: FileMsg): void => {
      if (!dropped && m.t === 'part' && m.i === 1) {
        dropped = true;
        return;
      }
      realOnMessage(m);
    };
    await net.run();
    expect(dropped).toBe(true);
    // The receiver is stuck after the gap until the sender's timer repeats the missing part.
    net.clock.now += 2000;
    net.sender.tick(net.clock.now);
    await net.run();
    expect(net.ends.receiver).toEqual({ ok: true });
    expect(net.written.equals(net.source)).toBe(true);
  });

  it('writes a late part where it belongs, and counts it at once', async () => {
    // A busy LAN hands packets over out of order. The old receiver dropped anything that was not next, so one lost
    // packet stalled everything behind it; 163 MB never finished that way.
    const net = pair(3000, false);
    net.receiver.onMessage({ t: 'part', peer: PEER, seq: 1, ts: 0, id: ID, i: 1, b: 'AAAA' } as unknown as FileMsg);
    await settle();
    expect(net.receiver.done).toBe(1); // written, but the run from the start is still missing part 0
    expect(net.written.subarray(PART_BYTES, PART_BYTES + 3)).toEqual(Buffer.from('AAAA', 'base64'));
    expect(net.written.subarray(0, 3)).toEqual(Buffer.alloc(3)); // part 0 has not overwritten anything
  });

  it('costs one retransmission for a gap, not the whole window behind it', async () => {
    const net = pair(PART_BYTES * 80);
    net.sender.offer();
    // Lose the second part, then let everything after it through: only that one part should need repeating.
    let dropped = false;
    const realOnMessage = net.receiver.onMessage.bind(net.receiver);
    net.receiver.onMessage = (m: FileMsg): void => {
      if (!dropped && m.t === 'part' && m.i === 1) {
        dropped = true;
        return;
      }
      realOnMessage(m);
    };
    await net.run();
    expect(net.receiver.done).toBeGreaterThan(1); // the parts behind the gap still landed
    // The sender's own timer is what repeats the one part that went missing.
    net.clock.now += 2000;
    net.sender.tick(net.clock.now);
    await net.run();
    expect(net.ends.receiver).toEqual({ ok: true });
    expect(net.written.equals(net.source)).toBe(true);
    expect(net.receiver.done).toBe(net.receiver.total);
  });

  it('gives up on a member that stops answering', async () => {
    const net = pair(3000, false);
    net.sender.offer();
    // The member takes the offer, then goes quiet: the sender has to notice by itself.
    net.sender.onMessage({ t: 'accept', peer: PEER, seq: 1, ts: 0, id: ID, to: PEER, took: true } as unknown as FileMsg);
    await settle();
    net.clock.now += 30_000;
    net.sender.tick(net.clock.now);
    expect(net.ends.sender).toEqual({ ok: false, why: 'lost' });
  });

  it('gives up on an offer nobody answers', async () => {
    const net = pair(1500, false);
    net.sender.offer();
    net.clock.now += 31_000;
    net.sender.tick(net.clock.now);
    expect(net.ends.sender).toEqual({ ok: false, why: 'gone' });
  });

  it('lets either side call it off', async () => {
    const net = pair(3000, false);
    net.sender.offer();
    net.receiver.answer(true);
    await settle();
    net.receiver.cancel();
    await net.run();
    expect(net.ends.receiver).toEqual({ ok: false, why: 'cancelled' });
    expect(net.ends.sender).toEqual({ ok: false, why: 'cancelled' });
  });
});
