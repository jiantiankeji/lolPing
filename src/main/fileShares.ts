import { stat } from 'node:fs/promises';
import type { Lang, Strings } from '../shared/i18n';
import {
  FILE_MAX_BYTES, formatSize, sanitizeFileName, withinLimit, type TransferResult, type TransferState,
} from '../shared/fileShare';
import { FileListener, sendFileTo } from './fileTcp';

/** What the card needs is in `TransferState`; this is what the app hands the transfer when it starts. */
export interface FileSharesDeps {
  lang(): Lang;
  text(): Strings;
  /** Where a file for this member goes: their LAN address and the port their listener announced. */
  target(peer: string): { host: string; port: number } | null;
  /** The room's message key: the TCP frames are sealed with it, so only this room can read the stream. */
  key(): Buffer | null;
  /** Draws the card; null takes it away. */
  show(state: TransferState | null): void;
  toast(title: string, body: string): void;
  members(): Array<{ peer: string; name: string }>;
  /** Asks which member should get it, when there is a choice; null cancels. */
  pickMember(): Promise<string | null>;
  /** Asks which file to send; null cancels. */
  pickFile(): Promise<{ path: string; name: string } | null>;
  /** Asks where to put what arrives; null refuses it. */
  pickSave(name: string): Promise<string | null>;
}

/** How long a finished card stays before it takes itself away. */
const CARD_MS = 4000;

/**
 * One file at a time, either going out or coming in, over a TCP connection between two members of the room. The socket
 * work lives in `fileTcp.ts`; this decides what to send, what to show, and when the card goes away.
 */
export class FileShares {
  private listener: FileListener | null = null;
  private out: {
    peerName: string;
    name: string;
    size: number;
    sent: number;
    abort: AbortController;
    result: TransferResult | null;
  } | null = null;
  private incoming: {
    name: string;
    size: number;
    got: number;
    asking: boolean;
    result: TransferResult | null;
  } | null = null;
  private hideTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: FileSharesDeps) {}

  /** Starts the listener on the room's key and returns the port to announce in our presence. */
  async listen(key: Buffer): Promise<number> {
    this.stop();
    this.listener = new FileListener({
      key,
      pickSave: async (name, size) => {
        const safe = sanitizeFileName(name);
        this.incoming = { name: safe, size, got: 0, asking: true, result: null };
        this.publish();
        const target = await this.deps.pickSave(safe);
        if (this.incoming) this.incoming.asking = false;
        return target;
      },
      onProgress: (p) => {
        if (!this.incoming) return;
        this.incoming.got = p.bytes;
        this.publish();
      },
      onEnd: (result) => this.endIncoming(result.ok ? 'ok' : result.why),
    });
    return this.listener.listen(0);
  }

  stop(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.listener?.close();
    this.listener = null;
    this.out?.abort.abort();
    this.out = null;
    this.incoming = null;
  }

  /** The ping landed: choose who gets it and what to send, then hand it to the socket. */
  async start(): Promise<void> {
    const t = this.deps.text();
    if (this.busy()) {
      this.deps.toast(t.fileBusy, '');
      return;
    }
    const key = this.deps.key();
    if (key === null) {
      this.deps.toast(t.fileNobody, t.fileNobodyBody);
      return;
    }
    const members = this.deps.members();
    if (members.length === 0) {
      this.deps.toast(t.fileNobody, t.fileNobodyBody);
      return;
    }
    const peer = members.length === 1 ? members[0].peer : await this.deps.pickMember();
    if (peer === null) return;
    const target = this.deps.target(peer);
    if (!target) {
      // Over a relay, or an app that predates files: there is no socket to open.
      this.deps.toast(t.fileNoLan, t.fileNoLanBody);
      return;
    }
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
    const name = sanitizeFileName(picked.name);
    const abort = new AbortController();
    this.out = { peerName: who?.name ?? '', name, size: info.size, sent: 0, abort, result: null };
    this.publish();
    const result = await sendFileTo(
      { host: target.host, port: target.port, key, path: picked.path, name, signal: abort.signal },
      (p) => {
        if (!this.out) return;
        this.out.sent = p.bytes;
        this.publish();
      },
    );
    const why = result.ok ? 'ok' : result.why ?? 'failed';
    this.endOutgoing(why);
  }

  /** A click on the card: call the transfer off. */
  cancel(): void {
    if (this.out && this.out.result === null) {
      this.out.abort.abort();
      return;
    }
    this.listener?.cancel();
  }

  dispose(): void {
    this.stop();
    this.deps.show(null);
  }

  private busy(): boolean {
    if (this.out && this.out.result === null) return true;
    return this.incoming !== null && this.incoming.result === null;
  }

  private endOutgoing(why: TransferResult): void {
    if (!this.out) return;
    this.out.result = why;
    this.publish();
    this.scheduleHide();
  }

  private endIncoming(why: TransferResult): void {
    if (!this.incoming) return;
    this.incoming.result = why;
    this.publish();
    this.scheduleHide();
  }

  private publish(): void {
    const lang = this.deps.lang();
    const out = this.out;
    if (out) {
      const finished = out.result !== null;
      this.deps.show({
        view: 'transfer',
        lang,
        phase: finished ? (out.result === 'ok' ? 'done' : 'failed') : 'sending',
        peerName: out.peerName,
        fileName: out.name,
        size: out.size,
        done: out.sent,
        total: out.size,
        ...(finished ? { result: out.result as TransferResult } : {}),
      });
      return;
    }
    const incoming = this.incoming;
    if (incoming) {
      const finished = incoming.result !== null;
      this.deps.show({
        view: 'transfer',
        lang,
        phase: finished ? (incoming.result === 'ok' ? 'done' : 'failed') : incoming.asking ? 'ask' : 'receiving',
        peerName: '',
        fileName: incoming.name,
        size: incoming.size,
        done: incoming.got,
        total: incoming.size,
        ...(finished ? { result: incoming.result as TransferResult } : {}),
      });
      return;
    }
    this.deps.show(null);
  }

  private scheduleHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.out = null;
      this.incoming = null;
      this.deps.show(null);
    }, CARD_MS);
  }
}
