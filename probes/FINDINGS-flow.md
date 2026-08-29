# Google Flow — findings

Discovery followed `capture-before-build`, same as every other provider in
this project. Recorded via the same CDP-based recorder used for LinkedIn/
Facebook (`electron/discovery/cdpRecorder.ts`), plus the page's own
`performance.getEntriesByType('resource')` once the recorder's own gap
(below) was found.

A third-party open-source project, `google-flow-kit` (MIT licensed), already
reverse-engineers this same API via a Chrome extension + Python backend. Its
approach was used as a starting hypothesis for where to look, never trusted
outright — every fact below was independently confirmed against a real, live
session before this project's own code relied on it.

## A recorder bug had to be found before Flow's own bug could be

The CDP recorder's `urlMatch` was a single string checked against the tab's
own host (`labs.google`). Google Flow's real generation calls go to a
completely different host, `aisandbox-pa.googleapis.com` — so the recorder
silently dropped every one of them. A full session (273 seconds, 96 other
calls captured fine, including cross-origin analytics beacons) showed ZERO
calls to that host — indistinguishable from "the app doesn't call it" until
the page's own `performance.getEntriesByType('resource')` was checked
directly and showed 28+ real calls there in the same session, including
`flowMedia:batchGenerateImages` itself.

Two dead-end hypotheses were tried and ruled out before finding the real
cause:
- **Service worker theory** — `navigator.serviceWorker.getRegistrations()`
  came back empty. No service worker exists on this origin at all.
- **CDP worker-attach gap theory** — added an explicit `filter` to
  `Target.setAutoAttach` (service_worker/shared_worker/worker/iframe) and
  explicit `Target.getTargets` + `Target.attachToTarget` for any pre-existing
  service worker target. Real, defensible fix for a real class of gap — but
  not the actual cause here, since no such worker exists. Kept anyway: it is
  correct hardening for whichever future platform DOES do this.

The actual cause, found by checking the Resource Timing entry's
`initiatorType` for one `aisandbox-pa.googleapis.com` call: `"fetch"` — an
ordinary same-frame fetch. CDP should have seen it. The real bug was simply
that `urlMatch` never included that host at all.

**Fix:** `CdpRecorderOptions.urlMatch` now accepts `string | string[]`; every
check point in the recorder ORs across the list instead of checking one
string. `sessions.ts` gained a `CDP_RECORDER_EXTRA_HOSTS` map so a host whose
real API lives elsewhere (`labs.google` → also watch
`aisandbox-pa.googleapis.com`) can declare it. Verified live: after the fix,
the very next session captured all 31 real `aisandbox-pa.googleapis.com`
calls, including a real `flowMedia:batchGenerateImages` returning 200 with
real image data.

## The wire format, once actually visible

### Auth: no token capture needed

```
GET /fx/api/auth/session   (same-origin, cookies only)
-> 200 { user: {...}, expires: "...", access_token: "ya29...." }
```

A NextAuth session endpoint that happens to carry the Google OAuth token
Flow's own client uses for its API calls. Confirmed live: this is a plain,
unauthenticated-beyond-cookies GET any page script can make, unlike the
third-party kit's approach of intercepting the header off an outgoing
request via a Chrome extension.

### reCAPTCHA: execute the page's own already-loaded widget

The captured request body carries a large `clientContext.recaptchaContext.
token`. Rather than solving or bypassing anything, the fix is to call the
SAME function the real page calls:

```js
grecaptcha.enterprise.execute(SITE_KEY, { action: 'IMAGE_GENERATION' })
```

Confirmed live in two ways: `window.grecaptcha.enterprise.execute` exists on
the page (checked directly), and the site key
(`6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV`) was read off the page's own
`<script src="https://www.google.com/recaptcha/enterprise.js?render=...">`
tag — independently matching the third-party kit's value, not copied from it.

### Generation

```
POST https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages
Authorization: Bearer <access_token>
Content-Type: text/plain;charset=UTF-8

{
  "clientContext": { "recaptchaContext": {"token", "applicationType":"RECAPTCHA_APPLICATION_TYPE_WEB"},
                      "projectId", "tool":"PINHOLE", "sessionId": ";<ms>" },
  "mediaGenerationContext": { "batchId": "<uuid>" },
  "useNewMedia": true,
  "requests": [{
    "clientContext": { ...same shape... },
    "imageModelName": "GEM_PIX_2",
    "imageAspectRatio": "IMAGE_ASPECT_RATIO_LANDSCAPE",
    "structuredPrompt": { "parts": [{ "text": "<prompt>" }] },
    "seed": <int>,
    "imageInputs": []
  }]
}
-> 200 { "media": [{ "name": "<mediaId>", "workflowId", "image": {"generatedImage": {...}} }] }
```

