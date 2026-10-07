// Markdown with LaTeX math rendered by KaTeX. App.tsx loads this file only when a
// Math answer is on screen, so other chats do not download KaTeX.
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// remark-math centers an equation only when its $$ fences sit on their own lines,
// and it ignores \[ \] and \( \). Models write all of these, so rewrite them first.
export const normalizeMath = (text: string) =>
  text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
    .replace(/\\\((.+?)\\\)/g, (_, tex: string) => `$${tex.trim()}$`)
    .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, tex: string) => `$$\n${tex.trim()}\n$$`);

export default function MathMarkdown({ children, components }: { children: string; components?: Components }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
      {normalizeMath(children)}
    </ReactMarkdown>
  );
}
