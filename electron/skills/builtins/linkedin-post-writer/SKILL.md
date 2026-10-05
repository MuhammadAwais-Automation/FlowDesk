---
name: linkedin-post-writer
title: "LinkedIn Post Writer"
description: "Researches viral hooks, drafts high-converting LinkedIn posts, and coordinates publishing or scheduling with verified user approval. Use when creating, publishing, or reviewing professional LinkedIn content."
version: 2.1.0
domain: linkedin
tools:
  - linkedin_status
  - linkedin_outlier
  - linkedin_get_profile
  - linkedin_my_posts
  - linkedin_create_post
  - linkedin_delete_post
  - linkedin_creator_analytics
inputs:
  topic:
    type: string
    required: true
    description: "Core topic, lesson, or story for the post"
  targetAudience:
    type: string
    required: false
    default: "tech and startup professionals"
    description: "Intended reader profile"
  format:
    type: string
    required: false
    default: "story_lesson"
    description: "Post template format: story_lesson, contrarian_insight, or tactical_list"
  visibility:
    type: string
    required: false
    default: "anyone"
    description: "Post audience: anyone or connections"
  draft:
    type: boolean
    required: false
    default: false
    description: "Save as draft instead of publishing live"
---

Every LinkedIn tool takes an optional `account` (id from `linkedin_accounts`); an unknown account is refused, never swapped. Tool choice, account routing and error meanings: the `linkedin` skill. Get the user's explicit approval for the exact content before any write.

## When to use
- Drafting original thought-leadership posts, technical insights, or milestone updates.
- Researching viral hook structures and post frameworks across recent niche updates.
- Inspecting creator profile details (headline, summary) to maintain consistent voice.
- Publishing live posts, saving drafts, or scheduling future posts via `linkedin_create_post`.
- Reviewing performance and impressions on your past posts or deleting outdated updates.

## When not to use
- Sending private direct messages (use `linkedin_send_message` or `linkedin_send`).
- Browsing feed discussions and commenting on other creators' posts (use `linkedin-engagement`).
- Unattended posting without explicit user approval in chat.

## Tools

### linkedin_status
Verifies active LinkedIn authentication and API connectivity.
- **Parameters**: None `{}`.
- **Success shape**:
  ```json
  { "ok": true, "signedIn": true, "username": "alex-mercer", "headline": "Software Architect" }
  ```
- **Failure shape**: `{ "ok": false, "signedIn": false, "error": "Not signed in to LinkedIn..." }`.

### linkedin_outlier
Analyzes recent updates to identify viral breakout hooks and structural patterns.
- **Parameters**:
  - `minMultiplier`: number (optional, min 1.0, default 3.0).
  - `limit`: integer (optional, 5-100, default 30).
- **Success shape**:
  ```json
  {
    "ok": true,
    "medianLikes": 15,
    "medianComments": 3,
    "outliers": [
      {
        "id": "7496811041339740160",
        "multiplier": 3.8,
        "hook": "Most architecture debt is caused by premature abstraction. Here is how we simplified our stack:",
        "format": "contrarian_take"
      }
    ]
  }
  ```

### linkedin_get_profile
Retrieves authenticated profile attributes (name, headline, summary, location).
- **Parameters**: None `{}`.
- **Success shape**:
  ```json
  {
    "ok": true,
    "firstName": "Alex",
    "lastName": "Mercer",
    "headline": "Systems Architect & Tech Lead",
    "summary": "Designing distributed systems and high-throughput background automation...",
    "location": "Seattle, WA"
  }
  ```

### linkedin_my_posts
Fetches historical posts authored by the signed-in user, including impressions and interaction stats.
- **Parameters**:
  - `limit`: integer (optional, 1-50, default 10).
  - `start`: integer (optional, offset for pagination, default 0).
- **Success shape**:
  ```json
  {
    "ok": true,
    "count": 5,
    "posts": [
      {
        "activityId": "7497263203417169921",
        "text": "Three lessons learned from migrating monoliths to event streaming...",
        "likes": 84,
        "comments": 19,
        "impressions": 3200
      }
    ]
  }
  ```

