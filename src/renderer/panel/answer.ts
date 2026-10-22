import { strings } from '../../shared/i18n';
import type { AnswerState, PanelAction } from '../../shared/ipc';
import { renderMarkdown } from './markdownDom';
import { el } from './vote';

/** What the card says, in the language in force: its buttons, and where it stands in the history. */
export interface AnswerView {
  title: string;
  close: string;
  expand: string;
  /** Says the title bar can be dragged, so nobody has to guess how the card moves. */
  drag: string;
  /** "Show all" / "Show less" state, for the CSS as well as the button. */
  expanded: boolean;
  /** The follow-up button, and the two that page through what was asked before. */
  followUp: string;
  older: string;
  newer: string;
  /** "2 / 7": which answer of how many is on show. */
  position: string;
  /** There is something older to show, and something newer. */
  canOlder: boolean;
  canNewer: boolean;
}

export function answerView(state: Pick<AnswerState, 'lang' | 'expanded' | 'index' | 'count'>): AnswerView {
  const t = strings(state.lang);
  const count = Math.max(1, state.count);
  const index = Math.min(Math.max(0, state.index), count - 1);
  return {
    title: t.aiAnswerTitle,
    close: t.aiClose,
    expand: state.expanded ? t.aiCollapse : t.aiExpand,
    drag: t.aiDrag,
    expanded: state.expanded,
    followUp: t.aiFollowUp,
    older: t.aiTurnOlder,
    newer: t.aiTurnNewer,
    position: t.aiTurnOf(index + 1, count),
    canOlder: index < count - 1,
    canNewer: index > 0,
  };
}

interface Card {
  lang: string;
  text: string;
  root: HTMLElement;
  body: HTMLElement;
  expand: HTMLButtonElement;
  followUp: HTMLButtonElement;
  older: HTMLButtonElement;
  newer: HTMLButtonElement;
  position: HTMLElement;
  expanded: boolean;
  index: number;
}

/** The card on screen, so expanding it does not rebuild the text the user is in the middle of reading. */
let card: Card | null = null;

/** Whether this state needs a new card: a different answer, language or window. Expanding only rewords a button. */
export function needsRebuild(
  card: { lang: string; text: string } | null,
  next: { lang: string; text: string },
): boolean {
  return card === null || card.lang !== next.lang || card.text !== next.text;
}

/**
 * The AI answer. The text goes in whole and untouched — the window is what is small, not the answer — and the two
 * buttons are always there: one gives all of it (or puts it back), the other takes the card away.
 */
export function renderAnswer(root: HTMLElement, state: AnswerState, act: (a: PanelAction) => void): void {
  const view = answerView(state);
  // `card === null` first, so the compiler knows the state below is one with a card on screen.
  if (card === null || needsRebuild(card, state)) {
    dropAnswer();
    // A rebuild replaces the card: appending to the old one would stack a full-height card below it, out of the window,
    // and the user would keep reading the answer before this one.
    root.textContent = '';
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
    const followUp = el('button', 'answer-follow', view.followUp);
    followUp.type = 'button';
    followUp.addEventListener('click', () => act({ t: 'followUp' }));
    // Paging through what was asked before, newest first: "older" walks back into the history.
    const pager = el('div', 'answer-pager');
    const older = el('button', 'answer-step', '‹');
    older.type = 'button';
    older.title = view.older;
    older.setAttribute('aria-label', view.older);
    older.addEventListener('click', () => act({ t: 'answerTurn', index: (card?.index ?? 0) + 1 }));
    const position = el('span', 'answer-count', view.position);
    const newer = el('button', 'answer-step', '›');
    newer.type = 'button';
    newer.title = view.newer;
    newer.setAttribute('aria-label', view.newer);
    newer.addEventListener('click', () => act({ t: 'answerTurn', index: (card?.index ?? 0) - 1 }));
    pager.append(older, position, newer);
    const expand = el('button', 'answer-expand');
    expand.type = 'button';
    expand.addEventListener('click', () => act({ t: 'expandAnswer', expanded: !card?.expanded }));
    foot.append(followUp, pager, expand);
    wrap.append(head, body, foot);
    root.append(wrap);
    // The title text is the handle: the ✕ beside it must keep taking its own clicks.
    dragToMove(title, act);
    card = {
      lang: state.lang, text: state.text, root, body, expand, followUp, older, newer, position,
      expanded: state.expanded, index: state.index,
    };
  }
  card.expanded = view.expanded;
  card.index = state.index;
  card.body.classList.toggle('expanded', view.expanded);
  card.expand.textContent = view.expand;
  card.position.textContent = view.position;
  card.older.disabled = !view.canOlder;
  card.newer.disabled = !view.canNewer;
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
