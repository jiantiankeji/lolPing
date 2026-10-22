import { describe, expect, it } from 'vitest';
import { transferView } from '../../src/renderer/panel/transfer';
import type { TransferState } from '../../src/shared/fileShare';
import { strings } from '../../src/shared/i18n';

const state = (over: Partial<TransferState> = {}): TransferState => ({
  view: 'transfer', lang: 'en', phase: 'ask', peerName: 'Alex', fileName: 'shot.png',
  size: 5 * 1024 * 1024, done: 0, total: 100, ...over,
});

describe('transferView', () => {
  it('asks who is offering what, and offers the two answers', () => {
    const t = strings('en');
    const view = transferView(state());
    expect(view.title).toBe(t.fileAskTitle('Alex'));
    expect(view.asking).toBe(true);
    expect(view.take).toBe(t.fileTake);
    expect(view.decline).toBe(t.fileDecline);
    expect(view.ended).toBe(false);
  });

  it('shows who is sending or receiving, with the size and how far along it is', () => {
    const sending = transferView(state({ phase: 'sending', done: 25 }));
    expect(sending.title).toBe(strings('en').fileSendTitle('Alex'));
    expect(sending.percent).toBe(25);
    expect(sending.detail).toContain('5.0 MB');
    expect(sending.detail).toContain('25%');
    expect(sending.asking).toBe(false);

    expect(transferView(state({ phase: 'receiving' })).title).toBe(strings('en').fileReceiveTitle('Alex'));
  });

  it('says how it ended instead of a bar, and offers nothing to click', () => {
    const done = transferView(state({ phase: 'done', result: 'ok' }));
    expect(done.ended).toBe(true);
    expect(done.detail).toContain(strings('en').fileResult('ok'));

    const failed = transferView(state({ phase: 'failed', result: 'mismatch' }));
    expect(failed.ended).toBe(true);
    expect(failed.detail).toContain(strings('en').fileResult('mismatch'));
  });

  it('speaks the language in force', () => {
    const zh = transferView(state({ lang: 'zh-CN' }));
    expect(zh.title).toBe(strings('zh-CN').fileAskTitle('Alex'));
    expect(zh.take).toBe(strings('zh-CN').fileTake);
    expect(zh.take).not.toBe(strings('en').fileTake);
  });
});
