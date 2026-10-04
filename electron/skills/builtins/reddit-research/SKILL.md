---
name: reddit-research
title: "Reddit Research"
description: "Discovers trending discussions, analyzes comment threads, and extracts viral hooks and pain points across subreddits. Use when conducting community intelligence and content research."
version: 2.0.0
domain: reddit
tools:
  - reddit_status
  - reddit_api_feed
  - reddit_api_search
  - reddit_api_comments
  - reddit_outlier
inputs:
  subreddit:
    type: string
    required: false
    description: "Subreddit name to analyze without r/ prefix (e.g. technology, SaaS)"
  query:
    type: string
    required: false
    description: "Keyword search query"
  mode:
    type: string
    required: false
    default: outlier
    description: "Research mode: outlier, feed, search, or comments"
---

## When to use
- Identifying viral outlier posts and breakout discussion topics within target subreddits.
- Uncovering customer pain points, complaints, and high-debate topics (debate ratio >= 1.2 or frustration keywords).
- Extracting proven title hooks and formatting templates from top-performing Reddit submissions.
- Reading deeply into comment trees to understand community sentiment, counter-arguments, and real experiences.

## When not to use
- Upvoting, downvoting, or submitting comments/posts (use `reddit-engagement`).
- Subscribing or marking inbox notifications read (use `reddit-engagement`).
- Scraping millions of posts for bulk data dumps (use focused sampling instead).

## Tools

### reddit_status
- **Purpose**: Checks whether Reddit is authenticated and active, returning username, karma totals, and inbox unread count.
- **Parameters**: None `{}`.
- **Success shape**:
  ```json
  {
    "ok": true,
    "signedIn": true,
    "username": "FastAbbreviations506",
    "totalKarma": 1420,
    "linkKarma": 890,
    "commentKarma": 530,
    "inboxCount": 3,
    "hasMail": true
  }
  ```
- **Failure shape**: `{ "ok": false, "signedIn": false, "error": "Not authenticated to Reddit" }`.

### reddit_api_feed
- **Purpose**: Fast in-session Reddit feed JSON API (<300ms, zero DOM overhead).
- **Parameters**:
  - `subreddit` (string, optional): Subreddit name without prefix (e.g. "technology" or "reactjs"). Omit for home feed.
  - `sort` (string, optional): Sort algorithm: "hot", "new", "top", "rising". Defaults to "hot".
  - `limit` (number, optional, 1-100, default 25): Max posts to fetch.
- **Success shape**:
  ```json
  {
    "ok": true,
    "count": 25,
    "items": [
      {
        "id": "t3_1wkg3bi",
        "title": "Why did your team switch away from React?",
        "author": "dev_guru",
        "subreddit": "r/reactjs",
        "score": 384,
        "numComments": 142,
        "url": "https://www.reddit.com/r/reactjs/comments/1wkg3bi/...",
        "permalink": "/r/reactjs/comments/1wkg3bi/...",
        "createdUtc": 1727400000,
        "selftext": "We recently evaluated Vue and Svelte...",
        "isVideo": false
      }
    ]
  }
  ```

### reddit_api_search
- **Purpose**: Fast in-session Reddit keyword search across Reddit globally or restricted to a specific subreddit.
- **Parameters**:
  - `query` (string, required): Search query keyword or phrase.
  - `subreddit` (string, optional): Subreddit name to restrict search to.
  - `limit` (number, optional, 1-100, default 25): Max results to return.
  - `sort` (enum, optional): "relevance" | "hot" | "top" | "new" | "comments".
  - `t` (enum, optional): Time filter: "hour" | "day" | "week" | "month" | "year" | "all".
- **Success shape**: `{ "ok": true, "count": 25, "items": [...] }`.

### reddit_api_comments
- **Purpose**: Fast in-session comments flattener returning top comments sorted by score.
- **Parameters**:
  - `postId` (string, required): Reddit post ID (e.g. "1wkg3bi" or "t3_1wkg3bi").
  - `limit` (number, optional, 1-200, default 50): Max top comments to return.
- **Success shape**:
  ```json
  {
    "ok": true,
    "postId": "1wkg3bi",
    "post": { "id": "t3_1wkg3bi", "title": "...", "score": 384, "numComments": 142 },
    "count": 50,
    "comments": [
      {
        "id": "t1_pa13h2m",
        "author": "code_whisperer",
        "body": "The build tooling complexity was the main blocker for us...",
        "score": 89,
        "createdUtc": 1727401200,
        "parentId": "t3_1wkg3bi"
      }
    ]
  }
  ```

