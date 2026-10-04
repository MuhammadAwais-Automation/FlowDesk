---
name: tiktok-trend-research
title: "TikTok Trend Research"
description: "Discovers viral TikTok trends, searches topics, scans creator outlier videos, and extracts hook, audio, and format insights. Use when researching viral patterns, analyzing competitors, or developing video concepts."
version: 2.0.0
domain: tiktok
tools:
  - tiktok_api_search
  - tiktok_api_outlier
  - tiktok_api_batch_outliers
  - tiktok_api_creator_feed
  - tiktok_api_video_detail
  - tiktok_suggest
inputs:
  topic:
    type: string
    required: true
    description: "Search keyword, niche topic, or creator handle to research"
  minMultiplier:
    type: number
    required: false
    default: 3.0
    description: "Minimum viral view ratio threshold above creator median baseline (default 3.0x)"
  limit:
    type: number
    required: false
    default: 20
    description: "Maximum number of videos or search results to inspect"
  account:
    type: string
    required: false
    description: "Target account ID: 1, 2, or 3. Defaults to active account"
---

## When to use
- Identifying high-demand search topics, trending queries, and viral hooks before producing video content.
- Scanning competitor creators to identify mathematically proven viral outliers (3x to 10x+ above median views).
- Performing fast bulk scans across multiple creator channels in parallel.
- Extracting exact engagement metrics (plays, likes, shares, comments), background audio titles, and captions for top-performing videos.
- Reverse-engineering winning video formats and narrative structures for AI video prompt generation.

## When not to use
- Uploading or publishing video files (use `tiktok-publisher`).
- Modifying account bio or managing account sessions (use `tiktok-profile-manager`).
- Polishing captions and hashtag clusters for an existing video (use `caption-hashtag-writer`).
- Relying on slow DOM search tools when fast in-session API tools are available.

## Tools

### tiktok_api_search
Fast background JSON search (`/api/search/general/full/`) returning video metadata, view counts, and creator handles in ~250ms with zero UI page loads.
- **Parameters**:
  - `query` (string, required): Search keyword or topic (e.g. `'AI animation'`, `'fitness tips'`).
  - `limit` (number, optional): Max videos to return (1-50, default 20).
  - `offset` (number, optional): Pagination offset (default 0).
  - `account` (string, optional): Target account ID (`'1'`, `'2'`). Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast",
    "query": "AI animation",
    "count": 20,
    "hasMore": true,
    "cursor": 20,
    "videos": [
      {
        "id": "7481234567890123456",
        "url": "https://www.tiktok.com/@creator/video/7481234567890123456",
        "author": "creator",
        "authorNickname": "Creator Studio",
        "desc": "How AI created this viral world #ai #animation",
        "views": 845000,
        "likes": 92000,
        "comments": 1420,
        "shares": 5600,
        "duration": 18,
        "coverUrl": "https://p16-sign-va.tiktokcdn.com/...",
        "uploadTimestamp": 1759000000,
        "uploadedAt": "2026-09-25T12:00:00.000Z",
        "timeAgo": "3d ago"
      }
    ],
    "creators": []
  }
  ```

### tiktok_api_outlier
Ultra-fast mathematical outlier scanner for a creator. Calculates creator baseline median views, outlier multiplier, and flags fresh viral videos.
- **Parameters**:
  - `creator` (string, required): Creator username handle (e.g. `'nexivo92'`).
  - `minMultiplier` (number, optional): Multiplier threshold (default 3.0x).
  - `account` (string, optional): Target account ID. Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast",
    "creator": "nexivo92",
    "profile": {
      "uniqueId": "nexivo92",
      "nickname": "Nexivo",
      "followerCount": 14200,
      "heartCount": 210000,
      "videoCount": 48
    },
    "totalVideosScanned": 35,
    "baselineMedianViews": 4200,
    "outlierCount": 2,
    "outliers": [
      {
        "id": "7489876543210987654",
        "url": "https://www.tiktok.com/@nexivo92/video/7489876543210987654",
        "views": 184000,
        "baselineMedian": 4200,
        "outlierMultiplier": 43.8,
        "isFreshViral": true,
        "viralityBadge": "🔥 SUPER_VIRAL (43.8x)",
        "timeAgo": "2d ago"
      }
    ]
  }
  ```
  Virality badges: `>= 10x` produces `🔥 SUPER_VIRAL`, `>= 3x` produces `⭐ OUTLIER`, otherwise `NORMAL`.

### tiktok_api_batch_outliers
Parallel bulk outlier scanning across multiple creator handles in a single call.
- **Parameters**:
  - `creators` (string array, required): List of creator handles to scan.
  - `minMultiplier` (number, optional): Minimum outlier threshold (default 2.5x).
  - `account` (string, optional): Target account ID.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast_batch",
    "creatorsRequested": 3,
    "creatorsSuccessful": 3,
    "totalOutliersFound": 5,
    "allOutliers": [ ... ],
    "byCreator": [ ... ]
  }
  ```

### tiktok_api_creator_feed
Fetches creator profile metadata and full video catalog in ~300ms without opening their page.
- **Parameters**:
  - `creator` (string, required): Creator username handle.
  - `limit` (number, optional): Max videos to return (1-50, default 30).
  - `account` (string, optional): Target account ID.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast",
    "creator": "camelaiuniverse",
    "profile": { "uniqueId": "camelaiuniverse", "followerCount": 54000, "videoCount": 28 },
    "count": 28,
    "videos": [ ... ]
  }
  ```

