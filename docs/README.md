# FlowDesk — Complete Documentation Index

> **Purpose of these docs:** Koi bhi AI model (Claude, GPT, Gemini, etc.) yeh docs parh kar FlowDesk ke har feature, architecture, aur codebase ko poori tarah samajh sake — bina code dekhay.

---

## What is FlowDesk?

FlowDesk ek **Electron + React desktop application** hai jo ek productivity tool hai — specifically un logon ke liye jo multiple **AI tools** (ChatGPT, Claude, Gemini, Grok) aur **YouTube channels** manage karte hain.

**Core Value:** Ek hi app mein alag alag Gmail accounts se alag alag AI tools open karo, prompts inject karo, YouTube Studio manage karo, aur Google Calendar/Tasks use karo.

---

## Documentation Files

| File | Description |
|------|-------------|
| [README.md](./README.md) | Yeh file — index aur overview |
| [architecture.md](./architecture.md) | Tech stack, folder structure, data flow |
| [features.md](./features.md) | Har feature ki complete list with UI description |
| [pages.md](./pages.md) | Har page ka detailed breakdown |
| [components.md](./components.md) | Reusable components ka reference |
| [ipc-api.md](./ipc-api.md) | Electron IPC API — main ↔ renderer communication |
| [stores.md](./stores.md) | Zustand state management stores |
| [types.md](./types.md) | TypeScript types aur data models |
| [electron-main.md](./electron-main.md) | Main process, sessions, lifecycle |
| [ui-guide.md](./ui-guide.md) | UI design system, colors, fonts, layout |

---

## Quick Summary

### Tech Stack
- **Framework:** Electron 41 + React 18 + TypeScript
- **Build Tool:** electron-vite
- **Styling:** Tailwind CSS + CSS variables
- **State:** Zustand (React) + electron-store (Main process)
- **Database:** Supabase (cloud) + electron-store (local)
- **Fonts:** Outfit (display), DM Sans (body), JetBrains Mono (code)
- **Theme:** Light mode only, accent color `#4F6EF7` (blue)

### Main Pages (7 total)
1. **Dashboard** — Stats overview + quick actions
2. **AI Browser** — Multi-tab AI tool sessions with Gmail accounts
3. **Prompt Library** — Prompt management with categories, variables, versioning
4. **Accounts** — Gmail account management
5. **YT Studio** — YouTube multi-channel management
6. **Workspace** — Google Calendar + Tasks
7. **Settings** — App configuration, hotkeys, workspaces

### Core Features
- Isolated browser sessions per account (Electron partitions)
- Prompt injection into ChatGPT, Claude, Gemini, Grok
- Variable-based prompt templates `{{varName}}`
- Global keyboard shortcuts (configurable)
- Minimize to system tray
- Multi-workspace support via Supabase
- Resizable sidebar navigation (120–280px, default 172px)
