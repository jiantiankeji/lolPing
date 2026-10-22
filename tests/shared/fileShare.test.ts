import { describe, expect, it } from 'vitest';
import {
  FILE_MAX_BYTES, MAX_FILE_NAME, formatSize, progressPercent, sanitizeFileName, withinLimit,
} from '../../src/shared/fileShare';

describe('withinLimit', () => {
  it('takes a real file up to the limit and refuses everything else', () => {
    expect(withinLimit(1)).toBe(true);
    expect(withinLimit(FILE_MAX_BYTES)).toBe(true);
    expect(withinLimit(FILE_MAX_BYTES + 1)).toBe(false);
    expect(withinLimit(0)).toBe(false);
    expect(withinLimit(-1)).toBe(false);
    expect(withinLimit(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('keeps a plain name as it is', () => {
    expect(sanitizeFileName('screenshot.png')).toBe('screenshot.png');
    expect(sanitizeFileName('我的截图 2026-10-21.png')).toBe('我的截图 2026-10-21.png');
  });

  it('takes the last part of a path, so a sender cannot choose where it lands', () => {
    expect(sanitizeFileName('C:\\Users\\me\\Desktop\\a.png')).toBe('a.png');
    expect(sanitizeFileName('/home/me/../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('..\\..\\windows\\system32\\evil.dll')).toBe('evil.dll');
  });

  it('replaces what Windows refuses and drops what could disguise an extension', () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt');
    expect(sanitizeFileName('report\u202Etxt.exe')).toBe('reporttxt.exe');
    expect(sanitizeFileName('bell\u0007name.txt')).toBe('bellname.txt');
  });

  it('never returns an empty or dot-only name', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('   ')).toBe('file');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('/')).toBe('file');
  });

  it('cuts a very long name but keeps its beginning', () => {
    const long = sanitizeFileName(`${'a'.repeat(300)}.png`);
    expect(long.length).toBeLessThanOrEqual(MAX_FILE_NAME);
    expect(long.startsWith('aaaa')).toBe(true);
  });
});

describe('progressPercent', () => {
  it('counts from 0 to 100 and never leaves that range', () => {
    expect(progressPercent(0, 10)).toBe(0);
    expect(progressPercent(5, 10)).toBe(50);
    expect(progressPercent(10, 10)).toBe(100);
    expect(progressPercent(20, 10)).toBe(100);
    expect(progressPercent(-1, 10)).toBe(0);
    expect(progressPercent(1, 0)).toBe(0);
  });
});

describe('formatSize', () => {
  it('picks the unit a person would read', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(999)).toBe('999 B');
    expect(formatSize(1536)).toBe('2 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSize(120 * 1024 * 1024)).toBe('120 MB');
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});
