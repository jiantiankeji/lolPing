import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import type { Lang, Strings } from '../shared/i18n';
import {
  FILE_MAX_BYTES, formatSize, sanitizeFileName, withinLimit, type TransferResult, type TransferState,
} from '../shared/fileShare';
import type { FileMsg } from '../shared/roomProtocol';
import { FileReceiver, FileSender, type TransferEnd } from './fileTransfers';

export interface FileSharesDeps {
  lang(): Lang;
  text(): Strings;
  /** One transfer message, to one member, over the local network. */
  send(peer: string, body: Record<string, unknown>): void;
  /** Draws the card; null takes it away. */
  show(state: TransferState | null): void;
  toast(title: string, body: string): void;
  /** Whoever is in the room: one of them gets the file. */
  members(): Array<{ peer: string; name: string }>;
  /** Asks which member should get it, when there is a choice; null cancels. */
  pickMember(): Promise<string | null>;
  /** Asks which file to send; null cancels. */
  pickFile(): Promise<{ path: string; name: string } | null>;
  /** Asks where to put what arrives; null cancels. */
  pickSave(name: string): Promise<string | null>;
  now(): number;
  newId(): string;
}

/** How long a finished card stays before it takes itself away. */
const CARD_MS = 4000;

const sha256Of = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });

/**
 * One file at a time, either going out or coming in. It owns the dialogs and the file handles; the wire protocol and
 * the pacing live in `fileTransfers.ts`, which knows nothing about Electron or the disk.
 */
