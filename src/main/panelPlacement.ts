import type { VoteKind } from '../shared/roomProtocol';
import { placeInside, type Rect } from './coords';

/** Window sizes in DIPs. A kick uses the surrender widget. */
export const SURRENDER_SIZE = { width: 223, height: 113 };
export const READY_SIZE = { width: 442, height: 452 };
export const ROSTER_SIZE = { width: 720, height: 470 };
/** The shutdown countdown: a card small enough to sit in the middle without hiding what is behind it. */
export const COUNTDOWN_SIZE = { width: 320, height: 176 };
/** The answer card: a few lines of it, and the two buttons that are always on it. */
export const ANSWER_SIZE = { width: 420, height: 128 };
/** The same card showing all of the answer, tall enough to read and to scroll. */
export const ANSWER_EXPANDED_SIZE = { width: 600, height: 440 };

const EDGE_GAP = 16;
/** How far down the display the surrender widget starts, like League's. */
const WIDGET_TOP = 0.4;

export const voteSize = (kind: VoteKind): { width: number; height: number } => (kind === 'ready' ? READY_SIZE : SURRENDER_SIZE);

/** Surrender and kick sit at the right edge, about 40% down; the ready check is centred. `area` is the primary display's work area. */
export function votePlacement(kind: VoteKind, area: Rect): Rect {
  const size = voteSize(kind);
  if (kind === 'ready') return centredIn(size, area);
  return { ...size, x: area.x + area.width - size.width - EDGE_GAP, y: area.y + Math.round(area.height * WIDGET_TOP) };
}

export function centredIn(size: { width: number; height: number }, area: Rect): Rect {
  return { ...size, x: area.x + Math.round((area.width - size.width) / 2), y: area.y + Math.round((area.height - size.height) / 2) };
}

/**
 * The answer card, centred on the point the ping was placed at and kept inside the display's work area. Expanding
 * grows it around that same point, so it does not wander off while the user reads it.
 */
export function answerPlacement(at: { x: number; y: number }, expanded: boolean, area: Rect): Rect {
  const size = expanded ? ANSWER_EXPANDED_SIZE : ANSWER_SIZE;
  const { x, y } = placeInside(
    { x: at.x - Math.round(size.width / 2), y: at.y - Math.round(size.height / 2) }, size, area,
  );
  return { ...size, x, y };
}

/** Where the card's anchor point ends up after it is dragged by `dx`, `dy` from where the drag began. */
export function draggedTo(origin: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
  return { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) };
}
