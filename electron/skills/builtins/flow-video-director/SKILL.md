---
name: flow-video-director
title: "Google Flow Video Director"
description: "Directs Google Flow neural text-to-video, image-to-video, and video extension with credit failover, status polling, and verified local downloads. Use when producing high-quality AI video reels or animating visual assets."
version: 2.0.0
domain: flow
tools:
  - flow_video_models
  - flow_generate_video
  - flow_generate_video_from_image
  - flow_extend_video
  - flow_media_status
  - flow_download_media
  - flow_accounts
  - flow_credits
  - flow_list_projects
  - flow_create_project
inputs:
  prompt:
    type: string
    required: true
    description: "Directorial scene prompt describing visual action, subject, camera motion, and soundscape"
  projectId:
    type: string
    required: false
    description: "Target Google Flow project ID; if omitted, an existing project is chosen or created"
  modelKey:
    type: string
    required: false
    default: abra_t2v_10s
    description: "Accepted video model key from flow_video_models or references/models.md"
  mediaId:
    type: string
    required: false
    description: "Source image media ID when generating video from an image"
  sourceVideoId:
    type: string
    required: false
    description: "Source video media ID when extending an existing video scene"
  sceneId:
    type: string
    required: false
    description: "Scene ID when extending an existing video scene"
  account:
    type: string
    required: false
    description: "Preferred Google account email or partition; failover applies automatically if credits are exhausted"
---

## When to use
- Generating commercial-grade AI video clips from text prompts using Google Flow neural synthesis.
- Animating an uploaded keyframe image into an animated video sequence (`flow_generate_video_from_image`).
- Extending an existing video scene seamlessly beyond its initial frame boundary (`flow_extend_video`).
- Polling generation status until completed and streaming the final MP4 bytes to local disk storage (`flow_download_media`).
- Managing multi-account Google Flow credits with automated failover when one account runs out.

## When not to use
- Static 2D image generation without video motion (use `flow-image-artist` or `chatgpt-image-studio` instead).
- Video publishing or direct uploads to social media channels (use `tiktok-publisher` instead).
- Writing and formatting directorial prompt syntax from scratch (use `video-prompt-writer` instead).
- General web research or social media analytics.

## Tools

### flow_video_models
Queries the live Google Flow session for registered video generation models.
- **Parameters**: None.
- **Success shape**:
  ```json
  {
    "ok": true,
    "models": ["veo_3_1_quality", "veo_3_1_lite", "abra", "veo_3_1_fast"]
  }
  ```
- **Known failure shapes**:
  `{ "ok": false, "error": "Google Flow is not open in any account" }` if no account is running Flow.

### flow_generate_video
Submits a text-to-video synthesis request in a Google Flow project. Spends Flow subscription credits.
- **Parameters**:
  - `projectId`: string (required). Flow project ID.
  - `prompt`: string (required). Scene prompt.
  - `modelKey`: string (required). Valid model key (e.g. `abra_t2v_10s` or `abra_t2v_8s`). See `references/models.md`.
  - `account`: string (optional). Preferred Google account partition or email.
- **Success shape**:
  ```json
  {
    "ok": true,
    "requested": true,
    "model": "abra_t2v_10s",
    "creditsAfterIfThatIsWhatItIs": 828,
    "account": "aw***@gmail.com",
    "projectId": "88b2ccd7-9981-4970-8f7d-c70a1a0973b9",
    "result": [
      null,
      828,
      [
        [
          "ae5333f7-8f1d-4a8e-b927-9abac29ff50f",
          null,
          null,
          ["Scene title", [1789666250, 649297000], null, null, "15b83eba-df23-4c2c-bb47-bb7c72eefa5e", "UUID", [1789666252, 957002000]],
          "88b2ccd7-9981-4970-8f7d-c70a1a0973b9"
        ]
      ],
      [["15b83eba-df23-4c2c-bb47-bb7c72eefa5e", "88b2ccd7-9981-4970-8f7d-c70a1a0973b9", "ae5333f7-8f1d-4a8e-b927-9abac29ff50f"]]
    ]
  }
  ```
  *Note*: The media ID for status polling is the UUID located inside `result[2][0][4]` or `result[3][0][0]` (e.g. `"15b83eba-df23-4c2c-bb47-bb7c72eefa5e"`).

### flow_generate_video_from_image
Generates a video starting from an existing image in the project as its opening frame.
- **Parameters**:
  - `projectId`: string (required). Target project ID.
  - `prompt`: string (required). Animation and movement prompt.
  - `mediaId`: string (required). Existing image media ID within the project.
  - `modelKey`: string (required). Model key (e.g. `abra_r2v_10s`).
- **Success shape**: `{ "ok": true, "requested": true, "model": "abra_r2v_10s", "result": [...] }`.

### flow_extend_video
Extends an existing video scene sequentially.
- **Parameters**:
  - `projectId`: string (required). Flow project ID.
  - `prompt`: string (required). Continuation action prompt.
  - `sourceVideoId`: string (required). Existing video media ID.
  - `sceneId`: string (required). Target scene ID.
- **Success shape**: `{ "ok": true, "requested": true, "result": [...] }`.

### flow_media_status
Inspects the asynchronous rendering progress of a generated video or image.
- **Parameters**:
  - `mediaId`: string (required). Media ID returned by the generation call.
  - `account`: string (optional). Account partition or email.
- **Success shape**:
  ```json
  {
    "ok": true,
    "mediaId": "15b83eba-df23-4c2c-bb47-bb7c72eefa5e",
    "status": "completed",
    "statusCode": 3,
    "done": true,
    "videoUrl": "https://flow-content.google/video/...",
    "imageUrl": null,
    "byteSize": 4194304
  }
  ```
  Status transitions: `queued` (`statusCode: 6`) -> `rendering` (`statusCode: 2`) -> `completed` (`statusCode: 3`).

