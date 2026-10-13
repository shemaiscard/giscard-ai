// The legacy build adds the newest JavaScript features (Promise.try and others) only when a
// browser lacks them, so PDF upload keeps working on older phones and browsers.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import * as mammoth from 'mammoth';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;

export const extractTextFromFile = async (file: File): Promise<string> => {
  const extension = file.name.split('.').pop()?.toLowerCase();

  // 1. Text or Markdown
  if (file.type.startsWith('text/') || extension === 'md' || extension === 'csv') {
    return await file.text();
  }

  // 2. PDF Parsing via pdfjs-dist
  if (file.type === 'application/pdf' || extension === 'pdf') {
    return await extractPdfText(file);
  }

  // 3. DOCX Parsing via mammoth
  if (extension === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return await extractDocxText(file);
  }

  console.warn(`Unsupported file type for local text extraction: ${extension || file.type}. Falling back to API parsing.`);
  return "";
};

const extractPdfText = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => item.str);
      fullText += strings.join(' ') + '\n';
    }
    
    return fullText.trim();
  } catch (error) {
    console.error("PDF extraction failed:", error);
    throw new Error("Failed to read PDF document.");
  }
};

const extractDocxText = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value.trim();
  } catch (error) {
    console.error("DOCX extraction failed:", error);
    throw new Error("Failed to read DOCX document.");
  }
};
