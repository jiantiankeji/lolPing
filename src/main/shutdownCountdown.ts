import type { Lang } from '../shared/i18n';
import type { CountdownState } from '../shared/ipc';

/** How long the card counts down before the machine goes down. */
export const SHUTDOWN_SECONDS = 5;

/** Four looks a second: the number changes on the second, and no later than a quarter of a second after it. */
const TICK_MS = 250;

export interface ShutdownCountdownDeps {
  now(): number;
  lang(): Lang;
  /** The pause shortcut's label, for the hint line. */
  hotkey(): string;
  /** Draws the card, or takes it away with null. */
  show(state: CountdownState | null): void;
  /** Runs the shutdown. Only ever called once per countdown. */
  shutdown(): void;
}

/**
 * The retreat ping's five seconds. lolPing counts them itself instead of asking the OS to shut down later: an app that
 * crashes, is closed or has its setting switched off before the countdown ends then simply never runs the command.
 */
export class ShutdownCountdown {
  private deadline: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The number on the card, so an unchanged second is not drawn again. */
  private shown = 0;

  constructor(private readonly deps: ShutdownCountdownDeps, private readonly seconds = SHUTDOWN_SECONDS) {}

  running(): boolean {
    return this.deadline !== null;
  }

  /** A retreat ping: starts the countdown, or calls off the one that is running. */
  ping(): void {
    if (this.running()) this.cancel();
    else this.start();
  }

  start(): void {
    this.stopTimer();
    this.deadline = this.deps.now() + this.seconds * 1000;
    this.draw(this.seconds);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  cancel(): void {
    if (!this.running()) return;
    this.stopTimer();
    this.deadline = null;
    this.shown = 0;
    this.deps.show(null);
  }

  /** lolPing is going away: nothing of ours may still shut the machine down afterwards. */
  dispose(): void {
    this.stopTimer();
    this.deadline = null;
    this.shown = 0;
  }

  private tick(): void {
    if (this.deadline === null) return;
    const left = Math.ceil((this.deadline - this.deps.now()) / 1000);
    if (left > 0) {
      if (left !== this.shown) this.draw(left);
      return;
    }
    // Time is up. The card goes first, so a slow shutdown command cannot leave it counting at zero.
    this.stopTimer();
    this.deadline = null;
    this.shown = 0;
    this.deps.show(null);
    this.deps.shutdown();
  }

  private draw(secondsLeft: number): void {
    this.shown = secondsLeft;
    this.deps.show({ view: 'countdown', lang: this.deps.lang(), secondsLeft, hotkey: this.deps.hotkey() });
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
