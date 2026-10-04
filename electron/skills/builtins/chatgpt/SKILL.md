---
name: chatgpt
title: "ChatGPT (chats, asks, images, accounts)"
description: "How to use every FlowDesk ChatGPT tool: talk in new or old chats, pick a model, search/read/rename chats, generate and edit images with progress, browse and download the image library, and route work across several ChatGPT accounts."
version: 3.0.0
domain: chatgpt
tools:
  - chatgpt_ask
  - ask_chatgpt
  - chatgpt_models
  - chatgpt_chats
  - chatgpt_chat_read
  - chatgpt_search_chats
  - chatgpt_chat_update
  - chatgpt_generate_image
  - chatgpt_edit_image
  - chatgpt_image_jobs
  - chatgpt_image_library
  - chatgpt_download_image
  - chatgpt_image_accounts
  - chatgpt_open_login
inputs: {}
---

Every fact below was checked against the live app on 2026-10-04. FlowDesk drives the
user's own signed-in ChatGPT accounts; there is no API key and no cost per call, but each
account has ChatGPT's own limits.

## When to use
- Asking ChatGPT anything, in a new chat or continuing an old one, on a chosen account or model.
- Finding, reading, renaming or archiving the user's ChatGPT chats.
- Generating or editing still images (any framing), and finding/downloading images made before.

## When not to use
- Video of any kind: use the `google-flow` skill.
- Other assistants (Claude, Gemini, Grok, Perplexity): their own `ask_*` tools.

## Which tool for which job

| The user wants to… | Use | Notes |
|---|---|---|
| ask ChatGPT something | `chatgpt_ask` | New chat every time unless `chatId` is given. |
| continue an earlier conversation | `chatgpt_chats` or `chatgpt_search_chats` → `chatgpt_ask` with `chatId` | The chat stays on the account that owns it. |
| use a specific model | `chatgpt_models` → `chatgpt_ask` with `model` | Only slugs from `chatgpt_models`. |
| see what was said in a chat | `chatgpt_chat_read` | `lastN` for the tail only. |
| find a chat by its content | `chatgpt_search_chats` | Full-text; snippets are cut to 300 chars. |
| rename / archive a chat | `chatgpt_chat_update` | There is no delete, on purpose. |
| make images | `chatgpt_generate_image` | One job per image, spread over accounts. |
| change an image | `chatgpt_edit_image` | Works on FlowDesk images and any local file. |
| follow image progress | `chatgpt_image_jobs` | `status` + `stage` per job. |
| find an old image | `chatgpt_image_library` → `chatgpt_download_image` | Every image ever made, no chat needs opening. |
| check accounts / image quota | `chatgpt_image_accounts` | Reads quota without spending anything. |
| sign an account in | `chatgpt_open_login` | Opens a window; the user types the password. |

`ask_chatgpt` is the older name: same engine as `chatgpt_ask`, returns plain text, takes only `prompt`.
Prefer `chatgpt_ask`: it returns `chatId`, the account and saved images as data.

## Talking: `chatgpt_ask`

- `prompt` (required), `chatId` (continue that chat), `account` (email or partition), `model` (slug).
- Returns `{ ok, account, chatId, text, images? }`. Keep `chatId` if the user may follow up.
- A plain answer takes ~10-15 s. Two asks on the SAME account run one after the other;
  asks on different accounts run in parallel.
- If ChatGPT draws an image in the answer, it is saved and listed in `images` (path + `flowdesk-image://` link).
- `model`: call `chatgpt_models` first. A slug the account cannot use makes ChatGPT end the turn
  with no reply; the tool then fails in about 30 s with "model … may not be available on this
  account". Retry without `model` (ChatGPT's `auto`).

## Reading and managing chats

- `chatgpt_chats {limit, account?}`: newest first, merged across accounts, each with `account` and `partition`.
- `chatgpt_chat_read {chatId, lastN?}`: messages in order (`role`, `text`, `images` = file ids). The owning
  account is found automatically. A chat id that exists nowhere comes back as an error.
