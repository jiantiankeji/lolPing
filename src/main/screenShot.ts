import { desktopCapturer, screen } from 'electron';

/** DeepSeek scales a screenshot down to about 1300 px anyway; a wider one only costs upload time. */
export const CAPTURE_MAX_WIDTH = 1280;

/** The size to ask desktopCapturer for: a display's pixel size, scaled down to CAPTURE_MAX_WIDTH. */
export function captureSize(pixels: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, CAPTURE_MAX_WIDTH / Math.max(1, pixels.width));
  return { width: Math.max(1, Math.round(pixels.width * scale)), height: Math.max(1, Math.round(pixels.height * scale)) };
}

/**
 * The capturer source that shows `displayId`. Platforms that report no `display_id` (macOS) list the sources in the
 * order `screen.getAllDisplays()` uses, so `orderIndex` picks the same display there; a lone source stands for it too.
 */
export function pickScreenSource<T extends { display_id: string }>(
  sources: readonly T[], displayId: number, orderIndex = 0,
): T | null {
  const match = sources.find((s) => s.display_id === String(displayId));
  if (match) return match;
  if (sources.every((s) => s.display_id === '')) return sources[orderIndex] ?? sources[0] ?? null;
  return sources.length === 1 ? sources[0] : null;
}

/** A JPEG of that display, or null when the OS gave nothing back: no permission, or no such display. */
export async function captureDisplay(displayId: number): Promise<Uint8Array | null> {
  const displays = screen.getAllDisplays();
  const orderIndex = Math.max(0, displays.findIndex((d) => d.id === displayId));
  const display = displays[orderIndex] ?? screen.getPrimaryDisplay();
  const size = captureSize({
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  });
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const source = pickScreenSource(sources, displayId, orderIndex);
    if (!source || source.thumbnail.isEmpty()) return null;
    return source.thumbnail.toJPEG(85);
  } catch (err) {
    // macOS without screen recording permission, or a Linux session without a capturable display.
    console.warn('[ai] screenshot failed', err);
    return null;
  }
}
