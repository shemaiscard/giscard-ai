// The six shortcuts on the welcome screen and in the + menu. Each one asks a
// question, offers quick options, and shapes the next messages until it is closed.

export type ShortcutKind = 'docs' | 'images' | 'code' | 'math' | 'translate' | 'summary';

export interface ShortcutState {
  kind: ShortcutKind;
  option?: string;
  messageId: string; // the question message whose option buttons stay active
}

// Options that open the file picker instead of being selected.
export const UPLOAD_OPTIONS = new Set(['Upload a file', 'Upload a photo']);

export const SHORTCUTS: Record<ShortcutKind, { title: string; question: string; placeholder: string; options: string[] }> = {
  docs: {
    title: 'Docs',
    question: 'What document do you need? I can write a Word document, a PowerPoint deck or an Excel sheet. You can also upload a PDF or Word file and ask me about it.',
    placeholder: 'What is the document about?',
    options: ['Word document', 'PowerPoint deck', 'Excel sheet', 'Upload a file'],
  },
  images: {
    title: 'Images',
    question: 'What image can I make for you? Describe it in a sentence, and pick a style if you like.',
    placeholder: 'Describe the image...',
    options: ['Photo', 'Illustration', 'Watercolor', '3D render', 'Pixel art', 'Anime'],
  },
  code: {
    title: 'Code',
    question: 'What code do you need? Tell me what it should do, or paste code you want explained or fixed.',
    placeholder: 'Describe or paste code...',
    options: ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'SQL'],
  },
  math: {
    title: 'Math',
    question: "Let's solve it together. Type the problem or upload a photo of it, and we'll work through it step by step.",
    placeholder: 'Type a math problem...',
    options: ['Step by step', 'Just the answer', 'Upload a photo'],
  },
  translate: {
    title: 'Translate',
    question: 'Which language should I translate into?',
    placeholder: 'Text to translate...',
    options: ['English', 'Korean', 'French', 'Spanish', 'Kinyarwanda', 'Swahili', 'Japanese', 'Chinese'],
  },
  summary: {
    title: 'Summary',
    question: 'What should I summarize? Paste the text, share a link, or upload a PDF or Word file.',
    placeholder: 'Paste text or a link...',
    options: ['Short', 'Key points', 'Detailed', 'Upload a file'],
  },
};

// Hints are kept short so they fit one line on a 360 px phone.
export const shortcutPlaceholder = ({ kind, option }: ShortcutState) =>
  kind === 'translate' && !option ? 'Type a language or pick one'
    : kind === 'docs' && option ? `${option} topic...`
    : SHORTCUTS[kind].placeholder;

// Translate: a reply such as "Korean", "to french" or "Spanish please" picks the language.
const LANGUAGES = ['English', 'Korean', 'French', 'Spanish', 'Kinyarwanda', 'Swahili', 'Japanese', 'Chinese',
  'German', 'Portuguese', 'Italian', 'Arabic', 'Russian', 'Hindi', 'Turkish', 'Vietnamese', 'Indonesian',
  'Dutch', 'Kirundi', 'Amharic', 'Thai', 'Polish', 'Greek', 'Hebrew', 'Ukrainian'];
export const languageFromReply = (text: string) => {
  const word = text.toLowerCase().replace(/\bplease\b/g, ' ').replace(/[.!?,]/g, ' ').trim()
    .replace(/^(?:in|into|to)\s+/, '').replace(/\s+/g, ' ');
  return LANGUAGES.find(language => language.toLowerCase() === word) ?? '';
};

// Docs: the chosen format, or the one the message names (Word when it names none).
export const docTypeFor = (option: string | undefined, text: string) =>
  option === 'PowerPoint deck' || (!option && /power\s?point|slides?\b|\bdeck\b|presentation|\bpptx?\b/i.test(text)) ? 'ppt'
    : option === 'Excel sheet' || (!option && /excel|spreadsheet|\bsheet\b|\btable\b|\bcsv\b|\bxlsx\b/i.test(text)) ? 'excel'
    : 'word';

// "a PowerPoint about the water cycle" -> "the water cycle"
export const docTopicFrom = (text: string) =>
  text.trim().replace(/^(?:(?:please\s+)?(?:make|create|write|generate)\s+(?:me\s+)?)?(?:an?\s+)?(?:word\s+doc(?:ument)?|power\s?point(?:\s+(?:deck|presentation))?|excel\s+(?:sheet|file|spreadsheet)|spreadsheet|presentation|document|deck|slides|report|essay|table)\s+(?:about|on|for|of)\s+/i, '').trim()
    || text.trim();

// Images: the style option as words the image model understands.
export const IMAGE_STYLES: Record<string, string> = {
  Photo: 'realistic photograph',
  Illustration: 'digital illustration',
  Watercolor: 'watercolor painting',
  '3D render': '3D render',
  'Pixel art': 'pixel art',
  Anime: 'anime style',
};
export const withStyle = (description: string, option?: string) =>
  option && IMAGE_STYLES[option] ? `${description}, ${IMAGE_STYLES[option]}` : description;

// Extra instructions for the chat model while a shortcut is open (Docs uses document generation instead).
export const shortcutInstruction = ({ kind, option }: ShortcutState): string => {
  switch (kind) {
    case 'images':
      return `Images mode is on: every message asks for a picture. Reply only with the [[IMAGE: ...]] line. Write a complete English description, and keep details from earlier pictures when the user refers to them${option && IMAGE_STYLES[option] ? `. Style: ${IMAGE_STYLES[option]}` : ''}.`;
    case 'code':
      return `Code mode is on${option ? ` and the user chose ${option}` : ''}. Write complete, runnable code in one fenced block with a language tag, then a short explanation and how to run it. When the user pastes code, explain it or fix it as asked and show the corrected version.`;
    case 'math':
      return option === 'Just the answer'
        ? 'Math mode is on. Give the final answer in bold with one or two lines of working. Write math in LaTeX: $...$ inline and $$...$$ on its own line.'
        : 'Math mode is on. Solve the problem with the user step by step, like a patient tutor: number the steps, explain each one briefly, and end with the final answer in bold. Write math in LaTeX: $...$ inside sentences, and put each equation you work through on its own line as $$...$$. If the problem is unclear, ask one short question first.';
    case 'translate':
      return option
        ? `Translate mode is on. Translate the user's text into ${option}. Reply with the translation only, without notes. For a language with a non-Latin script, add the pronunciation in Latin letters on a new line.`
        : 'Translate mode is on, but no language is chosen yet. If the text is not English, translate it into English. If it is English, ask which language to translate it into.';
    case 'summary':
      return ({
        Short: 'Summary mode is on. Summarize the text, link or attached files in two or three sentences.',
        'Key points': 'Summary mode is on. Summarize the text, link or attached files as at most seven bullet points, most important first.',
        Detailed: 'Summary mode is on. Give a detailed summary of the text, link or attached files: a two-sentence overview, then short sections with headings.',
      } as Record<string, string>)[option ?? '']
        ?? 'Summary mode is on. Summarize the text, link or attached files: a one-sentence overview, then the key points as bullets.';
    default:
      return '';
  }
};

export const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;
