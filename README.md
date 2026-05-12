# FlowDesk

> AI & Social Media Management Desktop App — built with Electron, React, and TypeScript.

FlowDesk is a productivity-focused desktop application that lets you manage multiple AI tool accounts, organize reusable prompts, browse social platforms, and run YouTube Studio — all from a single, unified interface with persistent isolated sessions per account.

---

## Features

### AI Browser — Multi-Account Sessions
- Open ChatGPT, Claude, Gemini, and other AI tools in isolated browser sessions
- Switch between accounts without logging in/out — each account keeps its own cookies and session data
- Inject prompts directly into any AI tool's input field via a floating Prompt Bar overlay
- Global hotkey to open the Prompt Bar from anywhere in the app

### Prompt Library
- Save, organize, and reuse AI prompts across workspaces
- Variable templates — define `{{variables}}` in prompts and fill them in at run time via a modal
- Tag-based filtering and full-text search
- Track last-used timestamps per prompt

### Workspace Management
- Group prompts and accounts into named workspaces
- Switch workspaces from the Dashboard dropdown
- Per-workspace prompt isolation

### Social Hub
- One-click access to Instagram, Facebook, Twitter/X, LinkedIn, TikTok, Threads, Reddit, YouTube, Telegram, Discord, WhatsApp
- Each platform opens in its own persistent WebContentsView
- Dock-style switcher with per-platform color coding

### YouTube Studio
- Dedicated YouTube Studio session with isolated cookies
- Prompt injection support for description and script writing

### Accounts Manager
- Add and label multiple accounts per AI tool
- Color-coded tool indicators (ChatGPT, Claude, Gemini, etc.)
- Active/inactive toggle per account

### Dashboard
- At-a-glance stats: total prompts, AI accounts, workspaces
- Recent prompts list with tags
- Active AI session overview
- Quick-action buttons

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Electron](https://www.electronjs.org/) v41 |
| Renderer | [React](https://react.dev/) 18 + [TypeScript](https://www.typescriptlang.org/) 5 |
| Bundler | [electron-vite](https://electron-vite.org/) + [Vite](https://vitejs.dev/) 5 |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v3 |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Backend / DB | [Supabase](https://supabase.com/) |
| Icons | [Lucide React](https://lucide.dev/) |
| Testing | [Vitest](https://vitest.dev/) |
| Packaging | [electron-builder](https://www.electron.build/) |

---

## Project Structure

```
FlowDesk/
├── electron/               # Main process (Electron)
│   ├── main.ts             # App entry, window & view management
│   ├── preload.ts          # Context bridge — exposes electronAPI to renderer
│   ├── sessions.ts         # Isolated session management per account
│   ├── injector.ts         # Prompt injection into web pages
│   ├── oauthRouting.ts     # OAuth redirect handling
│   └── socialHub.ts        # Social Hub WebContentsViews
├── src/                    # Renderer process (React)
│   ├── App.tsx             # Root component + page router
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── AIBrowser.tsx
│   │   ├── PromptLibrary.tsx
│   │   ├── Accounts.tsx
│   │   ├── SocialHub.tsx
│   │   ├── YTStudio.tsx
│   │   └── Workspace.tsx
│   ├── components/
│   │   ├── layout/         # LeftNav sidebar
│   │   ├── browser/        # AI Browser UI (tabs, account switcher, prompt bar)
│   │   ├── prompt/         # Prompt cards, editor, variable modal
│   │   └── social/         # Social Hub dock
│   ├── store/              # Zustand stores (accounts, prompts, workspaces, social)
│   ├── lib/                # Supabase client, utilities, theme
│   ├── config/             # Social app definitions
│   └── types/              # TypeScript types and interfaces
├── supabase/               # Database migrations and schema
├── resources/              # App icons
└── electron.vite.config.ts # Build configuration
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [npm](https://www.npmjs.com/) v9 or higher
- A [Supabase](https://supabase.com/) project (free tier works)

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/FlowDesk.git
cd FlowDesk
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

> Never commit your `.env` file — it is listed in `.gitignore`.

### 4. Run in development mode

```bash
npm run dev
```

This starts the Electron app with hot-reload for the renderer process.

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start app in development mode with hot-reload |
| `npm run build` | Build renderer + main process for production |
| `npm run build:win` | Build + package as Windows installer (.exe) |
| `npm run build:mac` | Build + package as macOS app (.dmg) |
| `npm start` | Preview production build |
| `npm test` | Run unit tests with Vitest |

---

## Building for Production

### Windows

```bash
npm run build:win
```

Output: `dist/FlowDesk Setup 1.0.0.exe` (NSIS installer, x64)

### macOS

```bash
npm run build:mac
```

---

## Database Schema

FlowDesk uses Supabase (PostgreSQL) for storing prompts, accounts, and workspaces. Migration files are located in `supabase/`.

To apply migrations:

```bash
npx supabase db push
```

---

## Architecture Notes

- **Session isolation** — Each AI account uses a dedicated Electron `Session` partition (`persist:account-<id>`), preventing any cookie or storage bleed between accounts.
- **WebContentsView** — AI tools and social platforms are rendered in native `WebContentsView` instances (not `<webview>` tags), which gives full process isolation and better performance.
- **Context bridge** — All IPC between renderer and main process goes through a typed `electronAPI` interface exposed via `preload.ts`, following Electron security best practices.
- **Prompt injection** — The injector script finds the active input element in an AI tool's page and programmatically fills it, simulating user input so the target site's React/Vue state updates correctly.

---

## License

Private — All rights reserved. This repository is not open for public contribution or redistribution.

---

<p align="center">Built with by the FlowDesk team</p>
