# New Concepts from Live Capture Engine

This file tracks extra data-points we've discovered we can pull out of each
provider's live network capture (see `electron/captureInject.ts` for the
capture mechanism, and `electron/<tool>Parser.ts` for the per-provider
extraction logic), beyond just the assistant's reply text.

Each concept below was verified against a real, live capture (not guessed) —
see `FD_CAPTURE_DEBUG=1 npm run dev` to reproduce.

---

## ChatGPT

Source event stream: `POST /backend-api/f/conversation` (SSE). All three
concepts below come from event types that already flow through the existing
capture pipeline — they were previously seen and discarded; nothing new
had to be intercepted, only new parsing.

### 1. Usage / Quota Limits

**What it is:** How much of each rate-limited feature (deep research, file
upload, paste-to-file, image generation) the account has left, and when it
resets.

**Where it comes from:** A `conversation_detail_metadata` SSE event. Fires
several times per turn (both as its own standalone network call and inline
within the main answer stream).

**Raw shape:**
```json
{
  "type": "conversation_detail_metadata",
  "limits_progress": [
    { "feature_name": "deep_research", "remaining": 5, "reset_after": "2026-09-04T10:58:21Z" },
    { "feature_name": "file_upload", "remaining": 15, "reset_after": "2026-08-06T10:58:21Z" },
    { "feature_name": "paste_text_to_file", "remaining": 3, "reset_after": "2026-08-06T10:58:21Z" },
    { "feature_name": "image_gen", "remaining": 25, "reset_after": "2026-08-06T10:58:21Z" }
  ]
}
```

**Implementation:** `extractUsageFromSSEEvent()` in `electron/chatgptParser.ts`.
Wired into `electron/main.ts`'s chatgpt event loop; broadcasts to the
renderer via the `capture:usage` IPC event (`{ tool, limits }`).

**Why it's useful:** Could power a "quota remaining" indicator in the UI
per provider, or warn the user before a batch job runs out of allowance.

### 2. Model Info

**What it is:** Which model actually served the turn, the account's plan
tier, whether OpenAI auto-switched to a reasoning model, and how long the
first token took to arrive.

**Where it comes from:** A `server_ste_metadata` SSE event, fired once near
the end of each turn.

**Raw shape:**
```json
{
  "type": "server_ste_metadata",
  "metadata": {
    "model_slug": "gpt-5-5",
    "plan_type": "free",
    "did_auto_switch_to_reasoning": false,
    "server_ttfvt_ms": 1325.22,
    "cluster_region": "westus3"
  }
}
```

**Implementation:** `extractModelInfoFromSSEEvent()` in
`electron/chatgptParser.ts`. Broadcasts via `capture:modelInfo`
(`{ tool, info }`).

**Caveat:** `model_slug` is an internal routing name, not necessarily the
consumer-facing model name — don't assume it maps 1:1 to a marketed model
version.

**Why it's useful:** Lets us log/compare which model handled a given
reply, measure per-provider response latency (`server_ttfvt_ms`), and
detect free vs. paid plan behavior differences.

### 3. Conversation / Message IDs

**What it is:** The server-assigned `conversation_id` and `message_id` for
the turn just captured.

**Where it comes from:** `message_marker` SSE events — fired multiple
times per turn (first user-visible token, first final-channel token, last
token); every occurrence already carries both IDs, so the first one seen
is enough.

**Raw shape:**
```json
{
  "type": "message_marker",
  "conversation_id": "6a731749-442c-83ee-b2cf-be74bf3bac69",
  "message_id": "49890e71-2411-44ea-9a45-77ac33b44872",
  "marker": "last_token",
  "event": "last"
}
```

**Implementation:** `extractIdsFromSSEEvent()` in
`electron/chatgptParser.ts`. Broadcasts via `capture:ids` (`{ tool, ids }`).

**Why it's useful:** A stable handle for threading/history features later
— e.g. mapping a Universal Chat turn back to its underlying ChatGPT
conversation, or de-duplicating captures if the same provider is open in
both AI Browser and Universal Chat at once.

---

## Claude

