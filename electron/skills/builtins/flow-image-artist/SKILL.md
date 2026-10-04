---
name: flow-image-artist
title: "Google Flow Image Artist"
description: "Generates high-resolution images in Google Flow and uploads local images for image-to-video conditioning. Use when creating project image assets, video starting frames, or visual concepts."
version: 2.0.0
domain: flow
tools:
  - flow_generate_image
  - flow_upload_image
  - flow_download_media
  - flow_list_projects
  - flow_create_project
  - flow_credits
  - flow_accounts
inputs:
  prompt:
    type: string
    required: false
    description: "Detailed visual description of the image to generate"
  projectId:
    type: string
    required: false
    description: "Target Google Flow project ID; if omitted, an existing project is chosen or created"
  localFilePath:
    type: string
    required: false
    description: "Absolute path to a local image file for uploading into a project"
  aspectRatio:
    type: string
    required: false
    default: LANDSCAPE
    description: "Desired aspect ratio: LANDSCAPE, PORTRAIT, or SQUARE"
  account:
    type: string
    required: false
    description: "Preferred Google account email or partition; failover applies automatically if credits are exhausted"
---

## When to use
- Generating commercial image assets, character keyframes, or concept art directly inside Google Flow projects.
- Creating the opening keyframe image to feed into `flow-video-director` for image-to-video animation (`abra_r2v_10s`).
- Uploading local image files (JPEG, PNG, WebP) into a Flow project to obtain a valid `mediaId` for video generation.
- Downloading rendered image assets from Flow CDN to disk.

## When not to use
- Direct text-to-video synthesis or extending existing video clips (use `flow-video-director` instead).
- ChatGPT DALL-E / GPT-image generation with cross-account queuing (use `chatgpt-image-studio` instead).
- Writing narrative video scripts or prompt prompt-engineering rules (use `video-prompt-writer` instead).

## Tools

### flow_generate_image
Submits an image generation request inside a Google Flow project. Spends Flow subscription credits.
- **Parameters**:
  - `projectId`: string (required). Flow project ID.
  - `prompt`: string (required). Description of the scene (maximum 1,000 characters).
  - `aspectRatio`: enum string (optional, `'LANDSCAPE'` | `'PORTRAIT'` | `'SQUARE'`).
  - `account`: string (optional). Preferred Google account email or partition.
- **Success shape**:
  ```json
  {
    "ok": true,
    "requested": true,
    "model": "NARWHAL",
    "seed": 123456789,
    "account": "aw***@gmail.com",
    "projectId": "88b2ccd7-9981-4970-8f7d-c70a1a0973b9",
    "result": [null, 1048, [["operationId", null, null, ["title", "mediaId", ...]]]]
  }
  ```
- **Known failure shapes**:
  - `{ "ok": false, "error": "the prompt is 1200 characters; keep it under 1000" }`
  - `{ "ok": false, "error": "could not mint a reCAPTCHA token: ..." }`

### flow_upload_image
Uploads a local image file into a Google Flow project and registers it as a project media asset.
- **Parameters**:
  - `projectId`: string (required). Target Flow project ID.
  - `localFilePath`: string (required). Absolute path to a local image file (`.jpg`, `.jpeg`, `.png`, `.webp`).
- **Success shape**:
  ```json
  {
    "ok": true,
    "uploaded": true,
    "mediaId": "8136473e-0f5e-4ddc-a4ba-41ae76bbb664",
    "fileName": "character_keyframe.png"
  }
  ```
- **Known failure shapes**:
  `{ "ok": false, "error": "could not read <path>: ..." }` if the file is missing or unreadable.

### flow_download_media
Downloads an image asset by its Flow CDN URL or media ID to local disk.
- **Parameters**:
  - `mediaUrl`: string (required). Either a Flow CDN URL (`https://...`) or direct `mediaId`.
