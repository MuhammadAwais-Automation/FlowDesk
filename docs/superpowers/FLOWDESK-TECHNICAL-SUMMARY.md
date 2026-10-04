# FlowDesk — Technical Summary

FlowDesk is a local-first, Electron-based AI creator workstation. It gives an AI
agent the ability to operate WhatsApp, LinkedIn, Facebook, ChatGPT, and a
custom design tool ("Studio") **as if it were a human sitting at the
keyboard** — not through any official API. That distinction is the whole
architecture: this is browser automation and reverse-engineering, not
API integration, and the two require fundamentally different techniques
depending on what the target platform actually is underneath.

---

## 1. The core problem this project solves

None of WhatsApp, LinkedIn, or Facebook expose a usable API for what this
app needs (reading messages, sending messages, reading feeds, posting,
commenting). So every one of these integrations works by running the
**real, official web app** inside a hidden Electron `WebContentsView`,
already logged in as the real user, and then reaching into it — either by
reading its live in-memory state or by intercepting and replaying its
own network calls with the user's own real session.

This means the app can do **everything a human user could do** through the
UI — read, search, send, like, comment, connect — and it does it in
milliseconds via direct JavaScript execution or direct HTTPS calls,
rather than simulating clicks and typing.

---

## 2. Two different reverse-engineering strategies, chosen per platform

This is the most technically interesting part of the system, and it exists
because of one hard constraint: **where is the plaintext data actually
sitting?**

### WhatsApp — page-internal state extraction (network interception is useless)

WhatsApp Web's wire protocol is end-to-end encrypted using the Noise
protocol. Every byte that crosses the network is encrypted binary — there
is nothing meaningful to intercept at the network layer. The **only** place
the data exists in plaintext is inside the WhatsApp Web page's own
already-decrypted in-memory JavaScript store, after WhatsApp's own code has
done the decryption.

So `electron/whatsapp.ts` and `electron/whatsappInject.ts` work by running
`webContents.executeJavaScript(...)` directly inside the live, authenticated
WhatsApp Web page, reaching into WhatsApp's own internal `Store` objects to
read chats, messages, and contacts, and to invoke WhatsApp's own internal
send functions to send messages, files, and media. This is not "type into
the input box and click send" — it calls the same internal functions
WhatsApp's own UI calls, directly.

### LinkedIn / Facebook — Chrome DevTools Protocol network capture, then direct API replay

LinkedIn's traffic is plain HTTPS/GraphQL — no extra encryption layer beyond
TLS — so the strategy here is the opposite: capture real network traffic via
the **Chrome DevTools Protocol** (`electron/discovery/cdpRecorder.ts`),
reverse-engineer the actual endpoint shapes, required headers, and payload
formats, and then replay authenticated calls directly against LinkedIn's own
backend using the real session's cookies and tokens — no DOM interaction at
all for most operations.

A specific, non-obvious engineering finding drove this choice: an earlier
version hooked `window.fetch`/`XHR`/`WebSocket` from inside the page itself.
That has a blind spot — those hooks only exist on the **main thread's**
global object. WhatsApp and LinkedIn both run their networking inside a
**Web Worker**, which has its own separate global scope with its own
`fetch`. A real test session that opened a LinkedIn thread and sent a
message produced 201 captured network calls — and not one of them was the
actual "send message" request, because it never touched the hooked
main-thread `fetch` at all. CDP sits **underneath** the renderer process
(at the Chromium debugging-protocol level), so it sees every request
regardless of which thread or worker issued it, cannot be evaded by the
page, and survives page reloads. The tradeoff: only one debugger client can
attach to a given view at a time, so opening real DevTools on a recorded
view conflicts with the recorder.

LinkedIn also required discovering exact required headers empirically —
LinkedIn's backend rejects calls missing `x-restli-protocol-version`, and
several tracking headers turned out to be load-bearing on specific routes.
Guessing at "reasonable" headers silently fails; only real captured traffic
reveals the true contract.

---

## 3. The discovery-probe system — how the reverse engineering itself is done

