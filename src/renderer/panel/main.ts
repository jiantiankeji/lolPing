import type { PanelAction } from '../../shared/ipc';
import { dropAnswer, renderAnswer } from './answer';
import { renderCountdown } from './countdown';
import { dropReady, renderReady } from './readyCheck';
import { renderRoster } from './roster';
import { dropTransfer, renderTransfer } from './transfer';
import { renderVote } from './vote';

const root = document.getElementById('root') as HTMLElement;

window.panelApi.on((state) => {
  document.body.dataset.view = state.view;
  const act = (action: PanelAction): void => window.panelApi.act(action);
  if (state.view === 'transfer') {
    dropReady();
    dropAnswer();
    return renderTransfer(root, state, act);
  }
  dropTransfer();
  if (state.view === 'answer') {
    dropReady();
    return renderAnswer(root, state, act);
  }
  dropAnswer();
  if (state.view === 'countdown') {
    dropReady();
    return renderCountdown(root, state, act);
  }
  if (state.view === 'vote' && state.vote?.kind === 'ready') return renderReady(root, state, act);
  dropReady();
  if (state.view === 'vote') renderVote(root, state, act);
  else renderRoster(root, state, act);
});
