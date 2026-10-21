import { describe, expect, it } from 'vitest';
import {
  answerPlacement, ANSWER_EXPANDED_SIZE, ANSWER_SIZE, centredIn, draggedTo, READY_SIZE, SURRENDER_SIZE, votePlacement,
} from '../../src/main/panelPlacement';

const area = { x: 100, y: 50, width: 1920, height: 1000 };

describe('votePlacement', () => {
  it('puts a surrender or kick widget at the right edge, 40% down', () => {
    for (const kind of ['ff', 'kick'] as const) {
      expect(votePlacement(kind, area)).toEqual({ ...SURRENDER_SIZE, x: 100 + 1920 - SURRENDER_SIZE.width - 16, y: 50 + 400 });
    }
  });

  it('centres the ready check', () => {
    expect(votePlacement('ready', area)).toEqual({ ...READY_SIZE, x: 100 + Math.round((1920 - READY_SIZE.width) / 2), y: 50 + Math.round((1000 - READY_SIZE.height) / 2) });
  });
});

describe('centredIn', () => {
  it('centres a box in a work area that does not start at the origin', () => {
    expect(centredIn({ width: 200, height: 100 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: -1060, y: 490, width: 200, height: 100 });
  });
});

describe('answerPlacement', () => {
  it('puts the card on the ping, with the small size until it is expanded', () => {
    expect(answerPlacement({ x: 960, y: 550 }, false, area)).toEqual({
      ...ANSWER_SIZE, x: 960 - Math.round(ANSWER_SIZE.width / 2), y: 550 - Math.round(ANSWER_SIZE.height / 2),
    });
    expect(answerPlacement({ x: 960, y: 550 }, true, area)).toEqual({
      ...ANSWER_EXPANDED_SIZE,
      x: 960 - Math.round(ANSWER_EXPANDED_SIZE.width / 2),
      y: 550 - Math.round(ANSWER_EXPANDED_SIZE.height / 2),
    });
  });

  it('keeps the card on screen when the ping is at an edge, in either size', () => {
    for (const expanded of [false, true]) {
      const size = expanded ? ANSWER_EXPANDED_SIZE : ANSWER_SIZE;
      const corner = answerPlacement({ x: 5, y: 5 }, expanded, area);
      expect(corner.x).toBe(area.x);
      expect(corner.y).toBe(area.y);
      const far = answerPlacement({ x: 5000, y: 5000 }, expanded, area);
      expect(far.x + size.width).toBeLessThanOrEqual(area.x + area.width);
      expect(far.y + size.height).toBeLessThanOrEqual(area.y + area.height);
    }
  });
});

describe('draggedTo', () => {
  it('moves the anchor by exactly what the pointer travelled, from where the drag began', () => {
    expect(draggedTo({ x: 800, y: 500 }, 120, -40)).toEqual({ x: 920, y: 460 });
    expect(draggedTo({ x: 800, y: 500 }, 0, 0)).toEqual({ x: 800, y: 500 });
  });

  it('rounds a fractional move, so the window never lands between pixels', () => {
    expect(draggedTo({ x: 100, y: 100 }, 10.4, -10.6)).toEqual({ x: 110, y: 89 });
  });
});
