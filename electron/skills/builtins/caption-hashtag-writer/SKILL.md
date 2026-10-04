---
name: caption-hashtag-writer
title: "Caption & Hashtag Writer"
description: "Composes high-converting TikTok captions and targeted hashtag sets derived from trend research and competitor outlier analysis. Use when preparing text copy and SEO metadata for a TikTok video post."
version: 2.0.0
domain: tiktok
tools:
  - tiktok_suggest
  - tiktok_api_search
  - tiktok_api_video_detail
  - tiktok_edit_video_caption
inputs:
  topic:
    type: string
    required: true
    description: "Video topic, core value proposition, or seed keywords"
  hook:
    type: string
    required: false
    description: "Visual or spoken opening hook from video script or trend research"
  competitorVideos:
    type: string
    required: false
    description: "Comma-separated TikTok video URLs or video IDs of viral outliers to benchmark"
  style:
    type: string
    required: false
    default: viral
    description: "Tone style: viral, educational, curiosity, or promotional"
  targetAccountId:
    type: string
    required: false
    description: "Target account ID: 1, 2, or 3. Defaults to active account"
---

## When to use
- Drafting the written caption and hashtag metadata for a new video before uploading.
- Deriving high-intent search keywords and hashtag clusters from real viewer autocomplete behavior.
- Extracting proven caption copy frameworks from high-performing competitor outlier videos.
- Updating or A/B testing the caption of an already-published video on an account.
- Ensuring captions are optimized for TikTok's native search index and recommendation algorithm.

## When not to use
- Uploading or publishing video files to TikTok (use `tiktok-publisher`).
- Running initial discovery of creator accounts and outlier multipliers (use `tiktok-trend-research`).
- Modifying account bio or profile details (use `tiktok-profile-manager`).
- Writing video scripts or visual generation prompts (use `video-prompt-writer`).

## Tools

### tiktok_suggest
Harvests high-intent autocomplete search keywords, sub-topics, and ranked hashtag clusters for a seed keyword.
- **Parameters**:
  - `seed` (string, required): Seed keyword or niche phrase (e.g. `'gym cat'`, `'ai marketing'`).
  - `account` (string, optional): Target account ID. Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast",
    "seed": "gym cat",
    "topHashtags": [
      { "tag": "#gymcat", "occurrences": 10 },
      { "tag": "#gymcats", "occurrences": 9 },
      { "tag": "#gymmotivation", "occurrences": 8 }
    ],
    "recommendedKeywords": ["gym cat workout", "gym cat meme", "gym cat animation"],
    "sampleCaptions": ["gym cat workout #viral #trend"]
  }
  ```

### tiktok_api_search
Fast background JSON search (`/api/search/general/full/`) returning top ranking video descriptions and metrics in ~250ms with zero UI navigation.
- **Parameters**:
  - `query` (string, required): Search keyword or topic phrase.
  - `limit` (number, optional): Max videos to inspect (1-50, default 20).
  - `account` (string, optional): Target account ID.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast",
    "query": "gym cat workout",
    "count": 20,
    "videos": [
      {
        "id": "7481234567890123456",
        "url": "https://www.tiktok.com/@creator/video/7481234567890123456",
        "author": "creator",
        "desc": "Nobody talks about day 1 vs day 100... wait for the end 😂 #gymcat #fitnessjourney #catsoftiktok",
        "views": 1250000,
        "likes": 180000
      }
    ]
  }
  ```

### tiktok_api_video_detail
Inspects a single TikTok video's exact description, hashtags, and sound title in ~300ms without loading the web UI.
- **Parameters**:
  - `url` (string, required): TikTok video URL or numeric ID.
  - `account` (string, optional): Target account ID.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mode": "api_fast",
    "id": "7481234567890123456",
    "author": "creator",
    "desc": "Full caption text with exact hashtags #alphapaws #gymmotivation",
    "views": 950000,
    "likes": 110000,
    "comments": 2300,
    "music": "Original Sound - Creator"
  }
  ```

### tiktok_edit_video_caption
Applies a revised caption to an already-published video on the account via Studio's edit API.
- **Parameters**:
  - `videoId` (string, required): Numeric TikTok item ID.
  - `caption` (string, required): New caption text.
  - `account` (string, optional): Target account ID. Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "edited": true,
    "via": "api",
    "videoId": "7481234567890123456",
    "account": "social-tiktok"
  }
  ```

