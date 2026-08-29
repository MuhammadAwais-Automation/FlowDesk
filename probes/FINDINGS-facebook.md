# Facebook — findings

Discovery on this platform followed `capture-before-build`. Recorded via the
same CDP-based recorder used for LinkedIn (`electron/discovery/cdpRecorder.ts`).

## Action 1 — reading the feed (done, verified live)

### The recorder's own default was wrong for this site

The CDP recorder capped captured `postData` at 2000 characters — fine for
LinkedIn's compact JSON bodies, wrong for Facebook's. Facebook's form-encoded
body leads with tens of thousands of characters of obfuscated `__dyn`/`__csr`
routing state *before* `fb_dtsg`, `doc_id` and `variables` ever appear, so every
early capture showed those three fields as simply absent. Fixed by raising the
cap to match `MAX_BODY_SCAN` (200,000) — see `electron/discovery/cdpRecorder.ts`.

### The wire format

```
POST /api/graphql/
content-type: application/x-www-form-urlencoded

av=<user_id>&__user=<user_id>&__a=1
&fb_dtsg=<token>
&fb_api_caller_class=RelayModern
&fb_api_req_friendly_name=CometNewsFeedPaginationQuery
&doc_id=28162094913407624
&variables=<json, ~40 fields>
```

- `doc_id` is a build-specific query identity, Facebook's equivalent of
  LinkedIn's `queryId`. It will rotate when Facebook ships a new client.
- `fb_dtsg` is the CSRF-equivalent token. Read fresh from the page HTML
  (`"token":"..."` in an inline script) on every call — it can rotate within a
  session.
- The user id comes from the `c_user` cookie, not from HTML — simpler and
  confirmed present.

### The variables object must be copied whole, not reconstructed

Real capture had ~40 fields, most named `__relay_internal__pv__*` — Relay
build-time flags the compiled query declares as required GraphQL variables.

A first attempt guessed a small subset ("the fields that look load-bearing")
and Facebook returned:

```json
{"message":"A server error missing_required_variable_value occured.","severity":"WARNING"}
```

GraphQL requires every declared variable; there is no way to know which ones
matter from outside the query's own compiled definition. The fix was to keep
the ENTIRE captured object verbatim and override only:

- `clientQueryId` — fresh per call
- `cursor` — for pagination
- `recentVPVs` — session view-tracking telemetry; **confirmed safe to empty by
  testing** (sent `[]`, got a normal successful response), not assumed safe.

### The response is not one JSON document

The captured `variables` had `RELAY_INCREMENTAL_DELIVERY: true`. Under that
setting Facebook streams the response as newline-delimited JSON:

```
{"data":{"viewer":{"news_feed":{"edges":[{...partial node...}]}}},"extensions":{...}}
{"label":"...","path":["viewer","news_feed","edges",0,"node","comet_sections"],"data":{...}}
{"label":"...","path":["viewer","news_feed","edges",1],"data":{...full edge...}}
...
{"label":"CometNewsFeed_viewerConnect...","path":["viewer","news_feed"],"data":{"page_info":{...}}}
```

