# ChatGPT backend API — findings

Every fact below was confirmed by a live probe against a real logged-in
session (`probes/cg-0*.js`, results in `probes/out/`). Nothing here is
inferred from documentation or from another project's code.

## Auth

`/api/auth/session` (same-origin, cookies) returns 200 with a JWT in
`accessToken`, plus `user.email` and an `expires` ~90 days out.

**Cookies alone are NOT enough for `/backend-api/files/*`.** Confirmed
side-by-side in one probe run (`cg-02-image-fetch.json`):

| Request | Result |
| --- | --- |
| `files/download/{id}` + `Authorization: Bearer <accessToken>` | **200** |
| `files/download/{id}`, cookies only | **401 `{"detail":"Unauthorized"}`** |

This is the whole explanation for the long-standing 401. Other
`/backend-api/*` reads (`conversations`, `conversation/{id}`) also want the
bearer token.

## Fetching a generated image (full chain, verified end to end)

1. `GET /backend-api/files/download/{fileId}?conversation_id=...&inline=false&download_intent=false`
   with the bearer token → `200 { status:"success", download_url, file_name, file_size_bytes }`.
   `fileId` is the `asset_pointer` with `sediment://` stripped.
2. `GET <download_url>` → `200 image/png`, exact byte count matching
   `file_size_bytes` (measured 2,230,748 bytes).

Step 2's URL is pre-signed (`sig=`), so it works with **cookies only** — the
token is required for step 1, not step 2.

Equivalent working variants for step 1: `files/{id}/download`, and
`files/download/{id}` with no query string at all (that one returns the
friendlier `file_name`, e.g. `Astra LX-7 Voxel Blueprint.png`).
`GET /backend-api/files/{id}` returns metadata only (`size`, `state:"ready"`).

## Shape of an image-generation turn

`GET /backend-api/conversation/{id}` shows four messages (`cg-05-msg-roles.json`):

| # | role | recipient | channel | content_type | what it is |
| --- | --- | --- | --- | --- | --- |
| 1 | user | all | — | text | the prompt |
| 2 | assistant | `t2uay3k.sj1i4kz` | commentary | **code** | the call to the image tool |
| 3 | tool | all | commentary | multimodal_text | **the image** (`image_asset_pointer`) |
| 4 | assistant | all | final | text | the closing reply |

Message 2 is the one that used to be mistaken for the answer. Its arguments
stream to `/message/content/text`; real answer text streams to
`/message/content/parts/N`. `extractTextFromSSEEvent` now tracks the current
patch path (`ChatGPTTextState`) and only collects `/parts/`, which also
handles continuation ops (`{v:"..."}` with no `p`) that inherit the previous
path across network chunk boundaries.

Message 3's author role is `tool`, not `assistant` — which is why the
assistant-only text collector found nothing at all for these turns.

## Stream lifecycle (the timeout bug)

An image turn's SSE stream frequently delivers the image and then **goes
quiet without ever sending `done`** — only `: ping` keep-alives, or nothing.
`emitCaptureComplete` therefore never fires for that turn.

Measured gaps between genuinely finished image events on one conversation:
**130–220s**. A run at `IDLE_TIMEOUT_MS = 60_000` still failed with
"went idle for 60s, 131s after the prompt was sent".

Current handling (`electron/agent/browserWorkerQueue.ts`):
- `IDLE_TIMEOUT_MS` 120s, reset on every `capture:live` tick.
- `HARD_CEILING_MS` 360s, never reset.
- **Either timer settling resolves with the text collected so far** when
  there is any. Rejecting there was discarding a 2.2MB PNG that had already
  been fetched and written to disk.

## MCP tool timeout

The SDK caps one MCP tool call at 90s by default, below the time an image
turn actually needs. A real agent run failed with
`MCP server "workers" tool "ask_chatgpt" timed out after 90s` while ChatGPT
had produced the image both times — the probe path
(`debugAskBrowserProviderDirect`) never hit this because it bypasses MCP.
`leadAgent.ts` now passes `MCP_TOOL_TIMEOUT` at 400s, deliberately above
browserWorkerQueue's 360s ceiling so that queue stays the component that
decides to give up, and still returns the partial text holding the image
link.

## Seeing the image

`view_saved_image` (electron/agent/imageTools.ts) reads a saved
`flowdesk-image://` file and attaches the real bytes as an MCP image block.
Before it, the agent described generated images from the prompt it had sent,
having never seen the result.

## Still open

- Only the `chatgpt.com` image path has been mapped. Gemini/Grok/Perplexity
  image turns have not been captured and may differ.
- The tool name `t2uay3k.sj1i4kz` looks like a per-deployment identifier.
  Nothing depends on it — the filter keys off the patch path, not this name —
  but do not start matching on it without re-capturing first.
