---
name: youtube
title: "YouTube research (niches, outliers, packaging, transcripts)"
description: "How to research YouTube with FlowDesk: niche maps, outlier videos against their channel's median, search with YouTube's filters, channel stats, transcripts, comments, Most Replayed moments, one-video breakdowns and view-speed tracking. No API key, no sign-in."
version: 1.1.0
domain: youtube
tools:
  - youtube_niche_scan
  - youtube_outliers
  - youtube_search
  - youtube_suggest
  - youtube_channel_videos
  - youtube_video_detail
  - youtube_breakdown
  - youtube_comments
  - youtube_most_replayed
  - youtube_watchlist
  - youtube_related_videos
  - youtube_channel_search
  - youtube_trending
  - youtube_keyword_research
  - youtube_comment_insights
  - youtube_monetization
  - youtube_video_earnings
inputs: {}
---

FlowDesk reads YouTube through YouTube's own page in a hidden view with its own session (`social-youtube`).
It is not signed in and never touches the user's channel, so every tool here is read-only research.
Built from captured traffic on 2026-10-16. One request runs at a time.

## When to use
- Finding what works in a niche before making videos: topics, formats, titles, lengths.
- Explaining why one video beat its channel (packaging, hook, the moments people replay, comments).
- Watching how fast chosen videos are growing.

## When not to use
- Uploading, scheduling or editing videos on the user's channel: not built yet.
- TikTok research: use the `tiktok` skill.

## The order that works

```
youtube_niche_scan {topic}            ─► demand (autocomplete) + channels + outliers + patterns
        │
youtube_outliers {query | channel}    ─► the videos that beat their own channel (2×+ by default)
        │
youtube_breakdown {video}             ─► why one of them worked
        │
youtube_watchlist add → refresh later ─► how fast they are still growing
```

## Which tool for which job

| Job | Tool | Time |
|---|---|---|
| Map a whole niche in one call | `youtube_niche_scan {topic, type?, uploaded?}` | 2-4 min |
| Breakout videos for a topic or one channel | `youtube_outliers {query \| channel, type?, uploaded?, minScore?}` | topic 1-3 min, channel ~10 s |
| What exists for a query, exact views | `youtube_search {query, type?, uploaded?, duration?, sort?}` | 5-20 s |
| What people type into search | `youtube_suggest {seed, expand?, language?, country?}` | 1-5 s |
| A channel's profile and videos | `youtube_channel_videos {channel, tab?, sort?, limit?}` | 5-30 s |
| One video's details and transcript | `youtube_video_detail {video, transcript?, language?}` | 5-15 s |
| Why one video worked | `youtube_breakdown {video}` | 30-60 s |
| What viewers say | `youtube_comments {video, sort?, limit?}` | 3-20 s |
| Which moments hold viewers | `youtube_most_replayed {video}` | 2-5 s |
| Growth over time (videos and channels, title changes) | `youtube_watchlist {action, videos?, channels?}` | ~1-3 s each |
| Videos YouTube puts next to a video | `youtube_related_videos {video}` | 3-10 s |
| Channels in a niche | `youtube_channel_search {query}` | 5-15 s |
| Fastest growers on a topic right now | `youtube_trending {topic, window?}` | 10-20 s |
| Demand and competition for a keyword | `youtube_keyword_research {keyword}` | 15-30 s |
| What viewers ask for across a niche | `youtube_comment_insights {topic}` | 1-2 min |
| Is a channel monetized, rough earnings | `youtube_monetization {channel}` | 20-40 s |
| Rough earnings of one video | `youtube_video_earnings {video}` | 5-10 s |

## Reading the numbers

- **outlierScore** = views ÷ the channel's median views over its latest ~30 videos (or Shorts). 2 means
  twice the channel's typical video. The median, not the average, so one viral hit does not hide the rest.
- **Views:** exact on search results and video detail; rounded on channel pages ("620K"). Each video
  carries `viewsApprox: true` when rounded.
- **ageDays / published** come from YouTube's "3 weeks ago" text, so they are approximate.
- **viewsPerDay** compares old and new videos fairly. **viewsPerHourRecent** (watchlist) is the growth
  between the last two checks.
- **Most Replayed** intensity is 0-1, relative to the rest of the same video. Videos with few views have no graph.
- **Autocomplete** shows wording and demand, never search volume. YouTube publishes no search volume; keyword research gives demand and competition signals instead.
- **Monetization** is read from whether YouTube serves ads on a channel's recent videos (to a signed-out viewer here): a strong sign, not proof. Ads can also run on channels that are not paid. **Earnings** are views × an assumed RPM range for the spoken language and format, never real figures.
- **Trending** is per topic: YouTube has no single public trending list. It ranks by views per hour since upload.

## Rules

- Shorts and long videos are judged separately: pass `type: "short"` for Shorts.
- Use `sort: latest` (the default) on a channel when you want a fair median.
- A breakdown gives facts, not a verdict. Judge the hook, title and thumbnail yourself from them.
- Do not loop the slow tools over dozens of topics; YouTube may slow the hidden page down.

## When something fails

| Message | Meaning | Do |
|---|---|---|
| `is not a YouTube video link or id` | Bad input | Pass a watch/shorts/youtu.be link or the 11-character id |
| `is not a YouTube channel` | Bad input | Pass @handle, a channel link or a UC… id |
| `YouTube page: …` / `did not load` | YouTube changed or is unreachable | `flowdesk_health_check`, then `flowdesk_report_issue` |
| `transcriptError: the player did not load captions` | Captions did not load (very short video, or none) | Retry once, or use the description |
| `heatmap: null` | YouTube shows no graph for this video | Normal for small videos |