### tiktok_api_video_detail
Deep forensic inspection of a single video in ~300ms without UI navigation.
- **Parameters**:
  - `url` (string, required): TikTok video URL or numeric video ID.
  - `account` (string, optional): Target account ID.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast",
    "id": "7481234567890123456",
    "url": "https://www.tiktok.com/@creator/video/7481234567890123456",
    "author": "creator",
    "authorNickname": "Creator Studio",
    "desc": "Full caption text #fyp #viral",
    "views": 950000,
    "likes": 110000,
    "comments": 2300,
    "shares": 8500,
    "collects": 4200,
    "music": "Original Sound - Creator",
    "musicAuthor": "Creator",
    "duration": 22,
    "coverUrl": "https://p16-sign.tiktokcdn.com/...",
    "uploadedAt": "2026-09-24T15:30:00.000Z",
    "timeAgo": "4d ago"
  }
  ```

### tiktok_suggest
Harvests high-intent autocomplete search keywords, sub-topics, and hashtag clusters for a seed keyword from search suggestion engines.
- **Parameters**:
  - `seed` (string, required): Seed keyword or niche (e.g. `'ai animation'`).
  - `account` (string, optional): Target account ID.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast",
    "seed": "ai animation",
    "topHashtags": [{ "tag": "#aianimation", "occurrences": 10 }, { "tag": "#aianimations", "occurrences": 9 }],
    "recommendedKeywords": ["ai animation tutorial", "ai animation generator", "ai animation video"],
    "sampleCaptions": ["ai animation tutorial #viral #trend"]
  }
  ```

### Preferred API Tools Note
Always prefer `tiktok_api_*` tools over DOM-based counterparts (`tiktok_search`, `tiktok_outlier`, `tiktok_feed`). The API tools make direct in-session JSON requests (~250-300ms) with zero DOM rendering overhead, avoid fragile CSS selectors, and return exact numeric metrics rather than formatted strings (e.g. `845000` vs `"845K"`).

## Procedure

1. **Map search intent**:
   - Call `tiktok_suggest` with the target niche keyword to discover active search queries and related hashtag clusters.
2. **Scan the topic landscape**:
   - Call `tiktok_api_search` using the most promising queries from Step 1 (`limit: 20` or `30`).
   - Identify recurring visual motifs, high-view videos (>100k views), and leading creator handles.
3. **Isolate statistical outliers**:
   - Collect creator handles discovered in search.
   - Call `tiktok_api_batch_outliers` (or `tiktok_api_outlier` per creator) with `minMultiplier: 3.0`.
   - Filter for videos tagged with `"viralityBadge"` containing `SUPER_VIRAL` or `OUTLIER`, or marked `isFreshViral: true`.
4. **Deconstruct winner anatomy**:
   - Call `tiktok_api_video_detail` on the top 2-3 outlier video URLs.
   - Note the exact duration, opening caption words (the written hook), audio sound title, and engagement ratios (likes-to-views, shares-to-views).
5. **Synthesize creative brief**:
   - Compile a brief specifying:
     - **Hook**: First 2-second visual action and text overlay.
     - **Format**: Video duration, pacing, and visual style.
     - **Audio**: Sound title or acoustic tone (upbeat, suspenseful, ambient).
     - **Hashtag bank**: Exact tags observed on the winning outliers.
     - **Viral angle**: The psychological trigger (curiosity, shock, transformation, educational value).

## Limits and safety
- **Read-only execution**: All tools in this skill are completely read-only. They spend zero credits and make no outbound posts, comments, or likes.
- **Signing context**: In-session API searches require TikTok's signing SDK (`X-Bogus`, `X-Gnarly`). FlowDesk automatically parks the view on `tiktok.com/search` to provide valid signatures.
- **Request cadence**: While fast and lightweight, do not execute tight unbounded loops of search requests to avoid temporary IP/session rate limits from ByteDance edge servers.

## Verified facts
- `tiktok_api_search` queries `/api/search/general/full/?keyword=...` using in-page fetch headers with automatic pagination offsets (`bin/flowdesk-mcp.mjs:930-989`).
- `ensureSigningContext` loads `https://www.tiktok.com/search?q=trending` when necessary because TikTok's patched fetch attaches signing tokens only from search routes (`electron/tiktok.ts:104-115`, probes `tkr-01`/`tkr-02`).
- Outlier algorithm determines baseline median from non-zero playCount values, sets `outlierMultiplier = views / median`, and flags `isFreshViral` if uploaded within 4 days (86400 * 4 seconds) with multiplier >= 2.0x (`bin/flowdesk-mcp.mjs:1182-1204`).
- Video timestamps are parsed from `item.createTime` or bit-shifted from the 64-bit numeric video ID (`Number(BigInt(vid) >> 32n)`) when `createTime` is missing (`bin/flowdesk-mcp.mjs:919-928`).
- `tiktok_suggest` fetches Google autocomplete queries for `<seed> tiktok` via `suggestqueries.google.com` before falling back to in-page search DOM (`electron/tiktok.ts:172-194`).
- `tiktok_api_video_detail` extracts the structured video object from the page script tag `__UNIVERSAL_DATA_FOR_REHYDRATION__` -> `itemStruct` (`bin/flowdesk-mcp.mjs:1083-1093`).

## Not verified
- Minimum audience retention completion rates required to trigger second-wave FYP distribution.
- Exact algorithmic penalty weights applied to duplicate background audio tracks or re-uploaded clips.