The recaptcha token appears at BOTH the outer and the per-request
`clientContext` in the real captured body. Both are sent by this project's
`generateImageScript` — dropping either would be exactly the "hand-picked
subset" mistake the Facebook comment mutation already made and documented in
`FINDINGS-facebook.md`.

`imageModelName: "GEM_PIX_2"` is what THIS build actually sent — different
from the reference kit's `NANO_BANANA_PRO` constant, which is either a
different alias for the same model or has since changed. Used the value this
project's own live capture actually showed, not the kit's.

The generate response does not carry a directly-viewable URL — only a
`mediaId`. The real client fetches the image separately via:

```
GET /fx/api/trpc/media.getMediaUrlRedirect?name=<mediaId>&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL
-> 302 redirect to the actual image bytes (confirmed: mimeType image/jpeg)
```

`generateImageScript` returns this constructed URL as `viewUrl` rather than
fetching the bytes itself.

## Verified live (done)

User approved a live test, aware of the account-risk above. Generated a real
image in the same existing Flow project via the SHIPPED
`generateImageScript` code path (mirrored exactly, since a probe cannot
import the TS module directly) — HTTP 200, a real `mediaId`
(`4c8e8cc4-534f-4765-8106-ff359b77b114`) returned, no errors.
`generateImageScript`, `flowGenerateImage`, and `studio_flow_generate_image`
are done for single-image generation into an existing project.

## Agent can actually SEE generated images (done)

Until now, `studio_flow_generate_image` only returned a `mediaId` and a
`viewUrl` string in text — the agent never saw the actual picture, only its
id. Per explicit request (an earlier ChatGPT-image test showed the same gap
elsewhere: an image was generated but the agent never got to look at it),
`studio_flow_generate_image` and a new `studio_flow_view_image` tool now
fetch the real image bytes (reusing `flowDownloadImage`'s already-confirmed
cookie-forwarded fetch, refactored into a shared `fetchMediaBytes` in
`flow.ts`) and attach them as an MCP image content block
(`{ type: 'image', data: <base64>, mimeType }`) alongside the text result —
the agent genuinely sees the picture now, the same way it would see an
image the user pasted into chat. Best-effort: if the image fetch fails, the
text result still returns rather than failing the whole tool call.

## Credits — video only, no image quota anywhere (done)

`GET /v1/credits?key=...` returns `{ credits, userPaygateTier, sku,
serviceTier, subscriptionCredits }` — confirmed across ~30 real captures as
the balance dropped 55→45→35→25→15 with each video generated (10 credits
each, matching the UI's own quoted cost). This is **video credits only**.

Checked every response captured across this entire investigation for any
image-generation quota/daily-limit field — none exists anywhere. Google
Flow's image daily limit (mentioned by the user; images are not charged
against this credit balance) is enforced silently server-side with no
queryable remaining-count. The only way to learn its shape would be to
actually hit it and capture the resulting error, which has not happened
yet — deliberately not pursued now to avoid spending real generation slots
just to find it; will be captured opportunistically if it comes up during
normal use. `getCreditsScript`/`flowGetCredits`/`studio_flow_get_credits`
ship for the video-credit balance; there is no equivalent for images.

## Full aspect ratio and image model control (done)

All 5 aspect ratio buttons Flow's own UI offers (16:9, 4:3, 1:1, 3:4, 9:16)
were generated one at a time and their real enum strings read off each
captured request — `_FOUR_THREE`/`_THREE_FOUR` were not derivable from the
first three values alone:

| UI | enum |
|---|---|
| 16:9 | `IMAGE_ASPECT_RATIO_LANDSCAPE` |
| 4:3 | `IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE` |
| 1:1 | `IMAGE_ASPECT_RATIO_SQUARE` |
| 3:4 | `IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR` |
| 9:16 | `IMAGE_ASPECT_RATIO_PORTRAIT` |

The UI also offers 3 image models (screenshot: Nano Banana Pro, Nano Banana
2, Nano Banana 2 Lite). Only `GEM_PIX_2` (Nano Banana Pro) has been
generated live. `NARWHAL` (Nano Banana 2) is the reference kit's value,
matching this build's own naming convention closely enough to offer, but
not independently captured. Nano Banana 2 Lite's real key is unknown and
is deliberately NOT offered as a selectable option — offering a guessed
model key would silently generate with the wrong model if wrong, exactly
the "field that lies" class of bug this project's catalogue warns about.

## Video: two models, two modes (done)

Extended after the user tried Omni Flash (a second video model, not named
anywhere in the reference kit) and "Frames" mode (a single start image,
distinct from "Ingredients"/reference images):

