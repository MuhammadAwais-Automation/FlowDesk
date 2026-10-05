---
name: google-flow
title: "Google Flow (images, videos, projects, accounts)"
description: "How to use every FlowDesk Google Flow tool: projects, image generation, upload, text-to-video, image-to-video, extending a video, polling status, downloading, and spreading work over several Google accounts' credits."
version: 1.0.0
domain: flow
tools:
  - flow_accounts
  - flow_credits
  - flow_list_projects
  - flow_create_project
  - flow_list_project_media
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

Every fact below was checked against the live app on 2026-10-04. FlowDesk drives the user's own
signed-in Google accounts in Google Flow; videos spend that account's Flow credits.

## When to use
- Making AI video: from text, from an image, or continuing a finished video.
- Making or uploading images inside a Flow project, usually as a video's starting frame.
- Checking Flow credits, projects, or whether a generation is finished; downloading the result.

## When not to use
- A still image with portrait/square framing, or an image edit: use the `chatgpt` skill
  (`chatgpt_generate_image` / `chatgpt_edit_image`); Flow images are landscape only.
- Writing the video prompt itself: `video-prompt-writer`. Posting the video: `tiktok-publisher`.

## The flow of work

```
flow_accounts ─► flow_list_projects / flow_create_project ─► projectId
                                  │
     ┌────────────────────────────┼─────────────────────────────┐
flow_generate_image         flow_upload_image            flow_generate_video
(prompt → image mediaId)    (local file → mediaId)       (prompt → video mediaId + sceneId)
     └──────────┬─────────────────┘                             │
     flow_generate_video_from_image (image mediaId → video)     │
                └──────────────────────┬────────────────────────┘
                     flow_media_status (poll until done) ─► videoUrl / imageUrl
                     flow_extend_video (finished video + sceneId → next shot)
                     flow_download_media (url → file on disk)
```

## Which tool for which job

| The user wants to… | Use | Cost seen live |
|---|---|---|
| see accounts and credits | `flow_accounts` (all) / `flow_credits` (one) | free |
| find or make a project | `flow_list_projects` / `flow_create_project` | free |
| see what is inside a project | `flow_list_project_media` | free |
| make a picture | `flow_generate_image` | 0 credits |
| bring in a local picture | `flow_upload_image` | free |
| video from text | `flow_generate_video` with `abra_t2v_8s` | 12 credits |
| animate a picture | `flow_generate_video_from_image` with `veo_3_1_r2v_lite` | 10 credits |
| continue a finished video | `flow_extend_video` | 20 credits |
| know if it is ready / get its link | `flow_media_status` | free |
| save the file | `flow_download_media` | free |

## Projects and accounts

- Every generation happens inside a project. Reuse one (`flow_list_projects`) or make one
  (`flow_create_project {title}` → `projectId`).
- `account` (exact email, partition, or the masked name `flow_accounts` prints) picks the Google account; an
  unknown or partial value is an error, never a silent fallback. Without it, a call about a project or media
  runs on the account that owns it (FlowDesk remembers owners across restarts), else the default account.
- `flow_generate_image` and `flow_generate_video` move to the next account with credits when the
  project's account runs out, into that account's "FlowDesk" project; the result names the account and
  `projectId` actually used. (The exact out-of-credits error has not been seen live yet.)
- `flow_credits` / `flow_accounts` report Flow's own balance number; each video's answer also carries
  `creditsLeft`.

## Images

- `flow_generate_image {projectId, prompt, account?, imageModel?}` returns in ~30 s with `mediaId` and `imageUrl`.
  Output is landscape (1376×768). There is no aspect-ratio option. `imageModel` accepts only
  `NANO_BANANA_2` (default, verified) or `NANO_BANANA_PRO` (was refused when tried live); anything else is refused.
- `flow_upload_image {projectId, localFilePath, account?}` → `mediaId` in ~20 s. The path must be an absolute
  local path (no network/UNC paths) to a real PNG, JPEG or WebP file of at most 25 MB. Use it to animate
  an image from anywhere (for example one made with ChatGPT).

## Videos

1. Call `flow_video_models` once. Use **`verifiedModelKeys`**: `textToVideo` (`abra_t2v_8s`),
   `imageToVideo` (`veo_3_1_r2v_lite`). The `families` list (`veo_3_1_lite`, `abra`, …) is NOT a valid
   `modelKey`; the tool refuses a family before anything is spent. Modes are enforced: `flow_generate_video`
   takes only a t2v key, `flow_generate_video_from_image` only an r2v/i2v key.
2. Start it:
   - text → `flow_generate_video {projectId, prompt, modelKey, account?}`
   - image → `flow_generate_video_from_image {projectId, mediaId, prompt, modelKey, account?}` (the image must be in
     that project; it runs on the project's account)
   Both return at once with `mediaId`, `sceneId` and `creditsLeft`. Keep `mediaId` and `sceneId`.
3. Poll `flow_media_status {mediaId}` every 10-15 s until `done: true` (`status`: queued → rendering →
   completed). A text video finished in ~30 s live; allow a few minutes.
4. Continue it: `flow_extend_video {projectId, sourceVideoId: <the finished mediaId>, sceneId, prompt, account?}` →
   a new `mediaId` in the same scene; poll it the same way.

Write video prompts as one shot: subject, action, camera, light ("The paper boat drifts slowly forward,
gentle ripples").

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
| `"…" is a model family, not a generation key` | Wrong `modelKey` | Use `verifiedModelKeys` |
| `Google Flow answered but carried no … result` with `[5]` | Flow rejected the request (bad key or ids) | Check `modelKey`, `projectId`, `mediaId` belong together |
| `media … was not found on this account` | Wrong id or another account's media | Pass `account`, or find it with `flow_list_project_media` |
| `unknown Google account "…"` | `account` matched no signed-in account exactly (no partial matches) | Use an email or `partition` from `flow_accounts` |
| `is not a valid Google Flow id` | An id with characters other than letters, digits, `-`, `_` | Copy the id from a listing |
| `could not mint a reCAPTCHA token` | Flow page not ready / signed out | Retry; check `flow_accounts` shows `signedIn: true` |

## Not available

No aspect ratio for images, no video length choice beyond the verified keys, no delete
through MCP. Keys other than the verified ones may exist but have not been proven; do not guess them.
