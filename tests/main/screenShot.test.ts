import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureDisplay, captureSize, pickScreenSource } from '../../src/main/screenShot';

type Thumb = { isEmpty(): boolean; toJPEG(quality: number): Uint8Array };
type Source = { display_id: string; thumbnail: Thumb };

const h = vi.hoisted(() => ({
  displays: [
    { id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 },
    { id: 2, size: { width: 2560, height: 1440 }, scaleFactor: 2 },
  ],
  sizes: [] as Array<{ width: number; height: number }>,
  sources: [] as Source[],
  fail: false,
}));

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => h.displays, getPrimaryDisplay: () => h.displays[0] },
  desktopCapturer: {
    getSources: async (opts: { thumbnailSize: { width: number; height: number } }) => {
      h.sizes.push(opts.thumbnailSize);
      if (h.fail) throw new Error('no screen recording permission');
      return h.sources;
    },
  },
}));

const thumb = (bytes = new Uint8Array([9, 9]), empty = false): Thumb => ({
  isEmpty: () => empty,
  toJPEG: (quality) => {
    expect(quality).toBeGreaterThan(0);
    return bytes;
  },
});

describe('captureSize', () => {
  it('keeps a screenshot within the width DeepSeek would shrink to anyway', () => {
    expect(captureSize({ width: 5120, height: 2880 })).toEqual({ width: 1280, height: 720 });
    expect(captureSize({ width: 2560, height: 1440 })).toEqual({ width: 1280, height: 720 });
  });

  it('never blows a small display up', () => {
    expect(captureSize({ width: 1024, height: 768 })).toEqual({ width: 1024, height: 768 });
  });
});

describe('pickScreenSource', () => {
  it('picks the source of the display the ping is on', () => {
    const sources = [{ display_id: '1' }, { display_id: '2' }];
    expect(pickScreenSource(sources, 2)).toEqual({ display_id: '2' });
  });

  it('takes the only source when the platform reports no display ids', () => {
    expect(pickScreenSource([{ display_id: '' }], 7)).toEqual({ display_id: '' });
  });

  it('follows the display order when no source reports an id at all', () => {
    const sources = [{ display_id: '', n: 1 }, { display_id: '', n: 2 }];
    expect(pickScreenSource(sources, 2, 1)).toEqual({ display_id: '', n: 2 });
    expect(pickScreenSource(sources, 9, 0)).toEqual({ display_id: '', n: 1 });
  });

  it('picks nothing rather than another display when there is a choice to make', () => {
    expect(pickScreenSource([{ display_id: '5' }, { display_id: '6' }], 1)).toBeNull();
    expect(pickScreenSource([], 1)).toBeNull();
  });
});

describe('captureDisplay', () => {
  beforeEach(() => {
    h.sizes.length = 0;
    h.fail = false;
    h.sources = [{ display_id: '2', thumbnail: thumb() }];
  });

  it('asks for the display at its pixel size and returns a JPEG', async () => {
    expect(await captureDisplay(2)).toEqual(new Uint8Array([9, 9]));
    expect(h.sizes).toEqual([{ width: 1280, height: 720 }]);
  });

  it('returns nothing when the platform hands over an empty picture', async () => {
    h.sources = [{ display_id: '2', thumbnail: thumb(undefined, true) }];
    expect(await captureDisplay(2)).toBeNull();
  });

  it('returns nothing instead of throwing when the capturer refuses', async () => {
    h.fail = true;
    expect(await captureDisplay(2)).toBeNull();
  });
});
