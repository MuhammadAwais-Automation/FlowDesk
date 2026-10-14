---
name: tiktok-publisher
title: "TikTok Publisher"
description: "Uploads videos to TikTok via the web API with privacy controls and scheduling, lists existing posts, edits captions, and deletes videos. Use when a video file is ready to publish or when managing published TikTok posts."
version: 2.0.0
domain: tiktok
tools:
  - tiktok_api_upload_video
  - tiktok_list_posts
  - tiktok_edit_video_caption
  - tiktok_delete_video
inputs:
  filePath:
    type: string
    required: true
    description: "Absolute local path to the mp4 video file to upload"
  caption:
    type: string
    required: false
    description: "Post caption text including hashtags and description"
  privacy:
    type: string
    required: false
    default: private
    description: "Visibility setting: private, friends, or public. Defaults to private"
  scheduleAt:
    type: string
    required: false
    description: "Publish later: ISO date-time string 15 minutes to 10 days ahead. Not allowed with private"
  account:
    type: string
    required: false
    description: "Target account ID: 1, 2, or 3. Defaults to active account"
---

> The `tiktok` skill is the full, current reference for every TikTok tool. Account routing: every
> tool takes `account` (id, label or partition from `tiktok_accounts`); an unknown account fails and never
> falls back to another one. Uploads, posts, caption edits, deletes, bio changes and warmup `autoLike`
> change the public account: call them only after the user approved that exact action.


## When to use
- A rendered mp4 video file is saved on disk and ready to upload to TikTok.
- Uploading in private mode ("Only you") for manual review and QA before broad release.
- Scheduling an approved video between 15 minutes and 10 days into the future (friends or public).
- Listing all published or studio videos on an account to verify publish status or view statistics.
- Editing the caption on an already-published video.
- Deleting an unwanted or test video after explicit user confirmation.

## When not to use
- Researching viral topics, sounds, or competitor outliers (use `tiktok-trend-research`).
- Editing profile bio or switching account sessions (use `tiktok-profile-manager`).
- Composing captions and hashtag stacks from research without a video file (use `caption-hashtag-writer`).
- Attempting immediate public posts or deletions without user approval in chat.

## Tools

### tiktok_api_upload_video
Uploads and publishes a local video file to TikTok over the web API (no Studio UI driving).
- **Parameters**:
  - `filePath` (string, required): Absolute local path to an .mp4 file.
  - `caption` (string, optional): Full caption text with description and hashtags.
  - `privacy` (string, optional): `'private'` (default), `'friends'`, or `'public'`.
  - `scheduleAt` (string, optional): ISO date-time 15 minutes to 10 days ahead, rounded up to the next 5 minutes. Needs `privacy: 'public'`. FlowDesk schedules in TikTok Studio's own form and answers its "Allow your video to be saved for scheduled posting?" popup (shown on every scheduled upload) itself; the user asking to schedule is the go-ahead. Takes 1-2 minutes.
  - `account` (string, optional): Target account ID (e.g. `'1'`, `'2'`). Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "via": "api",
    "itemId": "7485920194857291823",
    "url": "https://www.tiktok.com/video/7485920194857291823",
    "privacy": "private",
    "videoId": "v09044g40000cu...",
    "steps": ["auth", "apply", "upload", "publish"],
    "scheduled": false
  }
  ```
  If scheduled, includes `"scheduled": true` and `"scheduledFor": "2026-09-30T18:00:00.000Z"`.
- **Known failure shapes**:
  - `scheduleAt` violation: `{ "ok": false, "error": "scheduleAt must be at least 15 minutes from now", "steps": [] }`
  - Private scheduling attempt: `{ "ok": false, "error": "TikTok cannot schedule an \"Only you\" post — use friends or public", "steps": [] }`
  - Unauthenticated session: `{ "ok": false, "error": "upload/auth returned no video token (status undefined) — signed in?", "steps": [] }`
  - Storage node rejection: `{ "ok": false, "error": "file upload rejected", "status": 400, "steps": ["auth", "apply"] }`

### tiktok_list_posts
Lists published and studio videos for a TikTok account over Studio's content management API.
- **Parameters**:
  - `account` (string, optional): Target account ID. Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "via": "api",
    "count": 12,
    "posts": [
      {
        "id": "7485920194857291823",
        "url": "https://www.tiktok.com/video/7485920194857291823",
        "caption": "Morning routine with the squad #catsoftiktok",
        "createdAt": "2026-09-27T10:14:00.000Z",
        "visibility": 1,
        "inReview": false,
        "views": 412,
        "likes": 56,
        "comments": 4,
        "shares": 2,
        "saves": 9,
        "durationMs": 14000
      }
    ],
    "account": "social-tiktok"
  }
  ```
  Note: `visibility === 1` indicates public ("Everyone") per TikTok Studio conventions. Other integer values represent restricted, friends, or private posts.
- **Known failure shapes**:
  - Unsigned request: `{ "ok": false, "error": "empty response — the request went out unsigned (view not on a Studio page)", "account": "social-tiktok" }`