### flow_download_media
Downloads the rendered video directly from its Google Flow CDN URL or media ID to disk.
- **Parameters**:
  - `mediaUrl`: string (required). Either the direct video CDN URL (`https://...`) or the direct `mediaId`.
- **Success shape**:
  ```json
  {
    "ok": true,
    "downloaded": true,
    "filePath": "C:\\Users\\...\\Downloads\\FlowDesk Studio\\flow-1789655184.mp4",
    "byteSize": 4194304,
    "url": "https://flow-content.google/video/..."
  }
  ```

### flow_accounts & flow_credits
- `flow_accounts`: Returns all configured Google accounts, session status, and credit balances.
- `flow_credits`: Checks credit balance on an account. Returns `{ "ok": true, "raw": [1050, 1, 2, 2, null, 1050] }`.

### flow_list_projects & flow_create_project
- `flow_list_projects`: Lists projects owned by the account. Returns `{ "ok": true, "count": 21, "projects": [...] }`.
- `flow_create_project`: Creates a new project container. Returns `{ "ok": true, "projectId": "uuid", "projectTitle": "..." }`.

## Procedure

1. **Verify Session & Credits**:
   Call `flow_accounts` or `flow_credits` to ensure sufficient credits exist (> 22 credits). If the preferred account is empty, FlowDesk's `generateRouted` handles account failover automatically.

2. **Select or Create Project**:
   Call `flow_list_projects`. If a suitable project is found, reuse its `projectId`. Otherwise, call `flow_create_project` with `{ title: "FlowDesk Automation" }` and extract the new `projectId`.

3. **Verify Model Key**:
   Consult `references/models.md`. For text-to-video, select `abra_t2v_10s` (or `abra_t2v_8s`). For image-to-video, select `abra_r2v_10s`.

4. **Dispatch Generation**:
   - For text-to-video: call `flow_generate_video` with `{ projectId, prompt, modelKey: "abra_t2v_10s" }`.
   - For image-to-video: call `flow_generate_video_from_image` with `{ projectId, prompt, mediaId, modelKey: "abra_r2v_10s" }`.
   - Verify `ok === true` and extract the returned `mediaId`.

5. **Poll Generation Status**:
   Poll `flow_media_status` with `{ mediaId }` every 5 seconds.
   Continue polling while `done === false` (statuses: `queued` or `rendering`).
   Apply a 180-second (3-minute) timeout ceiling.
   When `done === true` (`status === "completed"`), extract `videoUrl`.

6. **Download MP4 Asset**:
   Call `flow_download_media` passing either the `videoUrl` or the `mediaId`.
   Verify `ok === true` and record `filePath` (`.../FlowDesk Studio/flow-{timestamp}.mp4`). Pass this path to downstream workflows (e.g. TikTok upload).

## Limits and safety
- **Credits & Quotas**: Video generation consumes real Google Flow credits (typically 22 credits per generation, as captured in `_network-flow-google-com.SESSION2.json`). Never run unattended loops without human approval.
- **Failover Routing**: `generateRouted` in `electron/flow.ts` checks account credit balance before dispatch. If an account has 0 credits or returns a quota error, it automatically fails over to the next account's "FlowDesk" project.
- **reCAPTCHA Token Requirement**: Flow generation calls require enterprise reCAPTCHA tokens (`VIDEO_GENERATION`). Dropping the context causes Google Flow to reject the request (`electron/flowBridge.ts:482-485`).
- **CDN Expiration**: Temporary signed URLs from Google Flow (`flow-content.google`, `as29s`) expire. Always download media to local disk immediately rather than caching remote URLs.
- **Memory Safety**: FlowDesk streams video downloads through Node HTTP fetch directly to disk to prevent Electron renderer WebContents out-of-memory crashes (`electron/flow.ts:413-428`).

## Verified facts
- Google Flow frontend runs at `flow.google.com` using Angular and `batchexecute` protocol (`probes/FINDINGS-flow.md:377-400`).
- Text-to-video calls use RPC `YhhmEf` with prompt, model key, reCAPTCHA token, and client context (`electron/flowBridge.ts:474-501`).
- Video models query uses RPC `yBhWQ` returning `["veo_3_1_quality", "veo_3_1_lite", "abra", "veo_3_1_fast"]` (`electron/flowBridge.ts:509-526`, `probes/out/_network-flow-google-com.SESSION2.json:12389`).
- Live generation requests submit `abra_t2v_10s` and `abra_t2v_8s` for text-to-video (`_network-flow-google-com.SESSION2.json:11717`, `bin/flowdesk-mcp.mjs:1678`).
- Image-to-video generation uses RPC `MZZa6b` with model key `abra_r2v_10s` (`electron/flowBridge.ts:749-783`).
- Scene extensions use RPC `jIps6` with source frames 0..240 and model key `abra_edit` (`electron/flowBridge.ts:787-821`).
- Status polling uses RPC `as29s` with fallback to `jwpduf`, where `statusCode === 3` indicates completed render (`electron/flowBridge.ts:538-586`).
- Direct video downloads stream to `%USERPROFILE%\Downloads\FlowDesk Studio\flow-<timestamp>.mp4` via Node fetch (`electron/flow.ts:420-424`).

## Not verified
- The exact server-side error code returned by Google Flow when credits are completely exhausted (simulated in tests via HTTP 429 and quota keywords; see `electron/flow.ts:161-168` and `HANDOFF-2026-09-28.md:49`).