| model | mode | key | how confirmed |
|---|---|---|---|
| Veo 3.1 Lite | INGREDIENTS | `veo_3_1_r2v_lite` | 2 live generations |
| Omni Flash | INGREDIENTS | `abra_r2v_6s` | 1 live generation |
| Omni Flash | FRAMES | `abra_i2v_6s` | 1 live generation |
| Omni Flash | FRAMES + end frame | — | **confirmed unsupported** |
| Veo 3.1 Lite | FRAMES | — | not captured |

The unsupported case is the most useful negative result: the user tried
giving Omni Flash BOTH a start and an end frame, and Google's own API
rejected it outright — `"Unknown name \"endImage\" at 'requests[0]':
Cannot find field."` This isn't a guess or an inference; the server said so
directly. So `generateVideoScript` never offers an `endImageMediaId` on any
model — not because it definitely doesn't exist for Veo 3.1 Lite too, but
because that hasn't been tried, and the one data point available says "don't
assume this exists for a model just because the UI shows a slot for it."

Interestingly, `abra_r2v_6s` — the reference kit's guessed value for Tier
ONE's `reference_frame_2_video`, which turned out WRONG for Veo 3.1 Lite
earlier in this document — turned out to be RIGHT after all, just for a
different model (Omni Flash) than the kit's table implied. The kit's data
wasn't fabricated, it was just organized around a different axis (tier)
than what actually determines the key (which specific model was picked in
the UI).

The FRAMES-mode request also carried a `cropCoordinates` object on
`startImage` (the UI's own crop rectangle) in the real capture — not
included in `generateVideoScript`, since whether it's required or just a
UI nicety hasn't been tested by omission, and this project's own rule is
not to add a field never confirmed necessary.

Omni Flash's key bakes its duration into the string itself (`abra_..._6s`).
The user selected 6 seconds specifically; 4s/8s/10s variants almost
certainly exist as sibling keys but none has been captured, so only 6s is
offered.

`generateVideoScript`/`flowGenerateVideo`/`studio_flow_generate_video` now
take explicit `mode` (`INGREDIENTS`/`FRAMES`) and `model`
(`VEO_3_1_LITE`/`OMNI_FLASH`) parameters; requesting an uncaptured
combination (currently only Veo 3.1 Lite + FRAMES) returns a clear refusal
rather than guessing a key. Live-tested only for the original
Veo 3.1 Lite + INGREDIENTS combination (see below); Omni Flash and FRAMES
mode are unit-tested against their real captured shapes but not yet
separately live-tested through the shipped code path.

## Video generation — corrected after real capture (done)

Built first from the reference kit's guessed shape (start-image i2v,
`abra_r2v_6s` model key for Tier ONE), per explicit instruction to extract
from the kit while the user tested more Flow features live. The user then
generated a real video by hand (Veo 3.1 Lite, Portrait, from one reference
image, "Ingredients" mode) and the real capture showed the kit's guess was
wrong in three ways:

1. **Wrong endpoint.** The real request went to
   `/v1/video:batchAsyncGenerateVideoReferenceImages` — the reference-images
   ("Ingredients") flow, not `batchAsyncGenerateVideoStartImage` (the
   start-frame "Frames" flow, a genuinely different UI mode, not captured).
2. **Wrong model key.** The real request used `veo_3_1_r2v_lite`, not the
   kit's `abra_r2v_6s`, for the exact same tier and generation type — direct
   proof the kit's model table is stale for at least this combination.
3. **Wrong response shape read.** The real response is
   `{ workflows: [{ name, metadata: { primaryMediaId, ... } }] }` —
   `primaryMediaId` is the id to poll, not `workflows[].name`.

`generateVideoScript` was rewritten to match the real capture exactly, and
only offers the one verified combination (Portrait, Veo 3.1 Lite, reference
images) rather than extrapolating to Landscape or other tiers. A second real
capture — polling `/v1/video:batchCheckAsyncVideoGenerationStatus` for the
completed video — gave the real status field
(`mediaMetadata.mediaStatus.mediaGenerationStatus`,
`"MEDIA_GENERATION_STATUS_SUCCESSFUL"` when done), which
`getVideoStatusScript` reads.