### tiktok_edit_video_caption
Edits the caption of an existing video owned by the account via Studio's edit API.
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
    "videoId": "7485920194857291823",
    "account": "social-tiktok"
  }
  ```
- **Known failure shapes**:
  - Non-numeric video ID: `{ "ok": false, "error": "videoId must be numeric", "account": "social-tiktok" }`
  - Rejection: `{ "ok": false, "error": "caption edit not confirmed", "status_code": 10002, "status_msg": "item not found" }`

### tiktok_delete_video
Deletes an owned TikTok video over the authenticated web API using ticket-guard signatures.
- **Parameters**:
  - `videoId` (string, optional): Numeric video ID.
  - `videoUrl` (string, optional): Full TikTok video URL (e.g. `'https://www.tiktok.com/@user/video/12345'`).
  - `account` (string, optional): Target account ID. Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "deleted": true,
    "via": "api",
    "itemId": "7485920194857291823",
    "account": "social-tiktok"
  }
  ```
- **Known failure shapes**:
  - Missing identifier: `{ "ok": false, "error": "Must provide either videoId or videoUrl (a numeric id or a /video/<id> URL) to delete a video" }`
  - Page client missing: `{ "ok": false, "error": "TikTok page client not found — is a www.tiktok.com page loaded?" }`

## Procedure

1. **Pre-upload safety check**:
   - Verify that the target video file exists on disk and is a valid .mp4 file.
   - Default privacy to `'private'`. If `'public'` or `'friends'` or scheduling is requested, confirm user approval.
2. **Execute upload**:
   - Call `tiktok_api_upload_video` with `filePath`, `caption`, `privacy`, and optional `scheduleAt`.
   - Inspect the response. Ensure `res.ok === true` and verify `res.itemId` is returned.
3. **Verify in catalog**:
   - Call `tiktok_list_posts({ account })`.
   - Find the newly uploaded `itemId` in `res.posts` to confirm TikTok registered the item and observe its initial `visibility` and `inReview` state.
4. **Caption updates (if needed)**:
   - To update copy after review, call `tiktok_edit_video_caption` with the verified `videoId` and new `caption`.
   - Verify `res.edited === true`.
5. **Deletion (cleanup/revert)**:
   - When running test uploads or removing videos, ask the user for confirmation.
   - Call `tiktok_delete_video({ videoId })` and confirm `res.deleted === true`.

## Limits and safety
- **Private-first rule**: Always upload with `privacy: 'private'` by default. Public publishing and scheduled drops require explicit user permission in chat.
- **Scheduling constraints**: TikTok Studio API allows scheduling strictly between 15 minutes and 10 days in advance (`SCHEDULE_MIN_MS = 900000`, `SCHEDULE_MAX_MS = 864000000`). Scheduling is rejected if `privacy === 'private'`.
- **Permanent deletion**: Deleting a post is irreversible. Never execute `tiktok_delete_video` without confirming the target video ID with the user.
- **Rate limits & anti-spam**: Space video uploads by at least 15 to 30 minutes to preserve account health. Never upload multiple public videos in rapid automated succession.

## Verified facts
- `tiktok_api_upload_video` executes a 4-step web API workflow (`/api/v1/video/upload/auth/`, SigV4 `ApplyUploadInner`, multipart storage upload with CRC32, and `/tiktok/web/project/post/v1/`) without opening Studio UI (`electron/tiktokUpload.ts:1-19`, `electron/tiktokUpload.ts:137-237`).
- Upload step 3 sends binary video bytes from Node via `fetch` directly to the storage host using `StoreInfo.Auth`, preventing large base64 memory overhead in Electron WebContents (`electron/tiktokUpload.ts:16-18`, `electron/tiktokUpload.ts:192-209`).
- Scheduling boundary is 15 minutes to 10 days ahead (`SCHEDULE_MIN_MS = 900000`, `SCHEDULE_MAX_MS = 864000000`) and private scheduling is rejected (`electron/tiktokUpload.ts:84-95`).
- TikTok visibility types in project post API are: 0 = public ("everyone"), 1 = private ("only you"), 2 = friends (`electron/tiktokUpload.ts:77-79`).
- `tiktok_list_posts` fetches up to 10 pages of 50 items from `/tiktok/creator/manage/item_list/v1/` signed by the Studio session (`electron/tiktok.ts:566-596`).
- In `tiktok_list_posts`, `visibility === 1` denotes Everyone (public) according to TikTok Studio API response data (`electron/tiktok.ts:582-583`).
- `tiktok_edit_video_caption` sends POST `/tiktok/post/edit/v1/` with `is_text_changed: true` signed in the Studio web view (`electron/tiktok.ts:784-801`).
- `tiktok_delete_video` uses `TIKTOK_CLIENT_FN` to sign requests to `/api/aweme/delete/` with tt-ticket-guard headers from loaded webpack chunks (`electron/tiktok.ts:603-647`).

## Not verified
- The maximum file size limit for `/top/v1` web uploads (standard web UI supports up to 2GB-4GB).
- Maximum caption length validated server-side on `/tiktok/web/project/post/v1/` (no client-side check exists in FlowDesk; UI allows 2200-4000 chars depending on region).
