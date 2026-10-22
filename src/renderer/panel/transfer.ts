import { strings } from '../../shared/i18n';
import { formatSize, progressPercent, type TransferState } from '../../shared/fileShare';
import type { PanelAction } from '../../shared/ipc';
import { el } from './vote';

/** What the transfer card says, in the language in force: the same two buttons, worded for the phase. */
export interface TransferView {
  /** The line naming who and what. */
  title: string;
  /** The size, and how far along it is. */
  detail: string;
  /** 0 to 100, for the bar. */
  percent: number;
  /** True while somebody is waiting for an answer: the two buttons are offered then, and only then. */
  asking: boolean;
  take: string;
  decline: string;
  cancel: string;
  /** A finished transfer shows how it ended instead of a bar. */
  ended: boolean;
}

export function transferView(state: TransferState): TransferView {
  const t = strings(state.lang);
  const percent = progressPercent(state.done, state.total);
  const size = formatSize(state.size);
  const asking = state.phase === 'ask';
  const title =
    state.phase === 'ask' ? t.fileAskTitle(state.peerName)
      : state.phase === 'sending' ? t.fileSendTitle(state.peerName)
        : t.fileReceiveTitle(state.peerName);
  const detail = state.phase === 'done' || state.phase === 'failed'
    ? `${state.fileName} · ${size} · ${t.fileResult(state.result ?? 'failed')}`
    : `${state.fileName} · ${size} · ${percent}%`;
  return {
    title,
    detail,
    percent,
    asking,
    take: t.fileTake,
    decline: t.fileDecline,
    cancel: t.fileCancel,
    ended: state.phase === 'done' || state.phase === 'failed',
  };
}

interface Card {
  lang: string;
  root: HTMLElement;
  title: HTMLElement;
  detail: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  buttons: HTMLElement;
}

let card: Card | null = null;

/** The transfer card: an offer to answer, a bar while it moves, and how it ended. */
export function renderTransfer(root: HTMLElement, state: TransferState, act: (a: PanelAction) => void): void {
  const view = transferView(state);
  if (!card || card.root !== root || card.lang !== state.lang) {
    dropTransfer();
    root.textContent = '';
    const wrap = el('div', 'transfer-card');
    const title = el('div', 'transfer-title');
    const detail = el('div', 'transfer-detail');
    const bar = el('div', 'transfer-bar');
    const fill = el('div', 'transfer-fill');
    bar.append(fill);
    const buttons = el('div', 'transfer-buttons');
    const take = el('button', 'transfer-take', view.take);
    take.type = 'button';
    take.addEventListener('click', () => act({ t: 'takeFile', took: true }));
    const decline = el('button', 'transfer-drop', view.decline);
    decline.type = 'button';
    decline.addEventListener('click', () => act({ t: 'takeFile', took: false }));
    const cancel = el('button', 'transfer-drop', view.cancel);
    cancel.type = 'button';
    cancel.addEventListener('click', () => act({ t: 'cancelFile' }));
    buttons.append(take, decline, cancel);
    wrap.append(title, detail, bar, buttons);
    root.append(wrap);
    card = { lang: state.lang, root, title, detail, bar, fill, buttons };
  }
  card.title.textContent = view.title;
  card.detail.textContent = view.detail;
  card.fill.style.width = `${view.percent}%`;
  card.bar.hidden = view.ended;
  // Two buttons while an offer waits; one way out of a transfer that is moving; nothing once it has ended.
  card.buttons.hidden = view.ended;
  const [take, decline, cancel] = [...card.buttons.children] as HTMLButtonElement[];
  take.hidden = !view.asking;
  decline.hidden = !view.asking;
  cancel.hidden = view.asking;
  cancel.textContent = view.cancel;
}

export function dropTransfer(): void {
  card = null;
}
