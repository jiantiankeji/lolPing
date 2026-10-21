import { describe, expect, it } from 'vitest';
import { parsePanelAction } from '../../src/shared/ipc';

const peer = '0123456789abcdef';

describe('parsePanelAction', () => {
  it('accepts only well-formed panel actions', () => {
    expect(parsePanelAction({ t: 'alive', peer })).toEqual({ t: 'alive', peer });
    expect(parsePanelAction({ t: 'mute', peer, on: true })).toEqual({ t: 'mute', peer, on: true });
    expect(parsePanelAction({ t: 'kick', peer })).toEqual({ t: 'kick', peer });
    expect(parsePanelAction({ t: 'vote', kind: 'ff' })).toEqual({ t: 'vote', kind: 'ff' });
    expect(parsePanelAction({ t: 'vote', kind: 'ready' })).toEqual({ t: 'vote', kind: 'ready' });
    expect(parsePanelAction({ t: 'ballot', yes: false })).toEqual({ t: 'ballot', yes: false });
    expect(parsePanelAction({ t: 'cancelShutdown' })).toEqual({ t: 'cancelShutdown' });
    expect(parsePanelAction({ t: 'expandAnswer', expanded: true })).toEqual({ t: 'expandAnswer', expanded: true });
    expect(parsePanelAction({ t: 'expandAnswer', expanded: false })).toEqual({ t: 'expandAnswer', expanded: false });
    expect(parsePanelAction({ t: 'closeAnswer' })).toEqual({ t: 'closeAnswer' });
    expect(parsePanelAction({ t: 'dragAnswer', dx: -12.5, dy: 40, start: false }))
      .toEqual({ t: 'dragAnswer', dx: -12.5, dy: 40, start: false });
  });

  it('refuses anything that is not an object with a known type', () => {
    for (const raw of [null, undefined, 'alive', 7, [], {}, { t: 'quit' }, { t: 42 }]) expect(parsePanelAction(raw)).toBeNull();
  });

  it('refuses a peer that is not a 16-digit hex id', () => {
    for (const bad of ['', 'ABCDEF0123456789', '0123456789abcde', '0123456789abcdef0', 5, null]) {
      expect(parsePanelAction({ t: 'kick', peer: bad })).toBeNull();
      expect(parsePanelAction({ t: 'mute', peer: bad, on: true })).toBeNull();
      expect(parsePanelAction({ t: 'alive', peer: bad })).toBeNull();
    }
  });

  it('drops a point sent with an alive action, and refuses flags that are not booleans', () => {
    expect(parsePanelAction({ t: 'alive', peer, x: 10.5, y: 20 })).toEqual({ t: 'alive', peer });
    expect(parsePanelAction({ t: 'mute', peer, on: 1 })).toBeNull();
    expect(parsePanelAction({ t: 'expandAnswer' })).toBeNull();
    expect(parsePanelAction({ t: 'expandAnswer', expanded: 'yes' })).toBeNull();
    expect(parsePanelAction({ t: 'dragAnswer', dx: 1, dy: 2 })).toBeNull();
    expect(parsePanelAction({ t: 'dragAnswer', dx: 'a', dy: 2, start: true })).toBeNull();
    expect(parsePanelAction({ t: 'dragAnswer', dx: 1, dy: Number.NaN, start: true })).toBeNull();
    expect(parsePanelAction({ t: 'ballot', yes: 'yes' })).toBeNull();
  });

  it('refuses a vote kind that panel cannot start, and keeps only the known fields', () => {
    expect(parsePanelAction({ t: 'vote', kind: 'kick' })).toBeNull();
    expect(parsePanelAction({ t: 'vote', kind: 'remake' })).toBeNull();
    expect(parsePanelAction({ t: 'ballot', yes: true, extra: 'x' })).toEqual({ t: 'ballot', yes: true });
  });
});