### reddit_outlier
- **Purpose**: Calculates median scores across 50 posts, flags viral breakouts (score >= multiplier * median), isolates high-debate pain points, and classifies title hook patterns.
- **Parameters**:
  - `subreddit` (string, required): Subreddit name (e.g. "technology", "SaaS").
  - `minMultiplier` (number, optional, default 3.0): Minimum multiplier above median.
  - `sort` (enum, optional, default "hot"): "hot" | "top" | "rising".
  - `t` (enum, optional): Time filter: "hour" | "day" | "week" | "month" | "year" | "all".
- **Success shape**:
  ```json
  {
    "ok": true,
    "subreddit": "SaaS",
    "sampleSize": 50,
    "medianScore": 12,
    "medianComments": 6,
    "minMultiplier": 3.0,
    "outlierCount": 4,
    "outliers": [
      { "id": "t3_1w...", "title": "...", "score": 98, "outlierMultiplier": 8.2, "scorePerHour": 14.5 }
    ],
    "highDebatePainPoints": [
      { "id": "t3_1w...", "title": "Why does Stripe hold funds for 90 days?", "debateRatio": 2.1, "hasFrustrationKeywords": true }
    ],
    "topHooks": [
      {
        "postId": "t3_1w...",
        "title": "I spent 6 months building an AI tool nobody bought. Here is what happened:",
        "pattern": "First-Person Case Study",
        "hookTemplate": "I spent [X] building an [Subreddit] nobody bought. Here is what happened:"
      }
    ]
  }
  ```

## Procedure

1. **Verify Reddit Connection**:
   Call `reddit_status` to ensure active authentication and retrieve your account username and karma.
2. **Scan for Viral Outliers & Pain Points**:
   Call `reddit_outlier` on the target subreddit (e.g. `subreddit: "SaaS"`, `minMultiplier: 3.0`).
   - Examine `outliers`: identify what topics and angles exceed the median upvotes by 3x-10x.
   - Examine `highDebatePainPoints`: find discussions where `numComments / score >= 1.2` or titles contain frustration keywords ("why does", "problem", "hate", "worst"). These represent unaddressed market gaps.
   - Examine `topHooks`: note the recurring grammatical patterns (e.g. "First-Person Case Study", "Curiosity Question", "Contrarian Warning").
3. **Keyword Discovery Across Communities**:
   When researching a specific topic rather than a single subreddit, call `reddit_api_search` with `query: "<topic>"`, `sort: "top"`, and `t: "month"`.
4. **Deep-Dive Comment Intelligence**:
   Identify the top 2-3 most relevant posts from steps 2 and 3. Call `reddit_api_comments` with each post's ID to review top community opinions, real user grievances, alternative tools cited, and nuanced objections.
5. **Synthesize Findings**:
   Compile insights into clear market patterns: core frustrations, viral themes, and proven communication frameworks.

## Limits and safety
- **Read-Only Operation**: All tools in this skill are safe, read-only API calls that consume no platform credits and pose zero write-ban risk.
- **Pacing**: Space repeated calls by at least 1-2 seconds to respect Reddit's client rate limits (60-100 requests per minute).
- **In-Session Token Security**: Uses the existing authenticated Reddit session partition; never handles or logs raw session cookies or passwords.

## Verified facts
- `reddit_api_feed` queries `/r/{subreddit}/{sort}.json?limit={limit}` inside the logged-in session, returning structured posts (<300ms) with scores and permalinks (`electron/redditBridge.ts:477-518`).
- `reddit_api_search` queries `/r/{subreddit}/search.json?q={query}&restrict_sr=1` or `/search.json?q={query}` (`electron/redditBridge.ts:520-564`).
- `reddit_api_comments` queries `/comments/{postId}.json?limit={limit}&depth=4`, parses post details, and flattens nested comment trees sorted by score (`electron/redditBridge.ts:565-624`).
- `reddit_outlier` samples 50 posts, computes median score and comments, calculates velocity (`scorePerHour`), flags posts with `score >= minMultiplier * median`, finds debate posts with `numComments / score >= 1.2` or frustration keywords, and categorizes title hooks (`electron/redditBridge.ts:626-760`).
- Registered MCP tools in `bin/flowdesk-mcp.mjs`: `reddit_status` (line 398), `reddit_api_feed` (line 515), `reddit_api_search` (line 526), `reddit_api_comments` (line 539), `reddit_outlier` (line 549).

## Not verified
- None. All 5 tools are fully implemented, tested, and actively registered in MCP.
