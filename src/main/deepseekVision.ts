/** DeepSeek's chat completions endpoint: the OpenAI-shaped one, so the body below is a plain chat request. */
export const VISION_URL = 'https://api.deepseek.com/chat/completions';

/** The only DeepSeek model that takes an image: `deepseek-chat` and `deepseek-reasoner` are text only. */
export const VISION_MODEL = 'deepseek-flash';

/**
 * Thinking is off in the request, so a one-sentence answer needs little room. Measured on a real screenshot: 38 output
 * tokens in 1.1 s, against 5 s and 1139 reasoning tokens with thinking on at low effort.
 */
export const ANSWER_TOKEN_BUDGET = 400;

/**
 * With thinking on, the reasoning counts against the same budget — measured, 3000 tokens of it ended a real screenshot
 * with `content` still empty. The deep mode gets a budget that leaves room for thinking and the answer after it.
 */
export const REASONING_TOKEN_BUDGET = 16000;

/** How long a deep ask may take: it thinks first, and that is measured in tens of seconds, not in one. */
export const DEEP_TIMEOUT_MS = 90000;

/**
 * Why an answer didn't come back, as the caller words it: there is nothing else it can do about it. `shape` is a reply
 * lolPing can't read; `empty` is a readable reply with no answer in it.
 */
export type VisionFailure = 'auth' | 'rate' | 'timeout' | 'network' | 'shape' | 'empty';

export type VisionResult = { ok: true; text: string } | { ok: false; kind: VisionFailure };

/** A server that doesn't know the `thinking` field: worth one more ask with it left out. */
type Attempt = VisionResult | { ok: false; kind: 'unsupported' };

/** How the request asks for thinking: off, on, or not at all (the server's own default, which is on). */
export type ThinkingMode = 'disabled' | 'enabled' | 'server-default';

export interface VisionBodyOptions {
  /** Off by default: it is slow, and its reasoning competes with the answer for tokens. */
  thinking?: ThinkingMode;
  maxTokens?: number;
}

/** The request body: one screenshot and one question, which is the only place DeepSeek accepts an image. */
export function visionBody(prompt: string, jpeg: Uint8Array, opts: VisionBodyOptions = {}): unknown {
  const thinking = opts.thinking ?? 'disabled';
  const base64 = Buffer.from(jpeg).toString('base64');
  return {
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
    max_tokens: opts.maxTokens
      ?? (thinking === 'disabled' ? ANSWER_TOKEN_BUDGET : REASONING_TOKEN_BUDGET),
    stream: false,
    ...(thinking === 'server-default' ? {} : { thinking: { type: thinking } }),
  };
}

export interface ReplyReading {
  /** The answer, or null when there is none. */
  text: string | null;
  /** Why `text` is null: an unreadable reply, or a readable one that carries no answer. */
  problem: 'shape' | 'empty' | null;
}

const READ_SHAPE: ReplyReading = { text: null, problem: 'shape' };
const READ_EMPTY: ReplyReading = { text: null, problem: 'empty' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The first choice, or null when the reply has no choices at all. */
function firstChoice(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw)) return null;
  const choices = raw.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  return isObj(first) ? first : null;
}

/** A message's text: a plain string, or the text blocks some OpenAI-shaped servers answer with. */
function messageText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    const text = isObj(part) ? part.text : undefined;
    if (typeof text === 'string') parts.push(text);
  }
  return parts.join(' ').trim();
}

/**
 * What a chat completion says. A reply that stayed readable but was cut off before it answered is `empty`, not
 * `shape`: it happens to a reasoning model that spends the whole budget thinking, and asking again usually answers.
 */
export function readVisionReply(raw: unknown): ReplyReading {
  const choice = firstChoice(raw);
  if (!choice) return READ_SHAPE;
  const message = choice.message;
  if (!isObj(message)) return READ_SHAPE;
  const text = messageText(message.content);
  if (text === null) return READ_SHAPE;
  if (text === '') return READ_EMPTY;
  // A half sentence is still worth showing, as long as it reads as one.
  const cut = choice.finish_reason === 'length' && !text.endsWith('…') ? `${text}…` : text;
  return { text: cut, problem: null };
}

