---
name: background-jobs
title: "Background jobs and the inbox"
description: "Run long research or number collection in the background with jobs, pick results up later from the inbox, and do the thinking work packets ask for (radar winners, chat digests, weekly review)."
version: 1.0.0
domain: brain
tools:
  - jobs
  - jobs_monitor
  - inbox
  - brain_record
  - brain_learning
---

## When
Anything that would take many tool calls or minutes: TikTok radar, Pinterest trends or niche
research, Reddit or LinkedIn searches, reading numbers for every post, unread WhatsApp chats.
Start it, keep working on something else, and read the result when it lands in the inbox.

## Recipes
`jobs { action: "recipes" }` lists them. Current set:

| recipe | params | result |
|---|---|---|
| `tiktok.radar` | `{ niche, hours? }` | new videos for a saved radar niche → agent packet: pick winners |
| `tiktok.search` | `{ query, limit? }` | videos |
| `pinterest.trends` | `{ country?, limit? }` | trends, saved as ideas |
| `pinterest.niche` | `{ niche, country? }` | niche research |
| `pinfactory.nicheScan` | `{ candidates: [..] }` | scored niches → agent packet |
| `reddit.search` / `linkedin.search` | `{ query, ... }` | posts / results |
| `metrics.tiktok` / `metrics.pinterest` / `metrics.gumroad` | `{ account? }` | numbers per post, pin or product; scheduled posts go to the calendar |
| `whatsapp.digest` | `{ limit? }` | unread chats → agent packet: write the digest |
| `brief.daily` / `brief.weekly` | `{}` | morning brief / weekly review packets |

## Flow
1. `jobs { action: "start", recipe, params }` → job id immediately.
2. `jobs { action: "status", id }` while it runs (or just continue other work).
3. Finished → `inbox { action: "list" }` shows it. Items with `needsAgent` carry instructions.
4. `inbox { action: "take", id }`, then `jobs { action: "result", id: <jobId>, page }` (paged).
5. Do the thinking the packet asks for and write results back (`brain_record` ideas, contacts,
   tasks; `brain_learning` records). Then `inbox { action: "done", id, note }`.

## Schedules
`jobs_monitor { action: "create", recipe, params, everyMinutes }` repeats a recipe (minimum 15
minutes). Only create one when the user asked; list, pause, resume and delete them the same way.

## Rules
Jobs only read. Nothing a job finds is posted or sent; replies and posts still need the user's
yes in chat. Chat packets contain real messages: summarise them, never copy them into records.
