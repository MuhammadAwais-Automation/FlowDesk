---
name: youtube-niche-strategy
title: "YouTube niche strategy (choose, combine, make it valuable)"
description: "Playbook for choosing a YouTube niche with FlowDesk's tools: shortlist, score niches side by side, find a new angle by combining niches, make the channel worth more than its copycats, and plan and check the first 30 days. Every step names the tool and what to read."
version: 1.0.0
domain: youtube
tools:
  - youtube_niche_compare
  - youtube_niche_mashup
  - youtube_niche_scan
  - youtube_outliers
  - youtube_breakdown
  - youtube_comment_insights
  - youtube_keyword_research
  - youtube_trending
  - youtube_monetization
  - youtube_watchlist
inputs: {}
---

How to go from "which channel should I start?" to a plan, using the `youtube` tools (read that skill for
what each number means). Work in this order; each step narrows the next.

## 1. Shortlist (5-10 candidates)

- Start from what the user can produce (Flow video, ChatGPT images, their language and voice) and what they enjoy.
- For each idea run `youtube_trending {topic, window: "week"}` and `youtube_keyword_research {keyword}`. Drop ideas
  where the top-20 median views are low and nothing recent ranks (nothing is being watched now).

## 2. Score (2-6 at a time)

`youtube_niche_compare {topics}` returns 0-100 scores with evidence. Read it like this:
- **opportunity** matters most for a new channel: breakout videos from channels under 100K subscribers mean a small
  channel can win there.
- **earning** low with high demand means views are easy but money is not (South Asian or kids audiences, or
  channels without ads). Check the strongest candidates with `youtube_monetization {channel}`.
- **flowCreditsPerVideo** is the real cost of one typical video if every second is AI video. Compare it with the
  user's credits before recommending.
- Do not trust one number. Open the `topOutliers` links' breakdowns (`youtube_breakdown`) for the top two niches.

## 3. Combine for a new angle

`youtube_niche_mashup {base, others}` with the best niche as base and 3-5 adjacent themes (horror, moral/faith,
survival, school, history, comedy, a new language):
- **gap**: both sides have demand and few videos combine them. Best for a new channel, but untested.
- **proven and still open**: a few combined videos already reach 100K+ views. Safest angle.
- **tried, low views**: others already combine them and few people watch: avoid, or change the angle.
- **crowded**: only with a clear twist. **weak demand**: drop.
Write titles by joining the `titleWords` of both sides. Check `peopleSearchCombination` for wording people use.

## 4. Make it worth more than the copycats

The research shows views are easy in copied AI niches but many such channels show no ads. Build what a copy lacks:
- **Own characters and series**: the same cast every video, numbered parts, a cliffhanger (people ask for part 2 in comments).
- **Own voice and language**: Urdu/English narration, not a translated template.
- **Hook from the data**: put the conflict in the first 5 seconds (Most Replayed peaks sit at the start and at the
  hero's promise).
- **Monetizable**: family audience, not "made for kids"; original stories, not re-uploads; consistent quality.
- **What viewers ask for**: `youtube_comment_insights {topic}` requests and questions become episodes.

## 5. Plan and check

- First 10 videos: 3-4 formats from the best outliers, 2-3 videos each, then keep what works.
- Put the 10 best competitor videos and channels in `youtube_watchlist` and refresh it daily: which grow fastest now.
- After 7 and 14 days compare your videos against each other (views per day) and double down on the winner.

## Say it honestly

Every recommendation is a data-backed bet, not a guarantee. Scores are relative between the niches compared.
Earnings are estimates from ad signals and assumed RPM ranges. Name the evidence (links) behind each claim.
