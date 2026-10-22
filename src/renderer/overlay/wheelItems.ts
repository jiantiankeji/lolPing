import { catalogEmote, customHash, customStillUrl, emoteIconUrl, type EmoteRef } from '../../shared/emotes';
import { FALLBACK_TEXTURE, textureUrl, type PingDef } from '../../shared/pings';
import type { OverlaySettings } from '../../shared/settings';
import type { WheelItem } from './wheel';

const UNKNOWN_ICON = textureUrl(FALLBACK_TEXTURE);

/** A slot's icon and the name the middle of the wheel shows while the pointer is on it. */
export const pingItem = (p: PingDef, label: string): WheelItem => ({ key: p.id, icon: textureUrl(p.icon), label });

/** A wheel slot's icon: the bundled emote's, the imported emote's still, or the generic ping for one that isn't known. */
export function emoteItem(ref: EmoteRef, customEmotes: OverlaySettings['customEmotes'], label: string): WheelItem {
  if (catalogEmote(ref)) return { key: ref, icon: emoteIconUrl(ref), label };
  if (customEmotes.some((c) => c.id === ref)) return { key: ref, icon: customStillUrl(customHash(ref)), label };
  return { key: ref, icon: UNKNOWN_ICON, label };
}
