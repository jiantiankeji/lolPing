import type { PanelAction } from '../../shared/ipc';
import { renderCountdown } from './countdown';
import { dropReady, renderReady } from './readyCheck';
import { renderRoster } from './roster';
import { renderVote } from './vote';

const root = document.getElementById('root') as HTMLElement;

window.panelApi.on((state) => {
  document.body.dataset.view = state.view;
  const act = (action: PanelAction): void => window.panelApi.act(action);
  if (state.view === 'countdown') {
    dropReady();
    return renderCountdown(root, state, act);
  }
  if (state.view === 'vote' && state.vote?.kind === 'ready') return renderReady(root, state, act);
  dropReady();
  if (state.view === 'vote') renderVote(root, state, act);
  else renderRoster(root, state, act);
});
