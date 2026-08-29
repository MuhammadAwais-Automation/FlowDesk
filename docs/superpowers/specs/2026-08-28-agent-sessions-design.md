# Agent Sessions Design

## Purpose

Give the Agent real, durable conversations: many sessions the user can leave and
come back to, none of which are ever destroyed, whose memory survives switching
between the Claude and Codex providers mid-conversation.

## The problem this fixes

Two defects, confirmed by reading the current code rather than inferred:

1. **Conversations are destroyed.** `src/pages/Agent.tsx` persists to a single
   electron-store key, `AGENT_STORE_KEY = 'agentSession'`. `handleNewSession()`
   builds a fresh session and writes it to that same key, so starting a new
   conversation permanently overwrites the previous one. There is no session
   list, no history, and no way back.

2. **Memory is shallow, because the SDK's own memory is switched off.**
   `leadAgent.ts` passes `persistSession: false`, which disables the Claude
   Agent SDK's session persistence and therefore its built-in compaction.
   Continuity is instead reconstructed by `buildAgentHandoffPrompt`
   (`src/lib/agentSession.ts`), which prepends a recap of the last
   `maxEntries = 6` turns, each truncated to 1000 characters and each tool
   result to 400. Beyond six turns the agent genuinely remembers nothing.

The second point is the important one: the capability was always present and
deliberately turned off. This design turns it on rather than rebuilding it.

## What the SDKs already provide

Verified against the installed type definitions, not assumed:

- `@anthropic-ai/claude-agent-sdk` exposes `persistSession` (default `true`),
  `resume: string` — *"Session ID to resume. Loads the conversation history from
  the specified session"* — and `sessionId` for supplying a UUID of our own. It
  performs compaction internally, surfacing it through the `PreCompact` and
  `PostCompact` hooks, an `SDKCompactBoundaryMessage`, and a `compact_summary`
  field described as *"The conversation summary produced by compaction."*
- `@openai/codex-sdk` exposes `resumeThread(id, options)` alongside
  `startThread`.

Compaction therefore needs no model choice, no API key, and no cost estimate on
our side: it happens inside the provider's own session, on the credential the
agent is already running under. This design writes no summarization code.

## User-visible behaviour

1. A sidebar lists every session, most recently updated first, with a title and
   a relative timestamp.
2. Selecting a session restores that conversation with its memory intact.
3. "New Session" creates an additional session. It never overwrites or deletes
   an existing one.
4. Sessions can be renamed, and deleted only through an explicit confirmation.
5. Switching provider mid-session continues the same conversation, in both
   directions, any number of times, with no manual step from the user.
6. A long-running session keeps answering in context without the conversation
   being truncated at six turns.
7. The full text of every turn stays readable in FlowDesk's own storage.

## Non-goals

- No custom compaction or summarization. The providers do it.
- No cross-session memory. A session does not know what happened in another
  session; that is the Brain project, deliberately deferred.
- No search across sessions in this slice.
- No cloud sync, export, or sharing.
- No change to how tools, approvals, or the worker queue behave.
- No Studio integration. This slice only has to leave a session *attachable*
  later; it does not build that.

## Architecture

### Two kinds of memory, with different owners

**Provider memory** — Claude's session and Codex's thread. Each provider stores
and compacts its own conversation. We hold only an identifier for each.

**FlowDesk's transcript** — our own append-only record of every turn, whoever
produced it. It exists for three jobs: rendering history in the UI, surviving
provider-side cleanup, and — the structural one — catching a provider up on
turns it never saw.

The transcript is not sent as the prompt in the normal case. A turn on the
provider the session is already using sends only the new message.

### Per-provider catch-up

Each provider entry records how far that provider has been brought up to date:

```
session "FlowDesk work"
  claude: { sessionId: "abc-123", syncedThroughTurn: 40 }
  codex:  { threadId:  "xyz-789", syncedThroughTurn: 80 }
  turns:  92
```

On every turn, compare the active provider's `syncedThroughTurn` against the
transcript length:

- **Equal** — the normal case. Resume that provider's session and send only the
  new message. No catch-up text, no extra cost.
- **Behind** — build a catch-up block from exactly the missing turns, prepend it
  to the new message, then advance the watermark.
- **Absent** — that provider has never seen this conversation. Seed it from the
  whole transcript, which is the same operation with the watermark at zero.

This is what makes provider switching automatic and repeatable. A conversation
that runs Claude in the morning, Codex in the afternoon, and Claude again at
night catches Claude up on the afternoon's turns only — the morning is already
in Claude's own session — and it happens without the user doing anything.

