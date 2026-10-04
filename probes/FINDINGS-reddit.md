# Reddit — API Map & Reverse Engineering Findings

Evidence: CDP capture (`probes/out/_network-reddit-com.json`, 1,042 calls, 3.86 MB) of a live authenticated Reddit session inside FlowDesk, recording feed browsing, post/comment reading, post & comment voting, search history, comment submission, subreddit joining, and post creation.

Redacted identifiers:
- User: `<SELF>` (observed: `FastAbbreviations506`)
- CSRF Token: `<CSRF>` (observed: `5b3e8dd9e91e6a4616775c67647436cf`)

---

## 1. Authentication & Security Primitives

Reddit uses its modern **"Shreddit"** frontend architecture backed by GraphQL (`/svc/shreddit/graphql`) and REST partials (`/svc/shreddit/*`).

1. **CSRF Protection:**
   - Every GraphQL POST mutation requires `"csrf_token": "<token>"` in the JSON body.
   - Form-encoded POST requests (`create-comment`) require `csrf_token=<token>` in the body.
   - The token matches the `csrf_token` cookie or the `<shreddit-async-loader>` / document meta attribute.
2. **Session Cookies:**
   - Auth is carried via HttpOnly session cookies (`reddit_session`, `token_v2`, etc.) bound to the Electron session partition.
   - Scripts executing inside the page via `webContents.executeJavaScript` automatically inherit the authenticated session and cookies.
3. **Client Version:**
   - Header `x-reddit-client-version` (e.g. `2026-09-18T21:22Z~b181a839`) is sent with calls.

---

## 2. Mutations (Replayable Writes)

### A. Post Creation (`CreatePost`)
- **Transport:** `POST https://www.reddit.com/svc/shreddit/graphql`
- **Headers:** `content-type: application/json`
- **Request Body:**
  ```json
  {
    "operation": "CreatePost",
    "variables": {
      "input": {
        "title": "ai writes the code in 2 min then i spend 40 min just reading it lol. is it just me",
        "subredditName": "AI_Coders",
        "isNsfw": false,
        "isSpoiler": false,
        "isCommercialCommunication": false,
        "targetLanguage": "",
        "content": null,
        "crosspost": { "sourceId": "t3_1vwc8ja" },
        "correlationId": "5200e0c3-b078-4b26-ba19-8a480dc83895"
      }
    },
    "csrf_token": "<CSRF>"
  }
  ```
- **Observed Response (200 OK):**
  ```json
  {
    "data": {
      "createSubredditPost": {
        "ok": true,
        "post": {
          "__typename": "SubredditPost",
          "id": "t3_1wkg3bi",
          "permalink": "/r/AI_Coders/comments/1wkg3bi/ai_writes_the_code_in_2_min_then_i_spend_40_min/",
          "isCrosspostable": true,
          "subreddit": { "type": "PUBLIC" }
        },
        "errors": null,
        "fieldErrors": null
      }
    }
  }
  ```

### B. Post Voting (`UpdatePostVoteState`)
- **Transport:** `POST https://www.reddit.com/svc/shreddit/graphql`
- **Payload:**
  ```json
  {
    "operation": "UpdatePostVoteState",
    "variables": {
      "input": {
        "postId": "t3_1wfwvex",
        "voteState": "UP"
      }
    },
    "csrf_token": "<CSRF>"
  }
  ```
- **Vote States:** `"UP"` (upvote), `"DOWN"` (downvote), `"NONE"` (remove vote / neutral).

### C. Comment Voting (`UpdateCommentVoteState`)
- **Transport:** `POST https://www.reddit.com/svc/shreddit/graphql`
- **Payload:**
  ```json
  {
    "operation": "UpdateCommentVoteState",
    "variables": {
      "input": {
        "commentId": "t1_paq85tr",
        "voteState": "UP"
      }
    },
    "csrf_token": "<CSRF>"
  }
  ```

### D. Comment Creation (`create-comment`)
- **Transport:** `POST https://www.reddit.com/svc/shreddit/{postId}/create-comment`
- **Headers:** `content-type: application/x-www-form-urlencoded`, `accept: text/vnd.reddit.partial+html, application/json`
- **Form Fields:**
  - `parentId`: Full fullname ID of target post (`t3_...`) or target parent comment (`t1_...`).
  - `commentDepth`: `1` for top-level comments, `2` for nested replies.
  - `mode`: `"richText"`
  - `content`: JSON string representing the AST:
    ```json
    {"document":[{"e":"par","c":[{"e":"text","t":"GOOD"}]}]}
    ```
  - `csrf_token`: `<CSRF>`

### E. Subreddit Join / Leave (`UpdateSubredditSubscriptions`)
- **Transport:** `POST https://www.reddit.com/svc/shreddit/graphql`
- **Payload:**
  ```json
  {
    "operation": "UpdateSubredditSubscriptions",
    "variables": {
      "input": {
        "inputs": [
          { "subredditId": "t5_2sama", "subscribeState": "SUBSCRIBED" }
        ]
      }
    },
    "csrf_token": "<CSRF>"
  }
  ```
- **States:** `"SUBSCRIBED"` (join), `"UNSUBSCRIBED"` (leave).

### F. Inbox & Notifications
- **Mark as Read:**
  ```json
  {
    "operation": "MarkInboxAsRead",
    "variables": { "input": { "types": ["NOTIFICATIONS"] } },
    "csrf_token": "<CSRF>"
  }
  ```
- **Update Seen Activity:**
  ```json
  {
    "operation": "UpdateInboxActivitySeenState",
    "variables": { "input": { "lastSentAt": "2026-09-19T07:51:24.751Z" } },
    "csrf_token": "<CSRF>"
  }
  ```

---

## 3. Read Surfaces

1. **User Identity & Stats:**
   - `GET /user/me/about.json` -> Returns JSON with username, total karma (link + comment), inbox unread count.
   - `GET /svc/shreddit/user-drawer-button-logged-in` -> Logged-in profile badge and status.
2. **Subreddit Feeds & JSON:**
   - `GET /r/{subreddit}/{sort}.json` (e.g. `hot.json`, `new.json`, `top.json?t=day`) -> Standard structured Reddit post listings.
   - `GET /svc/shreddit/feeds/home-feed` -> Home feed stream.
   - `GET /svc/shreddit/feeds/popular-feed` -> Popular feed stream.
   - `GET /svc/shreddit/feeds/news-feed` -> News feed stream.
3. **Search & Auto-suggest:**
   - `GET /svc/shreddit/search-typeahead?query={query}` -> Live autocomplete suggestions.
   - `GET /search.json?q={query}&sort=relevance` -> Structured search results.
4. **Post & Comments:**
   - `GET /r/{subreddit}/comments/{postId}/{slug}.json` -> Structured array: `[PostDetailListing, CommentsListing]`.
