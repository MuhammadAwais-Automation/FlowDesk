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

## Chat management and library (probes cg-20, cg-21, cg-22; live 2026-10-04)

All with `Authorization: Bearer <accessToken>` from `/api/auth/session`.

| call | result |
|---|---|
| `GET /backend-api/my/recent/image_gen?limit=N[&after=<cursor>]` | 200 `{ items, cursor }`. Every generated image across ALL chats, newest first: `asset_pointer` (`sediment://file_…`), `conversation_id`, `message_id`, `title`, `width`, `height`, `created_at` (epoch s), `is_archived`. `after=<cursor>` returns the next page (distinct ids, verified). |
| `GET /backend-api/conversations/search?query=Q&limit=N` | 200 `{ items, cursor }`. Item: `conversation_id`, `title`, `update_time` (epoch s), `payload.snippet`. The snippet can be a whole pasted document (14k chars seen): cut it. |
| `PATCH /backend-api/conversation/{id}` `{title}` or `{is_archived}` | 200 `{success:true}`; a fresh `GET` shows the change. Verified rename, archive, unarchive. |
| `GET /backend-api/memories?include_memory_entries=true` | 200 `{ memories[], memory_max_tokens, memory_num_tokens }` |
| `GET /backend-api/user_system_messages` | 200 custom instructions (about_user_message, about_model_message, traits…) |
| `GET /backend-api/gizmos/snorlax/sidebar?limit=N` | 200 projects `{ items[{gizmo,tools,files,…}], cursor }` |
| `GET /backend-api/tasks` | 200 `{ tasks[] }` (scheduled tasks, 14 on the test account) |
| `GET /backend-api/shared_conversations?order=created` | 200 shared links |
| `GET /backend-api/conversations?…&is_archived=true` / `&is_starred=true` | 200 `{ items, total, limit, offset }` |
| `/backend-api/images/library`, `/files`, `/aip/connectors/list_accessible`, `/experimental/prompt_suggestions` | 404 / 403: not usable |

Not captured yet: a text-limit refusal, and the image-size / style options the composer sends.
