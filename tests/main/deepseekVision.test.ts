import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWER_TOKEN_BUDGET, DeepSeekVision, REASONING_TOKEN_BUDGET, VISION_MODEL, VISION_URL, readVisionReply, replyTrace,
  visionBody, type VisionFetch,
} from '../../src/main/deepseekVision';

type Body = {
  model: string;
  max_tokens: number;
  thinking?: { type: string };
  messages: Array<{ role: string; content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
};

const sent = { key: 'sk-test', prompt: 'What should I do?', jpeg: new Uint8Array([0xff, 0xd8, 0xff]) };

function reply(content: unknown, finishReason = 'stop'): Response {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finishReason, message: { role: 'assistant', content } }] }),
    { status: 200 },
  );
}

const refusal = (said: string): Response => new Response(JSON.stringify({ error: { message: said } }), { status: 400 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('visionBody', () => {
  it('asks the vision model with one base64 JPEG and the prompt', () => {
    const body = visionBody('What should I do?', new Uint8Array([1, 2, 3])) as Body;
    expect(body.model).toBe(VISION_MODEL);
    expect(body.model).toBe('deepseek-flash');
    expect(body.messages[0].role).toBe('user');
    const [text, image] = body.messages[0].content;
    expect(text).toEqual({ type: 'text', text: 'What should I do?' });
    expect(image.type).toBe('image_url');
    expect(image.image_url?.url).toBe('data:image/jpeg;base64,AQID');
  });

  it('turns thinking off, so the answer gets the whole budget', () => {
    // Measured on a real screenshot: thinking on spent 3000 tokens and returned nothing; off, 38 tokens in 1.1 s.
    const body = visionBody('x', new Uint8Array([1])) as Body;
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBe(ANSWER_TOKEN_BUDGET);
  });

  it('turns thinking on, with a roomier budget, for the deep ask', () => {
    const body = visionBody('x', new Uint8Array([1]), { thinking: 'enabled' }) as Body;
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.max_tokens).toBe(REASONING_TOKEN_BUDGET);
  });

  it('leaves the field out when the server should use its own default', () => {
    const body = visionBody('x', new Uint8Array([1]), { thinking: 'server-default' }) as Body;
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(REASONING_TOKEN_BUDGET);
  });
});

describe('readVisionReply', () => {
  it('reads the text of a chat completion', () => {
    expect(readVisionReply({ choices: [{ message: { content: ' Back off. ' } }] })).toEqual({ text: 'Back off.', problem: null });
  });

  it('reads the text blocks some servers answer with instead of a string', () => {
    const raw = { choices: [{ message: { content: [{ type: 'text', text: 'Push the wave.' }, { type: 'text', text: 'Then back.' }] } }] };
    expect(readVisionReply(raw).text).toBe('Push the wave. Then back.');
  });

  it('marks a half sentence as one, when the reply was cut off mid-answer', () => {
    const raw = { choices: [{ finish_reason: 'length', message: { content: 'The test fails because' } }] };
    expect(readVisionReply(raw)).toEqual({ text: 'The test fails because…', problem: null });
  });

  it('calls a readable reply with no answer in it empty, not malformed', () => {
    // What a thinking model returns when it spends the whole budget thinking: content "", reasoning_content filled.
    const raw = { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'Considering…' } }] };
    expect(readVisionReply(raw)).toEqual({ text: null, problem: 'empty' });
    expect(readVisionReply({ choices: [{ message: { content: '   ' } }] })).toEqual({ text: null, problem: 'empty' });
  });

  it('rejects everything that has no message at all', () => {
    for (const raw of [null, undefined, 42, 'text', {}, { choices: [] }, { choices: [null] }, { choices: [{ message: null }] }]) {
      expect(readVisionReply(raw), JSON.stringify(raw)).toEqual({ text: null, problem: 'shape' });
    }
    expect(readVisionReply({ choices: [{ message: { content: 42 } }] })).toEqual({ text: null, problem: 'shape' });
  });

  it('traces what a reply without an answer looked like, without its text', () => {
    const trace = replyTrace({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'abc' } }] });
    expect(trace).toBe('finish=length content=0 reasoning=3');
  });
});

