# Giscard AI — Advanced Multimodal Intelligence

**Live Demo:** [giscard-ai.netlify.app](https://giscard-ai.netlify.app/)

A high-performance, feature-rich AI chatbot built with **React**, **Vite**, **Google Gemini**, and **Mistral AI**. Optimized for speed, versatility, API quota efficiency, and a premium user experience.

## Key Features

- **Multi-Model Intelligence**: Switch between Mistral Small, Pixtral 12B, Gemini 2.0 Flash, and Gemini 1.5 Pro.
- **Multi-Document Analysis**: Upload PDF, DOCX, CSV, TXT, or Image files simultaneously.
- **Quota Guardian (Smart Extraction)**: Extracts text from PDFs/DOCX within your browser — saves up to 90% on API limits.
- **AI Image Generation & Code Decoding**: Syntax-highlighted code blocks and vector SVG generation in chat.
- **Progress Visibility**: Dynamic parsing overlay and simulated upload queue for large contexts.
- **Multilingual & Maths**: Translation, math solving, and logical assistance.
- **Export History**: Download your full chat session as a formatted text file.
- **Theme Aware**: Dark and Light modes with a glass-morphism UI.

## Quick Start

### Deploy on Netlify (Recommended)
1. Fork this repository and connect it to [Netlify](https://app.netlify.com).
2. Configure Build Settings:
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`
3. Add **Environment Variables** and tick **Contains secret values** on each:
   - `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey)
   - `GROQ_API_KEY` from the [Groq console](https://console.groq.com/keys)
   - `OPENROUTER_API_KEY` from [OpenRouter](https://openrouter.ai/settings/keys)
   - Optional, for image generation: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with the Workers AI permission)
   - Optional, when a provider retires a model: `GROQ_MODEL` (default `openai/gpt-oss-120b`) and `OPENROUTER_MODEL` (default `openrouter/free`). These are not secret.

> **Security:** The browser never receives these keys. The app calls `/api/*` on its own domain, and the Netlify function in `netlify/functions/ai.mts` adds the key on the server. The function only serves this site, picks the models itself (visitors cannot choose another model), and limits each visitor to 20 requests a minute. Do not give the variables a `VITE_` prefix: Vite copies those into the public JavaScript.

### Local Setup
```bash
npm install
npx netlify-cli dev   # runs the site and the /api functions together
npm run build         # production build
```
Plain `npm run dev` starts only the frontend, so chat requests fail without the functions.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS 4 |
| Icons | Lucide React |
| Animations | Framer Motion |
| AI | Gemini (`@google/generative-ai`), Groq and OpenRouter through a Netlify function |
| Images | Cloudflare Workers AI (FLUX.1 schnell), Pollinations as fallback |
| Parsing | `pdfjs-dist`, `mammoth` |
| Rendering | React-Markdown with GFM |

## License
SPDX-License-Identifier: Apache-2.0
