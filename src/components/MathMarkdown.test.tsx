import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MathMarkdown, { normalizeMath } from './MathMarkdown';

describe('normalizeMath', () => {
  it('turns \\[ \\] into a $$ block on its own lines', () => {
    expect(normalizeMath('\\[ x^2 \\]')).toBe('\n$$\nx^2\n$$\n');
  });

  it('turns \\( \\) into inline $ math', () => {
    expect(normalizeMath('area \\( \\pi r^2 \\) here')).toBe('area $\\pi r^2$ here');
  });

  it('splits a one-line $$...$$ and keeps its indent', () => {
    expect(normalizeMath('   $$a+b$$')).toBe('   $$\n   a+b\n   $$');
  });
});

describe('MathMarkdown', () => {
  it('renders markdown and KaTeX math to HTML', () => {
    const html = renderToStaticMarkup(<MathMarkdown>{'**Step 1**\n\n\\[ x^2 + 1 \\]'}</MathMarkdown>);
    expect(html).toContain('<strong>Step 1</strong>');
    expect(html).toContain('katex-display');
  });
});
