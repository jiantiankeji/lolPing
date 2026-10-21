import { parseMarkdown, type MdBlock, type MdInline, type MdListItem } from './markdown';

/**
 * Draws the answer card's text: markdown in, DOM out, built node by node with `textContent`. Nothing from the answer
 * is ever parsed as HTML, and a link is only ever shown — never followed.
 */
export function renderMarkdown(host: HTMLElement, src: string): void {
  host.textContent = '';
  for (const block of parseMarkdown(src)) host.append(blockNode(block));
}

function inlineNode(node: MdInline): Node {
  switch (node.t) {
    case 'text':
      return document.createTextNode(node.text);
    case 'code': {
      const e = document.createElement('code');
      e.className = 'md-code';
      e.textContent = node.text;
      return e;
    }
    case 'strong': {
      const e = document.createElement('strong');
      e.textContent = node.text;
      return e;
    }
    case 'em': {
      const e = document.createElement('em');
      e.textContent = node.text;
      return e;
    }
    case 'link': {
      const e = document.createElement('span');
      e.className = 'md-link';
      e.textContent = node.text;
      e.title = node.href;
      return e;
    }
  }
}

/** The lines of a paragraph, a quote or a list item: a line break in the answer stays a line break. */
function appendLines(host: HTMLElement, lines: readonly MdInline[][]): void {
  lines.forEach((inlines, index) => {
    if (index > 0) host.append(document.createElement('br'));
    for (const inline of inlines) host.append(inlineNode(inline));
  });
}

function listNode(block: Extract<MdBlock, { t: 'list' }>): HTMLElement {
  const make = (): HTMLUListElement | HTMLOListElement => {
    if (block.ordered) {
      const list = document.createElement('ol');
      list.className = 'md-list';
      if (block.start !== 1) list.start = block.start;
      return list;
    }
    const list = document.createElement('ul');
    list.className = 'md-list';
    return list;
  };
  const root = make();
  // depth 0 sits at the top; an indented item hangs off the last item above it.
  const stack: Array<{ depth: number; list: HTMLUListElement | HTMLOListElement }> = [{ depth: 0, list: root }];
  for (const item of block.items) {
    while (stack.length > 1 && item.depth < stack[stack.length - 1].depth) stack.pop();
    while (item.depth > stack[stack.length - 1].depth) {
      const parent = stack[stack.length - 1];
      const nested = make();
      const last = parent.list.lastElementChild;
      if (last) last.append(nested);
      else parent.list.append(nested);
      stack.push({ depth: parent.depth + 1, list: nested });
    }
    stack[stack.length - 1].list.append(itemNode(item));
  }
  return root;
}

function itemNode(item: MdListItem): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'md-item';
  appendLines(li, item.lines);
  return li;
}

function blockNode(block: MdBlock): HTMLElement {
  switch (block.t) {
    case 'heading': {
      const e = document.createElement('div');
      e.className = `md-h${block.level}`;
      for (const inline of block.inlines) e.append(inlineNode(inline));
      return e;
    }
    case 'paragraph': {
      const e = document.createElement('div');
      e.className = 'md-p';
      appendLines(e, block.lines);
      return e;
    }
    case 'list':
      return listNode(block);
    case 'code': {
      const pre = document.createElement('pre');
      pre.className = 'md-pre';
      const code = document.createElement('code');
      if (block.lang !== '') code.className = `language-${block.lang}`;
      code.textContent = block.text;
      pre.append(code);
      return pre;
    }
    case 'quote': {
      const e = document.createElement('blockquote');
      e.className = 'md-quote';
      appendLines(e, block.lines);
      return e;
    }
    case 'rule': {
      const e = document.createElement('div');
      e.className = 'md-rule';
      return e;
    }
  }
}
