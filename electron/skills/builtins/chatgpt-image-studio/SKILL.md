---
name: chatgpt-image-studio
title: "ChatGPT Image Studio"
description: "Generates and edits high-fidelity images across multi-account ChatGPT sessions with automatic quota tracking, job queuing, and account failover. Use when generating marketing graphics, product illustrations, or editing visual assets."
version: 2.0.0
domain: chatgpt
tools:
  - chatgpt_image_accounts
  - chatgpt_generate_image
  - chatgpt_edit_image
  - chatgpt_image_jobs
  - chatgpt_open_login
inputs:
  prompt:
    type: string
    required: true
    description: "Detailed prompt describing the image to generate or the visual edits to perform"
  mode:
    type: string
    required: false
    default: generate
    description: "Operation mode: generate or edit"
  image:
    type: string
    required: false
    description: "Source image reference for editing: flowdesk-image:// URL, saved file name, or absolute file path"
  count:
    type: number
    required: false
    default: 1
    description: "Number of images to generate (1 to 20 for generate, 1 to 10 for edit)"
  account:
    type: string
    required: false
    description: "Preferred account email or partition; failover applies automatically if quota is exhausted"
  wait:
    type: boolean
    required: false
    default: true
    description: "Whether to wait synchronously for completion (up to 14 minutes) or return immediately with job IDs"
---

## When to use
- Generating commercial marketing graphics, thumbnail concepts, character visuals, and high-fidelity photo assets via ChatGPT.
- Editing existing images by referencing previous generation links (`flowdesk-image://...`) or uploading local image files.
- Running batch image jobs across multiple signed-in ChatGPT accounts to avoid exhausting a single account quota.
- Inspecting available daily image quotas and reset times across all configured ChatGPT account partitions.

## When not to use
- Video generation or video animating (use `flow-video-director` instead).
- Google Flow native image generation within Flow projects (use `flow-image-artist` instead).
- General text conversation or coding assistance without image outputs (use `ask_chatgpt` instead).
- Operations where the user is completely signed out of all ChatGPT accounts and cannot authenticate.

## Tools

### chatgpt_image_accounts
Reads live quota status without spending image generations.
- **Parameters**:
  - `refresh`: boolean (optional, default `true`). When true, queries `/backend-api/conversation/init` for fresh quota data.
- **Success shape**:
  Array of account objects:
  ```json
  [
    {
      "account": "aw***@gmail.com",
      "chatgpt": "aw***@gmail.com",
      "partition": "social-chatgpt-1",
      "signedIn": true,
      "plan": "plus",
      "imagesLeft": 111,
      "resetsAt": "2026-09-29T02:00:00.000Z",
      "parkedUntil": null,
      "usable": true,
      "busy": false,
      "error": null
    }
  ]
  ```
- **Known failure shapes**:
  Returns `{ "signedIn": false, "usable": false }` if cookies expired or user is logged out.

### chatgpt_generate_image
Dispatches one or more image generation jobs to available accounts.
- **Parameters**:
  - `prompt`: string (required, 1 to 4000 characters). Sent as-is to ChatGPT image mode (`?hints=picture_v2`).
  - `count`: integer (optional, 1 to 20, default `1`). Each image becomes an independent job.
  - `account`: string (optional). Preferred email or partition.
  - `wait`: boolean (optional, default `true`). If false, returns immediately with queued job objects.
- **Success shape**:
  ```json
  {
    "ok": true,
    "jobs": [
      {
        "id": "a1b2c3d4",
        "kind": "generate",
        "status": "done",
        "account": "aw***@gmail.com",
        "conversationId": "39baa7ee-f1c0-4db2-a2ae-4da11f527a50",
        "images": [
          {
            "url": "flowdesk-image://chatgpt-1789655184-a1b2c3d4.png",
            "path": "C:\\Users\\...\\AppData\\Roaming\\flowdesk\\images\\chatgpt-1789655184-a1b2c3d4.png",
            "width": 1024,
            "height": 1024,
            "title": "A futuristic city street"
          }
        ],
        "text": "Here is the image you requested...",
        "error": null,
        "retriedOn": 0,
        "seconds": 24
      }
    ],
    "images": [
      {
        "url": "flowdesk-image://chatgpt-1789655184-a1b2c3d4.png",
        "path": "C:\\Users\\...\\AppData\\Roaming\\flowdesk\\images\\chatgpt-1789655184-a1b2c3d4.png",
        "width": 1024,
        "height": 1024,
        "title": "A futuristic city street"
      }
    ]
  }
  ```
- **Known failure shapes**:
  `{ "ok": false, "error": "no ChatGPT account can generate right now: ..." }` when all accounts are parked, signed out, or out of quota.