Source event stream: `POST /api/organizations/.../chat_conversations/.../completion`
(SSE). Capturing this also **confirmed `claudeParser.ts`'s text extraction
for the first time** — it was previously a documented-API guess, marked
"UNVERIFIED"; a live capture showed claude.ai's web app streams the exact
same `content_block_delta` / `text_delta` shape as Anthropic's public
Messages API, so that comment has been removed.

Also newly seen in the stream: a `content_block_start` of `type: "thinking"`
immediately before the `text` block (empty on this simple turn — worth
re-checking on a harder prompt to see if it ever carries visible reasoning
content).

### 1. Model Info

**What it is:** The model that served the turn, and how the turn ended.
Unlike ChatGPT's single `server_ste_metadata` event, Claude splits this
across two separate events.

**Where it comes from:**
- Model name: `message_start` event, `message.model`.
- Stop reason: `message_delta` event, `delta.stop_reason`.

**Raw shape:**
```json
// message_start
{ "type": "message_start", "message": { "model": "claude-sonnet-5", ... } }
// message_delta
{ "type": "message_delta", "delta": { "stop_reason": "end_turn", "stop_sequence": null } }
```

**Implementation:** `extractModelInfoFromSSEEvent()` in
`electron/claudeParser.ts` — returns a `Partial<ClaudeModelInfo>` since the
two fields arrive in separate events; `electron/main.ts` logs/broadcasts
each piece as it arrives rather than waiting to merge them. Broadcasts via
the same `capture:modelInfo` IPC event ChatGPT uses (`{ tool, info }`).

**Why it's useful:** Same as ChatGPT's model info — confirms which model
actually answered, and whether the turn ended naturally (`end_turn`) vs.
being cut off.

### 2. Usage / Quota Limits

**What it is:** Rolling quota utilization across two windows — 5 hours and
7 days — rather than ChatGPT's per-feature counters (deep research, image
gen, etc). claude.ai apparently rate-limits by *overall usage volume*, not
by feature.

**Where it comes from:** A `message_limit` SSE event, fired once near the
end of each turn.

**Raw shape:**
```json
{
  "type": "message_limit",
  "message_limit": {
    "windows": {
      "5h": { "status": "within_limit", "utilization": 0.49, "resets_at": 1785930000 },
      "7d": { "status": "within_limit", "utilization": 0.36, "resets_at": 1786330800 }
    }
  }
}
```

**Implementation:** `extractUsageFromSSEEvent()` in
`electron/claudeParser.ts`. Broadcasts via the same `capture:usage` IPC
event ChatGPT uses (`{ tool, limits }`), though the shape of each entry
differs (`{ window, status, utilization, resetsAt }` vs. ChatGPT's
`{ feature, remaining, resetAfter }`) — any UI consuming both will need to
branch on `tool`.

**Why it's useful:** Same as ChatGPT's usage limits — a "how close to
rate-limited am I" indicator, but Claude's is a single percentage rather
than a per-feature countdown, so it's simpler to show as one meter per
window.

## Gemini

Source event stream: `POST /BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`
(Google's "batchexecute" framing over XHR, not SSE — see `geminiParser.ts`
header comment for the wire format). Unlike ChatGPT/Claude, this is an
**undocumented internal API**, so field positions were identified by eyeballing
one live capture, not a published spec — see the caveat at the end of this
section.

### 1. Model Info + Conversation/Response/Candidate IDs

**What it is:** The model display name that answered, plus three IDs Google
uses to track the turn (conversation, response, candidate/reply).

**Where it comes from:** The same `wrb.fr` payload array that already
carries the answer text (`extractCandidateText`'s `payload[4]`) — these are
just other positions in that same array:

| Field | Position | Example |
|---|---|---|
| `conversationId` | `payload[1][0]` | `"c_0eeb175c2d22eb1a"` |
| `responseId` | `payload[1][1]` | `"r_0a07fa195f57ba72"` |
| `candidateId` | `payload[4][0][0]` | `"rc_4ab95a18f303dd37"` |
| `model` | `payload[42]` | `"3.6 Flash"` |

**Implementation:** `extractTurnMetaFromRaw()` in `electron/geminiParser.ts`.
Broadcasts via the same `capture:modelInfo` and `capture:ids` IPC events the
other providers use.

**Why it's useful:** Same as ChatGPT/Claude — confirms which model
answered, and gives stable IDs for future threading/history features.

### 2. Detected Location (new — not seen on any other provider)

**What it is:** Gemini includes a device-based country guess in every
response payload — e.g. `"Pakistan"`, paired with the literal marker string
`"SWML_DESCRIPTION_FROM_YOUR_DEVICE"` right next to it in the array. Almost
certainly used server-side for response localization/personalization, but
it's notable that it rides along in the payload the client (and therefore
our capture) can read.