### linkedin_create_post
Publishes, drafts, or schedules a post on the user's LinkedIn feed.
- **Parameters**:
  - `text`: string (required, 1-3000 characters). Exact text published verbatim.
  - `visibility`: enum `'anyone' | 'connections'` (optional, default `'anyone'`).
  - `draft`: boolean (optional). If true, saves as a draft on LinkedIn.
  - `scheduleAtEpochMs`: number (optional). Epoch ms in the future for scheduled release.
  - `imagePath`: string (optional). Absolute path to local PNG/JPEG (<8 MB).
  - `imageAltText`: string (optional). Accessibility description for image.
- **Success shape**:
  ```json
  { "ok": true, "id": "7497263203417169921", "urn": "urn:li:activity:7497263203417169921" }
  ```

### linkedin_delete_post
Permanently deletes an authored post by its numeric activity ID. Irreversible.
- **Parameters**:
  - `activityId`: string (required). Numeric activity ID from `linkedin_my_posts`.
  - `postText`: string (optional). Snippet of post text for approval verification.
- **Success shape**: `{ "ok": true, "deleted": true }`.

### linkedin_creator_analytics
Reads creator impressions and content engagement figures from LinkedIn.
- **Parameters**: None `{}`.
- **Success shape**: Scraped analytics metrics representing impressions and member engagements.

## Procedure

1. **Verify Session & Voice Alignment**:
   Call `linkedin_status`, then `linkedin_get_profile`. Inspect author headline and background to ensure the post matches professional tone.
2. **Hook and Outline Research**:
   Call `linkedin_outlier` (`minMultiplier: 2.5`). Analyze top outlier formats:
   - Line 1: Clear outcome, paradox, or strong hook.
   - Line 2: Blank line (forces "see more" expansion).
   - Core: Crisp single-idea paragraphs and bullet lists.
   - Call to action: Insightful question prompting replies.
   - Tags: 2-3 topic tags.
3. **Draft the Post**:
   - Ensure post length is under 3,000 characters (`MAX_POST_LENGTH = 3000`).
   - If an image is included, verify file exists and is under 8 MB (`MAX_IMAGE_BYTES = 8 * 1024 * 1024`).
4. **User Review and Explicit Confirmation**:
   Present the finalized post text, image path, visibility (`anyone` vs `connections`), and scheduling time to the user. Do not proceed without explicit confirmation.
5. **Publish, Schedule, or Save Draft**:
   Invoke `linkedin_create_post` with `{ text, visibility, draft, scheduleAtEpochMs, imagePath, imageAltText }`.
6. **Verify Publication**:
   Call `linkedin_my_posts` with `limit: 5` to confirm the new post appears in the user's authored post list.

## Limits and safety
- **Action Policy Gating**: `linkedin_create_post` and `linkedin_delete_post` are real runtime tools exported by `electron/agent/linkedinTools.ts` and forwarded via gateway `tools.call`. While agent tool factories set `alwaysApprove: true` to avoid duplicate in-app modals, `electron/gateway/actionPolicy.ts` intercepts all external `/rpc` requests. Outbound creation and deletion are classified as write actions and appended to `action-log.jsonl`.
- **Character Limit**: Hard ceiling of 3,000 characters enforced in `electron/linkedinPost.ts:35` (`MAX_POST_LENGTH = 3000`).
- **Media Ceiling**: Images must be PNG or JPEG under 8 MB (`MAX_IMAGE_BYTES = 8 * 1024 * 1024`).
- **Cadence Rules**: Cap posting at 1-2 updates per day to prevent algorithmic distribution penalties. Link to `account-safety`.

## Verified facts
- `electron/agent/linkedinTools.ts:335-375, 378-401, 223-233, 423-427`: Declares `linkedin_create_post`, `linkedin_delete_post`, `linkedin_my_posts`, and `linkedin_creator_analytics`.
- `electron/linkedinPost.ts:14-25, 35, 56`: Implements post creation via GraphQL `voyagerContentcreationDashShares`, enforcing `MAX_POST_LENGTH = 3000` and `MAX_IMAGE_BYTES = 8 * 1024 * 1024`.
- `electron/gateway/localGateway.ts:233-260, 646-665`: Bridges agent tools to external callers via RPC `tools.list` and `tools.call`.
- `bin/flowdesk-mcp.mjs:718-723`: Registers `linkedin_get_profile` which reads headline, summary, and experience.

## Not verified
- Video uploads and multi-image carousel/PDF presentations are not currently supported by `liCreatePost`.
