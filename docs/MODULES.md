# FlowDesk — Analysis + Module Plan (2026-10-04)

Ye doc code padh kar likha hai (file:line evidence ke saath). Jo cheez live verify nahi hui, uspe **[unverified]** likha hai.

## 1. Project ka haal (snapshot)

- Stack: Electron + React + TS. Request path: MCP stdio `bin/flowdesk-mcp.mjs` → HTTP gateway `electron/gateway/localGateway.ts` → Electron main → hidden window per account partition → in-page JS.
- 90 MCP tools: tiktok 30, linkedin 15, reddit 14, flow 13, brain 12, whatsapp 8, chatgpt-images 5, ask_* 5, workflows/skills 8.
- Health: `typecheck` clean. `vitest`: 1695 pass, 1 fail (`brain/runtimeSmoke` — pehle se known flaky).
- **Risk:** ~510 files uncommitted. Last commit = brain-atlas merge. Ek disk/crash problem = hafton ka kaam gaya. Pehle commit karna chahiye.
- Monolith files: `main.ts` 2920 lines, `flowdesk-mcp.mjs` 2199, `localGateway.ts` 874. Naye module inme nahi, apni file mein jayein.

## 2. Problems — ChatGPT / ask_* (Module 1 ki buniyaad)

| # | Problem | Evidence |
|---|---------|----------|
| P1 | `ask_*` sirf `prompt` leta hai. Account, chat id, new-chat — kuch select nahi hota. | `flowdesk-mcp.mjs:1647-1652`, `localGateway.ts:509` |
| P2 | Hidden tab `agent-<partition>-chatgpt` dobara use hota hai; `runOne` kahin new chat navigate nahi karta → har ask usi chat mein jaa sakta hai (context mix). **[unverified live]** | `browserWorkerQueue.ts:268-271` |
| P3 | Waiter aur queue **tool** ke naam par hain, account par nahi → ChatGPT ke sab asks (saare accounts) ek-ek karke chalte hain; parallel accounts nahi. Capture chunk bhi account se attribute nahi hota. | `browserWorkerQueue.ts:291, 325` |
| P4 | Text path ka account routing andha hai: fixed order, error aane ke baad hi agla account (regex `limit reached/usage limit...`). Quota pehle se pata nahi. | `accountFailover.ts:15-20`, `browserWorkerQueue.ts:331-355` |
| P5 | **Do alag account systems:** images (`chatgptImages.ts` — quota map, `pickAccount`, parking) aur text (`browserWorkerQueue`). Ek doosre ko nahi jaante. | `chatgptImages.ts:68-80, 375-396` |
| P6 | Chat history zero: list / open / read / continue koi tool nahi. `conversationId` sirf image jobs ke andar jaanta hai. | grep: koi list-conversations call nahi |
| P7 | Image progress ask path mein andaza hai (fixed 15% jaisa stage + `isLikelyImagePrompt` heuristic). Image path mein real job states hain, par per-image progress/percent nahi. | `browserWorkerQueue.ts:301-303` |
| P8 | Quota refusal → failover ka **asli error shape kabhi capture nahi hua**, sirf unit test. Flow ke "out of credits" ka bhi yehi haal. | HANDOFF-2026-09-28 |
| P9 | `ask.deepseek` gateway mein hai par MCP tool nahi; `as any` use hua. | `localGateway.ts:514` |
| P10 | Account `tiktok1` ChatGPT mein signed in nahi; free account ~6 images bacha. Routing test ke liye sirf 2 usable. | HANDOFF |

Baaki cross-cutting: Workflows Phase 1 app restart ke baad hi load hoga; Phase 2-4 (SKILL.md, agent/approval/wait steps, channels, cron) baqi. Debug IPC `debug:askBrowserProviderDirect` sirf dev mein hai (theek).

## 3. Modules

Percent = meri mota andaza (code + tools ke hisaab se), exact nahi.

