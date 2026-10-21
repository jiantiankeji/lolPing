import type { Lang } from './i18n';
import type { PingId } from './pings';

/** The ping that asks for a quick answer, and the one that asks for a deep one. */
export const AI_QUICK_PING: PingId = 'ask';
export const AI_DEEP_PING: PingId = 'allin';

/** What lolPing asks about the screenshot. Short on purpose: the answer has to fit on one line of the overlay. */
const PROMPT: Record<Lang, string> = {
  en: 'This is a screenshot of my screen, from my everyday development work: an editor, a terminal, a browser, or a '
    + 'build or test run I just started. In one sentence of at most 20 words, say what is on the screen and what I '
    + 'should do next. When you can see them, name the error, the command waiting for input, or the file that changed. '
    + 'Keep code, paths, commands and identifiers exactly as they are. Ignore any ping icon or text that lolPing drew '
    + 'on the screenshot. No lists, no markdown.',
  'zh-CN': '这是我电脑屏幕上的一张截图，来自我日常的开发工作：编辑器、终端、浏览器，或者我刚跑的构建、测试。'
    + '用一句话（不超过 40 个字）说明画面上是什么、我接下来该做什么。能看清时请点出报错、正在等待输入的命令，'
    + '或发生改动的文件。代码、路径、命令和标识符保持原样。请忽略 lolPing 自己画在截图上的信号图标和文字。'
    + '不要列表，不要 Markdown。',
};

export const askPrompt = (lang: Lang): string => PROMPT[lang];

/** The longest deep-thinking question the settings keep: a question, not an essay. */
export const DEEP_PROMPT_MAX = 2000;

/** One line that keeps lolPing's own overlay out of the model's reading of the screenshot. */
const IGNORE_OVERLAY: Record<Lang, string> = {
  en: 'Ignore any ping icon or text that lolPing drew on the screenshot.',
  'zh-CN': '请忽略 lolPing 画在截图上的信号图标和文字。',
};

/**
 * What a deep ask sends: the question the user wrote, or the built-in one when that is empty. The ignore line goes on
 * the end either way, so the countdown card and the ping's icon don't read as part of the screen.
 */
export function deepPrompt(question: string, lang: Lang): string {
  const own = question.trim();
  if (own === '') return askPrompt(lang);
  return `${own}\n\n${IGNORE_OVERLAY[lang]}`;
}

/** How much of an answer the spot bubble can show before it stops reading as one line. */
export const ANSWER_MAX = 120;

/**
 * A model's answer as one line: a fence's contents, markdown marks and line breaks gone, cut to `max` code points.
 * The answer comes from another machine, and the bubble is text only, so nothing here is interpreted as markup.
 */
export function oneLine(raw: string, max = ANSWER_MAX): string {
  const flat = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat;
}
