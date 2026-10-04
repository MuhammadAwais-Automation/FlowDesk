---
name: reddit-engagement
title: "Reddit Engagement"
description: "Executes approved votes, comments, posts, and community subscriptions across subreddits. Use when interacting with Reddit threads and managing community participation under user approval."
version: 2.0.0
domain: reddit
tools:
  - reddit_status
  - reddit_vote_post
  - reddit_vote_comment
  - reddit_create_comment
  - reddit_create_post
  - reddit_subscribe
  - reddit_mark_read
inputs:
  action:
    type: string
    required: true
    description: "Action type: vote_post, vote_comment, comment, post, subscribe, or mark_read"
  targetId:
    type: string
    required: false
    description: "Post ID (t3_...) or comment ID (t1_...) for voting or commenting"
  text:
    type: string
    required: false
    description: "Comment text or post body"
  subreddit:
    type: string
    required: false
    description: "Subreddit name for posting or subscribing"
  title:
    type: string
    required: false
    description: "Title for a new post submission"
---

## When to use
- Submitting an approved comment or discussion reply to a specific Reddit thread.
- Upvoting or downvoting valuable community posts or comments.
- Publishing a new text submission in a relevant subreddit after thorough user review.
- Subscribing or unsubscribing from subreddits to maintain your feed topics.
- Clearing notification backlogs by marking inbox messages read.

## When not to use
- Automated bulk commenting or mass upvoting campaigns (guaranteed shadowban).
- Self-promotional link dropping or spamming commercial offers without prior subreddit participation.
- Posting without verifying community-specific rules, flair mandates, and minimum karma gates.
- Unapproved write actions (every comment and post requires human confirmation).

## Tools

### reddit_status
- **Purpose**: Checks active authentication, username, total karma (link + comment), and inbox notifications count.
- **Parameters**: None `{}`.
- **Success shape**:
  ```json
  {
    "ok": true,
    "signedIn": true,
    "username": "FastAbbreviations506",
    "totalKarma": 1420,
    "inboxCount": 0
  }
  ```

### reddit_vote_post
- **Purpose**: Casts an upvote, downvote, or clears vote on a Reddit post.
- **Parameters**:
  - `postId` (string, required): Full post ID (e.g. "t3_1wkg3bi" or "1wkg3bi").
  - `voteState` (enum, required): `"UP"` | `"DOWN"` | `"NONE"`.
- **Success shape**: `{ "ok": true, "status": 200, "data": { ... } }`.
- **Failure shape**: `{ "ok": false, "error": "GraphQL errors: ..." }`.

### reddit_vote_comment
- **Purpose**: Casts an upvote, downvote, or clears vote on a comment.
- **Parameters**:
  - `commentId` (string, required): Full comment ID (e.g. "t1_pa13h2m" or "pa13h2m").
  - `voteState` (enum, required): `"UP"` | `"DOWN"` | `"NONE"`.
- **Success shape**: `{ "ok": true, "status": 200, "data": { ... } }`.

### reddit_create_comment
- **Purpose**: Posts a public comment or nested reply using Shreddit richText AST.
- **Parameters**:
  - `postId` (string, required): Post ID where comment belongs (e.g. "t3_1wkg3bi").
  - `parentId` (string, required): Parent post (`t3_...`) for top-level comments, or parent comment (`t1_...`) for nested replies.
  - `text` (string, required): Comment text content.
- **Success shape**:
  ```json
  {
    "ok": true,
    "status": 200,
    "created": true,
    "commentId": "t1_paq85tr"
  }
  ```
- **Failure shape**: `{ "ok": false, "created": false, "error": "Reddit rejected comment" }`.

### reddit_create_post
- **Purpose**: Publishes a new text post in a subreddit via Shreddit GraphQL `CreatePost`.
- **Parameters**:
  - `subreddit` (string, required): Target subreddit name (e.g. "r/AI_Coders" or "AI_Coders").
  - `title` (string, required): Post title.
  - `body` (string, optional): Text body in rich text format.
- **Success shape**:
  ```json
  {
    "ok": true,
    "status": 200,
    "data": {
      "createSubredditPost": {
        "ok": true,
        "post": {
          "id": "t3_1wkg3bi",
          "permalink": "/r/AI_Coders/comments/1wkg3bi/..."
        }
      }
    }
  }
  ```

### reddit_subscribe
- **Purpose**: Joins or leaves a subreddit community via GraphQL `UpdateSubredditSubscriptions`.
- **Parameters**:
  - `subredditId` (string, required): Full subreddit ID (e.g. "t5_2sama").
  - `subscribeState` (enum, required): `"SUBSCRIBED"` | `"UNSUBSCRIBED"`.
