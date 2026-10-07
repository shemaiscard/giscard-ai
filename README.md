# Giscard AI

A multimodal AI assistant that runs in the browser. It answers with live web search, reads documents and images, speaks its replies, creates pictures, and exports Word, PowerPoint and Excel files.

**Live app:** [giscard-ai.netlify.app](https://giscard-ai.netlify.app/)

## Features

- **Chat with web search:** current answers that know the user's time zone.
- **Documents and images:** upload PDF, Word, text or image files and ask questions about them.
- **Shortcuts:** one tap starts a guided task for documents, images, code, math, translation or summaries.
- **Image generation:** describe a picture, then refine it with follow-ups such as "a dog too".
- **Office files:** Word documents, PowerPoint decks and Excel sheets, generated in the browser.
- **Math:** step-by-step solutions with formatted equations.
- **Voice:** dictation and a natural read-aloud voice.
- **Memory without an account:** the chat history stays in the browser.
- Light and dark themes, on desktop and phone.

## Tech stack

React 19, TypeScript, Vite and Tailwind CSS 4, with Google Gemini, Groq, OpenRouter and Cloudflare Workers AI. Hosted on Netlify.

## Run locally

1. Install the dependencies: `npm install`
2. Copy `.env.example` to `.env` and add your API keys.
3. Start the app with its serverless functions: `npx netlify-cli dev`

`npm run build` writes a production build to `dist`.

## Research

Giscard AI is the system described in the preprint *Yin-AI: A Multimodal Conversational Agent with Voice, Memory, and Document Generation* (Shema Nkindi Giscard, 2026), available on [ResearchGate](https://www.researchgate.net/publication/408097857_Yin-AI_A_Multimodal_Conversational_Agent_with_Voice_Memory_and_Document_Generation). The [`v1.0-paper`](https://github.com/shemaiscard/giscard-ai/releases/tag/v1.0-paper) release is the version the paper describes; the main branch has changed since.

## License

Apache-2.0
