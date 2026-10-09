---
name: content-life-path
title: "Content life path: idea to numbers"
description: "Keep every pin, video, product and post connected from idea to prompt to file to where it was posted to its numbers, by creating a Brain content item and passing its contentId to every tool that works on it."
version: 1.0.0
domain: brain
tools:
  - brain_content
  - brain_activity
  - chatgpt_generate_image
  - flow_generate_video
  - pinterest_create_pin
  - tiktok_upload_video
  - gumroad_create_product
---

## The rule
One piece of content = one Brain content item. Create it before you start, pass its id as
`contentId` to every generation, upload and posting tool, and FlowDesk links each step to it.

## Steps
1. `brain_content { action: "create", data: { kind: "pin" | "video" | "product" | "post", title, brandId, stage: "idea", ideaSource } }`
   → keep the returned `id`.
2. Record the prompt: `brain_content { action: "link", data: { contentId, type: "prompt", detail: "<prompt>" } }`.
3. Generate with `contentId` (e.g. `chatgpt_generate_image { ..., contentId }`). Pin images always
   come from ChatGPT; Flow is for product content and video, with the user's approval.
4. Approval from the user → `link` with `type: "approval"`; move `stage` to `approved`
   (`brain_content { action: "update", data: { id, stage: "approved" } }`).
5. Post or schedule with `contentId`. The posting tool's result (pin id, video id, URL) becomes a
   `placement` automatically and the stage moves to `live`.
6. Numbers arrive from the `metrics.*` background jobs; the item moves to `measured`.

## Reading a life path
`brain_content { action: "get", data: { id } }` returns the item, every link (prompt, asset,
approval, placement) in order, the latest numbers, and the ledger events for it.

## Stages
`idea → made → approved → scheduled → live → measured` (or `dropped`). Move stages yourself
for steps FlowDesk cannot see (an edit in another app, a manual upload) with `update` and a
`link` of type `note` or `edit`.