Catch-up text is built from the transcript, which is why the transcript has to
be provider-independent: it records turns from both providers in one ordered
list.

### Storage

Each session owns a directory under `app.getPath('userData')/agent-sessions/`:

```
agent-sessions/
  <sessionId>/
    turns.jsonl    append-only, one JSON object per turn, never rewritten
    meta.json      title, timestamps, provider ids and watermarks
```

`turns.jsonl` is append-only on purpose: a turn is added by appending one line,
so an interrupted write can damage at most the final line rather than the whole
conversation.

This replaces electron-store for session data. electron-store holds a single
JSON document rewritten in full on every `set`; with dozens of long
conversations that is both slow and a single point of loss. Per-session
directories mean one damaged session cannot take the others with it.

### Where provider sessions live, and what follows from it

Setting `persistSession: true` makes the Claude SDK write session transcripts to
`~/.claude/projects/` — outside FlowDesk's own storage. Three consequences,
each of which the design has to answer rather than discover later:

1. **Deleting a FlowDesk session must also delete the provider session**, or
   abandoned transcripts accumulate in a directory the user never looks at.
2. **A provider-side cleanup can remove memory FlowDesk still lists.** This is
   why FlowDesk keeps its own transcript: the history the user reads, and the
   ability to re-seed a provider, both survive it.
3. **A provider session that has gone missing is a normal state, not an error.**
   Resuming an id the provider no longer has must fall back to seeding a fresh
   session from the transcript, silently.

The SDK's `sessionStore` mirroring option would address (2) more directly, but
its own type documentation marks it `@alpha`; this design does not depend on it.

## Data model

```ts
interface AgentTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: AgentToolCallEntry[]   // existing shape, unchanged
  provider?: 'claude' | 'codex'     // which provider produced an assistant turn
  createdAt: string
}

interface ProviderLink {
  id: string                 // Claude sessionId or Codex threadId
  syncedThroughTurn: number  // transcript turns this provider has seen
}

interface AgentSessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
  providers: Partial<Record<'claude' | 'codex', ProviderLink>>
}
```

`providers` is partial because a session that has only ever used one provider
has only one entry, and that is the common case.

## Modules

- `electron/agentSessionStore.ts` — the session directory: list, create, append
  turn, load turns, read and update meta, rename, delete. Owns all filesystem
  concerns and nothing else.
- `src/lib/agentCatchUp.ts` — pure: given a transcript and a watermark, produce
  the catch-up text, or nothing when the provider is current. No filesystem, no
  Electron, directly testable.
- `electron/agent/leadAgent.ts` — accepts a resume id, passes `persistSession:
  true`, reports the session id it used.
- `electron/agent/codexLeadAgent.ts` — same, via `resumeThread`.
- `src/components/agent/SessionList.tsx` — the sidebar.

Keeping catch-up pure and separate from storage is what allows the watermark
logic to be tested without touching disk or a provider, and it keeps
`Agent.tsx` — already 717 lines — from taking on the session list as well.

## Migration

On first run, an existing `agentSession` value in electron-store is imported as
a session directory, then the old key is cleared. The user keeps the
conversation they had, with no provider ids, so its next turn seeds whichever
provider is used. A missing or malformed value is not an error: the user simply
starts with no sessions.

## Error handling

- **Resuming an unknown provider session** — treat as absent and seed from the
  transcript. Not surfaced as an error.
- **A corrupt trailing line in `turns.jsonl`** — load every preceding turn and
  continue. A partial write must not cost the whole conversation.
- **Provider-side delete failing during session delete** — remove the FlowDesk
  session anyway and log. The user's intent was to delete.

## Testing

Pure (`agentCatchUp`), no filesystem:

- A provider whose watermark equals the turn count produces no catch-up text.
- A provider behind by N turns produces text covering exactly those N turns,
  and neither earlier nor later ones.
- A provider with no link produces catch-up covering the whole transcript.
- An empty transcript produces no catch-up text.
- Catch-up includes turns from the other provider, since that is its purpose.

Store, against a temp directory:

- Appending a turn does not rewrite earlier turns.
- A `turns.jsonl` with a corrupt trailing line loads every preceding turn.
- Creating a session never modifies another session's files.
- Deleting removes exactly one session directory.
- The electron-store migration produces one session and clears the old key.

Regression:

- Watermarks advance only after a turn completes, so an aborted turn does not
  mark a provider as caught up on a turn it never received.

## Open questions

None blocking. The compaction cost question that an earlier draft raised is
gone: compaction now happens inside the provider's own session, so there is no
model to choose and no separate spend to measure.