**Where it comes from:** `payload[5]` — a 2+ element array
`[countryName, "SWML_DESCRIPTION_FROM_YOUR_DEVICE", ...]`. The marker
string is used as a sanity check before trusting `payload[5][0]` as the
country, since a bare array index alone isn't a reliable anchor in this
undocumented format.

**Implementation:** Also part of `extractTurnMetaFromRaw()` in
`electron/geminiParser.ts` — returned as `detectedCountry`.

**Why it's useful:** Confirms Gemini is personalizing responses based on
inferred location even without the user stating it — worth knowing if
troubleshooting why Gemini gives region-flavored answers, and worth
flagging as a privacy-relevant data point if this is ever surfaced to users.

### Also seen but not extracted (lower priority)

- **Sentence-segmented breakdown of the reply** (`payload[26]` — the same
  text re-split sentence-by-sentence, likely for a "read aloud" feature).
- **Quick-action button definitions** ("Try again", "Longer", "Shorter",
  "Don't personalize") sent inline with every response (`payload[44]`).
- No usage/quota-limit equivalent to ChatGPT's `conversation_detail_metadata`
  or Claude's `message_limit` was seen in this capture — Gemini may not
  expose one over this endpoint, or it may live in a separate call not yet
  identified.

**Caveat:** All positional indices above (`payload[1]`, `payload[4]`,
`payload[5]`, `payload[42]`) come from reading one real capture by eye, not
a documented schema — this is Google's private wire format and could shift
without notice. `extractTurnMeta()` guards each read with a type/shape check
(and a same-`true` sanity anchor right after the model name) so a shifted
index yields a missing field instead of garbage, but if Gemini's extraction
ever silently stops working, re-verify these positions against a fresh
`FD_CAPTURE_DEBUG` capture before assuming the code is broken.

## Grok

Source: a persistent `wss://grok.com/ws/mgw/` connection (not per-message
HTTP — see `buildWSCaptureInjectSrc` in `electron/captureInject.ts`).
Extraction for Grok happens **client-side**, inside the injected page
script, not in a server-side `grokParser.ts` — main.ts just appends the
already-clean text deltas it's handed. To see the full raw event stream for
this exploration, a temporary debug-only forward was added: every event on
the socket now also gets posted as `__flowdeskGrokRaw` → bridged through
`webviewPreload.ts` → logged in `main.ts` via a new `capture:grokRaw` IPC
channel, gated behind `FD_CAPTURE_DEBUG` (this raw-forward stays in the
codebase for future debugging; it does not affect normal capture behavior).

