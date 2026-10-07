/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import localforage from 'localforage';
import { GoogleGenerativeAI, type Tool } from "@google/generative-ai";
import {
  Send,
  Bot,
  User,
  Loader2,
  Image as ImageIcon,
  Languages,
  Calculator,
  Code,
  FileText,
  Moon,
  Sun,
  Trash2,
  Download,
  Paperclip,
  X,
  Maximize2,
  Cpu,
  Copy,
  Check,
  BrainCircuit,
  Settings,
  ChevronDown,
  Sparkles,
  Zap,
  Mic,
  Volume2,
  VolumeX,
  MicOff,
  Plus,
  Presentation,
  Table,
  Brain
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { extractTextFromFile } from './utils/fileExtractor';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import pptxgen from 'pptxgenjs';
import * as XLSX from 'xlsx';

// API keys never ship to the browser. Every AI request goes to /api/* on this
// site, where netlify/functions/ai.mts adds the key on the server.
// The SDK requires a key string, so it gets a placeholder; the server ignores it.
const ai = new GoogleGenerativeAI('server-side-key');
const GEMINI_PROXY = { baseUrl: `${window.location.origin}/api/gemini` };

// Free image service used when the server has no Cloudflare credentials.
// Its anonymous tier refuses many requests (HTTP 402), so images retry a few times.
const pollinationsUrl = (prompt: string) =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${Math.floor(Math.random() * 1000000)}&nologo=true&width=1024&height=1024`;

// Photos are resized before upload: smaller requests, fewer tokens, and the
// server rejects request bodies above about 5 MB.
const shrinkImage = (file: File, maxSide = 1600): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image.'));
    };
    img.src = url;
  });

// Read-aloud helpers: speak plain sentences, not Markdown symbols.
const toSpeechText = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, '\nCode block omitted.\n')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/\|/g, ', ')
    .replace(/^[\s,:-]+$/gm, '')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '')
    .replace(/([^.!?:;,\s])\s*\n/g, '$1.\n')
    .replace(/\s+/g, ' ')
    .trim();

// Short chunks avoid Chrome cutting off long utterances after about 15 seconds.
const splitForSpeech = (text: string, maxLength = 220) => {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    if (current && (current + sentence).length > maxLength) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
};

const detectLanguage = (text: string) =>
  /[가-힯]/.test(text) ? 'ko'
    : /[぀-ヿ]/.test(text) ? 'ja'
    : /[一-鿿]/.test(text) ? 'zh'
    : /[Ѐ-ӿ]/.test(text) ? 'ru'
    : /[؀-ۿ]/.test(text) ? 'ar'
    : 'en';

// Voice choice as in the paper (Section III.E): voices whose name contains
// Google, Natural, Premium or Microsoft, preferring "UK English Female" or Aria.
// Replies in another language use a voice for that language.
const PREFERRED_VOICE = /Google|Natural|Premium|Microsoft/;
const pickVoice = (voices: SpeechSynthesisVoice[], lang: string) => {
  const sameLang = voices.filter(v => v.lang.toLowerCase().startsWith(lang));
  const preferred = sameLang.filter(v => PREFERRED_VOICE.test(v.name));
  return preferred.find(v => /UK English Female|Aria|Natural/.test(v.name)) ?? preferred[0] ?? sameLang[0];
};

// Chat history in each provider's format (paper Section III.F): Gemini uses
// {role, parts}, OpenRouter and Groq use OpenAI-style {role, content}.
type GeminiTurn = { role: string; parts: { text: string }[] };
type OpenAITurn = { role: string; content: string };
function convertHistoryForProvider(history: Message[], provider: 'gemini'): GeminiTurn[];
function convertHistoryForProvider(history: Message[], provider: 'openai'): OpenAITurn[];
function convertHistoryForProvider(history: Message[], provider: 'gemini' | 'openai'): (GeminiTurn | OpenAITurn)[] {
  return history.filter(m => !m.isStreaming).map(m => {
    const content = m.type === 'file' && m.files
      ? `[Attached Files: ${m.files.map(f => f.name).join(', ')}]\n${m.content}`
      : m.content;
    return provider === 'gemini'
      ? { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: content }] }
      : { role: m.role === 'user' ? 'user' : 'assistant', content };
  });
}

// Files the browser cannot read (PPTX, XLSX): the model gets the name and type only.
const unreadableFileNote = (file: AttachedFile) =>
  `\n[Attached file: ${file.name} (${file.type || 'unknown type'}). Its contents could not be read: binary parsing for this format is not supported yet.]\n`;

const PROVIDER_LABEL: Record<string, string> = { gemini: 'Gemini', openrouter: 'OpenRouter', groq: 'Groq' };

// Array of fallback models in strict priority order. For OpenRouter and Groq the
// server picks the model (GROQ_MODEL / OPENROUTER_MODEL in Netlify); these ids
// are the defaults, kept here for reference and logs.
const FALLBACK_MODELS = [
  { id: 'gemini-2.5-flash', type: 'gemini' },
  { id: 'openrouter/free', type: 'openrouter' },
  { id: 'openai/gpt-oss-120b', type: 'groq' }
];

// System identity injected into every model
const SYSTEM_INSTRUCTION = `You are Giscard AI, a highly capable and intelligent multimodal assistant created by Shema Nkindi Giscard.

If the user specifically asks who you are or who created you, answer briefly: "I am Giscard AI, created by Shema Nkindi Giscard." Do NOT mention your creator unless specifically asked about it. Do NOT mention any underlying AI model names (such as Gemini, Mistral, GPT, etc.) under any circumstances.

Provide concise, summarized, and clear responses. Keep your answers brief but informative, avoiding unnecessary long text unless explicitly asked for a detailed explanation. When asked for code, ensure it is robust and clean. When asked for icons/graphics, generate pure, valid SVG code. Always be helpful and articulate.`;

interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  type: 'text' | 'image' | 'file';
  files?: { name: string, type: string }[];
  timestamp: Date;
  isStreaming?: boolean;
  provider?: string; // which backend answered: gemini, openrouter or groq
}

export interface AttachedFile {
  name: string;
  data: string;
  type: string;
  extractedText?: string;
}

const CodeBlock = ({ children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4">
      <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-1.5 bg-white/10 hover:bg-white/20 rounded-md backdrop-blur-sm border border-white/10 text-white transition-all"
          title="Copy code"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="!bg-[#1e1e1e] !text-gray-200 !p-4 rounded-xl overflow-x-auto border border-white/5 font-mono text-sm leading-relaxed" {...props}>
        <code>{children}</code>
      </pre>
    </div>
  );
};

// Square frame capped at the screen width, so a 1024 px image cannot push the
// chat wider than the screen. Retries cover the free service's refusals.
const GeneratedImage = ({ src, onDownload }: { src: string; onDownload: (url: string, e: React.MouseEvent) => void }) => {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const isPollinations = src.startsWith('https://image.pollinations.ai/');
  const currentSrc = isPollinations && attempt > 0 ? `${src}&retry=${attempt}` : src;

  const handleError = () => {
    if (isPollinations && attempt < 3) {
      setTimeout(() => setAttempt(a => a + 1), 4000 * (attempt + 1));
    } else {
      setStatus('failed');
    }
  };

  const retry = () => {
    setAttempt(a => a + 1);
    setStatus('loading');
  };

  return (
    <div className="group relative w-[min(28rem,70vw)] max-w-full aspect-square rounded-xl overflow-hidden bg-black/5">
      {status !== 'failed' && (
        <img
          key={`${currentSrc}#${attempt}`}
          src={currentSrc}
          alt="AI generated"
          referrerPolicy="no-referrer"
          onLoad={() => setStatus('loaded')}
          onError={handleError}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[var(--text-secondary)]">
          <Loader2 size={20} className="animate-spin text-[var(--primary-color)]" />
          {attempt > 0 ? `Image service is busy, retrying (${attempt}/3)...` : 'Generating image...'}
        </div>
      )}
      {status === 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-xs text-[var(--text-secondary)]">
          <span>The free image service is busy right now.</span>
          <button onClick={retry} className="px-3 py-1.5 rounded-lg bg-[var(--primary-color)] text-white font-semibold">Try again</button>
        </div>
      )}
      {status === 'loaded' && (
        <button
          onClick={(e) => onDownload(currentSrc, e)}
          className="absolute top-2 right-2 p-2.5 bg-black/50 text-white rounded-full opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all hover:bg-[var(--primary-color)]"
          title="Download image"
        >
          <Download size={14} />
        </button>
      )}
    </div>
  );
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [fileProgress, setFileProgress] = useState<number | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isUploadingToAI, setIsUploadingToAI] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  // Shown when a backup provider answers in a chat that has images (they are not sent to it).
  const [fallbackImageNotice, setFallbackImageNotice] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(event.target as Node)) {
        setIsCreateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDocumentGeneration = async (type: string, topic: string, content: string) => {
    try {
      if (type === 'word') {
        const doc = new Document({
          sections: [{
            properties: {},
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: topic.toUpperCase(), bold: true, size: 36, font: "Calibri", color: "1f497d" })
                ],
                spacing: { after: 400 },
                heading: "Heading1"
              }),
              ...content.split('\n').filter(p => p.trim()).map(p => new Paragraph({
                children: [new TextRun({ text: p, size: 24, font: "Calibri" })],
                spacing: { after: 200 }
              }))
            ]
          }]
        });
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${topic.replace(/[^a-z0-9]/gi, '_')}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (type === 'ppt') {
        const pptx = new pptxgen();
        const slides = content.split('---SLIDE---');
        slides.forEach((slideContent) => {
          const lines = slideContent.split('\n').filter(l => l.trim());
          if (lines.length > 0) {
            const slide = pptx.addSlide();
            slide.addText(lines[0], { x: 0.5, y: 0.5, w: '90%', h: 1, fontSize: 32, bold: true, color: '363636' });
            if (lines.length > 1) {
              const bullets = lines.slice(1).map(l => l.replace(/^[-*•]\s*/, ''));
              slide.addText(bullets.join('\n'), { x: 0.5, y: 1.5, w: '90%', h: 4, fontSize: 18, bullet: true, color: '666666' });
            }
          }
        });
        await pptx.writeFile({ fileName: `${topic.replace(/[^a-z0-9]/gi, '_')}.pptx` });
      } else if (type === 'excel') {
        const rows = content.split('\n').filter(r => r.trim()).map(r => r.split(',').map(c => c.trim()));
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        XLSX.writeFile(wb, `${topic.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
      }
    } catch (e) {
      console.error('Doc gen error:', e);
    }
  };
  
  // Speech Recognition Setup
  const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (SpeechRecognitionAPI) {
      recognitionRef.current = new SpeechRecognitionAPI();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setInput((prev) => {
           // We might want to handle prev nicely, but resetting or appending smartly is better
           // Since it's continuous interim results, we'll just set it
           return currentTranscript;
        });
      };
      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (!SpeechRecognitionAPI) {
        alert("Speech Recognition is not supported by your browser.");
        return;
      }
      setInput(''); // clear input when starting new dictation
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  // Browsers load voices asynchronously; without this the first playback falls
  // back to the default (often robotic) voice.
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const speechRunRef = useRef(0);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loadVoices = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      window.speechSynthesis.cancel();
    };
  }, []);

  const toggleMessageTTS = (messageId: string, text: string) => {
    if (!('speechSynthesis' in window)) {
      alert("Read aloud is not supported by your browser.");
      return;
    }
    const synth = window.speechSynthesis;
    // Each playback gets a number, so events from a cancelled playback
    // cannot reset the button of the one that replaced it.
    const run = ++speechRunRef.current;
    synth.cancel();
    if (playingMessageId === messageId) {
      setPlayingMessageId(null);
      return;
    }

    const spoken = toSpeechText(text);
    if (!spoken) return;
    const lang = detectLanguage(spoken);
    const voice = pickVoice(voicesRef.current.length ? voicesRef.current : synth.getVoices(), lang);
    const chunks = splitForSpeech(spoken);
    const finish = () => { if (speechRunRef.current === run) setPlayingMessageId(null); };

    setPlayingMessageId(messageId);
    // Chrome sometimes drops speech queued in the same tick as cancel().
    setTimeout(() => {
      if (speechRunRef.current !== run) return;
      chunks.forEach((chunk, i) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = voice?.lang ?? lang;
        if (voice) utterance.voice = voice;
        utterance.pitch = 1.05; // as in the paper: slightly more energetic
        utterance.rate = 1.05;
        utterance.onerror = finish;
        if (i === chunks.length - 1) utterance.onend = finish;
        synth.speak(utterance);
      });
    }, 100);
  };

  const handleImageDownload = async (url: string, e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      if (!response.ok || !blob.type.startsWith('image/')) throw new Error('Not an image');
      const extension = blob.type === 'image/svg+xml' ? 'svg' : blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `giscard-ai-image-${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      window.open(url, '_blank');
    }
  };

  // Load from localforage (allows unlimited images/docs per session storage)
  useEffect(() => {
    localforage.getItem<string>('giscard-ai-chat-history').then((saved) => {
      if (saved) {
        try {
          const parsed: Message[] = JSON.parse(saved);
          setMessages(parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));
        } catch (e) {
          console.error('Failed to parse chat history', e);
        }
      }
    }).catch(console.error);
  }, []);

  // Save to localforage
  useEffect(() => {
    if (messages.length > 0) {
      localforage.setItem('giscard-ai-chat-history', JSON.stringify(messages)).catch(console.error);
    }
  }, [messages]);


  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const clearChat = () => {
    setMessages([]);
    localforage.removeItem('giscard-ai-chat-history').catch(console.error);
  };

  const downloadChat = () => {
    if (messages.length === 0) return;

    const chatText = messages.map(msg => {
      const time = msg.timestamp.toLocaleString();
      const role = msg.role === 'user' ? 'YOU' : 'Giscard AI';
      const content = msg.type === 'image' ? '[Generated Image]' :
        msg.type === 'file' ? `[Attached Files: ${msg.files?.map(f => f.name).join(', ')}]` : msg.content;
      return `[${time}] ${role}:\n${content}\n${'-'.repeat(40)}`;
    }).join('\n\n');

    const blob = new Blob([chatText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `giscard-ai-chat-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setFileProgress(0);
    const newFiles: AttachedFile[] = [];
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Photos are still resized before upload, so requests stay small.
      const isPhoto = file.type.startsWith('image/') && file.type !== 'image/svg+xml';
      if (file.size > MAX_FILE_SIZE) {
        alert(`File ${file.name} is too large. Max size is 5MB.`);
        continue;
      }

      try {
        let extractedText = undefined;
        if (!file.type.startsWith('image/')) {
          extractedText = await extractTextFromFile(file);
        }

        const base64 = isPhoto ? await shrinkImage(file) : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newFiles.push({
          name: file.name,
          data: base64.split(',')[1],
          type: isPhoto ? 'image/jpeg' : file.type,
          extractedText
        });
      } catch (err: any) {
        alert(`Error reading file ${file.name}: ${err.message}`);
      }

      setFileProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setAttachedFiles(prev => [...prev, ...newFiles]);
    // Ensure progress bar is visible for at least a moment
    setTimeout(() => setFileProgress(null), 800);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const generateResponse = async (userInput: string) => {
    if (!userInput.trim() && attachedFiles.length === 0) return;
    setIsLoading(true);

    // Simulate "Upload to AI" progress with a guaranteed minimum visibility
    setIsUploadingToAI(true);
    await new Promise(resolve => setTimeout(resolve, 1200)); 
    setIsUploadingToAI(false);

    const currentFiles = [...attachedFiles];

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput || (currentFiles.length > 0 ? `Uploaded ${currentFiles.length} file(s)` : ''),
      type: currentFiles.length > 0 ? 'file' : 'text',
      files: currentFiles.map(f => ({ name: f.name, type: f.type })),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setAttachedFiles([]);

    // Dynamic System Instruction with Timezone and Local Time
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let dynamicSystemInstruction = `${SYSTEM_INSTRUCTION}\n\n[SYSTEM INFO]\nThe current date and time is: ${new Date().toLocaleString()}, in the timezone: ${userTimeZone}. Use this to accurately calculate global times if asked.`;

    if (userInput.toLowerCase().includes('creator') || userInput.toLowerCase().includes('who made you') || userInput.toLowerCase().includes('who created you') || userInput.toLowerCase().includes('who are you')) {
       dynamicSystemInstruction += `\n\n[CREATOR BACKGROUND]: Shema Nkindi Giscard is a versatile full-stack software developer based in Seoul, Korea, with expertise in web development (Python, React, Flask, Django), computer graphics (Blender, OpenGL), cybersecurity (cryptography, network recon), and AI/ML. Projects: Ze Video Downloader, Ze Matrix, Cipher Shield Suite, LogoScope. Portfolio: https://www.giscard.me`;
    }

    let isDocGen = false;
    let docType = '';
    let docTopic = '';

    const lowerInput = userInput.toLowerCase();
    if (lowerInput.startsWith('create a word doc about ')) {
      isDocGen = true; docType = 'word'; docTopic = userInput.substring(24).trim();
    } else if (lowerInput.startsWith('create a powerpoint about ')) {
      isDocGen = true; docType = 'ppt'; docTopic = userInput.substring(26).trim();
    } else if (lowerInput.startsWith('create an excel sheet about ')) {
      isDocGen = true; docType = 'excel'; docTopic = userInput.substring(28).trim();
    }

    if (isDocGen) {
      if (docType === 'word') {
         dynamicSystemInstruction += `\n\nThe user requested a Word document about "${docTopic}". Please provide ONLY the raw content for the document. No markdown blocks wrapping the text. Include a title, introduction, 3-5 main sections, and a conclusion.`;
      } else if (docType === 'ppt') {
         dynamicSystemInstruction += `\n\nThe user requested a PowerPoint presentation about "${docTopic}". Please provide the content in strict format. Separate slides with "---SLIDE---". For each slide, put the title on the first line, and bullet points on following lines. No markdown blocks.`;
      } else if (docType === 'excel') {
         dynamicSystemInstruction += `\n\nThe user requested an Excel sheet about "${docTopic}". Please provide ONLY a valid CSV format table. No markdown tables or code blocks. The first row must be headers, followed by data rows.`;
      }
    }

    // Check for image generation request using robust regex
    const imageMatch = lowerInput.match(/^(?:generate|create|make|draw|imagine|show me)(?: me)?(?: an?)?\s+(.*(?:image|picture|photo|drawing).*)/i) 
                    || lowerInput.match(/^(?:generate|create|make|draw|imagine|show me)(?: me)?(?: an?)?\s+(.*)/i);
    
    let isImageGen = false;
    let imagePrompt = '';
    
    // If it mentions image/drawing/picture AND an action verb, or starts with draw/imagine
    if ((lowerInput.includes('generate') || lowerInput.includes('create') || lowerInput.includes('draw') || lowerInput.includes('imagine')) && 
        (lowerInput.includes('image') || lowerInput.includes('picture') || lowerInput.includes('photo') || lowerInput.startsWith('draw') || lowerInput.startsWith('imagine'))) {
        
        // Prevent avatar requests from being caught here
        if (!lowerInput.includes('avatar')) {
            isImageGen = true;
            imagePrompt = lowerInput
                .replace(/^(generate|create|make|draw|imagine|show me)(\s+me)?(\s+an?)?\s+/i, '')
                .replace(/\b(image|picture|photo)s?\b/gi, '')
                .trim() || userInput;
        }
    }

    // Check for avatar generation request
    let isAvatarGen = false;
    let avatarSeed = '';
    if (lowerInput.includes('avatar') && (lowerInput.includes('create') || lowerInput.includes('generate') || lowerInput.includes('draw') || lowerInput.includes('make'))) {
        isAvatarGen = true;
        avatarSeed = lowerInput
            .replace(/^(generate|create|make|draw|imagine|show me)(\s+me)?(\s+an?)?\s+/i, '')
            .replace(/\bavatars?\b/gi, '')
            .replace(/\bfor\b/gi, '')
            .trim() || userInput;
    }

    let modelIndex = 0;
    let success = false;

    const aiMessageId = (Date.now() + 1).toString();
    const initialAiMessage: Message = {
      id: aiMessageId,
      role: 'ai',
      content: '',
      type: 'text',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, initialAiMessage]);
    setIsLoading(false);

    // Image generation: Cloudflare through /api/image when the server has
    // credentials, otherwise the free Pollinations service (retried by GeneratedImage).
    if (isImageGen && imagePrompt.trim() !== '') {
        const prompt = `${imagePrompt} highly detailed, masterpiece`;
        let imageSrc = '';
        try {
          const res = await fetch('/api/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
          });
          if (res.ok) imageSrc = (await res.json()).image ?? '';
        } catch {
          // Fall back to Pollinations below.
        }

        setMessages(prev => prev.map(msg =>
            msg.id === aiMessageId
                ? { ...msg, type: 'image', content: imageSrc || pollinationsUrl(prompt), isStreaming: false }
                : msg
        ));

        return; // Skip LLM generation
    }

    // Handle Avatar Generation via DiceBear instantly
    if (isAvatarGen && avatarSeed.trim() !== '') {
        const encodedSeed = encodeURIComponent(avatarSeed);
        const avatarUrl = `https://api.dicebear.com/8.x/bottts/svg?seed=${encodedSeed}`;
        
        setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
                ? { ...msg, type: 'image', content: avatarUrl, isStreaming: false } 
                : msg
        ));
        
        return; // Skip LLM generation
    }

    while (modelIndex < FALLBACK_MODELS.length && !success) {
      const currentModel = FALLBACK_MODELS[modelIndex];

      try {
        setIsThinking(true);
        let fullText = '';

        if (currentModel.type === 'gemini') {
          const geminiHistory = convertHistoryForProvider(messages, 'gemini');

          const currentParts: any[] = [{ text: userInput || "Analyze the following." }];

          currentFiles.forEach(file => {
             if (file.extractedText) {
                currentParts.push({ text: `\n--- Document: ${file.name} ---\n${file.extractedText}\n--- End Document ---\n` });
             } else if (file.type.startsWith('image/')) {
                currentParts.push({
                   inlineData: {
                      data: file.data, // raw base64 string
                      mimeType: file.type
                   }
                });
             } else {
                currentParts.push({ text: unreadableFileNote(file) });
             }
          });

          // SDK 0.24 types only know the older googleSearchRetrieval tool; Gemini 2.x expects googleSearch.
          const searchTool = { googleSearch: {} } as unknown as Tool;
          const model = ai.getGenerativeModel({ model: currentModel.id, tools: [searchTool] }, GEMINI_PROXY);
          const responseStream = await model.generateContentStream({
             contents: [...geminiHistory, { role: 'user', parts: currentParts }],
             systemInstruction: dynamicSystemInstruction,
             generationConfig: { temperature: 0.5 }
          });

          for await (const chunk of responseStream.stream) {
             const chunkText = chunk.text();
             if (chunkText) {
                fullText += chunkText;
                setMessages(prev => prev.map(msg =>
                   msg.id === aiMessageId ? { ...msg, content: fullText } : msg
                ));
             }
          }
        } else {
          // Handle Groq and OpenRouter via OpenAI Compatible Fetch
          const aiMessages: any[] = [
            { role: 'system', content: dynamicSystemInstruction },
            ...convertHistoryForProvider(messages, 'openai')
          ];

          const currentContent: any[] = [{ type: 'text', text: userInput || "Analyze the following." }];

          // Images go to Gemini only (paper Section III.F); the backup providers get text.
          currentFiles.forEach(file => {
            if (file.extractedText) {
              currentContent.push({ type: 'text', text: `\n--- Document: ${file.name} ---\n${file.extractedText}\n--- End Document ---\n` });
            } else if (!file.type.startsWith('image/')) {
              currentContent.push({ type: 'text', text: unreadableFileNote(file) });
            }
          });

          aiMessages.push({ role: 'user', content: currentContent });

          // The server adds the Groq or OpenRouter key and picks the model (netlify/functions/ai.mts).
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: currentModel.type,
              messages: aiMessages,
              temperature: 0.5,
            })
          });

          if (!response.ok) {
             const errData = await response.json().catch(() => ({}));
             throw new Error(`${response.status} ${errData?.error?.message || `${currentModel.type} error`}`);
          }

          setIsThinking(false);
          const reader = response.body?.getReader();
          const decoder = new TextDecoder("utf-8");

          if (reader) {
            // Network chunks can end mid-line, so keep the unfinished line for the next read.
            let buffered = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffered += decoder.decode(value, { stream: true });
              const lines = buffered.split('\n');
              buffered = lines.pop() ?? '';

              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const dataText = line.slice(5).trim();
                if (dataText === '[DONE]') break;

                try {
                  const data = JSON.parse(dataText);
                  const delta = data.choices[0]?.delta?.content;
                  if (delta) {
                    fullText += delta;
                    setMessages(prev => prev.map(msg =>
                      msg.id === aiMessageId ? { ...msg, content: fullText } : msg
                    ));
                  }
                } catch (e) {
                  // Ignore partial JSON parse errors
                }
              }
            }
          }
        }

        if (isDocGen) {
           await handleDocumentGeneration(docType, docTopic, fullText);
           setMessages(prev => prev.map(msg =>
              msg.id === aiMessageId ? { ...msg, content: `✅ I've created the ${docType.toUpperCase()} file about "${docTopic}". It should download automatically!`, isStreaming: false, provider: currentModel.type } : msg
           ));
        } else {
           setMessages(prev => prev.map(msg =>
             msg.id === aiMessageId ? { ...msg, isStreaming: false, provider: currentModel.type } : msg
           ));
        }
        const sessionHasImages = [...messages.flatMap(m => m.files ?? []), ...currentFiles].some(f => f.type.startsWith('image/'));
        setFallbackImageNotice(currentModel.type !== 'gemini' && sessionHasImages);
        success = true;
      } catch (error: any) {
        console.error(`Error with model ${currentModel.id}:`, error);

        if (modelIndex < FALLBACK_MODELS.length - 1) {
          modelIndex++;
          console.log(`Fallback: Switching to next model ${FALLBACK_MODELS[modelIndex].id}`);
          continue;
        }

        setIsThinking(false);
        let errorMsg = 'I encountered an error. This might be due to file size, type, or API quota. Please try again.';
        if (error?.message?.includes('quota') || error?.message?.includes('429')) {
          errorMsg = '**Too many requests (Error 429)**: the free AI limits are used up for the moment. Wait a minute and try again.';
        } else if (/413|too large/i.test(error?.message ?? '')) {
          errorMsg = 'Those attachments are too large to send. Keep the total under 5 MB.';
        }

        setMessages(prev => prev.map(msg =>
          msg.id === aiMessageId ? { ...msg, content: errorMsg, isStreaming: false } : msg
        ));
        success = true;
      }
    }
    setIsLoading(false);
  };

  const removeStagedFile = (idxToRemove: number) => {
    setAttachedFiles(prev => prev.filter((_, idx) => idx !== idxToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((input.trim() || attachedFiles.length > 0) && !isLoading) {
      generateResponse(input);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-300 p-2 md:p-6 lg:p-8 flex items-center justify-center">
      <div className="main-container flex flex-col w-full h-[95vh] max-h-[1000px] shadow-2xl border border-[var(--bg-secondary)]">
        {/* Header */}
        <header className="flex justify-between items-center mb-4 border-b border-[var(--bg-secondary)] pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-[var(--primary-color)] to-[var(--secondary-color)] rounded-xl text-white shadow-lg">
              <Cpu size={28} className="animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-[var(--primary-color)] to-[var(--accent-color)] bg-clip-text text-transparent">Giscard AI</h1>
              <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-widest font-semibold"></p>
            </div>
          </div>
          <div className="flex gap-1 md:gap-2">
            <button onClick={downloadChat} disabled={messages.length === 0} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-all text-[var(--text-secondary)] disabled:opacity-20" title="Export History"><Download size={18} /></button>
            <button onClick={clearChat} disabled={messages.length === 0} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-all text-[var(--text-secondary)] disabled:opacity-20" title="Clear Chat"><Trash2 size={18} /></button>
            <div className="w-[1px] h-6 bg-[var(--bg-secondary)] mx-1" />
            <button onClick={toggleTheme} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-all text-[var(--text-secondary)]">
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>

        {/* Features Grid */}
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto py-8">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-2">How can I help you today?</h2>
              <p className="text-[var(--text-secondary)]">Upload documents, generate art, or just chat.</p>
            </motion.div>
            <div className="grid grid-cols-3 gap-2 w-full max-w-2xl px-2">
              {[
                { icon: <FileText size={18} />, title: "Docs", color: "var(--primary-color)" },
                { icon: <ImageIcon size={18} />, title: "Images", color: "var(--accent-color)" },
                { icon: <Code size={18} />, title: "Code", color: "var(--secondary-color)" },
                { icon: <Calculator size={18} />, title: "Math", color: "var(--success-color)" },
                { icon: <Languages size={18} />, title: "Translate", color: "var(--warning-color)" },
                { icon: <Maximize2 size={18} />, title: "Summary", color: "var(--primary-color)" }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  whileHover={{ y: -2 }}
                  className="info-card !m-0 flex flex-col items-center justify-center text-center gap-1 p-2 cursor-pointer hover:border-[var(--primary-color)] border border-transparent transition-all rounded-xl"
                >
                  <div style={{ color: item.color }} className="mb-0.5">{item.icon}</div>
                  <h3 className="font-bold text-[10px] md:text-xs leading-none">{item.title}</h3>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className={`overflow-y-auto pb-12 pr-2 space-y-6 custom-scrollbar ${messages.length === 0 ? 'hidden' : 'flex-1 mb-4'}`}>
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className={`p-2.5 rounded-xl h-fit shadow-sm ${msg.role === 'user' ? 'bg-[var(--primary-color)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--primary-color)]'}`}>
                  {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                </div>
                {/* min-w-0 lets the bubble shrink: flex items otherwise grow to fit wide content */}
                <div className={`chat-message min-w-0 shadow-sm ${msg.role === 'user' ? 'user-message !bg-gradient-to-br from-[var(--primary-color)] to-[var(--secondary-color)]' : 'ai-message border border-[var(--bg-secondary)]'}`}>
                  {msg.type === 'image' ? (
                    <GeneratedImage src={msg.content} onDownload={handleImageDownload} />
                  ) : msg.type === 'file' ? (
                    <div className="flex flex-col gap-2">
                       {msg.content && (
                          <div className={`text-sm md:text-base whitespace-pre-wrap leading-relaxed ${msg.role === 'user' ? 'text-white' : ''}`}>
                             {msg.content}
                          </div>
                       )}
                      <div className="flex flex-wrap gap-2 mt-1">
                        {msg.files?.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 p-2 bg-white/10 rounded-lg w-fit">
                            <FileText size={16} />
                            <div className="flex flex-col">
                              <span className="text-xs font-medium truncate max-w-[150px]">{f.name}</span>
                              <span className="text-[9px] opacity-70">Uploaded</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : msg.role === 'user' ? (
                     <div className="text-sm md:text-base text-white whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                     </div>
                  ) : (
                    <div className="prose dark:prose-invert max-w-none leading-relaxed text-sm md:text-base">
                      {msg.content ? (
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code({ node, inline, className, children, ...props }: any) {
                                const match = /language-(\w+)/.exec(className || '');
                                return !inline && match ? (
                                  <CodeBlock language={match[1]} {...props}>{String(children).replace(/\n$/, '')}</CodeBlock>
                                ) : (
                                  <code className="bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded text-[var(--accent-color)] font-mono text-[13px]" {...props}>
                                    {children}
                                  </code>
                                );
                              }
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                      ) : msg.isStreaming ? (
                          <div className="flex items-center gap-3">
                             <BrainCircuit size={18} className="animate-pulse text-[var(--primary-color)]" />
                             <div className="flex items-center gap-2">
                               <div className="flex gap-1">
                                 <div className="w-1 h-1 bg-[var(--primary-color)] rounded-full animate-bounce" />
                                 <div className="w-1 h-1 bg-[var(--primary-color)] rounded-full animate-bounce [animation-delay:0.2s]" />
                                 <div className="w-1 h-1 bg-[var(--primary-color)] rounded-full animate-bounce [animation-delay:0.4s]" />
                               </div>
                               <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--primary-color)]">Giscard AI is thinking...</span>
                             </div>
                          </div>
                      ) : null}
                    </div>
                  )}
                  <div className={`flex items-center justify-between mt-2 pt-2 border-t border-white/5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`text-[9px] opacity-40 font-mono ${msg.role === 'user' ? 'text-right' : ''}`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {msg.role === 'ai' && msg.provider && <span title="AI provider that answered"> · via {PROVIDER_LABEL[msg.provider] ?? msg.provider}</span>}
                    </div>
                    {msg.role === 'ai' && !msg.isStreaming && msg.type === 'text' && (
                      <button 
                        onClick={() => toggleMessageTTS(msg.id, msg.content)}
                        className="p-1 hover:bg-[var(--bg-secondary)] rounded transition-colors text-[var(--text-secondary)] opacity-50 hover:opacity-100"
                        title="Read aloud"
                      >
                        {playingMessageId === msg.id ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="relative">
          {fallbackImageNotice && !fileProgress && !isUploadingToAI && attachedFiles.length === 0 && (
            <div role="status" className="absolute bottom-full left-0 w-full mb-2 flex items-start gap-2 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100 border border-amber-400 rounded-lg p-3 text-xs shadow-xl">
              <span className="flex-1">A backup model answered. It cannot see images, so the images in this chat were left out of its answer.</span>
              <button onClick={() => setFallbackImageNotice(false)} className="p-0.5 rounded hover:bg-amber-200/40" aria-label="Dismiss notice"><X size={14} /></button>
            </div>
          )}
          {fileProgress !== null && (
            <div className="absolute bottom-full left-0 w-full mb-2 bg-[var(--bg-secondary)] rounded-lg p-3 shadow-xl border border-[var(--primary-color)]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-[var(--primary-color)]" />
                  Reading File...
                </span>
                <span className="text-xs font-mono font-bold text-[var(--primary-color)]">{fileProgress}%</span>
              </div>
              <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${fileProgress}%` }}
                  className="h-full bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)]"
                />
              </div>
            </div>
          )}
          {isUploadingToAI && (
            <div className="absolute bottom-full left-0 w-full mb-2 bg-[var(--bg-secondary)] rounded-lg p-3 shadow-xl border border-[var(--primary-color)]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-[var(--primary-color)]" />
                  Uploading to AI limits...
                </span>
              </div>
              <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 0.8, ease: "linear" }}
                  className="h-full bg-gradient-to-r from-[var(--primary-color)] to-[var(--secondary-color)]"
                />
              </div>
            </div>
          )}

          {attachedFiles.length > 0 && !fileProgress && !isUploadingToAI && (
            <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="absolute bottom-full left-0 mb-2 flex gap-2 overflow-x-auto max-w-full pb-1 custom-scrollbar">
              {attachedFiles.map((f, idx) => (
                <div key={idx} className="p-2 bg-[var(--bg-secondary)] rounded-lg flex items-center gap-2 shadow-lg border border-[var(--primary-color)] whitespace-nowrap">
                  <FileText size={16} className="text-[var(--primary-color)]" />
                  <span className="text-xs truncate max-w-[120px]">{f.name}</span>
                  <button onClick={() => removeStagedFile(idx)} className="p-1 hover:bg-red-500/10 text-red-500 rounded-full"><X size={14} /></button>
                </div>
              ))}
            </motion.div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2 items-end bg-[var(--bg-secondary)] p-2 rounded-2xl border-2 border-transparent focus-within:border-[var(--primary-color)] transition-all">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 md:p-3 text-[var(--text-secondary)] hover:text-[var(--primary-color)] transition-colors"
            >
              <Paperclip size={20} className="md:w-[22px] md:h-[22px]" />
            </button>
            <div className="relative" ref={createMenuRef}>
              <button
                type="button"
                onClick={() => setIsCreateMenuOpen(!isCreateMenuOpen)}
                className="p-2 md:p-3 text-[var(--text-secondary)] hover:text-[var(--primary-color)] transition-colors"
                title="Create Document"
              >
                <Plus size={20} className="md:w-[22px] md:h-[22px]" />
              </button>
              {isCreateMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-48 bg-[var(--bg-primary)] border border-[var(--bg-secondary)] rounded-xl shadow-2xl py-2 z-50">
                   <button type="button" onClick={() => { setInput("Create a Word doc about "); setIsCreateMenuOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] flex items-center gap-2 text-sm transition-colors cursor-pointer"><FileText size={16} className="text-[var(--primary-color)]"/> Word Document</button>
                   <button type="button" onClick={() => { setInput("Create a PowerPoint about "); setIsCreateMenuOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] flex items-center gap-2 text-sm transition-colors cursor-pointer"><Presentation size={16} className="text-orange-500"/> PowerPoint Slide</button>
                   <button type="button" onClick={() => { setInput("Create an Excel sheet about "); setIsCreateMenuOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] flex items-center gap-2 text-sm transition-colors cursor-pointer"><Table size={16} className="text-green-500"/> Excel Sheet</button>
                   <button type="button" onClick={() => { setInput("generate an image of "); setIsCreateMenuOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] flex items-center gap-2 text-sm transition-colors cursor-pointer"><ImageIcon size={16} className="text-purple-500"/> Generate Image</button>
                   <button type="button" onClick={() => { setInput("Create a quiz about "); setIsCreateMenuOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] flex items-center gap-2 text-sm transition-colors cursor-pointer"><Brain size={16} className="text-pink-500"/> Quiz / Flashcards</button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleListening}
              className={`p-2 md:p-3 transition-colors ${isListening ? 'text-red-500 animate-pulse' : 'text-[var(--text-secondary)] hover:text-[var(--primary-color)]'}`}
              title="Dictate"
            >
              {isListening ? <MicOff size={20} className="md:w-[22px] md:h-[22px]" /> : <Mic size={20} className="md:w-[22px] md:h-[22px]" />}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.csv,.md,.png,.jpg,.jpeg,.svg"
            />
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-resize textarea
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Message..."
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-transparent border-none focus:ring-0 p-3 text-sm resize-none max-h-32 overflow-y-auto"
            />
            <button
              type="submit"
              disabled={(!input.trim() && attachedFiles.length === 0) || isLoading}
              className="p-3 bg-[var(--primary-color)] text-white rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100"
            >
              <Send size={20} />
            </button>
          </form>
          <div className="flex justify-between items-center mt-2 px-1">
            <p className="text-[9px] text-[var(--text-secondary)] opacity-50">Giscard AI can make mistakes. Verify important info.</p>
            {input.length > 0 && (
              <span className={`text-[9px] font-mono opacity-60 ${input.length > 3800 ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>
                {input.length}/4000
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