- `chatgpt_search_chats {query}`: hits with `chatId`, `title`, `snippet`.
- `chatgpt_chat_update {chatId, title?, archived?}`: verified by reading the chat back.

## Images

### Generate: `chatgpt_generate_image`
- `prompt`, `count` (1-20, each its own job and its own chat), `account` (preferred, not exclusive), `wait`.
- `wait: true` (default) holds up to ~14 min and returns `progress {total, done, running, queued, failed}`
  plus every saved image. For long batches use `wait: false` and poll `chatgpt_image_jobs` every 5-10 s.
- One image takes ~50-80 s. A Plus account may return 2 variations for one job.
- Image mode is forced in the request, so a caption-like prompt still draws. If ChatGPT still answers in
  text, the tool asks once more in the same chat ("Please create the image now.").

### Edit: `chatgpt_edit_image`
- `image` = a `flowdesk-image://` link, a saved file name, or an absolute local path; `prompt` = the change.
- An image FlowDesk made or downloaded is edited inside its own chat on its own account.
- Any other file (or when that account cannot draw) is uploaded over the API to an account with quota
  and edited in a new chat. Upload ~15 s, edit ~60-80 s.
- Write the change plainly and say what must stay ("Make the water purple. Keep everything else the same.").

### Progress: `chatgpt_image_jobs {jobId?}`
- `status`: queued → running → done | failed. `stage` while running: `opening ChatGPT`,
  `checking the image limit`, `uploading the source image`, `sending the prompt`,
  `ChatGPT is generating`, `saving N images`. `queued` stage: `waiting for a free account`.
- `retriedOn` > 0 means the job moved to another account.

### Library and download
- `chatgpt_image_library {account?, limit?, cursor?}`: every generated image with `fileId`, `conversationId`,
  `title`, size, time. Pass the returned `cursor` for the next page. Default account is the first one.
- `chatgpt_download_image {fileId, conversationId, account?}` saves it and returns a `flowdesk-image://`
  link. That link can then go straight into `chatgpt_edit_image`, and the edit happens in the original chat.

## Accounts and routing

- Accounts are the Google sessions added in FlowDesk's Accounts page. Each one signs in to ChatGPT once
  with `chatgpt_open_login {partition}` (partition from `chatgpt_image_accounts`).
- Images: the free account with the most images left takes the next job (the preferred `account` first).
  On a limit message the account is parked until its reset; on "image creation is temporarily
  unavailable" / "error on my side" it is parked 15 min. The job moves to the next account either way.
- Text: preferred account first, then the rest; a limit or sign-out moves the ask to the next account.
- `imagesLeft` is ChatGPT's own number; on Plus it was seen not to drop after use, so do not treat it as exact.
- Two Google accounts signed in to the SAME ChatGPT account share one quota. Check that the `chatgpt`
  email in `chatgpt_image_accounts` differs per account.

## When something fails

| Message | Meaning | Do |
|---|---|---|
| `no ChatGPT account could answer: … signed out` | No signed-in account | `chatgpt_open_login`, ask the user to sign in |
| `no ChatGPT account can generate right now: … limit reached, resets …` | Every account is out of images | Tell the user the reset time |
| `ChatGPT answered without an image: …` | ChatGPT refused (often content policy) | Rephrase; do not retry the same prompt |
| `ChatGPT ended the turn without an answer / image` | The turn closed empty | Retry once; without `model` if one was set |
| `chat … was not found on any account` | Wrong id | Find it with `chatgpt_chats` / `chatgpt_search_chats` |

## Not available

No delete, no memory/custom-instruction editing, no projects, no aspect-ratio option for images.
Sending a message always goes through the real ChatGPT page (its anti-bot tokens are never faked);
everything else (reading, search, library, download, upload, rename) uses ChatGPT's backend API.

## Same thing from a terminal

`flowdesk chatgpt accounts | models | chats | read <chatId> | search "<words>" | ask "<prompt>" [--chat id] [--model slug]
| image "<prompt>" [--count N] | edit <image> "<change>" | jobs | library | download <fileId> <chatId> | rename | archive | login <partition>`
