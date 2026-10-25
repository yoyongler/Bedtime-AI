# Bedtime Unwind

A zero-friction bedtime relaxation web app with guided breathing exercises and an optional AI mind-dump feature powered by Gemini.

Built with React, TypeScript, Tailwind CSS, Lucide React, and the `@google/genai` SDK.

![Dark theme · OLED-safe](https://img.shields.io/badge/theme-OLED%20dark-000000) ![React 19](https://img.shields.io/badge/React-19-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6)

---

## Features

### Guided Breathing Exercises

**4-7-8 Deep Sleep** (5 mins)
Long exhales to quiet a busy mind. Based on Dr. Andrew Weil's parasympathetic activation technique.
- Inhale 4s → Hold 7s → Exhale 8s

**Physiological Sigh** (3 mins)
Two quick inhales, one long sigh to drop tension. Based on Stanford neurobiology research by Dr. Andrew Huberman.
- Deep inhale 2s → Top-up inhale 1s → Slow sigh 6s

**Unload & Breathe** (AI Mind Dump)
Write down one lingering thought. Gemini generates a single sentence of calm reassurance, then transitions into 4-7-8 breathing.

### Visual Breathing Ring

A dynamic ring that responds to each phase of the exercise:
- **Inhale** — ring expands smoothly over the phase duration
- **Hold** — ring stops and holds steady with a soft glow
- **Exhale** — ring contracts slowly back to rest

A countdown number in the center of the ring shows seconds remaining in the current phase.

### Voice Dictation

The thought field has a microphone button in its bottom-right corner. Tap it, speak the
thought, and the words appear in the field as you say them. Tap again to stop. Dictated
text is appended to anything you typed by hand, then released to Gemini like any other
thought.

Powered by the browser's built-in Web Speech API — no extra dependency, no API key, and
nothing is recorded or stored by the app.

| Browser | Support |
|---------|---------|
| Chrome / Edge 139+ (desktop + Android) | Yes |
| Chrome / Edge (older) | Yes |
| Safari 14.1+ (macOS + iOS) | Yes |
| Firefox | No — the mic button is simply not shown |

Two things are worth knowing:

- **It needs a secure context.** The button appears on `https://` and on
  `http://localhost`, but not on a plain-http LAN address such as
  `http://192.168.1.20:5173`. If you are testing on a phone, use a tunnel or HTTPS.
- **On-device where possible.** Chrome 139+ can recognise speech without sending the
  audio anywhere. Where the browser exposes the language-pack check (Chrome 142+), the
  app uses local recognition if the pack is already installed; otherwise it falls back
  to whatever the browser does by default, which in Chrome means the audio goes to
  Google's speech service.

The browser's cloud recogniser occasionally fails its first connection — a cold service,
a just-woken laptop, a flaky lookup — and succeeds moments later. Each dictated session
therefore retries a `network` error up to twice in the background before showing
anything, so a brief hiccup is invisible. Only a persistent failure surfaces a message,
and that message names the usual culprits (connection, VPN, firewall, content blocker).

### Designed for Sleep

- **OLED-safe dark theme** (`#050505` background) to minimize light in a dark bedroom
- **Smooth transitions** between every screen — no abrupt changes
- **1.5s settling phase** ("Let's begin.") before the first breath starts
- **Hands-free operation** — no buttons to press once the exercise begins
- **Tap to pause / resume** if you need to adjust
- **Screen Wake Lock** keeps the display on during the exercise
- **Ambient soundscape** (optional) with gentle brown noise

---

## Getting Started

### Prerequisites

- Node.js 20.19+ or 22.12+ (required by Vite 8)
- npm

### Install & Run

```bash
# Clone or navigate to the project
cd bedtime-unwind

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Audio Lab (development)

The sound design can be auditioned at [http://localhost:5173/?audiotest=1](http://localhost:5173/?audiotest=1). The harness is split into its own lazily loaded chunk and only downloaded when that URL is opened.

### Production Build

```bash
npm run build
npm run preview
```

### Deploying to GitHub Pages

You may access the working site at [https://yoyongler.github.io/Bedtime-AI/](https://yoyongler.github.io/Bedtime-AI/).
Alternatively, feel free to use the project in your own repo. The Vite config uses a relative `base`, so the build works from a project path such as `https://<user>.github.io/<repo>/` without extra configuration, and the HTTPS URL keeps the microphone and Wake Lock APIs available.

A workflow at `.github/workflows/deploy.yml` builds and publishes the site on every push to `main`:

1. Create a **public** GitHub repository.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Add the project files, excluding `node_modules/` and `dist/`. If you upload through the GitHub web UI, do not drag those folders in — the workflow installs dependencies and builds from source.
4. Commit the workflow file, wait for the **Actions** run to finish, then open the Pages URL shown in the run or in **Settings → Pages**.

To deploy without Actions, run `npm run build` locally and publish the contents of `dist/` to a branch configured for Pages. The build already includes `.nojekyll`.

---

## Gemini API Key (Optional)

The AI Mind Dump feature uses `gemini-3.5-flash-lite` via the `@google/genai` SDK. Without a key, the app falls back to a built-in reassurance message.

Configure the key using any of these methods (the in-app key takes precedence):

1. **In-app** — click the key icon in the top-right corner of the home screen and save a key. It is stored as `bedtime_gemini_api_key` in this browser's `localStorage`, so it survives reloads and is only sent to Google when the feature is used. A small dot on the icon means a key is saved.
2. **Environment variable** — create `.env.local` in the project root:
   ```
   VITE_GEMINI_API_KEY=your_key_here
   ```
3. **System environment** — set `GEMINI_API_KEY` in your shell.

> **Public deployments:** Vite inlines `VITE_*` variables into the client bundle, so anyone can read a key supplied that way. Use the in-app field on GitHub Pages and never commit a real key. `.env` and `.env.*` are gitignored.

Because the key lives in `localStorage`, it is per-browser and per-device. Incognito windows lose it when closed, and visiting through a different URL (localhost, `github.io`, a custom domain) requires entering it again.

---

## Project Structure

```
.github/
└── workflows/
    └── deploy.yml             # GitHub Pages build and deploy

public/
├── .nojekyll
├── favicon.svg
└── icons.svg

src/
├── components/
│   ├── ApiKeyModal.tsx        # API key configuration modal
│   ├── AudioLab.tsx           # Dev-only sound audition harness (/?audiotest=1)
│   ├── AudioLabRoute.tsx      # Lazy loader for the dev harness
│   ├── CompletionScreen.tsx   # "You are all set for sleep."
│   ├── ExerciseScreen.tsx     # Breathing ring, phases, and timer
│   ├── HomeScreen.tsx         # Exercise selection cards
│   ├── MindDumpScreen.tsx     # Thought input → AI reassurance → transition
│   └── VolumeControl.tsx      # Master volume slider and mute toggle
├── constants/
│   └── exercises.ts           # Phase timings and instructions per exercise
├── hooks/
│   └── useSpeechToText.ts     # Web Speech API lifecycle for dictation
├── services/
│   └── gemini.ts              # @google/genai SDK integration with fallback
├── utils/
│   ├── audio.ts               # Web Audio brown noise and transition chimes
│   └── speechRecognition.ts   # Typed Web Speech API wrapper and feature detection
├── App.tsx                    # Screen state machine and transitions
├── index.css                  # Tailwind imports and custom animations
├── main.tsx                   # Entry point and Audio Lab route
└── types.ts                   # TypeScript type definitions
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Icons | Lucide React |
| AI | `@google/genai` (Gemini 3.5 Flash-Lite) |
| Audio | Web Audio API (no external assets) |
| Speech | Web Speech API (no external assets) |
| Build | Vite 8 |

---

## License

MIT