- **Success shape**: `{ "ok": true, "status": 200, "data": { ... } }`.

### reddit_mark_read
- **Purpose**: Clears all unread notifications in your inbox via GraphQL `MarkInboxAsRead`.
- **Parameters**: None `{}`.
- **Success shape**: `{ "ok": true, "status": 200, "data": { ... } }`.

## Procedure

1. **Verify Session & Karma Standing**:
   Call `reddit_status`. Note the user's `totalKarma`, `linkKarma`, and `commentKarma`.
2. **Subreddit Rules Caution & Pre-Flight Checks**:
   - **Karma & Age Gates**: Subreddits frequently run AutoModerator rules that instantly delete submissions from accounts with low comment karma or new account ages.
   - **Self-Promotion Guidelines**: Adhere to Reddit's 9:1 guideline: at least 9 community-contributing comments or posts for every 1 self-referential mention.
   - **Flair & Formatting**: Check if the community requires post flair or specific title tags (e.g. `[Discussion]`, `[Question]`).
3. **Drafting Value-First Content**:
   - Comments must speak Reddit's native tone: authentic, self-deprecating, technically grounded, and devoid of corporate marketing jargon.
   - For post submissions, craft titles that provoke genuine discussion or share transparent, quantifiable case studies.
4. **Mandatory User Approval Gate**:
   - Display the exact text, target subreddit, and post/comment ID to the user.
   - Wait for explicit user confirmation before executing `reddit_create_comment` or `reddit_create_post`.
5. **Execution & Server Verification**:
   - **Comment Submission**: Execute `reddit_create_comment`. Inspect the return payload: verify `ok: true`, `created: true`, and that a valid `commentId` (format `t1_...`) was assigned by Reddit.
   - **Post Submission**: Execute `reddit_create_post`. Inspect `data.createSubredditPost`: verify `ok: true` and capture the permalink and post ID (`t3_...`).
   - If GraphQL reports field errors or rate limits, surface the exact error to the user without blind retries.

## Limits and safety
- **Strict Approval Requirement**: Writing comments or publishing posts executes live public updates under the user's account. Never post without explicit user approval.
- **Rate Limits & Anti-Spam (Shadowban Risk)**:
  - Do not post more than 1 submission per 24 hours in the same subreddit.
  - Space comments by at least 2-5 minutes. Reddit aggressively shadowbans accounts that exhibit robotic posting frequencies or duplicate texts.
- **ID Prefixes**: Reddit expects standard Type 3 prefixes for posts (`t3_...`), Type 1 for comments (`t1_...`), and Type 5 for subreddits (`t5_...`). The tools auto-normalize missing prefixes.

## Verified facts
- Comment creation uses `POST /svc/shreddit/{postId}/create-comment` with form-encoded `parentId`, `commentDepth`, `mode: "richText"`, and JSON AST content `{"document":[{"e":"par","c":[{"e":"text","t":text}]}]}` (`electron/redditBridge.ts:248-310`, `probes/FINDINGS-reddit.md:105-117`).
- Comment creation success is verified by extracting the newly created `t1_...` ID from the response body; HTTP 200 alone is not considered proof as Reddit returns 200 on error partials (`electron/redditBridge.ts:285-309`).
- Post creation runs via GraphQL `CreatePost` operation over `POST /svc/shreddit/graphql` requiring `csrf_token` in JSON body (`electron/redditBridge.ts:312-340`, `probes/FINDINGS-reddit.md:29-71`).
- Post and comment voting use GraphQL operations `UpdatePostVoteState` and `UpdateCommentVoteState` with vote states `"UP"`, `"DOWN"`, `"NONE"` (`electron/redditBridge.ts:228-246`, `probes/FINDINGS-reddit.md:72-104`).
- Subreddit subscriptions use GraphQL `UpdateSubredditSubscriptions` with states `"SUBSCRIBED"` / `"UNSUBSCRIBED"` (`electron/redditBridge.ts:342-357`, `probes/FINDINGS-reddit.md:118-135`).
- Registered MCP tools in `bin/flowdesk-mcp.mjs`: `reddit_status` (line 398), `reddit_vote_post` (line 456), `reddit_vote_comment` (line 466), `reddit_create_comment` (line 476), `reddit_create_post` (line 487), `reddit_subscribe` (line 498), `reddit_mark_read` (line 508).

## Not verified
- None. All 7 tools are fully implemented, tested in `electron/redditBridge.test.ts`, and actively registered in `bin/flowdesk-mcp.mjs`.
