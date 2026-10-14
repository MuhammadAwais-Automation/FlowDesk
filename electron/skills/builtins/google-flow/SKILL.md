---
name: google-flow
title: "Google Flow (images, videos, projects, accounts)"
description: "How to use every FlowDesk Google Flow tool: projects, images, text-to-video, video from frames or up to 7 reference images, polling, downloading, the 12-hour hold after Google's unusual-activity flag, and several accounts."
version: 1.2.0
domain: flow
tools:
  - flow_accounts
  - flow_credits
  - flow_list_projects
  - flow_create_project
  - flow_list_project_media
  - flow_image_models
  - flow_generate_image
  - flow_upload_image
  - flow_video_models
  - flow_generate_video
  - flow_generate_video_from_image
  - flow_extend_video
  - flow_media_status
  - flow_download_media
inputs: {}
---

FlowDesk drives the user's own signed-in Google accounts in Google Flow; videos spend that account's Flow
credits. Since 2026-10 Flow's old direct calls are refused ("unusual activity"), so images and videos are made
by operating **Flow's own page** the way a person does (prompt bar settings, attach images, type, Start).
Checked live on 2026-10-13/14.

## When to use
- Making AI video: from text, from one or two frames, or from up to 7 reference images.
- Making or uploading images inside a Flow project, usually as a video's frame or reference.
- Checking Flow credits, projects, or whether a generation is finished; downloading the result.

## When not to use
- An image edit, or pin images (user rule: pins always come from ChatGPT): use the `chatgpt` skill
  (`chatgpt_generate_image` / `chatgpt_edit_image`).
- Writing the video prompt itself: `video-prompt-writer`. Posting the video: `tiktok-publisher`.

## The flow of work

```
flow_accounts ─► flow_list_projects / flow_create_project ─► projectId
                                  │
     ┌────────────────────────────┼─────────────────────────────┐
flow_generate_image         flow_upload_image            flow_generate_video
(prompt → image mediaId)    (local file → mediaId)       (prompt [+ frames / ingredients] → mediaIds)
     └──────────┬─────────────────┘                             │
     flow_generate_video_from_image (image → first frame)       │
                └──────────────────────┬────────────────────────┘
                     flow_media_status (poll until done) ─► videoUrl / imageUrl
                     flow_download_media (url → file on disk)
```

## Which tool for which job

| The user wants to… | Use | Cost |
|---|---|---|
| see accounts and credits | `flow_accounts` (all) / `flow_credits` (one) | free |
| find or make a project | `flow_list_projects` / `flow_create_project` | free |
| see what is inside a project | `flow_list_project_media` | free |
| make a picture | `flow_generate_image` | 0 credits |
| bring in a local picture | `flow_upload_image` | free |
| video from text | `flow_generate_video` | what Flow quotes (`creditsQuoted`) |
| animate a picture / first and last frame | `flow_generate_video_from_image` or `flow_generate_video` with `startFrame` / `endFrame` | same |
| video from reference images | `flow_generate_video` with `ingredients` (max 7) | same |
| continue a finished video | **not available** (`flow_extend_video` always errors: Flow's page has no Extend) | – |
| know if it is ready / get its link | `flow_media_status` | free |
| save the file | `flow_download_media` | free |

## Projects and accounts

- Every generation happens inside a project. Reuse one (`flow_list_projects`) or make one
  (`flow_create_project {title}` → `projectId`).
- `account` (exact email, partition, or the masked name `flow_accounts` prints) picks the Google account; an
  unknown or partial value is an error, never a silent fallback. Without it, a call about a project or media
  runs on the account that owns it (FlowDesk remembers owners across restarts), else the default account.
- `flow_credits` / `flow_accounts` report Flow's own balance number.
- One generation at a time per account; the call returns once Flow shows the new clips, so a batch is a
  loop of calls, then polling.

## Images

- `flow_image_models {projectId, account?}` reads Flow's own settings: the image models on offer (live
  2026-10-13: Nano Banana Pro, Nano Banana 2 Lite, Nano Banana 2.1) and the current settings.
- `flow_generate_image {projectId, prompt, account?, model?, aspectRatio?, count?, ingredients?}` sets model,
  ratio (16:9, 4:3, 1:1, 3:4, 9:16) and count (1-4) in the prompt bar settings (Agent off), attaches any
  `ingredients`, types the prompt, presses Start, and waits up to 4 min. Returns `mediaIds` and
  `images[{mediaId, imageUrl}]`; save each with `flow_download_media {mediaUrl: imageUrl}`. No credits are
  spent on images.