**Status: observed only — nothing extracted into structured fields yet**
(user's call, to keep this session scoped to discovery). Findings below are
for when we come back to implement.

Grok's protocol is much more granular/event-driven than the other three
providers (closer to a realtime API than a simple SSE stream) — a single
turn produces 10+ distinct event types:

| Event type | What it carries |
|---|---|
| `session.created` | `session.model` — the model tier serving the session (seen: `"fast"`) |
| `conversation.attached` | `conversation.id` |
| `conversation.item.added` | Echoes the just-sent user message |
| `response.created` | `response.id`, status, created_at |
| `response.output_item.added` / `.content_part.added` | Turn setup, before any text |
| `response.chunk` (channel `CHANNEL_ASSISTANT_NOTETAKER_HEADER`) | A "Thinking about your request" status string — already correctly filtered out by the existing capture code, not real answer text |
| `response.chunk` (channel `CHANNEL_ASSISTANT_RESPONSE`) | The actual answer text deltas — this is the only channel currently captured |
| `response.chunk` (`ui_layout`) | UI hint (`reasoning_ui_layout: "UNIFIED"`), not content |
| `response.output_text.done` / `.content_part.done` / `.output_item.done` | Turn teardown |
| `response.done` | Final status; carries a `usage: {}` field — empty in this capture, worth re-checking on a longer conversation or after hitting a rate limit to see if it ever populates |
| `response.persisted` | Ack that the turn was saved server-side |
| `conversation.title.updated` | Auto-generated chat title (e.g. `"Friendly Greeting"`) |
| `response.chunk` (`follow_up_suggestions`) | 2+ suggested next questions the UI would normally show as clickable chips — not seen on any other provider |
| `pong` | WebSocket heartbeat keep-alive |

**Candidates for later extraction** (not yet implemented):
- Model tier (`session.model`) + `conversation.id`/`response.id` — same
  pattern as the other three providers.
- Auto-generated title (`conversation.title.updated`).
- Follow-up suggestions — unique to Grok among the providers checked so far.
- Revisit `response.done`'s `usage` field once we see it non-empty.

## Qwen (chat.qwen.ai)

Added as a new provider to the Live Capture Engine only (not Universal
Chat/Agent orchestrator — scoped to discovery/System 1 for now, per user's
call). No `AITool` type change, no `injector.ts` selectors, no
`providerUrls.ts` entry — the tab is opened as a regular custom tool (same
mechanism already used for Perplexity), and only the capture side was wired
up.

**Discovery process:** hostname didn't match any existing `CAPTURE_RULES`
entry, so a `buildURLSnifferSrc('qwen')` rule was added first (logs every
network call, no bodies) to find the real endpoint — same method used
originally for Gemini/Grok. That found `POST /api/v2/chat/completions?chat_id=...`
as the actual streaming answer call; the sniffer rule was then replaced with
a real `buildCaptureInjectSrc` fetch-tee rule matching that path.

Source event stream: standard SSE (`\n\n`-delimited), one flat JSON object
per event — shaped like OpenAI's Chat Completions delta format rather than
ChatGPT's own JSON-patch protocol:
```json
{"choices":[{"delta":{"role":"assistant","content":"chunk","phase":"answer","status":"typing"}}],"response_id":"...","usage":{...},"timestamp":...}
```
No `[DONE]` sentinel — the stream just ends after a `status:"finished"` event.

**Implementation:** new file `electron/qwenParser.ts`; wired into
`electron/main.ts` as a dedicated `entry.tool === 'qwen'` branch (own SSE
buffering, since it needed a plain `\n\n` split rather than any of the other
providers' special-cased framing).

### 1. Answer Text

Only deltas where `delta.phase === "answer"` are real reply content — see
next section for why `phase` must be checked.

### 2. Visible Chain-of-Thought ("Thinking Summary") — new, not seen elsewhere

**What it is:** Every turn streams a `"thinking_summary"` phase *before*
the `"answer"` phase, and unlike Claude's `thinking` content block (which
arrived empty in every capture taken), Qwen's actually carries real text:
a short title and a multi-sentence reasoning summary.

**Raw shape:**
```json
{"choices":[{"delta":{"content":"","phase":"thinking_summary","extra":{
  "summary_title":{"content":["Acknowledging the greeting with warmth and courtesy"]},
  "summary_thought":{"content":["I recognize the user's message as a friendly salutation..."]}
},"status":"typing"}}]}
```
Note `content` is always empty during this phase — the actual text is
nested under `delta.extra`, not `delta.content`.

**Implementation:** `extractThinkingSummaryFromSSEEvent()` in
`electron/qwenParser.ts`. Currently only logged to the terminal
(`[FlowDesk thinking][qwen]`), not yet broadcast over IPC.

**Why it's useful:** A genuine look at the model's reasoning before it
answers — could be surfaced in the UI as a "thinking..." expandable section,
the way Qwen's own web app presumably shows it.

**Caveat:** `phase` must be checked before trusting `content` as answer
text — if Qwen ever changes to put real text in `content` during
`thinking_summary` too, it would silently leak into the captured answer
without that guard.

### 3. Live Token Usage

**What it is:** Running token counts for the turn — updated on nearly
every chunk, not just once at the end like ChatGPT/Claude's quota info.

**Raw shape:**
```json
"usage": {"input_tokens": 551, "output_tokens": 210, "total_tokens": 761, "output_tokens_details": {"reasoning_tokens": 196}}
```

**Implementation:** `extractUsageFromSSEEvent()` in
`electron/qwenParser.ts`. Broadcasts via the same `capture:usage` IPC event
the other providers use, though the shape differs again (`{ inputTokens,
outputTokens, totalTokens, reasoningTokens }`) — any shared UI needs to
branch per-provider on shape, same caveat as Claude's usage entry.

**Why it's useful:** A per-turn cost/length indicator rather than an
account-wide quota — useful for showing "this reply cost ~200 tokens"
rather than "you have 5 requests left today".

## Perplexity

Source event stream: `POST /rest/sse/perplexity_ask` (standard SSE). Text
extraction (`perplexityParser.ts`) was already confirmed working before this
session — this pass just re-verified it live and looked at what else rides
along in the same event.

**Status: observed only — nothing new extracted into structured fields**
(user's call, same as Grok). Findings below are for when we come back to
implement.

**Note on the "stream error" every turn logs:** every Perplexity capture
ends with `AbortError: BodyStreamBuffer was aborted`, already documented in
`main.ts` as expected — Perplexity's page aborts the underlying connection
right after it's done streaming, as its normal way of closing up. Confirmed
again here: the error fires *after* the full answer text was already
extracted (`"Sab theek bhai, tum sunao? 😄"` came through intact), so this
is not a capture failure, just a noisy-looking but harmless log line.

Fields seen in the raw event body, beyond the answer text itself:

| Field | What it is |
|---|---|
| `display_model` / `user_selected_model` | Model name (seen: `"turbo"`) |
| `search_focus` | e.g. `"SearchFocus.INTERNET"` — Perplexity's distinguishing feature (it does live web search) |
| `search_mode`, `search_implementation_mode` | e.g. `"SEARCH"`, `"multi_step"` |
| `mode` | Response style, e.g. `"CONCISE"` (vs. a more detailed mode) |
| `pending_followups_block.followups` | Suggested follow-up questions — same concept as Grok's `follow_up_suggestions`, empty in this capture |
| `backend_uuid`, `context_uuid`, `uuid`, `thread_url_slug`, `cursor` | Several different ID/cursor fields for the turn and thread |
| `classifier_results.mhe_predictions` | Internal ML classifier output (e.g. `nav_intent` — whether the query looks like a navigation request rather than a real question) — probably not useful to us, included for completeness |
| `status` | e.g. `"PENDING"` while streaming, `"COMPLETED"` on the final event |
| `final_sse_message` | Boolean marking the last event of the stream |

**No numeric usage/quota field exists** (confirmed by reading the full,
untruncated final event — earlier passes had the debug log truncated at
2000 chars and only caught the first `PENDING` event, which is why this was
initially missed). Unlike ChatGPT's countdown, Claude's percentage, or
Qwen's token counts, Perplexity has no "N requests remaining" style field
at all. What it has *instead*, only on the final (`status: "COMPLETED"`,
`final_sse_message: true`) event, under `_extras`:

```json
"_extras": {
  "country": "PK",
  "subscription_tier": null,
  "payment_tier": null,
  "pro_search_mode": "auto",
  "core_elapsed": 1.43
}
```

| Field | What it is |
|---|---|
| `subscription_tier` / `payment_tier` | Account tier (Free vs. Pro) rather than a usage countdown — both `null` here since this account has no paid tier |
| `country` | Device-based location guess — same concept as Gemini's `detectedCountry`, seen here too |
| `core_elapsed` | Total response time in seconds (e.g. `1.43`) — same concept as ChatGPT's `server_ttfvt_ms` |

**Candidates for later extraction** (not yet implemented): model name +
search-mode info (mirrors what was done for the other providers),
conversation/thread IDs for consistency, and the `_extras` block above
(account tier + country + response time) as the closest equivalent to the
other providers' "usage" concept.