User approved a live test of the SHIPPED code path. Submitted a real video
via `generateVideoScript`'s logic — HTTP 200, real `mediaId`
(`1c079c6a-c3aa-4eba-952a-46a6569bd187`), `remainingCredits` dropped 45→35
(10 credits, matching the UI's own quoted cost). Polled it via
`getVideoStatusScript`'s logic ~1 minute later — `status:
"MEDIA_GENERATION_STATUS_SUCCESSFUL"`, `done: true`. `generateVideoScript`,
`getVideoStatusScript`, `flowGenerateVideo`, `flowGetVideoStatus`,
`studio_flow_generate_video`, `studio_flow_get_video_status` are done.

## Upload (done) and download — corrected after real testing

`uploadImageScript` (`/v1/flow/uploadImage`) was tried against a live
session and worked as the reference kit describes: uploaded a small test
image, got a real `mediaId` back, HTTP 200. `studio_flow_upload_image` is
done.

**Download needed a real fix, not just a spot-check.** `getMediaScript`, the
reference kit's `/v1/media/{id}` REST call (using the real confirmed API key
`AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY` seen in the live-captured
`GET /v1/credits?key=...` call), returned **HTTP 400 INVALID_ARGUMENT** on a
real test — tried with and without the `clientContext.tool` param, and with
`projectId` substituted for it; all three failed identically. The kit's
shape was wrong for this build, the same lesson video generation already
taught. `getMediaScript` was removed rather than shipped broken.

The fix: reuse `media.getMediaUrlRedirect`, the SAME tRPC endpoint image
generation's `viewUrl` already relies on — confirmed live against a
freshly uploaded image (loaded correctly via an `<img>` element, real 64×64
pixel dimensions came back, matching the uploaded file).

A second wrinkle: calling that URL with `fetch()` from inside the page
failed with a plain "Failed to fetch" — CORS blocks a page-context fetch
from reading a response once it redirects to a different origin CDN, even
though an `<img>` tag loads the exact same URL fine (images aren't
CORS-checked the way fetch is). The fix moves the actual download OUT of
the page: `flowDownloadImage` now runs entirely in Electron's main process,
reads the real session cookies via `view.webContents.session.cookies.get()`,
and calls Node's own `fetch()` with those cookies attached manually — CORS
is a browser-JS restriction with no meaning in Node, so this bypasses it
entirely rather than working around it.

`studio_flow_download_image` is shipped and its core mechanism (the
redirect URL, the cookie-based auth) is confirmed live in the browser test
above. The Node-side code path itself (`flowDownloadImage`'s
`session.cookies.get()` + `fetch()` + file write) has NOT been separately
run end-to-end yet — that needs the full running app and an actual agent
tool call, not a page-context probe.

## Creating a new project (done)

Captured from a real "New project" click:

```
POST /fx/api/trpc/project.createProject
{"json":{"projectTitle":"Aug 25, 06:43 PM","toolName":"PINHOLE"}}
-> 200 {"result":{"data":{"json":{"result":{"projectId":"...", "projectInfo":{...}},"status":200,"statusText":"OK"}}}}
```

Confirmed identical in shape to the reference kit's guess, but not trusted
on that basis alone — checked directly against this build's own capture,
same as everything else in this document. Plain same-origin tRPC POST, no
recaptcha or aisandbox-pa.googleapis.com involved. User approved a live test of the shipped code path: created a real project
("FlowDesk test project") via the SHIPPED logic — HTTP 200, a real
`projectId` (`06d25c6f-6c90-4e0b-baf9-1dba7ae2e427`) returned, no errors.
`createProjectScript`, `flowCreateProject`, `studio_flow_create_project` are
done.

## Not yet built

- **Upscaling.** Not attempted at all — the kit documents an endpoint for
  it (`batchAsyncGenerateVideoUpsampleVideo`) but nothing here uses it yet.
- **Downloading the finished video's actual bytes.** `getVideoStatusScript`
  confirms completion and returns the raw media metadata, but no script yet
  turns that into a downloadable video file the way `flowDownloadImage`
  does for images — the video media response's URL field has not been
  checked.
- **Landscape video, or any tier other than PAYGATE_TIER_ONE.** Only one
  exact combination was captured. Different tiers/aspect ratios likely use
  different `videoModelKey` values, following the same lesson this
  combination already taught: the kit's table cannot be trusted without a
  matching live capture.
- **Project rename.** Neither this project's own capture nor the reference
  kit has a rename-after-creation call — `project.createProject` is the
  only project-naming operation found. "Give the project a proper name" is
  handled by passing a real title to `flowCreateProject`, not by a separate
  rename step.

## The account-risk, stated plainly

This calls an internal API Google does not publish for third-party use —
confirmed by web research: Google Flow has no official API at all. Every
call here spends the user's real Flow subscription credits on their real
Google account, with a real chance Google could flag or restrict that
account for it. This bridge does not randomize headers or spoof a different
client identity — its requests are honestly what FlowDesk's own Electron/
Chromium build sends — but the underlying fact remains that this is not how
Google intends Flow to be automated. `studio_flow_generate_image` requires
approval on every call, and the approval dialog states the account-risk
explicitly rather than presenting this as an ordinary write action.