### Preferred API Tools Note
Always prefer `tiktok_api_*` tools (`tiktok_api_search`, `tiktok_api_video_detail`) over DOM-based scrapers (`tiktok_search`, `tiktok_video_detail`). The API tools query JSON endpoints directly within the session context in ~250ms, avoid slow browser page renders, and deliver exact un-truncated description strings.

## Procedure

1. **Harvest search intent & autocomplete terms**:
   - Call `tiktok_suggest({ seed: topic })`.
   - Collect high-frequency hashtags (`topHashtags`) and search keywords (`recommendedKeywords`).
2. **Benchmark top-ranking competitor copy**:
   - Call `tiktok_api_search({ query: topic, limit: 10 })`.
   - Inspect the descriptions (`desc`) of videos with >100k views to identify high-performing hook patterns, emotional triggers, and tag structures.
   - If specific competitor URLs were supplied in `competitorVideos`, call `tiktok_api_video_detail({ url })` to inspect their exact caption copy.
3. **Draft the caption using the 3-Layer Formula**:
   - **Layer 1: The Visual Hook Line (First 60-80 chars)**:
     - Written copy that appears before the "...more" fold in the mobile video player.
     - Must arouse curiosity, state a contrarian premise, or create an open loop (e.g. "Nobody expected this to happen on day 30...", "The real reason your workout isn't working:").
   - **Layer 2: The Context & Engagement Bridge (1-2 sentences)**:
     - Brief context elaborating on the hook, followed by a direct call for comments (e.g. "Which exercise would you try first? Drop a comment below 👇").
   - **Layer 3: The Strategic Hashtag Stack (3 to 5 tags)**:
     - 1-2 broad category tags (`#fitness`, `#cats`).
     - 2-3 specific niche tags identified in Step 1 (`#gymcat`, `#petworkout`, `#alphapaws`).
     - Avoid generic tag spam (`#fyp`, `#foryou`, `#viral`) as they provide zero semantic indexing value.
4. **Final output verification**:
   - Assemble the complete caption string.
   - If updating an existing video, confirm with the user and call `tiktok_edit_video_caption({ videoId, caption })`.
   - If preparing for upload, pass the string directly into `tiktok_api_upload_video`.

## Limits and safety
- **No client-side caption length limit in FlowDesk**: Unlike profile bios which have a strict 80-character ceiling enforced in code (`TIKTOK_BIO_LIMIT = 80`), the FlowDesk codebase does not validate caption character length before sending in `tkApiUploadVideo` or `tkEditVideoCaption`.
- **Hashtag discipline**: Keep total hashtags between 3 and 5. Exceeding 8 hashtags triggers TikTok algorithmic spam filters and obscures the video display.
- **Caption editing safety**: `tiktok_edit_video_caption` alters live content on the account. Always verify the `videoId` is numeric and obtain user confirmation before executing.

## Verified facts
- `publishBody` in `electron/tiktokUpload.ts:123-128` packages caption text directly into `single_post_feature_info.text` and `markup_text` without enforcing a character count or hashtag limit.
- `tkEditVideoCaption` in `electron/tiktok.ts:770-800` executes POST `/tiktok/post/edit/v1/` with `is_text_changed: true` and `tz_name` inside the Studio session.
- `tkSuggest` in `electron/tiktok.ts:172-192` queries `suggestqueries.google.com/complete/search?client=chrome&q=<seed>+tiktok` to extract clean keywords and ranked hashtags.
- `tiktokVideoDetailScript` in `electron/tiktokBridge.ts:151-153` extracts hashtags using `/#[^\s#]+/g`.
- `buildMcpApiSearchScript` in `bin/flowdesk-mcp.mjs:966` extracts captions from `item.desc`.

## Not verified
- Official TikTok backend character limit on video post captions (platform documentation varies from 2,200 characters on mobile up to 4,000 characters on TikTok Studio Web). Keeping captions concise (under 500 characters) is recommended for retention.
- Secret algorithmic weight of specific viral hashtags vs natural language semantic parsing in the FYP ranking model.
