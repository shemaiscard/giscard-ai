/**
 * Read-aloud voices, server-side so the keys stay hidden.
 *
 * English replies use Groq Orpheus (GROQ_API_KEY). When Orpheus is unavailable
 * (daily limit, outage) or the reply is in another language, Cloudflare MeloTTS
 * takes over (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN). When neither
 * answers, the app falls back to the browser's built-in voice.
 * Optional: ORPHEUS_VOICE (default hannah; also autumn, diana, austin, daniel, troy).
 */

const MAX_CHARS = 200; // Orpheus accepts up to 200 characters per request
const MELO_LANGS = ['en', 'es', 'fr', 'zh', 'ja', 'ko'];

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// Browsers send an Origin header with every POST; it must be this site.
const isSameSite = (origin: string | null, host: string) => {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

const audio = (bytes: Uint8Array, engine: string) =>
  new Response(bytes, {
    headers: {
      'content-type': 'audio/wav',
      'cache-control': 'no-store',
      'x-tts-engine': engine,
      'access-control-expose-headers': 'x-tts-engine',
    },
  });

// Orpheus streams WAV with placeholder sizes (0xFFFFFFFF); write the real sizes
// so every browser can play the file.
const fixWavSizes = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44 || view.getUint32(0, false) !== 0x52494646) return bytes; // "RIFF"
  view.setUint32(4, bytes.byteLength - 8, true);
  for (let i = 12; i + 8 <= bytes.byteLength; ) {
    const id = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    if (id === 'data') {
      view.setUint32(i + 4, bytes.byteLength - (i + 8), true);
      break;
    }
    i += 8 + view.getUint32(i + 4, true);
  }
  return bytes;
};

const orpheus = async (text: string) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const upstream = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'canopylabs/orpheus-v1-english',
      voice: process.env.ORPHEUS_VOICE || 'hannah',
      input: text,
      response_format: 'wav',
    }),
  });
  if (!upstream.ok) return null;
  return fixWavSizes(new Uint8Array(await upstream.arrayBuffer()));
};

const melotts = async (text: string, lang: string) => {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token || !MELO_LANGS.includes(lang)) return null;
  const upstream = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/myshell-ai/melotts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: text, lang }),
  });
  const data = await upstream.json().catch(() => null);
  const encoded = data?.result?.audio;
  if (!upstream.ok || typeof encoded !== 'string') return null;
  return Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
};

export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, 'Use POST.');
  const url = new URL(req.url);
  if (!isSameSite(req.headers.get('origin'), url.host)) return json(403, 'Cross-origin requests are not allowed.');

  let text = '';
  let lang = 'en';
  let engine = '';
  try {
    const body = await req.json();
    text = String(body.text ?? '').trim();
    lang = String(body.lang ?? 'en').slice(0, 5);
    engine = String(body.engine ?? '');
  } catch {
    return json(400, 'Request body must be JSON.');
  }
  if (!text || text.length > MAX_CHARS) return json(400, `text must be 1 to ${MAX_CHARS} characters.`);

  try {
    // Keep the voice the reply started with: once MeloTTS has taken over, stay on it.
    if (lang === 'en' && engine !== 'melotts') {
      const speech = await orpheus(text);
      if (speech) return audio(speech, 'orpheus');
    }
    const speech = await melotts(text, lang);
    if (speech) return audio(speech, 'melotts');
    return json(503, 'No voice service is available right now.');
  } catch {
    return json(502, 'The voice service could not be reached.');
  }
};

export const config = {
  path: '/api/tts',
  // Separate limit from chat: a long reply is read in several short requests.
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
