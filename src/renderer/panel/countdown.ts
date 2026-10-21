import { strings } from '../../shared/i18n';
import type { CountdownState, PanelAction } from '../../shared/ipc';
import { el } from './vote';

interface Card {
  lang: string;
  title: HTMLElement;
  hint: HTMLElement;
}

/** The card of the current countdown, so its button survives the once-a-second redraw. */
let card: Card | null = null;

/**
 * The shutdown countdown. Built once per countdown and then only its text changes: rebuilding the button every second
 * would drop its hover and could swallow a click that lands while the number ticks over.
 */
export function renderCountdown(root: HTMLElement, state: CountdownState, act: (a: PanelAction) => void): void {
  const t = strings(state.lang);
  if (!card || card.lang !== state.lang) {
    root.textContent = '';
    const wrap = el('div', 'countdown-card');
    const title = el('div', 'countdown-title');
    const cancel = el('button', 'countdown-cancel', t.shutdownCancel);
    cancel.type = 'button';
    cancel.addEventListener('click', () => act({ t: 'cancelShutdown' }));
    const hint = el('div', 'countdown-hint');
    wrap.append(title, cancel, hint);
    root.append(wrap);
    card = { lang: state.lang, title, hint };
  }
  card.title.textContent = t.shutdownIn(state.secondsLeft);
  card.hint.textContent = t.shutdownHint(state.hotkey);
}