### chatgpt_edit_image
Applies visual modifications to an existing image.
- **Parameters**:
  - `image`: string (required). Can be a `flowdesk-image://` reference, a file name in the images directory, or an absolute local file path.
  - `prompt`: string (required). The modifications to make.
  - `count`: integer (optional, 1 to 10, default `1`).
  - `account`: string (optional). Preferred account.
  - `wait`: boolean (optional, default `true`).
- **Success shape**: Same structure as `chatgpt_generate_image` with `kind: "edit"`.
- **Known failure shapes**:
  `{ "ok": false, "error": "image not found: <ref>" }` if the source file does not exist.

### chatgpt_image_jobs
Inspects queued, running, done, or failed image jobs.
- **Parameters**:
  - `jobId`: string (optional). Single job ID. When omitted, returns up to 50 newest jobs.
- **Success shape**: Array of public job records matching the `jobs` field above.

### chatgpt_open_login
Opens an interactive, visible Electron window for the user to complete ChatGPT authentication.
- **Parameters**:
  - `partition`: string (required). Account partition from `chatgpt_image_accounts` (e.g. `social-chatgpt-1`).
- **Success shape**: `{ "ok": true }`.

## Procedure

1. **Pre-flight Quota Inspection**:
   Call `chatgpt_image_accounts` with `refresh: true`.
   Check that at least one account reports `signedIn: true` and `usable: true`. If no account is usable, inspect `parkedUntil` and report remaining wait time to the user.

2. **Login Remediation (if needed)**:
   If all accounts are logged out, identify the desired partition and invoke `chatgpt_open_login` with `{ partition }`. Prompt the user to log in through the visible window.

3. **Dispatch Generation or Edit**:
   - For fresh creation: invoke `chatgpt_generate_image` with `{ prompt, count, wait: true }`.
   - For modifications: pass the prior image reference (`flowdesk-image://...` or absolute path) to `chatgpt_edit_image` with `{ image, prompt, wait: true }`.
   - If generating asynchronously (`wait: false`), record the returned `job.id` values.

4. **Poll Background Jobs (if async)**:
   If `wait: false` was used, poll `chatgpt_image_jobs` with `{ jobId }` every 5 seconds until `status === 'done'` or `status === 'failed'`.

5. **Verify Output Assets**:
   Confirm `ok === true` and verify that `images` array contains at least one item.
   Extract `images[0].path` (local file path) and `images[0].url` (`flowdesk-image://` URI) for downstream display or publishing.

## Limits and safety
- **Prompt Character Limit**: Maximum 4,000 characters (`electron/chatgptImages.ts:460`). Longer prompts are rejected immediately.
- **CDP Input Safety**: FlowDesk uses Chrome DevTools Protocol `Input.insertText` rather than system clipboard paste, preventing clipboard pollution and cross-job prompt collisions.
- **Account Park Policy**: When ChatGPT responds with a quota limit refusal, the account is automatically parked until its `reset_after` timestamp. Jobs move seamlessly to the next configured account with remaining quota.
- **Turn Timeout**: FlowDesk enforces a 15-minute ceiling per turn and a 90-second composer submission timeout before failing a stalled job.
- **Action Policy**: Image creation consumes ChatGPT plan quotas. Do not dispatch runaway loops or excessive batch counts without user intent. Refer to `account-safety` rules.

## Verified facts
- Quota is read live without spending generation credits using `POST /backend-api/conversation/init` which returns `limits_progress` with `image_gen` remaining and reset timestamps (`electron/chatgptImages.ts:107-116`, `electron/chatgptImageCore.ts:8-10`).
- Background worker windows run per-partition with tab IDs named `cgimg-<partition>` (`electron/chatgptImages.ts:165`).
- Image generation requests navigate to `https://chatgpt.com/?hints=picture_v2` and enter prompt text into `div.ProseMirror[contenteditable="true"], #prompt-textarea` (`electron/chatgptImages.ts:33-34`).
- Turn status is polled via `GET /backend-api/conversation/{id}` every 4,000ms (`POLL_MS = 4000`, `electron/chatgptImages.ts:37, 314`).
- Completed images are tool messages from author `t2uay3k.sj1i4kz` with `image_asset_pointer` metadata and are downloaded with automatic retry if initial CDN links return HTTP 500 (`electron/chatgptImageCore.ts:10-12`, `electron/chatgptImages.ts:248-260`).
- Generated images are saved locally to `generatedImagesDir()` and indexed in `_chatgpt-origins.jsonl` with partition, conversationId, and fileId mapping (`electron/chatgptImages.ts:263-268`).

## Not verified
- Exact quota reset behavior for enterprise or team workspace plans where `limits_progress` response structure may include organizational pooling tiers. Check at runtime via `chatgpt_image_accounts`.
