/**
 * Server-side proxy for every AI service the app calls.
 *
 * The browser never sees an API key: it calls /api/*, this function adds the
 * key from Netlify's environment variables and streams the answer back.
 * Keys to set in Netlify (mark each one "Contains secret values"):
 *   GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
 *   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (optional, for image generation)
 */

const MAX_BODY_BYTES = 5_500_000; // Netlify functions reject request bodies above 6 MB

// Only these Gemini calls may use the key: the model the app uses, chat endpoints only.
const GEMINI_ROUTE = /^\/api\/gemini\/v1beta\/models\/gemini-2\.5-flash:(streamGenerateContent|generateContent)$/;

// OpenAI-compatible providers, each limited to the model the app actually uses,
// so a copied request cannot spend the keys on other (paid) models.
const CHAT_PROVIDERS: Record<string, { url: string; keyName: string; models: string[] }> = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyName: 'GROQ_API_KEY',
    models: ['llama-3.3-70b-versatile'],
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyName: 'OPENROUTER_API_KEY',
    models: ['openrouter/free'],
  },
};

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

// Pass the provider's answer through untouched (keeps streaming working).
const relay = (upstream: Response) =>
  new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });

const geminiProxy = async (path: string, url: URL, body: string) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(500, 'GEMINI_API_KEY is not set on the server.');
  const target = `https://generativelanguage.googleapis.com${path.replace('/api/gemini', '')}`;
  const upstream = await fetch(url.searchParams.get('alt') === 'sse' ? `${target}?alt=sse` : target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body,
  });
  return relay(upstream);
};

const chatProxy = async (body: string) => {
  let payload: { provider?: string; model?: string; messages?: unknown; temperature?: number };
  try {
    payload = JSON.parse(body);
  } catch {
    return json(400, 'Request body must be JSON.');
  }
  const provider = CHAT_PROVIDERS[payload.provider ?? ''];
  if (!provider || !provider.models.includes(payload.model ?? '')) {
    return json(400, 'Unknown provider or model.');
  }
  if (!Array.isArray(payload.messages)) return json(400, 'messages must be an array.');
  const key = process.env[provider.keyName];
  if (!key) return json(500, `${provider.keyName} is not set on the server.`);

  const upstream = await fetch(provider.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'https://giscard.me',
      'X-Title': 'Giscard AI',
    },
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      stream: true,
      temperature: Math.min(Math.max(Number(payload.temperature) || 0.5, 0), 1),
    }),
  });
  return relay(upstream);
};

// Cloudflare Workers AI (free plan: requests fail instead of billing when the
// daily allowance runs out). Without credentials the app falls back to Pollinations.
const imageProxy = async (body: string) => {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) return json(501, 'Image generation is not configured on the server.');

  let prompt = '';
  try {
    prompt = String(JSON.parse(body).prompt ?? '').trim();
  } catch {
    return json(400, 'Request body must be JSON.');
  }
  if (!prompt || prompt.length > 2048) return json(400, 'prompt must be 1 to 2048 characters.');

  const upstream = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 4 }),
    },
  );
  const data = await upstream.json().catch(() => null);
  const image = data?.result?.image;
  if (!upstream.ok || typeof image !== 'string') {
    return json(upstream.status === 429 ? 429 : 502, 'The image service did not return an image.');
  }
  return new Response(JSON.stringify({ image: `data:image/jpeg;base64,${image}` }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};

export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, 'Use POST.');

  // Block other websites from spending the quota through their visitors' browsers.
  const url = new URL(req.url);
  if (!isSameSite(req.headers.get('origin'), url.host)) return json(403, 'Cross-origin requests are not allowed.');

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return json(413, 'Attachments are too large. Keep the total under 5 MB.');
  }
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return json(413, 'Attachments are too large. Keep the total under 5 MB.');

  try {
    const path = decodeURIComponent(url.pathname);
    if (GEMINI_ROUTE.test(path)) return await geminiProxy(path, url, body);
    if (url.pathname === '/api/chat') return await chatProxy(body);
    if (url.pathname === '/api/image') return await imageProxy(body);
    return json(404, 'Unknown endpoint.');
  } catch {
    return json(502, 'The AI service could not be reached.');
  }
};

export const config = {
  path: ['/api/gemini/*', '/api/chat', '/api/image'],
  // Each visitor gets 20 AI requests per minute; extra requests get HTTP 429.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
