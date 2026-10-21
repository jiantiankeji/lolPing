/**
 * A small markdown reader for the answer card: the subset a model actually writes, turned into blocks and spans.
 * Nothing here produces HTML — the renderer builds DOM nodes with `textContent` — so an answer can say whatever it
 * likes without the card ever running it.
 */
export type MdInline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong'; text: string }
  | { t: 'em'; text: string }
  /** A link is shown, not followed: the card has no way out to a browser, and never navigates. */
  | { t: 'link'; text: string; href: string };

export interface MdListItem {
  /** 0 for the outermost level; a nested list is one deeper. */
  depth: number;
  lines: MdInline[][];
}

export type MdBlock =
  | { t: 'heading'; level: number; inlines: MdInline[] }
  | { t: 'paragraph'; lines: MdInline[][] }
  | { t: 'list'; ordered: boolean; start: number; items: MdListItem[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; lines: MdInline[][] }
  | { t: 'rule' };

const FENCE = /^\s*(```|~~~)\s*(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** The answer as blocks. Line breaks inside a paragraph stay as lines: a model's line breaks usually mean them. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  let i = 0;

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ t: 'paragraph', lines: paragraph.map(parseInline) });
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        body.push(lines[i]);
        i++;
      }
      i++; // the closing fence, or the end of the answer when one was never closed
      blocks.push({ t: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ t: 'heading', level: Math.min(3, heading[1].length), inlines: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ t: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i]);
        if (!m) break;
        quoted.push(m[1]);
        i++;
      }
      blocks.push({ t: 'quote', lines: quoted.map(parseInline) });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]);
      const start = ordered ? Number.parseInt(item[2], 10) : 1;
      const items: MdListItem[] = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]);
        if (m) {
          // The other kind of list is a new list, not another item of this one.
          if (/\d/.test(m[2]) !== ordered) break;
          items.push({ depth: Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), lines: [parseInline(m[3])] });
          i++;
          continue;
        }
        // An indented line under the last item belongs to it, not to a new paragraph.
        const last = items[items.length - 1];
        if (last && /^\s+\S/.test(lines[i]) && !ITEM.test(lines[i])) {
          last.lines.push(parseInline(lines[i].trim()));
          i++;
          continue;
        }
        break;
      }
      blocks.push({ t: 'list', ordered, start, items });
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return blocks;
}

/** One line of text as spans: `code`, **strong**, *em* and [links](url). Anything else stays as it was typed. */
export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = src;
  let plain = '';
  const flushPlain = (): void => {
    if (plain === '') return;
    out.push({ t: 'text', text: plain });
    plain = '';
  };

  while (rest.length > 0) {
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      flushPlain();
      out.push({ t: 'code', text: code[1] });
      rest = rest.slice(code[0].length);
      continue;
    }
    const strong = /^(\*\*|__)([^]+?)\1/.exec(rest);
    if (strong && strong[2].trim() !== '') {
      flushPlain();
      out.push({ t: 'strong', text: strong[2] });
      rest = rest.slice(strong[0].length);
      continue;
    }
    const em = /^(\*|_)([^*_]+)\1/.exec(rest);
    if (em && em[2].trim() !== '') {
      flushPlain();
      out.push({ t: 'em', text: em[2] });
      rest = rest.slice(em[0].length);
      continue;
    }
    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flushPlain();
      out.push({ t: 'link', text: link[1] === '' ? link[2] : link[1], href: link[2] });
      rest = rest.slice(link[0].length);
      continue;
    }
    plain += rest[0];
    rest = rest.slice(1);
  }
  flushPlain();
  return out;
}