- **Success shape**:
  ```json
  {
    "ok": true,
    "downloaded": true,
    "filePath": "C:\\Users\\...\\Downloads\\FlowDesk Studio\\flow-1789655184.jpg",
    "byteSize": 1048576,
    "url": "https://flow-content.google/image/..."
  }
  ```

### flow_list_projects & flow_create_project
- `flow_list_projects`: Lists existing projects on the account. Returns `{ "ok": true, "count": 21, "projects": [...] }`.
- `flow_create_project`: Creates a new project container. Returns `{ "ok": true, "projectId": "uuid", "projectTitle": "..." }`.

### flow_credits & flow_accounts
- `flow_credits`: Inspects available generation credit balance on one account.
- `flow_accounts`: Lists all configured Google accounts with credit balances and active sessions.

## Procedure

### Workflow A: Generate Image in Flow
1. **Check Credits & Project**:
   Call `flow_credits` to confirm credit balance. Call `flow_list_projects` to select an existing `projectId` or `flow_create_project` to make a new one.
2. **Dispatch Image Generation**:
   Call `flow_generate_image` with `{ projectId, prompt, aspectRatio: "PORTRAIT" }`.
   Ensure `prompt` is under 1,000 characters.
3. **Retrieve Media ID**:
   Extract `mediaId` from the returned generation `result` structure.
4. **Download or Hand Off**:
   To download the image locally, call `flow_download_media` with `{ mediaUrl: mediaId }`.
   To animate the image into video, hand `mediaId` directly to `flow-video-director` (`flow_generate_video_from_image`).

### Workflow B: Upload Local Image for Video Conditioning
1. **Target Project Selection**:
   Retrieve or create a `projectId` via `flow_list_projects` or `flow_create_project`.
2. **Upload Local File**:
   Call `flow_upload_image` with `{ projectId, localFilePath: "C:\\path\\to\\image.png" }`.
   Verify `ok === true` and `uploaded === true`.
3. **Capture Media ID**:
   Record the returned `mediaId`. This `mediaId` can now be passed to `flow_generate_video_from_image` with model key `abra_r2v_10s`.

## Limits and safety
- **Prompt Length**: Maximum 1,000 characters (`MAX_PROMPT_LENGTH = 1000` in `electron/flow.ts:273-274`).
- **File Format Support**: `.jpg`, `.jpeg`, `.png`, and `.webp` are mapped to standard MIME types (`electron/flow.ts:349-350`). Other formats are rejected.
- **reCAPTCHA Tokens**: Image generation uses reCAPTCHA action `IMAGE_GENERATION` (`electron/flowBridge.ts:442`); image uploads use `IMAGE_UPLOAD` (`electron/flowBridge.ts:686`). Both require active Google session cookies.
- **Credit Consumption**: Image generations consume credits from the Google account pool. If an account is exhausted, FlowDesk routes generation to another account's "FlowDesk" project automatically (`electron/flow.ts:227-252`).

## Verified facts
- Image generation uses Google Flow batchexecute RPC `ogiZ0b` with internal model `NARWHAL` mapped from `NANO_BANANA_2` (`electron/flowBridge.ts:438, 457`).
- Image upload uses RPC `maseQ` encoding raw file bytes as Base64 with filename, MIME type, and client context (`electron/flowBridge.ts:681-701`).
- Multi-account routing (`generateRouted`) pre-checks credit balance via RPC `nzlxg` before generation and falls back to subsequent Google accounts on quota rejection (`electron/flow.ts:227-252`).
- Project creation uses RPC `jHPbke` (`electron/flowBridge.ts:348`), project listing uses RPC `UpteDb` (`electron/flowBridge.ts:625`), and project renaming uses RPC `o8DA4` (`electron/flowBridge.ts:380`).

## Not verified
- Explicit aspect ratio overrides inside the `ogiZ0b` payload: the underlying batchexecute request only demonstrates default canvas geometry; ratio flags passed via MCP are retained for compatibility but the server mapping remains unconfirmed (`electron/flowBridge.ts:430-432`).
