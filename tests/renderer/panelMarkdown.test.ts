import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../../src/renderer/panel/markdown';

const text = (s: string): { t: 'text'; text: string } => ({ t: 'text', text: s });

describe('parseMarkdown', () => {
  it('turns the headings a model writes into three levels, deeper ones flattened', () => {
    expect(parseMarkdown('# Fix the build\n## Steps\n### Detail\n#### Deeper')).toEqual([
      { t: 'heading', level: 1, inlines: [text('Fix the build')] },
      { t: 'heading', level: 2, inlines: [text('Steps')] },
      { t: 'heading', level: 3, inlines: [text('Detail')] },
      { t: 'heading', level: 3, inlines: [text('Deeper')] },
    ]);
  });

  it('keeps a paragraph’s own line breaks as lines, and splits paragraphs on a blank line', () => {
    const blocks = parseMarkdown('first line\nsecond line\n\nanother paragraph');
    expect(blocks).toEqual([
      { t: 'paragraph', lines: [[text('first line')], [text('second line')]] },
      { t: 'paragraph', lines: [[text('another paragraph')]] },
    ]);
  });

  it('reads both kinds of list, with an indented item hanging under the one above it', () => {
    const blocks = parseMarkdown('- one\n- two\n  - two a\n1. first\n2. second');
    expect(blocks).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [
          { depth: 0, lines: [[text('one')]] },
          { depth: 0, lines: [[text('two')]] },
          { depth: 1, lines: [[text('two a')]] },
        ],
      },
      {
        t: 'list',
        ordered: true,
        start: 1,
        items: [
          { depth: 0, lines: [[text('first')]] },
          { depth: 0, lines: [[text('second')]] },
        ],
      },
    ]);
  });

  it('starts an ordered list at the number it was written with', () => {
    expect(parseMarkdown('3. third\n4. fourth')).toEqual([
      { t: 'list', ordered: true, start: 3, items: [{ depth: 0, lines: [[text('third')]] }, { depth: 0, lines: [[text('fourth')]] }] },
    ]);
  });

  it('keeps a fenced block verbatim, marks, indentation and all, and closes it at the end when it never closed', () => {
    expect(parseMarkdown('```ts\nconst a = *1*;\n  if (a) {}\n```')).toEqual([
      { t: 'code', lang: 'ts', text: 'const a = *1*;\n  if (a) {}' },
    ]);
    expect(parseMarkdown('```\nnpm run dev')).toEqual([{ t: 'code', lang: '', text: 'npm run dev' }]);
  });

  it('reads quotes, rules and a line of plain text around them', () => {
    expect(parseMarkdown('> quoted\n> twice\n\n---\ndone')).toEqual([
      { t: 'quote', lines: [[text('quoted')], [text('twice')]] },
      { t: 'rule' },
      { t: 'paragraph', lines: [[text('done')]] },
    ]);
  });

  it('reads a Windows answer the same way, and an empty one as nothing at all', () => {
    expect(parseMarkdown('# A\r\n\r\nbody')).toEqual([
      { t: 'heading', level: 1, inlines: [text('A')] },
      { t: 'paragraph', lines: [[text('body')]] },
    ]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });
});

describe('parseInline', () => {
  it('reads code, bold, italics and a link in one line', () => {
    expect(parseInline('run `npm test` then **look** at *this* [doc](https://x.dev/a)')).toEqual([
      text('run '),
      { t: 'code', text: 'npm test' },
      text(' then '),
      { t: 'strong', text: 'look' },
      text(' at '),
      { t: 'em', text: 'this' },
      text(' '),
      { t: 'link', text: 'doc', href: 'https://x.dev/a' },
    ]);
  });

  it('accepts both markdown spellings of bold and italics', () => {
    expect(parseInline('__a__ _b_')).toEqual([{ t: 'strong', text: 'a' }, text(' '), { t: 'em', text: 'b' }]);
  });

  it('leaves text without marks exactly as it was written', () => {
    expect(parseInline('2 * 3 = 6, a_b, path\\to\\file')).toEqual([text('2 * 3 = 6, a_b, path\\to\\file')]);
  });

  it('keeps a bare URL as text: a link is only a link when it was written as one', () => {
    expect(parseInline('see https://example.com/x')).toEqual([text('see https://example.com/x')]);
  });

  it('uses the address as the words when the link has none', () => {
    expect(parseInline('[](https://x.dev)')).toEqual([{ t: 'link', text: 'https://x.dev', href: 'https://x.dev' }]);
  });

  it('never lets a stray mark swallow the rest of the line', () => {
    expect(parseInline('**unclosed')).toEqual([text('**unclosed')]);
    expect(parseInline('`unclosed')).toEqual([text('`unclosed')]);
    expect(parseInline('**')).toEqual([text('**')]);
    expect(parseInline('')).toEqual([]);
  });
});
