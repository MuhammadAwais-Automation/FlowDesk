# Repository Guidelines

## Project Structure & Module Organization

FlowDesk is an Electron + React + TypeScript desktop app. Keep process boundaries clear:

- `electron/` contains main-process IPC, session isolation, provider integrations, and preload code.
- `electron/agent/` contains the lead agent, worker queue, and agent tools.
- `src/pages/` holds route-level React screens; `src/components/` holds reusable UI.
- `src/store/` contains Zustand/local persistence; `src/types/` contains shared contracts.
- `docs/` documents architecture and IPC; `resources/` contains installer and icon assets.
- Place tests beside their module, e.g. `electron/inlineDictation.test.ts`.

## Build, Test, and Development Commands

```powershell
npm run dev          # start Electron with Vite development server
npm run dev:debug    # start with agent/dictation diagnostic logs
npm run typecheck    # check Node and renderer TypeScript projects
npm test             # run Vitest suite
npm run build        # produce production Electron/Vite output
npm run build:win    # build Windows installer
```

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, single quotes, and no semicolons, matching existing files. Name React components and exported types in `PascalCase`; functions, values, and IPC handlers use `camelCase` (for example, `inlineDictationStart`). Keep IPC payloads typed in `src/types/electron.d.ts` and expose only narrow preload methods. Do not use `any` for new boundary data; validate unknown inputs in the main process.

## Testing Guidelines

Use Vitest for unit and regression tests. Add focused tests for routing, persistence, security checks, and provider/session behavior. Name tests by outcome, e.g. `rejects unregistered accounts`. Run `npm run typecheck`, `npm test`, and `npm run build` before handoff; report any unrelated existing failures.

## Security & Local-First Rules

Never commit secrets, cookies, tokens, `.env` files, transcripts, or user data. Preserve per-account Electron session partitions. Remote content must remain sandboxed with `nodeIntegration: false` and pass through typed preload IPC. Avoid logging prompt text, audio, credentials, or raw provider traffic.

## Commit & Pull Request Guidelines

Use concise conventional-style subjects seen in history: `feat: ...`, `fix: ...`, `docs: ...`, or `chore: ...`. Keep commits focused. PRs should explain behavior changes, list verification commands, link relevant issues, include screenshots for UI changes, and call out local-data or session migration effects.
