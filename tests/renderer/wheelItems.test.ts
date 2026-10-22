import { describe, expect, it } from 'vitest';
import { emoteItem, pingItem } from '../../src/renderer/overlay/wheelItems';
import { customStillUrl, emoteIconUrl } from '../../src/shared/emotes';
import { FALLBACK_TEXTURE, pingById, textureUrl } from '../../src/shared/pings';

const HASH = 'a'.repeat(32);
const custom = [{ id: `c:${HASH}`, name: 'Mine', animated: false }];

describe('wheelItems', () => {
  it('gives a ping slice its icon and the name the middle of the wheel shows', () => {
    const push = pingById('push');
    expect(push).not.toBeUndefined();
    expect(pingItem(push!, 'Send a file')).toEqual({ key: 'push', icon: textureUrl(push!.icon), label: 'Send a file' });
  });

  it('gives a bundled emote slice its icon and its name', () => {
    expect(emoteItem('poro_snax', [], 'Poro Snax')).toEqual({
      key: 'poro_snax', icon: emoteIconUrl('poro_snax'), label: 'Poro Snax',
    });
  });

  it("shows an imported emote's still", () => {
    expect(emoteItem(`c:${HASH}`, custom, 'Mine').icon).toBe(customStillUrl(HASH));
  });

  it('falls back to the generic ping for an emote this app does not know, and keeps its name', () => {
    const unknown = emoteItem(`c:${'b'.repeat(32)}`, custom, 'Theirs');
    expect(unknown.icon).toBe(textureUrl(FALLBACK_TEXTURE));
    expect(unknown.label).toBe('Theirs');
  });
});
