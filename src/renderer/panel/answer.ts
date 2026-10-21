import { strings } from '../../shared/i18n';
import type { AnswerState, PanelAction } from '../../shared/ipc';
import { renderMarkdown } from './markdownDom';
import { el } from './vote';

/** What the card says, in the language in force: the same two buttons in both states, worded for the state. */
export interface AnswerView {
  title: string;
  close: string;
  expand: string;
  /** Says the title bar can be dragged, so nobody has to guess how the card moves. */
  drag: string;
  expanded: boolean;
}

export function answerView(state: Pick<AnswerState, 'lang' | 'expanded'>): AnswerView {
  const t = strings(state.lang);
  return {
    title: t.aiAnswerTitle,
    close: t.aiClose,
    expand: state.expanded ? t.aiCollapse : t.aiExpand,
    drag: t.aiDrag,
    expanded: state.expanded,
  };
}

interface Card {
  lang: string;
  text: string;
  root: HTMLElement;
  body: HTMLElement;
  expand: HTMLButtonElement;
  expanded: boolean;
}

/** The card on screen, so expanding it does not rebuild the text the user is in the middle of reading. */
let card: Card | null = null;

/**
 * The AI answer. The text goes in whole and untouched — the window is what is small, not the answer — and the two
 * buttons are always there: one gives all of it (or puts it back), the other takes the card away.
 */
export function renderAnswer(root: HTMLElement, state: AnswerState, act: (a: PanelAction) => void): void {
  const view = answerView(state);
  if (!card || card.root !== root || card.lang !== state.lang || card.text !== state.text) {
    dropAnswer();
    const wrap = el('div', 'answer-card');
    const head = el('div', 'answer-head');
    head.title = view.drag;
    const close = el('button', 'answer-close', '✕');
    close.type = 'button';
    close.title = view.close;
    close.setAttribute('aria-label', view.close);
    close.addEventListener('click', () => act({ t: 'closeAnswer' }));
    const title = el('div', 'answer-title', view.title);
    head.append(title, close);
    const body = el('div', 'answer-text');
    renderMarkdown(body, state.text);
    const foot = el('div', 'answer-foot');
    const expand = el('button', 'answer-expand');
    expand.type = 'button';
    expand.addEventListener('click', () => act({ t: 'expandAnswer', expanded: !card?.expanded }));
    foot.append(expand);
    wrap.append(head, body, foot);
    root.append(wrap);
    // The title text is the handle: the ✕ beside it must keep taking its own clicks.
    dragToMove(title, act);
    card = { lang: state.lang, text: state.text, root, body, expand, expanded: state.expanded };
  }
  card.expanded = view.expanded;
  card.body.classList.toggle('expanded', view.expanded);
  card.expand.textContent = view.expand;
}

/**
 * Whether a press starts a drag: the left button, on the title bar, and never on a control that sits on it. A press on
 * a button has to stay a click — capturing the pointer there would send the button's own click to the title bar, which
 * is exactly how a close button stops closing.
 */
export function startsDrag(button: number, onControl: boolean): boolean {
  return button === 0 && !onControl;
}

/**
 * A press starts either a drag or a click, never both. `grip` is the title text, not the whole bar: the ✕ beside it
 * keeps taking its own clicks.
 */
function dragToMove(grip: HTMLElement, act: (a: PanelAction) => void): void {
  grip.addEventListener('pointerdown', (e) => {
    const onControl = e.target instanceof Element && e.target.closest('button') !== null;
    if (!startsDrag(e.button, onControl)) return;
    e.preventDefault();
    const fromX = e.screenX;
    const fromY = e.screenY;
    grip.setPointerCapture(e.pointerId);
    act({ t: 'dragAnswer', dx: 0, dy: 0, start: true });
    let frame = 0;
    let pending: { dx: number; dy: number } | null = null;
    const send = (): void => {
      if (pending) act({ t: 'dragAnswer', dx: pending.dx, dy: pending.dy, start: false });
      pending = null;
    };
    const move = (ev: PointerEvent): void => {
      pending = { dx: ev.screenX - fromX, dy: ev.screenY - fromY };
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          send();
        });
      }
    };
    const end = (): void => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
        send();
      }
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });
}

export function dropAnswer(): void {
  card = null;
}
