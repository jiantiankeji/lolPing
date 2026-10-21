import { askPrompt, deepPrompt } from '../shared/aiAsk';
import type { Lang, Strings } from '../shared/i18n';
import type { Settings } from '../shared/settings';
import type { VisionFailure, VisionResult } from './deepseekVision';

/** One upload per press: a second ? ping inside this gap is a plain ping, not another screenshot. */
export const AI_MIN_GAP_MS = 5000;

/** The line that says a deep question is being thought through: up until the answer (or the failure) clears it. */
export const AI_THINKING_OWNER = 'ai-thinking';

export interface AiPingDeps {
  /** The AI setting and the key it sends with, read at the moment of the ping (the settings file may have changed). */
  settings(): Pick<Settings, 'aiAsk' | 'deepseekKey'>;
  lang(): Lang;
  text(): Strings;
  capture(displayId: number): Promise<Uint8Array | null>;
  vision(input: { key: string; prompt: string; jpeg: Uint8Array; deep: boolean }): Promise<VisionResult>;
  /** Draws a line on the display the ping went to: the pending one while a deep ask runs. */
  show(p: { displayId: number; x: number; y: number; text: string; owner: string; sticky?: boolean }): void;
  /** Puts the answer on screen in full, at the ping, with the buttons to expand it and to close it. */
  answer(p: { displayId: number; x: number; y: number; text: string }): void;
  /** Takes down an answer left over from an earlier ask. */
  closeAnswer(): void;
  /** Takes down every line of one owner, on every display. */
  clearText(owner: string): void;
  /** Takes down the ping the overlay held while a deep ask ran. */
  releasePing(): void;
  toast(title: string, body: string): void;
  now(): number;
}

/**
 * What the ? ping does when `aiAsk` is on: one screenshot of the display it was placed on, one question to DeepSeek,
 * and the answer as one line where the ping went. Without the setting it does nothing, so ? stays a plain ping.
 */
export class AiPing {
  private busy = false;
  private lastAt = Number.NEGATIVE_INFINITY;
  /** The missing key is worth one hint, not one per question: the setting is on from the start. */
  private warnedNoKey = false;

  constructor(private readonly deps: AiPingDeps, private readonly minGapMs = AI_MIN_GAP_MS) {}

  /** Never throws: every failure ends in a toast. `deep` asks the model to think, and `question` is what the user typed
   * in the box; without one the built-in question goes out. */
  async ping(p: { displayId: number; x: number; y: number }, deep = false, question = ''): Promise<void> {
    const { aiAsk, deepseekKey } = this.deps.settings();
    if (!aiAsk) return;
    const t = this.deps.text();
    if (deepseekKey === '') {
      if (!this.warnedNoKey) {
        this.warnedNoKey = true;
        this.deps.toast(t.aiNoKey, t.aiNoKeyBody);
      }
      return;
    }
    const now = this.deps.now();
    if (this.busy || now - this.lastAt < this.minGapMs) return;
    this.busy = true;
    this.lastAt = now;
    // A new question replaces the last answer: one card on screen, the one being asked about.
    this.deps.closeAnswer();
    /** The pending line is on screen: it has to come down however this ask ends. */
    let pendingUp = false;
    try {
      const jpeg = await this.deps.capture(p.displayId);
      if (!jpeg) {
        this.deps.toast(t.aiFailCapture, t.aiFailCaptureBody);
        return;
      }
      // Thinking it through takes as long as it takes: the line stays up until the answer takes its place.
      if (deep) {
        this.deps.show({
          displayId: p.displayId, x: p.x, y: Math.max(0, p.y - 40), text: t.aiThinking,
          owner: AI_THINKING_OWNER, sticky: true,
        });
        pendingUp = true;
      }
      // The deep ask sends the question typed in the box, or the built-in one when it was sent empty.
      const lang = this.deps.lang();
      const prompt = deep ? deepPrompt(question, lang) : askPrompt(lang);
      const answer = await this.deps.vision({ key: deepseekKey, prompt, jpeg, deep });
      if (pendingUp) {
        this.deps.clearText(AI_THINKING_OWNER);
        this.deps.releasePing();
        pendingUp = false;
      }
      if (!answer.ok) this.fail(answer.kind, t);
      else this.deps.answer({ displayId: p.displayId, x: p.x, y: p.y, text: answer.text });
    } finally {
      this.busy = false;
      // A pending line and a held ping must never outlive their question, however the ask ended.
      if (pendingUp) {
        this.deps.clearText(AI_THINKING_OWNER);
        this.deps.releasePing();
      }
    }
  }

  private fail(kind: VisionFailure, t: Strings): void {
    switch (kind) {
      case 'auth':
        this.deps.toast(t.aiFailAuth, t.aiFailAuthBody);
        break;
      case 'rate':
        this.deps.toast(t.aiFailRate, t.aiFailRateBody);
        break;
      case 'timeout':
        this.deps.toast(t.aiFailTimeout, t.aiFailTimeoutBody);
        break;
      case 'empty':
        this.deps.toast(t.aiFailEmpty, t.aiFailEmptyBody);
        break;
      case 'shape':
        this.deps.toast(t.aiFailShape, t.aiFailShapeBody);
        break;
      default:
        this.deps.toast(t.aiFailNetwork, t.aiFailNetworkBody);
    }
  }
}
