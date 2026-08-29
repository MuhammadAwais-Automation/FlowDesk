# ChatGPT backend API — findings

Every fact below was confirmed by a probe run inside a real logged-in
chatgpt.com page (`probes/cg-0*.js`), not inferred from the SSE shape.

## Auth

`GET /api/auth/session` (cookies) -> 200
```json
{ "user": { "email": "..." }, "accessToken": "eyJhbGciOiJSUzI1NiIs...", "expires": "..." }
```

The `accessToken` is a JWT and is **required** for `/backend-api/*`.
Cookies alone are NOT enough — this is the whole 401 story:

| request | auth | result |
|---|---|---|
| `/backend-api/files/download/{id}` | cookies only | **401 `{"detail":"Unauthorized"}`** |
| `/backend-api/files/download/{id}` | `Authorization: Bearer <accessToken>` | **200** |

## Reading conversations

- `GET /backend-api/conversations?offset=0&limit=N&order=updated` -> `{ items: [{id, title, ...}] }`
- `GET /backend-api/conversation/{id}` -> full message mapping, including
  `sediment://file_...` asset pointers.

## Images: pointer -> bytes (the full confirmed chain)

1. The SSE turn carries `asset_pointer: "sediment://file_XXXX"` on a message
   whose `author.role` is **`tool`**, not `assistant` (see chatgptParser.ts).
2. `GET /backend-api/files/download/{fileId}` **with the bearer token**
   -> 200 `{ status:"success", download_url:"https://chatgpt.com/backend-api/estuary/content?id=...&sig=...", file_name, file_size_bytes }`
   - the `conversation_id` query param is optional; omitting it returns the
     nicer human filename instead of the internal storage path.
3. `GET <download_url>` -> 200 `image/png`, real bytes.
   Confirmed working with cookies alone **and** with the token — the estuary
   URL is signed, so it does not need the bearer.

Equivalent alternatives that also return 200 (all need the bearer):
`/backend-api/files/{id}/download`, and `/backend-api/files/{id}` for
metadata only (`size`, `state`, `name`).

## The real timeout bug (NOT an auth problem)

Cross-checked three ways: the SSE dump captured the image events, the queue
still reported "did not respond", and the fetched PNGs were nonetheless
present on disk in `userData/generated-images` with timestamps *inside* the
failed runs.

So the download always worked. What failed: **ChatGPT never closes the
stream for an image-generation turn** — after delivering the image it sends
neither `done` nor an error, only keep-alive pings and then silence. Since
`emitCaptureComplete` only fires on `done`/`error`, the waiter sat until its
idle deadline and then *rejected*, discarding an image that had already
succeeded.

Fix: `settleIdle` in `electron/agent/browserWorkerQueue.ts` — an idle stream
that already produced content resolves with that content instead of
rejecting. Pinned by `browserWorkerQueue.test.ts`.
