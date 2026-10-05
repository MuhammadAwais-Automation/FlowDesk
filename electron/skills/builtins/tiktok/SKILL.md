---
name: tiktok
title: "TikTok (research, profile, posts, accounts)"
description: "How to use every FlowDesk TikTok tool: trend and outlier research, video and creator reads, niche radar, own posts and profile, publishing and deleting with approval, and routing every call to the right signed-in TikTok account."
version: 1.0.0
domain: tiktok
tools:
  - tiktok_accounts
  - tiktok_status
  - tiktok_switch_account
  - tiktok_get_profile
  - tiktok_list_posts
  - tiktok_feed
  - tiktok_search
  - tiktok_suggest
  - tiktok_video_detail
  - tiktok_outlier
  - tiktok_api_search
  - tiktok_api_video_detail
  - tiktok_api_creator_feed
  - tiktok_api_outlier
  - tiktok_api_batch_outliers
  - tiktok_radar_niches
  - tiktok_radar_save_niche
  - tiktok_radar_collect
  - tiktok_radar_start
  - tiktok_radar_stop
  - tiktok_radar_report
  - tiktok_warmup_scroll
  - tiktok_api_upload_video
  - tiktok_upload_video
  - tiktok_submit_post
  - tiktok_edit_video_caption
  - tiktok_delete_video
  - tiktok_delete_all_videos
  - tiktok_update_profile
  - social_accounts
  - social_open_login
inputs: {}
---

Checked against the live app on 2026-10-05 with accounts 1 and 2 signed in. FlowDesk drives the
user's own TikTok sessions (cookie `sessionid` per account partition); there is no API key.
Only read tools were exercised live; write tools were checked only to refuse bad input.

## When to use
- Researching TikTok: trending videos, keyword search, viral outliers of a creator, video stats, hashtag ideas.
- Watching a niche over time with the radar and getting a "what works now" report.
- Reading the user's own TikTok profile and posts on any of their accounts.
- Publishing, editing or deleting the user's own videos, or changing the bio — only after the user approves.

## When not to use
- Making the video itself: `google-flow` (video) or `chatgpt` (images).
- Writing captions: `caption-hashtag-writer` skill, then publish here.
- Commenting, liking, following, messaging: there are no such tools (except `autoLike` in warmup).

## Which tool for which job

| The user wants to… | Use | Notes |
|---|---|---|
| see which accounts exist / are signed in | `tiktok_accounts` (or `social_accounts {platform:"tiktok"}`) | `selected:true` = the account used when `account` is omitted |
| check one session | `tiktok_status {account}` | `authenticated`, `username`, `mode` |
| search videos by keyword | `tiktok_api_search` | Fast JSON, exact counts, `hasMore`/`cursor` for paging. `tiktok_search` is the slower page-scrape version |
| trending / explore videos | `tiktok_feed` | Reads the /explore grid (~5-10 s) |
| hashtag and keyword ideas | `tiktok_suggest {seed}` | Uses search suggestions; no page load |
| one video's stats, sound, caption | `tiktok_api_video_detail {url or id}` | `tiktok_video_detail` opens the page and falls back to the API read |
| a creator's recent videos | `tiktok_api_creator_feed {creator}` | handle with or without @ |
| a creator's outliers (views vs median) | `tiktok_api_outlier {creator, minMultiplier}` | `tiktok_outlier` = page-scrape version |
| outliers of several creators at once | `tiktok_api_batch_outliers {creators[]}` | Up to ~35 s |
| watch a niche over time | `tiktok_radar_save_niche` → `tiktok_radar_collect` or `tiktok_radar_start` → `tiktok_radar_report` | Collect takes 1-5 min (4 s between calls) |
| own profile / own posts | `tiktok_get_profile`, `tiktok_list_posts` | Studio API; posts carry id, caption, views, likes, visibility, schedule |
| publish a video | `tiktok_api_upload_video` (APPROVAL) | Private by default; ok only with TikTok's item id |
| publish through the Studio form | `tiktok_upload_video` then `tiktok_submit_post` (APPROVAL) | Fallback only |
| change a caption | `tiktok_edit_video_caption` (APPROVAL) | |
| delete one video | `tiktok_delete_video` (APPROVAL, irreversible) | |
| delete every video | `tiktok_delete_all_videos` (APPROVAL, irreversible) | Also gated by the app's action policy: the user must click Allow in FlowDesk |
| change the bio | `tiktok_update_profile` (APPROVAL) | 80 by TikTok count (emoji = 2); also gated by the action policy |
| change which account is the default | `tiktok_switch_account {account}` | Rarely needed: every tool takes `account` |
| sign an account in | `social_open_login {platform:"tiktok", account}` | The user types the password |