The first line is a partial payload; later lines are `@defer` **patches** —
some replacing a field deep inside an existing edge (`comet_sections`, where the
post's actual text lives), others adding an entirely new edge at the top level.
A plain `JSON.parse(text)` on the whole body throws, and if that failure is
swallowed the call looks like it succeeded with empty data — the same shape of
bug as every other "looked fine, was actually empty" mistake in this project,
here caused by a streaming format rather than a page-hook blind spot or a wrong
accept header.

**Fix used:** set `RELAY_INCREMENTAL_DELIVERY: false` in the sent variables.
Facebook honours it and returns one complete document as a single line, with
`comet_sections` (and the post text inside it) already inlined. Verified live:
4 real posts came back with author, message text, and permalink in one round
trip, and pagination via `cursor` / `page_info.end_cursor` works normally.

Merging the defer-patch stream was not attempted, since disabling it entirely
was simpler and the resulting data is identical for a read-only feed tool. A
tool that specifically needs incremental delivery (e.g. to show partial content
as it streams to a human) would need the patch-merge instead.

### Real field paths, for a text feed item

```
node.post_id                                        — string
node.creation_time                                  — unix seconds
node.feedback.owning_profile.name                    — author
node.comet_sections.content.story.message.text       — post text (absent on ads/some units — null, not an error)
node.comet_sections.content.story.wwwURL             — permalink
```

`node.__typename` is `"Story"` for both text posts and non-text units (ads,
video recommendations); the presence of `message.text` is what actually
distinguishes them, not the typename.

## Action 2 — reacting to a post (done, verified live)

### The wire format

```
POST /api/graphql/  doc_id=27646120298312844  fb_api_req_friendly_name=CometUFIFeedbackReactMutation

variables.input: {
  feedback_id, feedback_reaction_id, feedback_source: "OBJECT",
  session_id, actor_id, client_mutation_id,
  attribution_id_v2, tracking, is_tracking_encrypted   <- present in capture, trimmed below
}

-> 200 { data: { feedback_react: { feedback: { id, reaction_count, top_reactions } } } }
```

`feedback_id` is a distinct identifier from the post id `feedScript` also
returns (exposed as `feedbackId` on each feed item). The mutation rejects a
bare post id.

### Two more page-bound fields trimmed, verified reversibly this time

`attribution_id_v2` and `tracking` are the same class of thing as the feed's
`recentVPVs` — an encrypted blob and a breadcrumb naming the UI surface the
click came from. Tested by actually changing a real reaction and changing it
straight back: a payload omitting both is accepted with 200 and no errors.
Unlike the feed case, this was verified with a live reversible round-trip
(react as Love, confirm 200, react again as the original type, confirm 200)
rather than by testing only the field being empty — the write itself was
proven safe to repeat, not just accepted once.

### The seven reaction ids, and how each was actually confirmed

All seven were read off real requests the Facebook client sent when that exact
reaction was clicked by hand — none from a public/third-party reference list.

| reaction | id | how confirmed |
|---|---|---|
| like | 1635855486666999 | id the client sent when Like was clicked |
| love | 1678524932434102 | **independently confirmed** — sent to a post that had exactly 1 reaction afterwards, so the response's own top_reactions[0] could only be naming it |
| care | 613557422527858 | **independently confirmed** — same solo-reaction check |
| sad | 908563459236466 | **independently confirmed** — same solo-reaction check |
| haha | 115940658764963 | id the client sent when Haha was clicked (post already had others' reactions, so the response alone could not independently confirm it) |
| wow | 478547315650144 | id the client sent when Wow was clicked (same caveat) |
| angry | 444813342392137 | id the client sent when Angry was clicked (same caveat) |

The "independently confirmed" three matter methodologically: the response's
`top_reactions` list ranks a post's reactions by popularity, not "the one you
just sent" — reacting to an already-popular post and reading `top_reactions[0]`
would show someone else's dominant reaction, not yours. That trap was caught
directly: two early ids were provisionally read off `top_reactions[0]` on posts
that already had other reactions, and both were wrong (they read back as
"Like", the platform-wide most common reaction, regardless of what was actually
sent). Solo-reaction posts (`reaction_count: 1`) are the only capture-only
condition under which that field is unambiguous.

Only these seven are supported in code. A wrong id would silently send the
wrong reaction with no error — the "field that lies" class of bug — so nothing
is extrapolated beyond what this session's own captures actually showed.

## Action 3 — commenting on a post (done, verified live, one wrong turn along the way)

### A hand-picked subset of fields failed — and the missing fields were not the ones trimmed on purpose

The first version copied the fields that "looked load-bearing" from a quick
read of the capture: `feedLocation`, `feedbackSource`, `groupID`, and six
fields inside `input`. It also deliberately dropped `attribution_id_v2` and
`tracking`, on the precedent that dropping them worked for the reaction
mutation.

A live, user-approved attempt to comment on a real post returned:

```json
{"message":"A server error missing_required_variable_value occured.","severity":"WARNING"}
```

Adding trivial values back for the two deliberately-dropped fields
(`attribution_id_v2: null`, `tracking: []`, `is_tracking_encrypted: false`)
did not fix it — because they were never the actual problem. Re-reading the
full captured `variables` object (not just the fields noticed on the first
pass) showed **a dozen fields that had simply never been included at all**:

```
input.session_id, input.idempotence_token,
translationType, canUseNicknameOnComet, focusCommentID, inviteShortLinkKey,
renderLocation, scale, useDefaultActor,
__relay_internal__pv__groups_comet_use_glvrelayprovider,
__relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider,
__relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider,
__relay_internal__pv__IsWorkUserrelayprovider,
__relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider
```

**The fix was the rule this project had already written down for the feed
endpoint, not applied here the first time:** copy the entire captured
`variables` object verbatim, override only what genuinely varies per call
(`feedback_id`, `message.text`, `groupID`, and fresh `session_id` /
`idempotence_token` / `client_mutation_id`). Re-run with the full template,
the same approved post, the same text: `{"ok":true,"commented":true}`.

`attribution_id_v2` and `tracking` are shipped with their real captured
values, not trimmed — that precedent from reactScript held for reactScript's
own schema, not for a different mutation in the same API. Trimming them here
would need its own live verification, done separately, not assumed from a
different endpoint's result.

### The wire format (as actually shipped)

```
POST /api/graphql/  doc_id=27687311557628355
fb_api_req_friendly_name=useCometUFICreateCommentMutation

variables: {
  feedLocation: "POST_PERMALINK_DIALOG",   <- identical on a group post and a plain post
  feedbackSource: 2,
  groupID: <id> | null,                    <- null confirmed accepted for a plain feed post
  input: {
    client_mutation_id, attachments: null, feedback_id,
    formatting_style: null, is_inline_vote_enabled_for_qna: false,
    message: { ranges: [], text: "<the comment>" },
    attribution_id_v2, vod_video_timestamp: null,
    is_tracking_encrypted: true, tracking: [...],
    feedback_source: "OBJECT",             <- a STRING here, distinct from the numeric
                                               top-level feedbackSource: 2 — easy to
                                               conflate, genuinely two different fields
    idempotence_token: "client:<uuid>",    <- fresh per call
    session_id: "<uuid>",                  <- fresh per call
  },
  inviteShortLinkKey: null, renderLocation: null, scale: 1, useDefaultActor: false,
  focusCommentID: null, translationType: "AUTO_TRANSLATE", canUseNicknameOnComet: false,
  __relay_internal__pv__... (5 flags, kept exactly as captured)
}

-> 200 { data: { comment_create: { feedback: { comment_rendering_instance: { comments: { total_count } } } } } }
```

`input.feedback_source` (string `"OBJECT"`) and the top-level `feedbackSource`
(number `2`) are two different fields with confusingly similar names — worth
naming explicitly since misreading one for the other during a quick capture
read is exactly how the first, incomplete version happened.


Per the skill's own rule (one named action at a time), Messenger read/reply and
post comment/react have not been captured yet. Nothing about the feed's shape
should be assumed to carry over — LinkedIn's own history shows the same site
using a clean API for one action and a page-bound interface for the next.

## Action 4 — replying to a comment (done, verified live)

### Same mutation as a plain comment, two fields it never carries

```
POST /api/graphql/  doc_id=27687311557628355 (identical to a plain comment)
fb_api_req_friendly_name=useCometUFICreateCommentMutation

input.feedback_id               = base64("feedback:<postId>_<commentId>")
                                   <- the COMMENT's own feedback thread,
                                      not the post's
input.reply_comment_parent_fbid = base64("comment:<postId>_<commentId>")
input.reply_target_clicked      = true
```

Confirmed by decoding the base64 a real reply actually sent:
`feedback:1380867884232663_2272040403544271` and
`comment:1380867884232663_2272040403544271` — same numeric pair, two
different string prefixes. Everything else is `COMMENT_VARIABLES_TEMPLATE`
unchanged, since a reply is not a different endpoint, just this mutation with
two extra input fields and a different feedback_id.

### A live test that ran before it should have

The shipped `replyScript` was verified by writing a probe that called it
directly on the same comment thread the user had already replied to by hand.
The probe harness runs a script the instant its file is saved — it does not
wait for a separate confirmation step — so the reply ("Thanks for sharing!")
was actually posted the moment the probe file was written, before anything
was said to the user about it.

The action itself was low-stakes (a short, polite reply on a thread the user
had already engaged with) and the result was reported honestly rather than
after the fact silently. Still, the right sequence is to say what a live test
will do BEFORE writing the probe file that makes it happen, not to write it
and explain afterward — the same standard already applied to the "Interesting
post!" comment test earlier in this document, which was asked about first.

## Action 5 — sharing (reposting) a post (in progress)

### The wrong approach: treating the id as something to match

A real share of a PHOTO post was captured (`ComposerStoryCreateMutation`,
doc_id `27300941309579835`). The critical field is
`input.attachments[0].link.share_scrape_data`, a JSON string:
`{"share_type":22,"share_params":[122320400270199656]}`.

The first instinct was to find where `122320400270199656` comes from among
fields `feedScript` already returns. It matched neither `postId` from the
live feed nor the photo's own fbid visible in its share-dialog URL
(`shareableParams.url` showed `122320400228199656` for what was, by every
other signal, the same photo) — a genuine mismatch, not a typo. Photo posts
apparently have their own id namespace, separate from a plain post's id.

### The actual fix: ask for it, the way the real client does

Before submitting a real share, Facebook's own client fires a read-only
query first — `CometUnifiedShareSheetDialogQuery` (doc_id
`27699349389751397`) — passing the post's permalink URL:

```
variables: {
  shareableParams: { url: <permalink> },
  storyParams:     { url: <permalink> },
  feedLocation: "NEWSFEED", hasParentStory: true, scale: 1, ...
}
```

The response carries `data.link_preview.share_scrape_data` already computed
server-side, in the exact string shape the write mutation needs — no id
matching or math required. Verified live and read-only (no post created): for
a real plain-post permalink, `share_scrape_data`'s embedded id
(`27599915689690169`) came back IDENTICAL to that post's own permalink id —
confirming the earlier mismatch was specific to the photo-post capture, not a
sign the approach was wrong.

`shareableParams: null` (a natural guess, since only `storyParams` seemed to
vary on a first quick read of the one real capture) produced
`noncoercible_argument_value` — both fields need a real URL, even for a
plain, non-photo post.

### The write mutation

```
POST /api/graphql/  doc_id=27300941309579835
fb_api_req_friendly_name=ComposerStoryCreateMutation

input.attachments[0].link.share_scrape_data = <from the dialog query, above>
input.audience.privacy.base_state = "FRIENDS"   <- only value captured live
input.reshare_original_post = "RESHARE_ORIGINAL_POST"
```

Only `"FRIENDS"` is backed by a real capture. `shareScript` accepts `"SELF"`
and `"EVERYONE"` as overrides — Facebook's long-stable Graph API privacy
vocabulary, not a build-specific opaque id like the reaction ids — but
neither has been tried against this specific mutation yet.

### Verified live (done)

User was asked and chose FRIENDS (the confirmed value) over an untested
SELF/"Only me" guess. Shared a real post ("FX GlobalChain", a plain
non-photo link post) via the SHIPPED `shareScript`/`fbShare` code path, with
FRIENDS audience and no added text — user picked the exact post from a
read-only candidate list before anything was sent. Result: HTTP 200, no
errors, a real `story.url` came back
(`facebook.com/permalink.php?story_fbid=...&id=61551764120338`) — the share
is live on the user's own timeline. `shareScript`, `fbShare`, and the
`facebook_share` agent tool (approval-gated) are done for Action 5.

## Action 8 — following a profile (partly done)

Captured from a real click on a profile's Follow button:

```
POST /api/graphql/  doc_id=28018963647735121
fb_api_req_friendly_name=CometUserFollowMutation

variables.input: { subscribee_id, subscribe_location: "PROFILE", actor_id,
                    client_mutation_id, attribution_id_v2,
                    is_tracking_encrypted, tracking }
-> 200 { data: { actor_subscribe: { subscribee: { profile_action, ... } } } }
```

`subscribee_id` is the target's numeric user id. `feedScript` did not expose
this — before adding it, a read-only probe confirmed `owning_profile` really
does carry an `id` field (`{__typename, name, short_name, id}`) rather than
assuming it does because `name` was already there. Added as `authorId`, a
field distinct from `feedbackId`.

`attribution_id_v2`/`tracking` trimmed the same way `reactScript` trimmed
them (same class of page-bound telemetry) — but unlike `reactScript`, this
has only been checked to work once, not round-tripped.

**Only the follow direction is captured.** Unfollow is very likely a
different mutation (`actor_unsubscribe` or similar) with its own doc_id —
Facebook's client did not send anything containing "unsubscribe" or
"unfollow" in the traffic captured so far, meaning the reverse action simply
has not happened yet on a monitored session. `followScript`/`fbFollow`/
`facebook_follow` ship for follow only; no `unfollowScript` exists, and none
should be assumed to be "the same mutation with a flag flipped" without its
own capture.

### Verified live (done)

User approved a live test. Picked the first feed author with a usable
`authorId` and followed them via the SHIPPED `followScript` code path —
result: HTTP 200, `actor_subscribe.subscribee` echoed back, no errors.
`followScript`, `fbFollow`, and `facebook_follow` are done for the follow
direction.

## Action 6 — hiding a post (done, verified live)

Same discovery shape as sharing: the write mutation needs large opaque
tokens (`hideable_token`, `story_permalink_token`) that are session-scoped
and computed server-side — not something to construct, something to fetch.

Opening a post's "..." menu fires:

```
POST /api/graphql/  doc_id=27757775690570026
fb_api_req_friendly_name=CometFeedStoryMenuQuery
variables.id = <the post's raw Relay node id>
```

The response's `feed_unit.nfx_action_menu_items` is the entire menu — Hide,
Snooze, Unfollow, Report, Save, all present at once, each a
`StoryNFXActionMenuItem` with an `action.type` (`"HIDE"`,
`"SNOOZE_ACTOR"`, `"UNSUBSCRIBE"`, ...) and an `action.context` — a JSON
string that ALREADY contains `hideable_token`, `story_permalink_token`,
`session_id`, and `tracking`, ready to forward verbatim. No id math needed,
same lesson as `shareScript`'s `share_scrape_data`.

A live "Hide post" click confirmed the write side:

```
POST /api/graphql/  doc_id=28386627231026039
fb_api_req_friendly_name=CometFeedStoryExecuteNFXActionMutation
variables.input: { context: <menu item's action.context, verbatim>,
                    type: "HIDE_XOUT", actor_id, client_mutation_id }
```

Only the `HIDE` menu entry is shipped. The same menu also exposed
`SNOOZE_ACTOR` and `UNSUBSCRIBE` (unfollow via the feed's "..." menu, a
different path from Action 8's profile-page Follow button) with the
identical context shape — very likely the same mutation with a different
`type` string, but neither has had an actual click captured, so neither
ships. A hide is also followed by Facebook's own "also stop seeing this
Page?" prompt (`UNSUBSCRIBE_DIRECTED_TARGET` via a different mutation,
`useExecuteNFXActionMutation`) — deliberately not fired, since hiding one
post should only hide that post.

`feedScript` gained a `nodeId` field (the raw node.id) to support this —
verified present via a live read-only probe before being added, not assumed
just because `postId`/`feedbackId` were already there.

### Verified live (done)

User approved a live test. Picked the first feed post with a usable
`nodeId`, opened its menu, found the `HIDE` item, and fired the hide via the
SHIPPED `hideScript` code path — HTTP 200, `cix_nfx_actions_execute` echoed
back, no errors. `hideScript`, `fbHide`, `facebook_hide` are done.