| Module | Scope | Abhi |
|---|---|---|
| **M1 — AI + Content Creation** | 1A ChatGPT (full human-like use) · 1B Gemini/Grok/Perplexity/Claude same pattern · 1C Google Flow (video/image) | ~35% |
| **M2 — Social Media (multi-account)** | WhatsApp, TikTok, LinkedIn, Reddit, Facebook, Pinterest; har platform ke 2-3 accounts | ~60% (TikTok sabse aage) |
| **M3 — Brain / Intelligence** | memory, knowledge, radar, answer packs | ~65% (UI Atlas ban chuka) |
| **M4 — Workflows + Skills** | SKILL.md, agent/approval/wait steps, channels, cron | ~30% (Phase 1 done) |
| **M5 — Platform hardening** | commit hygiene, main.ts/gateway split, action-policy, packaging | ongoing |

## 4. Module 1A — ChatGPT (pehla kaam)

**Goal:** jo ek insaan ChatGPT mein karta hai wo sab MCP se: chats list/open/continue, naya chat, images (progress ke saath), upload/edit/download, aur multiple accounts ke beech quota-aware routing.

### Tools (naye / badle)
- `chatgpt_accounts` — saare accounts: login, plan, text-limit, image quota, reset time, parked/busy. (`chatgpt_image_accounts` ka superset.)
- `chatgpt_chats` `{account?, limit=10..50}` — latest chats (id, title, updated, account).
- `chatgpt_chat_read` `{account, chatId, lastN?}` — purani baat + usme bani images.
- `chatgpt_ask` `{prompt, account?, chatId?, newChat=true, files?, wait?}` — naya chat default; `chatId` de to usi mein continue. `ask_chatgpt` isi ka alias rahega (backward compat).
- `chatgpt_open_chat` — visible window mein chat kholo.
- Images: `chatgpt_generate_image / edit_image / image_jobs` rahenge, + per-image state (`queued → generating → saving → done|failed`), chat id, retry, "kitni bani/kitni baqi" count.
- Gallery: chat ke andar ki saari images list + download + dobara edit.

### Core design
1. Ek **ChatGPT account pool** (image wale `chatgptImages.ts` ka quota/pick/park logic extract karke). Text aur image dono usi se account lein.
2. Queue **per account** (partition key), tool key nahi → accounts parallel, ek account par serial.
3. Text routing: preferred account → baqi quota-aware order; limit/login error par park + agla account; job result mein bata do kis account se hua.
4. Chat actions backend API se (jaise images already `/backend-api/conversation/{id}` padhti hain), DOM clicking se nahi.

### Order of work (har step ke baad live verify)
1. **Capture first** (memory rule: guessed wire format nahi): real traffic mein chat-list call, chat-open, text-limit refusal ka asli shape. Zaroorat ho to aap click karein, hum network hook se record karein.
2. Account pool extract + per-account queue (tests ke saath).
3. `chatgpt_chats` + `chatgpt_chat_read`.
4. `chatgpt_ask` (newChat/chatId) — P2/P3 fix.
5. Image per-image progress + gallery/download.
6. Failover live test (aap ek account ki limit khatam hone par / ya capture se shape mil jaye).
7. UI: AI Browser mein accounts panel + chats list (MCP ke baad).

### Done ka matlab
- 2 accounts par parallel asks chalein, aur chat A mein baat kar ke chat B mein switch kar sakein.
- "pichli 10 chats" list ho, kisi mein continue ho.
- 5 images ka batch: har ek ka status dikhe, ek account ki limit par agle par chala jaye.
- `typecheck`, `vitest`, `build` green.

## 5. Agle modules (sketch)

- **1B** wahi pattern Gemini/Grok/Perplexity/Claude par: `*_chats`, `*_ask {account,chatId,newChat}` — pool/queue code common ho jayega.
- **1C Flow:** account routing already hai (`flow.ts`); baqi: asli out-of-credits error capture, per-job progress, project/media browsing tools.
- **M2:** har platform ke liye "account switch + unread/feed/post/analytics" parity table banana; WhatsApp/TikTok/LinkedIn/Reddit ke 2-3 accounts ek hi pattern par.
- **M4:** Phase 2→4 (HANDOFF-2026-09-28 mein approved plan).