/** What a reply that carried no answer looked like, for the log: never the picture, and never the key. */
export function replyTrace(raw: unknown): string {
  const choice = firstChoice(raw);
  const message = isObj(choice?.message) ? choice.message : undefined;
  const size = (v: unknown): number => (typeof v === 'string' ? v.length : Array.isArray(v) ? v.length : -1);
  return `finish=${String(choice?.finish_reason)} content=${size(message?.content)} reasoning=${size(message?.reasoning_content)}`;
}

export interface VisionFetch {
  (url: string, init: RequestInit): Promise<Response>;
}

export interface VisionAsk {
  key: string;
  prompt: string;
  jpeg: Uint8Array;
  /** Think the question through before answering: slower and roomier, for the All In ping. */
  deep?: boolean;
}

/** Answers one question about one screenshot. Every failure is a value, so nothing here throws at the caller. */
export class DeepSeekVision {
  constructor(private readonly deps: { fetch: VisionFetch; timeoutMs?: number; attempts?: number }) {}

  /**
   * Asks without thinking first, because the answer here is one sentence, unless `deep` was asked for. `attempts`
   * covers a reply with no answer in it, which the model does not repeat the same way twice; a server that refuses the
   * thinking switch gets one more ask without it. A deep ask is never repeated: two of those would keep the user
   * waiting minutes.
   */
  async ask(input: VisionAsk): Promise<VisionResult> {
    const attempts = input.deep ? 1 : Math.max(1, this.deps.attempts ?? 2);
    let mode: ThinkingMode = input.deep ? 'enabled' : 'disabled';
    let result = await this.once(input, mode);
    if (!result.ok && result.kind === 'unsupported') {
      // The server doesn't know the field: leave it out and let the server's own default (thinking on) stand.
      mode = 'server-default';
      result = await this.once(input, mode);
    }
    for (let retry = 1; retry < attempts && !result.ok; retry++) {
      // Asking again cannot fix a refused key, a rate limit, a timeout or a dropped connection.
      if (result.kind !== 'shape' && result.kind !== 'empty') break;
      console.warn('[ai] asking again after an unusable reply:', result.kind);
      result = await this.once(input, mode);
    }
    if (!result.ok && result.kind === 'unsupported') return { ok: false, kind: 'network' };
    return result;
  }

  private async once(input: VisionAsk, mode: ThinkingMode): Promise<Attempt> {
    const timeoutMs = this.deps.timeoutMs ?? (mode === 'disabled' ? 30000 : DEEP_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.deps.fetch(VISION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${input.key}` },
        body: JSON.stringify(visionBody(input.prompt, input.jpeg, { thinking: mode })),
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) return { ok: false, kind: 'auth' };
      if (res.status === 429) return { ok: false, kind: 'rate' };
      if (res.status === 400 && mode !== 'server-default') {
        const said = await res.text().catch(() => '');
        // A server that predates the switch rejects it as an unknown parameter: ask again without the field.
        if (/thinking|reasoning|unknown|unsupported|param/i.test(said)) {
          console.warn('[ai] this server turned the thinking switch down:', said.slice(0, 200));
          return { ok: false, kind: 'unsupported' };
        }
        return { ok: false, kind: 'network' };
      }
      if (!res.ok) return { ok: false, kind: 'network' };
      let raw: unknown = null;
      try {
        raw = await res.json();
      } catch {
        console.warn('[ai] the reply was not JSON');
        return { ok: false, kind: 'shape' };
      }
      const reading = readVisionReply(raw);
      if (reading.text !== null) return { ok: true, text: reading.text };
      console.warn('[ai] the reply carried no answer:', replyTrace(raw));
      return { ok: false, kind: reading.problem ?? 'shape' };
    } catch {
      return { ok: false, kind: controller.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
}
