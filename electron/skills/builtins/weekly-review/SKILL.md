---
name: weekly-review
title: "Weekly review and learnings"
description: "Turn a week of posts and numbers into a short review per brand and evidence-backed learnings saved straight to Brain. Also how to use brand voice and accepted learnings when creating content."
version: 1.0.0
domain: brain
tools:
  - jobs
  - inbox
  - brain_activity
  - brain_content
  - brain_learning
  - brain_record
  - brain_briefing
---

## Weekly review
1. Make sure numbers are fresh: start `metrics.tiktok`, `metrics.pinterest`, `metrics.gumroad`
   (background jobs) and wait for them in the inbox.
2. `jobs { action: "start", recipe: "brief.weekly" }` → take the packet from the inbox and read
   its result: the week's actions, the latest numbers and the content items.
3. Per brand: what was posted, what performed best and worst (numbers, not feelings), what
   failed (tool errors from the activity), and what is scheduled next.
4. Write the review for the user in Roman Urdu, short.
5. Save 1-5 learnings with `brain_learning { action: "record", data: { statement, scope: <brand id or platform>, evidence: [content ids, numbers], confidence } }`.
   A learning is a rule someone can act on ("Mandala pins with a thick black border got 3x the
   saves of thin-line ones (12 vs 4, 6 pins each)"), not an observation.
6. `brain_wrap` with the review's decisions and the next experiment.

## Using brand voice and learnings
Before writing a caption, title or prompt for a brand:
- `brain_briefing { brandId }` — the brand's niche, audience, voice, visual rules and current
  learnings for it;
- follow them; if a learning conflicts with what the user asks now, the user wins and you say so.
