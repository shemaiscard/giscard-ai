import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { extractTextFromFile } from './fileExtractor';

// The sample files were made once with Python (reportlab and python-docx).
const fixture = (name: string, type: string) =>
  new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name, { type });

beforeAll(() => {
  // The app loads the PDF worker from unpkg. The tests use the copy in node_modules, so they run offline.
  const worker = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
});

describe('extractTextFromFile', () => {
  it('returns text and markdown files as they are', async () => {
    const file = new File(['# Notes\nline two'], 'notes.md', { type: '' });
    expect(await extractTextFromFile(file)).toBe('# Notes\nline two');
  });

  it('reads the text of every page of a PDF', async () => {
    const text = await extractTextFromFile(fixture('two-pages.pdf', 'application/pdf'));
    expect(text).toContain('First page of the sample PDF');
    expect(text).toContain('Second page of the sample PDF');
  });

  it('reads the paragraphs of a Word document', async () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const text = await extractTextFromFile(fixture('two-paragraphs.docx', docx));
    expect(text).toContain('Sample Word document');
    expect(text).toContain('It has two paragraphs.');
  });

  it('returns an empty string for a type it cannot read, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await extractTextFromFile(new File(['x'], 'photo.png', { type: 'image/png' }))).toBe('');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
