---
name: brain-protocol
title: "FlowDesk Brain protocol: start, record, wrap"
description: "How every agent session uses FlowDesk Brain: brain_start first, keep the Brain up to date yourself (accounts, brands, content, learnings), and brain_wrap at the end. Read this before any multi-step work for the user."
version: 1.0.0
domain: brain
tools:
  - brain_start
  - brain_wrap
  - brain_briefing
  - brain_activity
  - brain_record
  - brain_learning
  - brain_forget
---

## Why
FlowDesk has no AI inside. You are the user's operator; Brain is the shared memory every
agent reads and writes, so the next session (maybe a different agent) knows exactly where
things stand. FlowDesk logs every tool call by itself; your job is the parts only you know:
what the user decided, why, and what comes next.

## Session start (always)
1. `brain_start { platform? }` — scope it to the platform you are about to work on. You get:
   - the user's rules (AGENTS.md) — they override your defaults;
   - hot.md — what is due, what waits on the user, running jobs, the inbox, tool health,
     and the last agent's handoff;
   - the briefing — brands, which account is for what, the last 7 days, the next 7 days.
2. Tell the user, in Roman Urdu and in a few lines, where things stand and what waits for them.
3. Read the platform skill the briefing names (`flowdesk_skill_get`).

## While working
- Pass the right `account` to every social tool. The briefing says which account belongs to
  which brand; never guess an account for a brand.
- You keep the Brain; nobody approves anything inside FlowDesk. As soon as you know it, save:
  - which brand and job each account has → `brain_record { type: "account", action: "set",
    data: { platform, account, fields: { brand, purpose } } }` (check the account first, e.g.
    its profile, instead of guessing);
  - brand details and facts about the user → `brain_record { type: "brand" | "profile" }`;
  - what was uploaded where, and what is still to upload → `brain_content` (stage idea/made/
    scheduled/live);
  - a pattern backed by numbers ("pins with X get 3x saves") → `brain_learning { action: "record" }`
    with evidence.
  Saved values are current at once. When something turns out wrong or stale, correct it
  yourself: save the right value (the old one stays in the history), or retire the learning
  with `brain_learning { action: "update", data: { id, status: "retired" } }`.
- A calendar item or a thing that waits on the user → `brain_record { type: "task" }`
  (`state: "waiting"`, `waitingOn: "user approval"`).
- To answer "what did we do on …" use `brain_activity`, not memory.
- A memory that is wrong → ask the user, then `brain_forget`.

## Session end (always)
`brain_wrap { summary, decisions, next, focus }`. Write `next` as an instruction the next
agent can follow without asking ("Schedule pins 4-6 on board X after the user approves the
titles in hot.md"). If you forget, FlowDesk still logs the session but without your handoff.

## Records cheat sheet
| type | set data |
|---|---|
| profile | `{ field, value }` |
| brand | `{ name, fields: { niche, audience, voice, offer, goal, visualRules, links, rules } }` |
| account | `{ platform, account, fields: { brand, purpose, dailyLimit, rules, warmupStage } }` |
| task | `{ title, dueAt, platform, account, state, waitingOn, contentId }` |
| contact | `{ platform, name, stage, nextStep, notes }` |
| idea | `{ text, source, score, brandId }` |

`brain_record { type, action: "history", data: { subject: "brand:<id>", field } }` shows how a
value changed over time; old values are kept, never overwritten.

## Not for
- Raw chat text, passwords, cookies, tokens: never save them as records.
- Long research: start a background job (`background-jobs` skill) instead of looping reads.