- `flow_upload_image {projectId, localFilePath, account?}` → `mediaId` in ~20 s. The path must be an absolute
  local path (no network/UNC paths) to a real PNG, JPEG or WebP file of at most 25 MB.

## Videos

1. Call `flow_video_models {projectId}` once. It reads the page's own menu: the video models (live
   2026-10-13: Omni 1.1 Flash, Veo 3.1 - Lite / Fast / Quality), the current settings and the credits Flow
   quotes for them. Pass a model by that exact name.
2. Start it with `flow_generate_video {projectId, prompt, account?, model?, aspectRatio?, resolution?, seconds?,
   count?, startFrame?, endFrame?, ingredients?}`:
   - `aspectRatio` 16:9 or 9:16; `resolution` 360p or 720p; `seconds` 4, 6, 8 or 10; `count` 1-4 (each clip
     costs credits). Anything left out keeps what is set in Flow.
   - `startFrame` / `endFrame` (Frames mode, end needs start) **or** `ingredients` (up to 7 reference images,
     Ingredients mode), never both. Each is a project image `mediaId` or an absolute local image path (it is
     uploaded through Flow's own "Upload media"). `flow_generate_video_from_image {projectId, mediaId, prompt}`
     is the same with `mediaId` as the first frame.
   - It returns within about a minute with `mediaIds`, `creditsQuoted`, the `settings` used and a `note`.
     Do other work meanwhile.
3. Poll `flow_media_status {mediaId}` every 10-15 s until `done: true` (`status`: queued → rendering →
   completed). Live: 8 clips (360p, 4 s) started one after another finished within ~4.5 minutes.
4. Download with `flow_download_media`.

Write video prompts as one shot: subject, action, camera, light ("The paper boat drifts slowly forward,
gentle ripples").

## Unusual-activity hold (important)

If Flow says "unusual activity" for an account, FlowDesk parks that account for **12 hours**, across restarts:
every generation on it is refused with `heldUntil` until then. Retrying makes Google's flag worse (accounts
were blocked for manual use for days). So: do not retry, do not loop; use another signed-in account or wait,
and tell the user.

## Status and download

- `flow_media_status {mediaId}` → `kind` (image/video), `status`, `done`, `videoUrl`, `imageUrl`.
  An image is `done` as soon as it exists. If the id is not on the routed account, the other accounts
  are searched; an id found nowhere is an error.
- `flow_download_media {mediaUrl, account?}` with a mediaId, or the `videoUrl` / `imageUrl` from a FRESH
  `flow_media_status` (the links are signed and expire). Only https links on flow-content.google,
  flow.google.com/asb/, labs.google/asb/ and lh3.googleusercontent.com are fetched; anything else is refused.
  Only image/video answers up to 200 MB are saved. Saves to `Downloads\FlowDesk Studio\` and returns `filePath`.
- `flow_list_project_media {projectId, account?}` → `mediaId` + `prompt` per item. `prompt` is sometimes an id
  instead of text; use `flow_media_status` for the real kind and links.

## When something fails

| Message | Meaning | Do |
|---|---|---|
| `heldUntil` / "Flow flagged this account for unusual activity" | The 12-hour hold above | Use another account or wait; never retry |
| `Flow page: … not found — the page may have changed` | Flow changed its page | `flowdesk_health_check`, then `flowdesk_report_issue`; do not work around it |
| a refusal text from Flow itself (policy, limits) | Flow refused that prompt or image | Change the prompt/image; do not resend unchanged |
| `unknown Google account "…"` | `account` matched no signed-in account exactly (no partial matches) | Use an email or `partition` from `flow_accounts` |
| `is not a valid Google Flow id` | An id with characters other than letters, digits, `-`, `_` | Copy the id from a listing |
| frames and ingredients together, more than 7 ingredients, an end frame without a start | Refused before the page is touched | Fix the request |
| `flow_extend_video` error | Flow's page has no Extend | Make the next shot with `flow_generate_video` (start frame = an image of the last frame) |

## Not available

Extend, delete through MCP, and any model or setting that Flow's own menu does not list.
