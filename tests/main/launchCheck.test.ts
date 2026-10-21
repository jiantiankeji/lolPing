import { describe, expect, it } from 'vitest';
import { checkLaunchDraft } from '../../src/main/launchCheck';

/** Nothing exists except what a test says does. */
const only = (...paths: string[]) => (path: string): boolean => paths.includes(path);

describe('checkLaunchDraft', () => {
  it('asks for a target first', () => {
    expect(checkLaunchDraft({ type: 'url', target: '   ' }, only())).toEqual([{ field: 'target', reason: 'empty' }]);
  });

  it('takes only http and https links, and does not look for them on disk', () => {
    const exists = only();
    expect(checkLaunchDraft({ type: 'url', target: 'https://chat.deepseek.com' }, exists)).toEqual([]);
    expect(checkLaunchDraft({ type: 'url', target: 'file:///C:/x' }, exists)).toEqual([{ field: 'target', reason: 'badUrl' }]);
    expect(checkLaunchDraft({ type: 'url', target: 'chat.deepseek.com' }, exists)).toEqual([{ field: 'target', reason: 'badUrl' }]);
  });

  it('requires a path that is really there', () => {
    expect(checkLaunchDraft({ type: 'folder', target: 'D:\\code\\p' }, only('D:\\code\\p'))).toEqual([]);
    expect(checkLaunchDraft({ type: 'folder', target: 'D:\\gone' }, only('D:\\code\\p')))
      .toEqual([{ field: 'target', reason: 'missing' }]);
  });

  it('checks the program only when a program is chosen', () => {
    const exists = only('D:\\code\\p', 'C:\\Code.exe');
    expect(checkLaunchDraft({ type: 'folder', target: 'D:\\code\\p', openMode: 'program', program: 'C:\\Code.exe' }, exists)).toEqual([]);
    expect(checkLaunchDraft({ type: 'folder', target: 'D:\\code\\p', openMode: 'program', program: '' }, exists))
      .toEqual([{ field: 'program', reason: 'empty' }]);
    expect(checkLaunchDraft({ type: 'folder', target: 'D:\\code\\p', openMode: 'program', program: 'C:\\gone.exe' }, exists))
      .toEqual([{ field: 'program', reason: 'missing' }]);
    // A program typed while the mode is "system default" is not the user's answer, so it is not checked.
    expect(checkLaunchDraft({ type: 'folder', target: 'D:\\code\\p', openMode: 'default', program: 'C:\\gone.exe' }, exists))
      .toEqual([]);
  });

  it('reports both fields when both are wrong', () => {
    expect(checkLaunchDraft({ type: 'file', target: 'D:\\gone', openMode: 'program', program: 'C:\\nope.exe' }, only()))
      .toEqual([{ field: 'target', reason: 'missing' }, { field: 'program', reason: 'missing' }]);
  });

  it('ignores a program for a URL or an app, which have no "open with"', () => {
    expect(checkLaunchDraft({ type: 'url', target: 'https://x.dev', openMode: 'program', program: 'C:\\gone.exe' }, only())).toEqual([]);
    expect(checkLaunchDraft({ type: 'app', target: 'C:\\a.exe', openMode: 'program', program: 'C:\\gone.exe' }, only('C:\\a.exe')))
      .toEqual([]);
  });

  it('is not fooled by a payload that is not an object', () => {
    expect(checkLaunchDraft(null, only())).toEqual([{ field: 'target', reason: 'empty' }]);
    expect(checkLaunchDraft('nope', only())).toEqual([{ field: 'target', reason: 'empty' }]);
  });
});
