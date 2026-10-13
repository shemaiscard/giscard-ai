import { describe, expect, it } from 'vitest';
import { docTopicFrom, docTypeFor, languageFromReply, shortcutInstruction, withStyle } from './shortcuts';

describe('languageFromReply', () => {
  it('accepts a language name in any case', () => {
    expect(languageFromReply('Korean')).toBe('Korean');
    expect(languageFromReply('kinyarwanda')).toBe('Kinyarwanda');
  });

  it('ignores "to", "into", "please" and punctuation', () => {
    expect(languageFromReply('to french')).toBe('French');
    expect(languageFromReply('Spanish please!')).toBe('Spanish');
    expect(languageFromReply('into Swahili.')).toBe('Swahili');
  });

  it('returns an empty string when the reply names no known language', () => {
    expect(languageFromReply('Klingon')).toBe('');
    expect(languageFromReply('translate this sentence')).toBe('');
  });
});

describe('docTypeFor', () => {
  it('uses the chosen option over the words in the message', () => {
    expect(docTypeFor('Excel sheet', 'make slides about volcanoes')).toBe('excel');
  });

  it('reads the format from the message when no option is chosen', () => {
    expect(docTypeFor(undefined, 'Make slides about volcanoes')).toBe('ppt');
    expect(docTypeFor(undefined, 'a spreadsheet of my grades')).toBe('excel');
  });

  it('falls back to Word', () => {
    expect(docTypeFor(undefined, 'a cover letter for an internship')).toBe('word');
  });
});

describe('docTopicFrom', () => {
  it('strips the request and keeps the topic', () => {
    expect(docTopicFrom('a PowerPoint about the water cycle')).toBe('the water cycle');
    expect(docTopicFrom('Please make me a Word document on renewable energy')).toBe('renewable energy');
  });

  it('returns the text unchanged when it is already a topic', () => {
    expect(docTopicFrom('renewable energy')).toBe('renewable energy');
  });
});

describe('withStyle', () => {
  it('adds the words for a known image style', () => {
    expect(withStyle('a red fox', 'Watercolor')).toBe('a red fox, watercolor painting');
  });

  it('leaves the description alone without a known style', () => {
    expect(withStyle('a red fox')).toBe('a red fox');
    expect(withStyle('a red fox', 'Unknown')).toBe('a red fox');
  });
});

describe('shortcutInstruction', () => {
  it('names the target language in Translate mode', () => {
    expect(shortcutInstruction({ kind: 'translate', option: 'Korean', messageId: 'm1' })).toContain('into Korean');
  });

  it('adds nothing for Docs, which uses document generation', () => {
    expect(shortcutInstruction({ kind: 'docs', messageId: 'm1' })).toBe('');
  });
});