describe('DeepSeekVision', () => {
  const visionWith = (fetch: VisionFetch, extra: { timeoutMs?: number; attempts?: number } = {}): DeepSeekVision =>
    new DeepSeekVision({ fetch, timeoutMs: 50, ...extra });

  it('posts the key as a bearer token to the chat completions endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const vision = visionWith(async (url, init) => {
      calls.push({ url, init });
      return reply('Back off.');
    });
    expect(await vision.ask(sent)).toEqual({ ok: true, text: 'Back off.' });
    expect(calls[0].url).toBe(VISION_URL);
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: 'deepseek-flash', stream: false });
  });

  it('asks again without the thinking switch when the server refuses it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bodies: Body[] = [];
    const vision = visionWith(async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)) as Body);
      return bodies.length === 1 ? refusal('Unknown parameter: thinking') : reply('Wait for the tests.');
    });
    expect(await vision.ask(sent)).toEqual({ ok: true, text: 'Wait for the tests.' });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].thinking).toBeUndefined();
    expect(bodies[1].max_tokens).toBe(REASONING_TOKEN_BUDGET);
  });

  it('treats a 400 that is not about the thinking switch as a network problem', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const vision = visionWith(async () => {
      calls++;
      return refusal('bad image data');
    });
    expect(await vision.ask(sent)).toEqual({ ok: false, kind: 'network' });
    expect(calls).toBe(1);
  });

  it('asks again when the first reply carried no answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const vision = visionWith(async () => {
      calls++;
      return calls === 1 ? reply('', 'length') : reply('Wait for the tests.');
    });
    expect(await vision.ask(sent)).toEqual({ ok: true, text: 'Wait for the tests.' });
    expect(calls).toBe(2);
  });

  it('gives up as empty when the second reply has no answer either', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const vision = visionWith(async () => {
      calls++;
      return reply('', 'length');
    });
    expect(await vision.ask(sent)).toEqual({ ok: false, kind: 'empty' });
    expect(calls).toBe(2);
  });

  it('does not ask again after a refused key, a rate limit or a dropped connection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const [status, kind] of [[401, 'auth'], [429, 'rate'], [500, 'network']] as const) {
      let calls = 0;
      const vision = visionWith(async () => {
        calls++;
        return new Response('{}', { status });
      });
      expect(await vision.ask(sent)).toEqual({ ok: false, kind });
      expect(calls, String(status)).toBe(1);
    }
  });

  it('reports an unreadable reply as a shape problem', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await visionWith(async () => new Response('not json', { status: 200 })).ask(sent))
      .toEqual({ ok: false, kind: 'shape' });
    expect(await visionWith(async () => new Response('{}', { status: 200 })).ask(sent))
      .toEqual({ ok: false, kind: 'shape' });
  });

  it('gives up on a request that never answers', async () => {
    const vision = visionWith((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }), { timeoutMs: 5 });
    expect(await vision.ask(sent)).toEqual({ ok: false, kind: 'timeout' });
  });

  it('reports a failed connection as the network', async () => {
    const vision = visionWith(vi.fn(() => Promise.reject(new Error('offline'))) as unknown as VisionFetch);
    expect(await vision.ask(sent)).toEqual({ ok: false, kind: 'network' });
  });

  it('asks exactly once when retries are off', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const vision = visionWith(async () => {
      calls++;
      return reply('', 'length');
    }, { attempts: 1 });
    expect(await vision.ask(sent)).toEqual({ ok: false, kind: 'empty' });
    expect(calls).toBe(1);
  });

  it('sends a deep ask with thinking on, and does not repeat it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bodies: Body[] = [];
    const vision = visionWith(async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)) as Body);
      return reply('', 'length');
    });
    expect(await vision.ask({ ...sent, deep: true })).toEqual({ ok: false, kind: 'empty' });
    expect(bodies[0].thinking).toEqual({ type: 'enabled' });
    expect(bodies[0].max_tokens).toBe(REASONING_TOKEN_BUDGET);
    // One deep ask already takes a minute: a second one would keep the user waiting twice as long.
    expect(bodies).toHaveLength(1);
  });

  it('drops the thinking field on a deep ask too, when that is what the server refuses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bodies: Body[] = [];
    const vision = visionWith(async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)) as Body);
      return bodies.length === 1 ? refusal('Unsupported parameter: thinking') : reply('Deep answer.');
    });
    expect(await vision.ask({ ...sent, deep: true })).toEqual({ ok: true, text: 'Deep answer.' });
    expect(bodies[0].thinking).toEqual({ type: 'enabled' });
    expect(bodies[1].thinking).toBeUndefined();
  });
});