Order for research: `tiktok_suggest` → `tiktok_api_search` → `tiktok_api_outlier` / `tiktok_api_batch_outliers`
on the creators found → `tiktok_api_video_detail` on the winners. For a recurring niche use the radar instead.

## Account routing
- Every TikTok tool takes `account`: id (`"1"`, `"2"`), label (`"Account 2"`) or partition (`"social-tiktok-2"`).
  Account 1 is partition `social-tiktok`, account N is `social-tiktok-N`.
- No `account` = the selected account (`tiktok_accounts` → `selected:true`; set by `tiktok_switch_account`
  or the Social page). Pass `account` explicitly for anything that writes.
- An unknown account returns `ok:false` "unknown tiktok account" — it never falls back to another account.
- Every result says which partition answered in `account`. A radar niche reads with the `account` saved on it.
- Different accounts run in their own hidden windows; two calls on the SAME account share one page, so
  run them one after the other.

## Write tools need the user's approval
`tiktok_api_upload_video`, `tiktok_upload_video`, `tiktok_submit_post`, `tiktok_edit_video_caption`,
`tiktok_delete_video`, `tiktok_delete_all_videos`, `tiktok_update_profile` and `tiktok_warmup_scroll`
with `autoLike: true` change the user's public account. Never call them unless the user asked for that exact
action in this conversation, on that account; state the account, file/caption/video id and privacy first.
Deletes cannot be undone. `tiktok_delete_all_videos` and `tiktok_update_profile` additionally wait for the
user to click Allow in the FlowDesk app and fail with "needs approval" otherwise — do not retry around it.

## Limits
- Feed/search/outlier (page versions) return at most 50 items; API search pages with `offset`.
- `scheduleAt` for uploads: 15 minutes to 10 days ahead, and not with `privacy: "private"`.
- `tiktok_delete_all_videos` limit 1-200 (default 100), 2.5 s between deletes.
- Warmup scroll: 10-600 s. It is account-warming browsing; keep it short and infrequent.

## When something fails

| Message | Meaning | Do |
|---|---|---|
| `unknown tiktok account "…"` | Not in the account list | `tiktok_accounts`, use an id from there |
| `authenticated: false` / `upload/auth returned no video token … signed in?` | Account signed out | `social_open_login`, ask the user to sign in |
| `empty response — the request went out unsigned` | Page was not on a signing page | Retry once |
| `… is blocked by FlowDesk's action policy` | Action disabled by the user | Tell the user; do not work around it |
| `… needs approval in the FlowDesk app and was not approved` | User did not click Allow within 60 s | Ask the user, then retry once |
| `bio is N by TikTok's count …` | Bio too long | Shorten it |
| `Post button is disabled` | Studio upload still processing | Wait and retry `tiktok_submit_post` |
| `TikTok bridge execution timed out` | Slow page | Retry once; prefer the `tiktok_api_*` version |
| radar `blocked 3x` | TikTok throttled the radar | Stop collecting for a while |

## Same thing from a terminal

`flowdesk tiktok accounts | switch <id> | status | feed | search "<q>" | detail --url <url> | suggest "<seed>"
| outlier "<creator>" | upload --file <mp4> --caption "<text>" | publish | posts | delete --id <id> | delete-all`,
each with `--account <id>`.
