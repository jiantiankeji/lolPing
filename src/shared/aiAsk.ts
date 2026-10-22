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

/** How a follow-up names what it builds on, per language. The answer can be longer than the question it follows. */
const FOLLOW_UP_LABEL: Record<Lang, { question: string; builtIn: string; answer: string; follow: string; empty: string }> = {
  en: {
    question: 'The question I asked: ', builtIn: 'the built-in question about the screen',
    answer: 'Your answer: ',
    follow: 'Follow-up: ',
    empty: 'Go on from your previous answer: what should I do next about what is on the screen?',
  },
  'zh-CN': {
    question: '我上一个问题：', builtIn: '内置的那个关于屏幕的问题',
    answer: '你的回答：',
    follow: '追问：',
    empty: '接着你上一个回答继续：屏幕上现在该做什么？',
  },
};

/**
 * A follow-up turn: the question and answer it continues (so the model keeps the thread), then the new question, then
 * the line that keeps lolPing's own overlay out of its reading of the screenshot.
 */
export function followUpPrompt(
  question: string,
  previous: { question: string; answer: string },
  lang: Lang,
): string {
  const label = FOLLOW_UP_LABEL[lang];
  const asked = previous.question.trim() === '' ? label.builtIn : previous.question.trim();
  const own = question.trim() === '' ? label.empty : question.trim();
  return [
    `${label.question}${asked}`,
    `${label.answer}${previous.answer.trim()}`,
    '',
    `${label.follow}${own}`,
    '',
    IGNORE_OVERLAY[lang],
  ].join('\n');
}
