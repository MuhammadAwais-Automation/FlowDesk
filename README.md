<div align="center">

# FlowDesk

### Local-first AI creator workstation for prompts, accounts, AI sessions, and social workflows.

![Electron](https://img.shields.io/badge/Electron-Desktop-111111?style=flat-square&logo=electron)
![React](https://img.shields.io/badge/React-TypeScript-111111?style=flat-square&logo=react)
![Local First](https://img.shields.io/badge/Local--first-No%20hosted%20DB-111111?style=flat-square)
![Tests](https://img.shields.io/badge/Tests-Vitest-111111?style=flat-square)

</div>

FlowDesk is a desktop workstation for creators who work across AI tools, reusable prompts, Gmail accounts, YouTube Studio, social platforms, Calendar, and Tasks. The core workflow runs locally, so no hosted database or cloud account is required for the app itself.

## At a Glance

| Area | Details |
|---|---|
| Product type | Local-first desktop productivity app |
| Users | Creators, solo operators, social media managers, AI-heavy workflows |
| Desktop stack | Electron, React, TypeScript, electron-vite |
| Storage model | Local app storage with isolated Electron session partitions |
| Showcase value | Desktop product engineering, account isolation, prompt tooling, local-first UX |

## What It Proves

| Capability | Example in this project |
|---|---|
| Desktop app architecture | Electron main/preload/renderer split with typed IPC patterns |
| Local-first product design | Prompts, workspaces, accounts, and settings stored locally |
| Session isolation | Separate Electron partitions for AI tools, Gmail, YouTube Studio, and social platforms |
| Creator workflow design | AI browser, account switching, personal workspace, and agent workflows |
| Engineering verification | Vitest tests, TypeScript checks, production build scripts |

## Product Surface

| Module | Purpose |
|---|---|
| AI Browser | Open ChatGPT, Claude, Gemini, Grok, or custom AI tools with isolated sessions |
| Workspaces | Organize projects, clients, brands, and account profiles |
| Accounts | Add and isolate multiple Gmail accounts inside native browser views |
| YouTube Studio | Switch between isolated YouTube Studio sessions |
| Personal Workspace | Use Calendar and Tasks with a local isolated Google session |

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| Renderer | React 18, TypeScript |
| Bundler | electron-vite, Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Local storage | electron-store |
| Icons | Lucide React |
| Testing | Vitest |
| Packaging | electron-builder |

## Project Map

```text
electron/          Electron main and preload process
src/
  components/      Reusable UI components
  config/          Social platform definitions
  lib/             Utilities and local continuity logic
  pages/           agent, browser, research, accounts, settings
  store/           Local-first Zustand stores
  types/           Shared TypeScript types
docs/              Project documentation
resources/         App icons
flowdesk-promo/    Promo prototype assets
```

## Run Locally

```bash
npm install
npm run dev
```

## Test and Build

```bash
npm test
npm run typecheck
npm run build
```

## Package

```bash
npm run build:win
npm run build:mac
```

## Privacy Model

FlowDesk is local-first. App data is stored locally through Electron storage, while account sessions stay isolated through Electron session partitions. No Supabase project, hosted database, or external backend is required for the core app.

## License

MIT
