import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Wheel } from '../../src/renderer/overlay/wheel';
import { WHEEL } from '../../src/shared/geometry';

/** The SVG operations Wheel uses, without a browser. */
class FakeElement {
  id = '';
  innerHTML = '';
  textContent = '';
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  append(child: FakeElement): void {
    this.children.push(child);
  }
}

function makeWheel(id = 'wheel') {
  const svg = new FakeElement();
  svg.id = id;
  const hover = vi.fn();
  const wheel = new Wheel(svg as unknown as SVGSVGElement, 'Back', hover);
  wheel.setItems(Array.from({ length: 8 }, (_, i) => ({ key: String(i), icon: `${i}.png`, label: `L${i}` })));
  return { wheel, svg, hover };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElementNS: () => new FakeElement() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wheel size', () => {
  it.each(['wheel', 'emoteWheel'])('resizes %s around its original centre', (id) => {
    const { wheel, svg } = makeWheel(id);
    wheel.open(800, 500);
    for (const size of [300, 600, 900]) {
      wheel.setSize(size);
      expect(svg.style).toMatchObject({
        width: `${size}px`, height: `${size}px`, marginLeft: `${-size / 2}px`, marginTop: `${-size / 2}px`,
        left: '800px', top: '500px',
      });
      expect(wheel.isOpen).toBe(true);
    }
  });

  it.each([300, 600, 900])('scales hover and release dead zones at %i px', (size) => {
    const { wheel, hover } = makeWheel();
    wheel.setSize(size);
    const deadZone = WHEEL.innerR * size / 600;
    wheel.open(800, 500);
    wheel.move(800, 500 - deadZone + 1);
    expect(hover).not.toHaveBeenCalled();
    expect(wheel.release(800, 500 - deadZone + 1)).toBeNull();
    wheel.open(800, 500);
    wheel.move(800, 500 - deadZone);
    expect(hover).toHaveBeenCalledWith(0);
    expect(wheel.release(800, 500 - deadZone)).toEqual({ key: '0', x: 800, y: 500 });
    expect(wheel.isOpen).toBe(false);
  });

  it.each([300, 600, 900])('keeps all eight slices aligned at %i px', (size) => {
    const { wheel, hover } = makeWheel();
    wheel.setSize(size);
    for (let i = 0; i < 8; i++) {
      const rad = ((i * 45 - 90) * Math.PI) / 180;
      const r = WHEEL.iconR * size / 600;
      const x = 800 + r * Math.cos(rad);
      const y = 500 + r * Math.sin(rad);
      wheel.open(800, 500);
      wheel.move(x, y);
      expect(hover).toHaveBeenLastCalledWith(i);
      expect(wheel.release(x, y)).toEqual({ key: String(i), x: 800, y: 500 });
    }
  });

  it('uses a new size for a wheel that is already open', () => {
    const { wheel, hover } = makeWheel();
    wheel.open(800, 500);
    wheel.move(800, 400);
    expect(hover).toHaveBeenCalledWith(0);
    wheel.setSize(900);
    wheel.move(800, 400);
    expect(wheel.release(800, 400)).toBeNull();
  });

  it('still cancels after resizing', () => {
    const { wheel, svg } = makeWheel();
    wheel.setSize(300);
    wheel.open(800, 500);
    wheel.move(800, 400);
    wheel.cancel();
    expect(wheel.isOpen).toBe(false);
    expect(svg.classes.has('open')).toBe(false);
    expect(wheel.release(800, 400)).toBeNull();
  });
});

describe('wheel centre', () => {
  it('keeps nothing in the middle until the pointer is on a slice', () => {
    const { wheel, svg } = makeWheel();
    const hub = (): FakeElement | undefined => svg.children.find((c) => c.attrs.get('class') === 'hub');
    const centre = (): string =>
      svg.children.find((c) => c.attrs.get('class') === 'centerTxt')?.textContent ?? '';
    expect(hub()?.attrs.has('href')).toBe(false);
    expect(centre()).toBe('');
    wheel.open(0, 0);
    expect(hub()?.attrs.has('href')).toBe(false);
  });

  it('shows the slice under the pointer, icon and name, and empties again when it closes', () => {
    const { wheel, svg } = makeWheel();
    const hub = (): FakeElement | undefined => svg.children.find((c) => c.attrs.get('class') === 'hub');
    const centre = (): string =>
      svg.children.find((c) => c.attrs.get('class') === 'centerTxt')?.textContent ?? '';
    wheel.open(0, 0);
    wheel.move(0, -((WHEEL.innerR + WHEEL.outerR) / 2)); // straight up: the first slice
    expect(hub()?.attrs.get('href')).toBe('0.png');
    expect(centre()).toBe('L0');
    wheel.cancel();
    expect(hub()?.attrs.has('href')).toBe(false);
    expect(centre()).toBe('');
  });

  it('goes back to bare in the dead zone, the way League does', () => {
    const { wheel, svg } = makeWheel();
    const hub = (): FakeElement | undefined => svg.children.find((c) => c.attrs.get('class') === 'hub');
    const centre = (): string =>
      svg.children.find((c) => c.attrs.get('class') === 'centerTxt')?.textContent ?? '';
    wheel.open(0, 0);
    wheel.move(0, -((WHEEL.innerR + WHEEL.outerR) / 2));
    expect(centre()).toBe('L0');
    wheel.move(0, 0); // the middle: nothing would be placed
    expect(hub()?.attrs.has('href')).toBe(false);
    expect(centre()).toBe('');
  });

  it('cuts a long name so it cannot run past the ring', () => {
    const { wheel, svg } = makeWheel();
    wheel.setItems([
      { key: 'long', icon: 'long.png', label: 'Upside-down Missing' },
      ...Array.from({ length: 7 }, (_, i) => ({ key: String(i), icon: `${i}.png`, label: `L${i}` })),
    ]);
    const centre = (): string =>
      svg.children.find((c) => c.attrs.get('class') === 'centerTxt')?.textContent ?? '';
    wheel.open(0, 0);
    wheel.move(0, -((WHEEL.innerR + WHEEL.outerR) / 2));
    expect(centre()).toHaveLength(14);
    expect(centre().endsWith('…')).toBe(true);
  });
});