`electron/discovery/probeRunner.ts` is a dev-only live experimentation
system: a developer drops a small JavaScript file into a `probes/` folder,
and it is immediately executed inside a **live, already-authenticated**
target page (WhatsApp, LinkedIn, ChatGPT, etc.) with no rebuild and no
re-login required. The result is written to `probes/out/<name>.json`. This
is how every one of the above endpoint shapes, internal object structures,
and header requirements were actually discovered — by running real
JavaScript against the real, logged-in session and observing the real
response, rather than guessing from documentation that doesn't exist.

---

## 4. ChatGPT / Claude / Universal Chat integration — a third technique again

For AI chat providers, the app runs the real web chat UI in a hidden view
and intercepts the provider's own **Server-Sent Events (SSE) stream** as it
generates a reply — parsing the raw SSE wire format live to extract text
tokens and, for image generation, `image_asset_pointer` events carrying
`sediment://` asset references that must then be resolved through a
second, token-authenticated download step (the pointer alone is not
fetchable with cookies; it requires a bearer token obtained **from inside
the page**, then used server-side to fetch the actual signed URL).

The end-of-turn signal itself required parsing each SSE `data:` line as real
JSON and checking its `type` field for `message_stream_complete`, rather
than substring-matching for that phrase — because the model's own output
text can literally contain that string, which would end the capture
early on a false positive.

Universal Chat generalizes this pattern across multiple providers with a
shared injection layer (`electron/injector.ts`) that finds a provider's
composer element, types into it, and reads back its response — used as a
fallback where SSE interception isn't wired up for a given provider yet.

---

## 5. The agent's tool surface — what it can actually do

The AI agent (built on the Claude Agent SDK) is given dozens of custom MCP
tools, each mapped to one of the above bridges:

- **WhatsApp (10 tools):** status, list chats, list unread, list messages
  in a chat, search contacts, **send a message**, download media (voice
  notes, images, video, documents), send a file, delete a message,
  diagnose.
- **LinkedIn (24 tools):** status, list/search chats and messages, unread,
  find people, watch for new messages, feed, post comments, search, own
  posts, notifications, like/unlike, comment/reply on posts, **create/
  delete posts**, delete comments, creator analytics, network status,
  invite budget, **send a connection request**, **send a message**, mark
  read.
- **Studio (design tool, 20+ tools as of the latest work):** create
  documents/artboards, read/write HTML per-element, list 129 bundled
  fonts, set typography/fill/stroke/text-effects, reorder/group/lock
  layers, read composition-rule guides, export PNG/PDF.
- Plus Google Flow (unofficial image/video generation API), NotebookLM,
  and generic browser/dictation tools.

Every **write** action (sending a message, posting, deleting, connecting)
goes through a real, blocking approval dialog shown to the human user —
the agent cannot silently take an irreversible action. Read actions run
freely.

---

## 6. Reliability engineering under real-world constraints

A few specific, hard-won pieces of infrastructure:

- **Account failover** (`electron/agent/accountFailover.ts`) — classifies
  why a browser-automation call failed (rate limit, logged out, blocked)
  and can retry against a different signed-in account, masking the
  account's email in logs.
- **Heartbeat over a fake progress signal** — the Claude Agent SDK's own
  `tool_progress` message turns out, from real production logs, to be a
  Task/subagent-only signal that **never fires** for plain custom MCP tool
  calls. A long-running WhatsApp/LinkedIn call sitting inside its own
  timeout window would otherwise produce zero signal to the UI, and an
  idle-watchdog could wrongly kill a call that was still genuinely working.
  So `browserWorkerQueue.ts` emits its own heartbeat every 7 seconds
  directly, which the main process forwards to the renderer in the same
  event shape the SDK's real progress message would use — a workaround
  built entirely from empirical observation of what the SDK actually does
  versus what it claims to do.
- **Two-tier timeouts** for long browser-worker calls: an idle timeout that
  resets on real capture activity, and a hard ceiling that fires regardless
  — because a naive single timeout either kills a slow-but-working
  generation or lets a truly hung one run forever.

---

## 7. Why this is architecturally hard, in one sentence

Every one of these integrations targets a **moving, undocumented, actively
hostile-to-automation target** — three different platforms, three different
underlying transport realities (E2E-encrypted, plain HTTPS, and SSE
streaming), each requiring a different interception layer chosen for
technical reasons specific to where its plaintext actually lives — glued
together behind one uniform tool interface an LLM agent can call safely,
with human approval gating every irreversible action.