export class FileShares {
  private outgoing: { sender: FileSender; handle: FileHandle; peerName: string; result: TransferResult | null } | null = null;
  private incoming: {
    receiver: FileReceiver;
    handle: FileHandle | null;
    temp: string;
    target: string;
    peerName: string;
    result: TransferResult | null;
  } | null = null;
  private hideTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: FileSharesDeps) {}

  /** The ping landed: choose who gets it and what to send, then offer it. */
  async start(): Promise<void> {
    const t = this.deps.text();
    if (this.busy()) {
      this.deps.toast(t.fileBusy, '');
      return;
    }
    const members = this.deps.members();
    if (members.length === 0) {
      this.deps.toast(t.fileNobody, t.fileNobodyBody);
      return;
    }
    const peer = members.length === 1 ? members[0].peer : await this.deps.pickMember();
    if (peer === null) return;
    const who = members.find((m) => m.peer === peer);
    const picked = await this.deps.pickFile();
    if (picked === null) return;
    const info = await stat(picked.path).catch(() => null);
    if (!info || !info.isFile()) {
      this.deps.toast(t.fileGone, picked.name);
      return;
    }
    if (!withinLimit(info.size)) {
      this.deps.toast(t.fileTooBig, t.fileTooBigBody(formatSize(FILE_MAX_BYTES)));
      return;
    }
    const handle = await open(picked.path, 'r').catch(() => null);
    if (!handle) {
      this.deps.toast(t.fileGone, picked.name);
      return;
    }
    const name = sanitizeFileName(picked.name);
    const sender = new FileSender({
      read: async (offset, length) => {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return bytesRead === 0 ? null : new Uint8Array(buffer.subarray(0, bytesRead));
      },
      sha256: () => sha256Of(picked.path),
      send: (to, body) => this.deps.send(to, body),
      progress: () => this.publish(),
      end: (result) => void this.endOut(result),
      now: () => this.deps.now(),
    }, peer, this.deps.newId(), name, info.size);
    this.outgoing = { sender, handle, peerName: who?.name ?? '', result: null };
    sender.offer();
    this.publish();
  }

  /** Every message a member sends about a file lands here. */
  onMessage(peer: string, peerName: string, msg: FileMsg): void {
    if (msg.t === 'offer') return void this.takeOffer(peer, peerName, msg);
    const out = this.outgoing;
    if (out && peer === out.sender.peer) {
      out.sender.onMessage(msg);
      return;
    }
    const incoming = this.incoming;
    if (incoming && peer === incoming.receiver.peer) incoming.receiver.onMessage(msg);
  }

  /** A click on the card: take what is offered, or call the whole thing off. */
  onAction(action: { t: 'takeFile'; took: boolean } | { t: 'cancelFile' }): void {
    if (action.t === 'cancelFile') {
      this.outgoing?.sender.cancel();
      this.incoming?.receiver.cancel();
      return;
    }
    const incoming = this.incoming;
    if (!incoming || incoming.result !== null) return;
    if (!action.took) {
      incoming.receiver.answer(false);
      return;
    }
    void this.acceptIncoming(incoming);
  }

  /** Time moves: the senders repeat what went missing and give up on members that have gone. */
  tick(): void {
    const now = this.deps.now();
    this.outgoing?.sender.tick(now);
    this.incoming?.receiver.tick(now);
  }

  dispose(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    void this.dropOut();
    void this.dropIncoming();
  }

  private busy(): boolean {
    if (this.outgoing && this.outgoing.result === null) return true;
    return this.incoming !== null && this.incoming.result === null;
  }

  private async takeOffer(peer: string, peerName: string, msg: Extract<FileMsg, { t: 'offer' }>): Promise<void> {
    const t = this.deps.text();
    if (this.busy()) {
      // Two at once would be two cards and two files: the second simply does not start.
      this.deps.send(peer, { t: 'abort', id: msg.id });
      return;
    }
    const name = sanitizeFileName(msg.name);
    if (!withinLimit(msg.size)) {
      this.deps.send(peer, { t: 'abort', id: msg.id });
      return;
    }
    this.incoming = {
      receiver: new FileReceiver({
        write: async (bytes, offset) => {
          const handle = this.incoming?.handle;
          if (!handle) return false;
          return handle.write(bytes, 0, bytes.length, offset).then(() => true).catch(() => false);
        },
        sha256: async () => {
          const current = this.incoming;
          if (!current) return '';
          await current.handle?.sync().catch(() => undefined);
          return current.temp === '' ? '' : sha256Of(current.temp);
        },
        commit: async () => {
          const current = this.incoming;
          if (!current) return false;
          await current.handle?.close().catch(() => undefined);
          return rename(current.temp, current.target).then(() => true).catch(() => false);
        },
        discard: () => {
          const current = this.incoming;
          if (!current) return;
          void current.handle?.close().catch(() => undefined).then(() => rm(current.temp, { force: true }));
        },
        send: (to, body) => this.deps.send(to, body),
        progress: () => this.publish(),
        end: (result) => void this.endIncoming(result),
        now: () => this.deps.now(),
      }, peer, msg.id, name, msg.size),
      // The handle waits for the answer: the user picks where it goes before a byte is written.
      handle: null,
      temp: '',
      target: '',
      peerName,
      result: null,
    };
    this.publish(t.fileAskTitle(peerName));
  }

  private async acceptIncoming(incoming: NonNullable<FileShares['incoming']>): Promise<void> {
    const t = this.deps.text();
    const target = await this.deps.pickSave(incoming.receiver.name);
    if (target === null) {
      incoming.receiver.answer(false);
      return;
    }
    const temp = `${target}.lolping-part`;
    const handle = await open(temp, 'w').catch(() => null);
    if (!handle) {
      this.deps.toast(t.fileSaveFailed, incoming.receiver.name);
      incoming.receiver.answer(false);
      return;
    }
    incoming.handle = handle;
    incoming.temp = temp;
    incoming.target = target;
    incoming.receiver.answer(true);
    this.publish();
  }

  private async endOut(result: TransferEnd): Promise<void> {
    const out = this.outgoing;
    if (!out) return;
    out.result = result.ok ? 'ok' : result.why;
    await out.handle.close().catch(() => undefined);
    this.publish();
    this.scheduleHide();
  }

  private async endIncoming(result: TransferEnd): Promise<void> {
    const incoming = this.incoming;
    if (!incoming) return;
    incoming.result = result.ok ? 'ok' : result.why;
    if (!result.ok) {
      await incoming.handle?.close().catch(() => undefined);
      if (incoming.temp !== '') await rm(incoming.temp, { force: true }).catch(() => undefined);
    }
    this.publish();
    this.scheduleHide();
  }

  private async dropOut(): Promise<void> {
    const out = this.outgoing;
    this.outgoing = null;
    if (out) await out.handle.close().catch(() => undefined);
  }

  private async dropIncoming(): Promise<void> {
    const incoming = this.incoming;
    this.incoming = null;
    if (!incoming) return;
    await incoming.handle?.close().catch(() => undefined);
    if (incoming.temp !== '') await rm(incoming.temp, { force: true }).catch(() => undefined);
  }

  /** Puts the current state on the card: the offer waiting for an answer, or how far a transfer has got. */
  private publish(askTitle?: string): void {
    const incoming = this.incoming;
    const out = this.outgoing;
    const peerName = incoming?.peerName ?? out?.peerName ?? '';
    if (incoming) {
      const receiver = incoming.receiver;
      const finished = incoming.result !== null;
      this.deps.show({
        view: 'transfer',
        lang: this.deps.lang(),
        phase: finished ? (incoming.result === 'ok' ? 'done' : 'failed') : incoming.handle ? 'receiving' : 'ask',
        peerName,
        fileName: receiver.name,
        size: receiver.size,
        done: receiver.done,
        total: receiver.total,
        ...(incoming.result === null ? {} : { result: incoming.result }),
      });
      if (incoming.handle === null && askTitle !== undefined) this.announce(askTitle, receiver.name, receiver.size);
      return;
    }
    if (out) {
      const sender = out.sender;
      const finished = out.result !== null;
      this.deps.show({
        view: 'transfer',
        lang: this.deps.lang(),
        phase: finished ? (out.result === 'ok' ? 'done' : 'failed') : 'sending',
        peerName,
        fileName: sender.name,
        size: sender.size,
        done: sender.done,
        total: sender.total,
        ...(out.result === null ? {} : { result: out.result }),
      });
      return;
    }
    this.deps.show(null);
  }

  private announce(title: string, name: string, size: number): void {
    this.deps.toast(title, `${name} · ${formatSize(size)}`);
  }

  private scheduleHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      void this.dropOut();
      void this.dropIncoming();
      this.deps.show(null);
    }, CARD_MS);
  }
}
