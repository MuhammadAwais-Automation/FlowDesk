# LinkedIn — API map

Evidence: CDP capture (`electron/discovery/cdpRecorder.ts`) of a live session
that browsed feed, notifications, My Network, search, jobs and messaging, and
performed a like, a comment, a connect and a message send — plus three
read-only probes (`li-01`…`li-03`) that call the same routes from our own code.

Identifiers are redacted as `<SELF>` (own `fsd_profile` id) and `<CONV>`.
The raw capture in `probes/out/` has the real values and is gitignored.

## The headline: LinkedIn is two products, not one

| | Messaging | Feed / My Network |
|---|---|---|
| Transport | `/voyager/api/` | `/flagship-web/rsc-action/` |
| Protocol | REST + GraphQL, plain JSON | Server-Driven UI over RSC |
| Payloads | **data** (`text`, `conversationUrn`) | **UI state bindings** |
| Automatable directly | yes | no — see below |

This distinction decides the whole integration strategy, and getting it wrong
is what sank the previous attempt (which concluded `/voyager/api/` was dead and
fell back to DOM scraping — it is very much alive, just invisible to
main-thread `fetch` hooks because messaging runs off-thread).

### Why feed writes are not directly callable

`com.linkedin.sdui.comments.createComment` does **not** carry the comment text.
It carries a pointer to it:

```json
"commentFieldBinding": {
  "key": "commentBoxText-CgsIgMDIgPfG8YjQAQ-TDL_OCpdERgmzoxa-…FeedType_MAIN_FEED_RELEVANCE",
  "namespace": "MemoryNamespace"
}
```

The key is derived from the rendered component tree of that specific page load.
`addaAddConnection` is worse — it wants `profilePictureRenderPayload`, a base64
protobuf blob straight out of the render, plus `isDisabled` / `connectionState`
binding keys and an `origin` enum describing which UI surface the click came
from.

These are remote-UI messages, not an API. Reproducing them means reimplementing
LinkedIn's SDUI client, and every LinkedIn deploy would break it.

`com.linkedin.sdui.reactions.create` is the exception — its payload is nearly
pure data (`activityId` + `reactionType`) — so a like may be callable directly.
Untested; verify before relying on it.

**Therefore:** feed/network actions should be driven through the real UI in the
embedded view (the click path that already works), while messaging is driven
through the API. Mixing the two is a deliberate choice, not a compromise.

## Auth — verified, not assumed

- `csrf-token` header = the `JSESSIONID` cookie, quotes stripped. Format `ajax:…`.
- **Omitting it returns 403.** Cookies alone are not enough.
- `x-restli-protocol-version: 2.0.0` on every voyager call.
- Accept header changes the response shape:
  - `application/json` → flat body
  - `application/vnd.linkedin.normalized+json+2.1` → `{data, included[]}` with
    `"*field": "urn:…"` pointers into `included`
  - `application/graphql` → what the site itself sends to messaging GraphQL
- Also sent by the site, worth mirroring: `x-li-lang`, `x-li-track`
  (JSON with clientVersion/timezone), `x-li-page-instance`.

### URL encoding is not `encodeURIComponent`

Rest.li `variables=(…)` keeps its own parens and colons literal, but values are
escaped **including parentheses**, which `encodeURIComponent` deliberately
leaves alone. A conversation urn contains a parenthesised pair, so the default
encoding yields a 400. Required:

```js
encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29')
```

This cost one probe run — the first `messengerMessages` call returned 400 for
this reason plus a wrong queryId.

## Messaging — fully working

Base: `/voyager/api/voyagerMessagingGraphQL/graphql`

| Purpose | queryId | variables |
|---|---|---|
| Inbox | `messengerConversations.9501074288a12f3ae9e3c7ea243bccbf` | `(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20,mailboxUrn:…)` |
| Delta sync | `messengerConversations.0d5e6781bbee71c3e51c8843c6519f48` | `(mailboxUrn:…)` → `metadata.newSyncToken` |
| Thread messages | `messengerMessages.d8ea76885a52fd5dc5c317078ab7c977` | `(deliveredAt:<ms>,conversationUrn:…,countBefore:20,countAfter:0)` |
| Unread counts | `messengerMailboxCounts.fc528a5a81a76dff212a4a3d2d48e84b` | `(mailboxUrn:…)` |

Verified by probe: inbox 200 / 323KB / 20 conversations / `nextCursor` present;
thread 200 / 82KB / 12 messages with real sender names and text.

Two `messengerMessages` queryIds exist and are **not** interchangeable — the
one taking only `conversationUrn` is a different hash. Response key is
`messengerMessagesByAnchorTimestamp`.

Conversation element fields: `entityUrn`, `title`, `unreadCount`, `read`,
`lastActivityAt`, `lastReadAt`, `groupChat`, `conversationParticipants[]`,
`messages.elements[]`, `categories`, `conversationUrl`.

Message element fields: `body.text`, `deliveredAt`, `sender`, `actor`,
`originToken`, `renderContent[]`, `reactionSummaries`, `backendUrn`.

**Open:** in the inbox response `sender` is a bare participant urn, and naively
resolving it returned the *viewer's own* urn on every row. Resolve senders
against `conversationParticipants` and confirm — do not assume the first read
is right.

### Send — approval-gated, never automatic

```
POST /voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage
```
```json
{"message":{"body":{"attributes":[],"text":"hello"},
  "renderContentUnions":[],
  "conversationUrn":"urn:li:msg_conversation:(urn:li:fsd_profile:<SELF>,<CONV>)",
  "originToken":"<uuid v4>"},
 "mailboxUrn":"urn:li:fsd_profile:<SELF>",
 "trackingId":"<16 raw bytes>",
 "dedupeByClientGeneratedToken":false}
```

Response 200 (~918b) returns the created message. **This is the success proof**
— the bridge must return `value.entityUrn` and must not report success from a
resolved promise:

```
value.entityUrn              urn:li:msg_message:(…)
value.backendConversationUrn urn:li:messagingThread:<CONV>
value.senderUrn / deliveredAt
```

`originToken` is a client UUID and the natural idempotency key; whether
`dedupeByClientGeneratedToken:true` actually prevents a double-send is untested.

Other messaging writes seen: `voyagerMessagingDashMessagingBadge?action=markAllMessagesAsSeen`
`{"until":<ms>}`, and `messaging/dash/presenceStatuses` which is **form-encoded**,
not JSON: `ids=List(urn%3Ali%3Afsd_profile%3A…)`.

## Everything else — probe results

Read-only sweep, 18 routes. Status is from a real call, not a guess.

**Working**

| Route | Result |
|---|---|
| `feed/updatesV2?count=10&q=chronFeed&start=0` | **200, 265KB, 10 posts** — legacy voyager feed still live |
| `voyagerRelationshipsDashConnections?q=search&sortType=RECENTLY_ADDED` | 200, 20 connections |
| `voyagerIdentityDashNotificationCards?…&q=notifications` | 200, 10 cards |
| `voyagerNotificationsDashPill?…&q=filterVanityName` | 200, 4 filters |
| `relationships/invitationViews?q=receivedInvitation` | 200, 0 elements (none pending) |
| `identity/dash/profiles/<urn>?decorationId=…FullProfile-76` | 200, 12.8KB |
| `voyagerOnboardingDashMemberHandles?q=criteria&type=EMAIL` | 200 |
| `voyagerGlobalAlerts`, `voyagerMessagingDashSecondaryInbox` | 200, empty |

Feed post fields: `actor`, `commentary`, `content`, `socialDetail`,
`socialContent`, `updateMetadata`, `dashEntityUrn`.

**Not working as guessed** — wrong path or params, each needs its real call
observed rather than another guess:
`sentInvitationViews` 404, `voyagerRelationshipsDashInvitations` 400,
`invitationsSummary` 400, `relationships/connections` 400,
`voyagerFeedDashMainFeedUpdates` 404, jobs saved/applications 404,
`typeahead/hitsV2` 404.

## Realtime — the mechanism, found

There are **two** streams, and only one of them matters for messaging.

**1. SDUI heartbeat (not useful).** An EventSource at
`/flagship-web/rsc-action/actions/server-stream-request?sduiid=com.linkedin.sdui.realtimeDefaultHandler`
emitting an identical 553-byte SDUI state frame every 8 seconds. It carries no
message content.

**2. Voyager Realtime Frontend (the real one).** A subscription-based system:

| Call | Purpose |
|---|---|
| `GET /realtime/realtimeFrontendTimestamp` | server clock for resume |
| `PUT /realtime/realtimeFrontendSubscriptions?ids=List((clientConnectionId:<uuid>,topic:<topic urn>))` | subscribe |
| `DELETE` same route | unsubscribe |
| `POST /realtime/realtimeFrontendClientConnectivityTracking?action=sendHeartbeat` | keepalive |

Topics are urns, e.g.
`urn:li-realtime:presenceStatusTopic:urn:li:fsd_profile:<id>` (one per person
whose online dot is shown).

The routing table travels in request **headers**, which is the part that would
never have been found by looking at URLs and bodies alone:

- `x-li-query-map` — `topicToGraphQLQueryParams`, mapping each topic to the
  GraphQL query used to decorate its events. It contains
  `conversationsBroadcastTopic → voyagerMessagingDashMessengerRealtimeDecoration.f855048b390b286e513d7b23c59efee3`
  — the messaging push path.
- `x-li-recipe-map` — decoration ids per topic (`inAppAlertsTopic`,
  `tabBadgeUpdate…`, `professionalEventsTopic`, …).
- `x-li-realtime-session` — a session uuid shared across the subscription calls.

### It was never a worker — the recorder simply could not see a stream

Two wrong hypotheses died here, both cheaply, and both worth recording because
the *shape* of the mistake repeated.

First guess: a worker target. Auto-attaching to child targets was implemented
(`Target.setAutoAttach`, flatten, `Network.enable` per session) and did attach
to LinkedIn's four `blob:` workers and several iframes — but the realtime
connection was not in any of them. It carries `target: page`.

The actual cause was structural. Entries were written on
`Network.loadingFinished`, and **a push connection never finishes**. It had been
sitting in the `pending` map the whole time, seen and discarded on every write.
A recorder built on completion events is blind to precisely the class of
connection a realtime channel belongs to.

The capture now also writes `inFlight`: every unfinished request with
`openForSeconds`, `bytesReceived`, `chunks`, and `secondsSinceLastChunk` —
chunks still arriving is what separates a live stream from a stalled request.
That surfaced it immediately:

```
open 401.6s | GET 200 | text/event-stream | chunks 31
https://www.linkedin.com/realtime/connect?rc=1
```

Two self-inflicted bugs found on the way, both silent:

- **`Network.getResponseBody` was passed `sessionId: undefined`** once worker
  support landed. Electron rejects an empty session id, so every body fetch on
  the page target failed — 227 calls, 38 previews, all of them SSE frames that
  never used that path. `.catch(() => push(record))` hid it completely. Commands
  now go through one `send()` helper that omits the argument for the page, and
  a failed body records `bodyError` instead of nothing.
- **`streamResourceContent` failed the same way**, and its error only reached
  the console. It is now stored on the entry as `streamError`, with
  `streamRequested` to distinguish "never attempted" from "attempted, silent".

## Realtime — decoded

`GET /realtime/connect?rc=1` → `text/event-stream`, open for the session.

`Network.getResponseBody` cannot read it (the request never completes).
`Network.streamResourceContent` can: it returns what has buffered and makes
every subsequent `Network.dataReceived` carry the actual bytes. The recorder
keeps the most recent 60KB — the tail, since on a channel open for hours the
newest events are the ones being looked for.

Each frame is an SSE `data:` line wrapping:

```json
{"com.linkedin.realtimefrontend.DecoratedEvent": {
  "topic": "urn:li-realtime:messagesTopic:urn:li-realtime:myself",
  "publisherTrackingId": "urn:li:messagingMessage:…_urn:li:member:…",
  "leftServerAt": 1787372227428,
  "id": "<uuid>",
  "payload": { "data": { "doDecorateMessageMessengerRealtimeDecoration": { "result": { … } } } }
}}
```

Topics observed in one 30-second window:

| Topic | Carries |
|---|---|
| `messagesTopic:urn:li-realtime:myself` | **a new message, fully decorated** |
| `messageSeenReceiptsTopic:…myself` | read receipts |
| `typingIndicatorsTopic:…myself` | typing indicators |
| `presenceStatusTopic:urn:li:fsd_profile:<id>` | online status, one per watched person |
| `replySuggestionTopicV2:…myself` | suggested replies |
| `tabBadgeUpdateTopic:…myself` | badge counts |

The `messagesTopic` result is a complete `com.linkedin.messenger.Message`:

```
body.text                 "G"
deliveredAt               1787372227108
entityUrn                 urn:li:msg_message:(urn:li:fsd_profile:<SELF>,…)
backendUrn                urn:li:messagingMessage:…
backendConversationUrn
actor.hostIdentityUrn     urn:li:fsd_profile:<sender>
actor…member.firstName/lastName   "Iqra" / "Mushtaq"
conversation              full object, including conversationParticipants[]
previousMessages, renderContent, reactionSummaries, sender, subject
```

Two consequences worth stating:

- **No polling is needed.** New messages arrive pushed, with the conversation
  attached, so a watcher does not even have to re-fetch the thread.
- **The realtime event names the sender**, which the inbox list does not. The
  gap documented under Messaging is closed for pushed messages specifically.

### `target` says who reported it, not who issued it

Worth recording because it caused a wrong turn. The capture labels
`/realtime/connect` as `target: page`, which was read as "the page's JavaScript
made this request" — so a `window.fetch` wrapper was built and injected to tap
it. Three pieces of live evidence then contradicted that reading:

- the wrapper installed correctly (`fetch` wrapped, no hook error) and counted
  **zero** `/realtime/connect` requests;
- `performance.getEntriesByType('resource')` on the page contained **no
  `/realtime/` entry at all** — a page records every request it makes, whichever
  API makes it;
- injection happens at dom-ready, ~2.9s into the page load, while the
  connection opens at ~1.6s. Too late regardless.

Chrome attributes some requests to the page session that page JavaScript never
issued. The field is a routing hint; origin must be confirmed from the page
before anything is built on it. The production watcher therefore reads the
stream over CDP (`electron/linkedinRealtimeWatch.ts`), which is the mechanism
already proven to work.

Also seen, and needed by a well-behaved client:
`POST /voyager/api/voyagerMessagingDashMessengerMessageDeliveryAcknowledgements?action=sendDeliveryAcknowledgement`
with `{"messageUrns":[…]}` — the client acknowledging messages it received on
the channel.

## Beyond messaging — what a browsing pass revealed

Guessing routes has a poor hit rate here: 30 guesses, 13 hits. What worked was
the same method as for messaging — open the page once, let CDP record the real
call. The distinction that made the guesses useful at all:

- **404** — the route is gone. Five of them: `voyagerSocialDashReactions`,
  `voyagerSocialDashSocialActivityCounts`, `search/blended`, `search/hits`,
  `voyagerJobsDashJobSeekerSavedSearches`.
- **400** — the route exists and the arguments are wrong. Seven of them, which
  is a very different instruction: stop guessing parameters, go and watch.

### Verified working (real data, not a 200 with an empty body)

| Purpose | Call |
|---|---|
| Feed | `GET /voyager/api/feed/updatesV2?count=N&q=chronFeed&start=0` — 111KB, posts with `actor`, `commentary`, `content`, `socialDetail` |
| Comments on a post | `GET /voyager/api/feed/comments?count=10&q=comments&sortOrder=RELEVANCE&updateId=activity:<id>` — 157KB, 10 comments with text, `createdTime`, like counts |
| Search results | `graphql?queryId=voyagerSearchDashClusters.a7a0567fa66c52d645b5ff2f960b92aa` with `variables=(start:0,origin:AUTO_COMPLETE,query:(keywords:<text>,flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(ALL))),includeFiltersInResponse:false,spellCorrectionEnabled:false))` — 31KB |
| Search typeahead | `graphql?queryId=voyagerSearchDashTypeahead.fa9acbcb761f7b5ec2c808e6da796296` with `variables=(query:<text>)` — 6KB |
| Own posts / activity | `graphql?queryId=voyagerFeedDashProfileUpdates.20c70fe0314184158516a7ec004c0408` with `variables=(count:20,start:0,profileUrn:<SELF>)` — 33KB |

A trap worth naming: the comments route first answered **200 with zero
elements**, which reads as "works" or as "route alive but wrong" equally well.
It was neither — the post simply had no comments. Re-running it against a post
with 44 comments is what turned it from plausible into verified.

### No clean API at all

**Jobs** and **My Network / invitations management** are served entirely by
Server-Driven UI. The browsing pass shows only `rsc-action` traffic for them —
`com.linkedin.sdui.pagers.mynetwork.invitationsList`,
`com.linkedin.sdui.jobseeker.*`, `com.linkedin.sdui.generated.jobseeker.dsl.*` —
and no voyager equivalent. For those two areas, driving the real UI is the only
honest option.

Search is the interesting middle case: it runs through SDUI
(`com.linkedin.sdui.search.blendedSearchResults`) **and** still answers on
voyager. The voyager path is the one to use.

## Writing — eight API attempts, then the UI

Reacting, commenting, posting and connecting are Server-Driven UI. Eight direct
API attempts were made against the reaction endpoints and all were refused. The
useful part is *how* they were refused:

| Attempt | Result |
|---|---|
| `voyagerSocialDashReactions?threadUrn=…` (+ tracking headers, + dash urn) | **400** with `"Couldn't react to this post. Please try again."` |
| `feed/reactions?threadUrn=…` | 400 |
| threadUrn in body / `?action=create` | bare `{"status":400}` |
| `feed/socialActions/<urn>/likes` | 404, HTML error page |

The first group reached LinkedIn's **reaction service** and was rejected on its
contents; the second never got that far. So the route exists and the payload is
unknowable: the web client never sends this request, so there is nothing to copy
from a capture either. That is the difference from messaging, where the client
does use voyager and the shape could simply be observed.

Verified by like count throughout: 30 before, 30 after. Nothing was liked.

### Clicking the real control works

`element.click()` evaluated in the page — not a synthesised input event, so no
pointer moves and focus is never taken. Confirmed end to end: the click produced
`POST /flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.reactions.create`
→ **200**, with the correct `activityId` in the payload.

Worth stating: the button flipping to "Like" proves nothing on its own. React
updates optimistically, before the server answers. The confirmation was the
captured request and its status; the tool approximates it by re-reading the
control after a settle delay, since a rejection reverts it.

### DOM anchors, and why the tool navigates

From walking up out of real reaction buttons (probe li-15):

| Thing | Anchor |
|---|---|
| Reaction control | `button[data-view-name="reaction-button"]` |
| Its state, in words | `aria-label="Reaction button state: no reaction"` |
| Post container | `div[data-view-name="feed-full-update"]` |
| Comment subtree | `componentkey` beginning `replaceableComment_` |

None of these are class names, which LinkedIn regenerates every deploy.

The awkward part: **only 2 of 28 rendered posts carry an activity id anywhere in
their attributes**, so a post read from the API cannot be reliably matched to one
on screen. Matching by text works but only usually, and a like on the wrong post
cannot be quietly undone. `liLikePost` therefore opens
`/feed/update/urn:li:activity:<id>/` — addressed by the id itself — clicks there,
and restores the previous URL. The cost is that the tab visibly navigates.

A permalink page also renders the post's comments, each with its own reaction
button, so "the first reaction button" is not the post's. Buttons inside a
comment subtree are excluded explicitly.

## Not yet established

- send with attachment/image (`renderContentUnions` non-empty)
- delete / edit / react to a message
- `trackingId` derivation (16 bytes, likely random)
- whether `reactions.create` works as a direct call
- whether any of this works from a background view with no focus


## Permalink pages are not feed pages (probes li-24, li-26)

The like and comment tools both failed at their first check with "the page did
not render", while the network capture showed that same URL returning 200 with
180KB twice. The page had rendered; the tools were looking for the wrong thing.

`/feed/` is richly tagged with `data-view-name`. `/feed/update/<id>/` is not —
it carries **eight tagged elements in total**, and only three distinct names:

    feed-full-update, premium-upsell-link, search-global-typeahead-input

`reaction-button`, `comment-box`, `feed-comment-button` and `comment-post` are
all absent there. Every anchor read off the feed and pointed at a permalink was
therefore dead on arrival.

What the permalink page does carry is aria-labels, and they separate the post
from its comments by meaning rather than by build-specific attribute names:

| control | permalink page |
|---|---|
| post reaction | `aria-label="React Like"` (no `" to "`) |
| comment reaction | `aria-label="React Like to <name>s comment"` |
| reaction counts | `"32 reactions"`, `"See 26 more reactions"` — buttons, but not controls |
| comment editor | `[contenteditable="true"][role="textbox"]`, `aria-label="Text editor for creating content"`, placeholder `"Add a comment..."`, **already present with nothing clicked** |
| open-the-box | button text `"Comment"`, `aria-label="Comment"` |
| submit | button text `"Comment"`, **aria-label empty**, inside the `form` above the editor |

The last row is the one worth remembering: two buttons on the same page read
"Comment", and only the empty aria-label tells them apart. Matching on visible
text clicks the opener and posts nothing while looking like it worked.

Note also the editor's label differs by page — "creating comment" on the feed
(li-23), "creating content" on the permalink (li-26). Both are accepted now.

li-26 typed one throwaway character and cleared it; nothing was submitted. The
typing was necessary because the submit control only renders once React
believes the box is non-empty.


## Posting is a plain API call — unlike liking and commenting

Captured by publishing one real post by hand with the CDP recorder running,
then reading the wire.

```
POST /voyager/api/graphql?action=execute&queryId=voyagerContentcreationDashShares.80089eb2e82a2dfa23cb621fb09eb7bf
accept: application/vnd.linkedin.normalized+json+2.1
content-type: application/json; charset=UTF-8
csrf-token, x-restli-protocol-version: 2.0.0

{"variables":{"post":{
  "allowedCommentersScope":"ALL",
  "intendedShareLifeCycleState":"PUBLISHED",
  "origin":"FEED",
  "visibilityDataUnion":{"visibilityType":"ANYONE"},
  "commentary":{"text":"<the post text>","attributesV2":[]}
}},"queryId":"...","includeWebMetadata":true}

-> 200 {"data":{"data":{"createContentcreationDashShares":{
     "*entity":"urn:li:fsd_share:urn:li:share:7497263200586039296"}}}}
```

**The text travels in the payload in plain sight.** That makes posting
replayable, which liking and commenting are not — those are Server-Driven UI
and carry binding keys derived from a page load, with no data to copy.

This was found only because posting was tested rather than assumed to behave
like its neighbours. A full UI-driving implementation had already been written
first — trusted CDP click on the share box, wait for the composer, type,
disambiguate the submit control — and all of it was deleted. One captured
request replaced it.

### What was learned along the way, and is still true

- The share box is a `div` with `role="button"`, not a `<button>`. Page-script
  activation does nothing to it: the full pointer sequence with real
  coordinates, Enter on the role, and the inner labelled div were all tried and
  all failed (li-32). Only a trusted event opens it. `?shareActive=true`, which
  older builds honoured, does not work on this one (li-33).
- The feed page hosts a **same-origin iframe** at `/preload/?_bprMode=vanilla`,
  1364x785, containing a second complete LinkedIn UI. `document.querySelector`
  in the top document cannot see into it — which is why a composer that was
  visibly open on screen was reported as absent (li-35). The captured post
  request carries `Referer: /preload/?_bprMode=vanilla`, so that iframe is what
  the visible UI actually runs in.
- `[role="dialog"]` on the feed is not a signal. The page carries several 0x0
  dialog shells — video caption settings, ad menus — that are present at all
  times and match before any real modal does (li-28, li-29).

### The queryId will rotate

It is a build-specific hash. When LinkedIn ships a new web client it changes,
and the call returns a non-200. The tool says so in its error, with the fix:
publish one post by hand with the recorder running and read the new id off the
wire.


## Deleting a post, and the id that is not the id you have

`DELETE /voyager/api/contentcreation/normShares/<share urn>` -> 204, and the
share returns 400 afterwards. Verified end to end with the shipped script: a
test post was published, found in the account's own posts, deleted, and confirmed
absent from both the share endpoint and the post list.

**The share urn is not the activity id.** Same post, two numbers:

```
activity  urn:li:activity:7497280269775859712
share     urn:li:share:7497280269150945280
```

Every read tool reports the activity id. Delete needs the share urn. The mapping:

```
GET /voyager/api/feed/updates/urn:li:activity:<id>
    accept: application/vnd.linkedin.normalized+json+2.1
-> included[].updateMetadata { urn: <activity urn>, shareUrn: <share urn> }
```

Two things about that are load-bearing:

1. **The accept header decides the shape, not just the encoding.** With plain
   `application/json` the response has no `included` array at all. The first
   live run of the delete script failed for exactly this reason — the guard
   refused, correctly, because the data it needed had been requested in the
   wrong representation. The post stayed up, which is the right way for that
   bug to fail.
2. **Take the shareUrn paired with THIS activity, never the first one found.**
   A post that reshares someone else's content carries their share urn in the
   same payload. A regex over the response would delete a stranger's post, and
   there is no undo.

## Drafts

The create endpoint accepts `intendedShareLifeCycleState: "DRAFT"` and returns a
share urn for it. Nothing becomes visible to anyone. That is also what made it
possible to exercise create and delete without publishing — though note a draft
has no activity id, so the delete path had to be tested against a real post.

## Analytics is Server-Driven UI, with no API found

`/analytics/creator/content/` is a `/flagship-web/` route. The numbers render
into the DOM ("Impressions Cumulative 41 Impressions 1,950% vs. prior 7 days")
but no voyager endpoint serving them was found.

A sweep of every same-origin and licdn script the client loads (li-36) turned up
**937 queryIds**, and the only analytics-shaped one is
`voyagerFeedDashCreatorExperienceDashboard`. That sweep is worth keeping as a
technique: it answers "does this operation exist at all" in one read, without
performing the operation to find out.

So impressions can be read, but only by reading rendered text — acceptable for a
read, and clearly weaker than the post/delete paths.


## Scheduling, images, comment delete, unlike, reply — all verified live

| action | how | verified |
|---|---|---|
| create post | voyager GraphQL `createContentcreationDashShares` | yes |
| draft | same call, `intendedShareLifeCycleState: DRAFT` | yes |
| schedule | same call, `SCHEDULED` + `scheduledAt` (epoch ms) | yes, and the scheduled share deletes cleanly (204) |
| image | register -> PUT bytes -> poll -> create with `media` | yes |
| delete post | `DELETE /voyager/api/contentcreation/normShares/<share urn>` | yes |
| delete comment | `DELETE /voyager/api/feed/comments/<comment urn>` | yes |
| like / unlike | UI click | yes |
| reply to comment | UI click | yes |
| analytics | DOM read of the analytics page | yes, with caveats below |

### Images

A 2x2 test PNG was **rejected** by the upload validator (PUT 400). A real
200x200 PNG went through: PUT 201, poll reports the `feedshare-image` recipe
`AVAILABLE`, then the post is created with:

```
media: { mediaUrn: <urn:li:digitalmediaAsset:...>, category: 'IMAGE', altText }
```

`media` is a Map (`ShareMedia`), not an array; `id`, `image`, `thumbnail` and
`shareMediaUrn` are all rejected by name; `category` is a NonNull. That shape was
assembled from the server's own validation errors, each of which names the next
wrong field — a fast, precise way to reverse a GraphQL input type.

### Reactions have no API

Re-checked after posting turned out to be a plain API, in case the earlier
conclusion was premature. Eight REST shapes, all 400. Like and unlike stay
UI-driven.

### Two wrong-answer bugs worth remembering

**The reply matcher walked for a tagged container.** It looked for an ancestor
with `data-view-name ~ /comment/`. A permalink page has none, so the walk
stopped on the Reply button itself, whose text is just "Reply" — no snippet
could ever match. Replaced with structure that holds regardless of tagging: the
comment's container is the smallest ancestor containing exactly one "Reply to"
button. Growing past that would swallow the neighbouring comment, which is the
mix-up that posts a reply under the wrong person.

**Analytics read every engagement number one field off.** The page mixes two
label styles:

```
99 Impressions                      number BEFORE the label
Reactions 5 Comments 5 Reposts 0    number AFTER the label
```

Using number-before for all of them made each metric take its neighbour's
figure — it reported `reposts: 5` when the true value was `0`. A number that is
confidently wrong is worse than one that is absent.

### The backslash trap, third occurrence

`\s` inside a TypeScript template literal is swallowed before the page sees it.
Here it made a pattern arrive as `s*` and match the letter s — visible as
"Awai Mu htaq" in a diagnostic. Both new call sites now use a space character
class (`' *'`) instead, which cannot be swallowed. A backtick inside a comment
inside a template literal also terminates the literal; that cost a build error
in the same file.


## Connections and invitations

### What has an API

```
GET /voyager/api/relationships/connectionsSummary   -> numConnections (663)
GET /voyager/api/relationships/invitationsSummary   -> numPendingInvitations, numNewInvitations
GET /voyager/api/relationships/invitationViews?q=receivedInvitation -> received list
```

Names in the received list live in `included`, referenced by urn from the
elements — reading a name off the element itself returns nothing.

### What does not

- **The sent-invitation list.** `/mynetwork/invitation-manager/sent/` is a
  `/flagship-web/` SDUI route. Eight query shapes across `invitationViews` and
  `normInvitations` returned 400.
- **The weekly invite allowance.** Four candidate endpoints returned 404.
  `invitationsSummary` carries `numTotalSentInvitations` and
  `numSingleSentInvitations`, and LinkedIn returns **null** for both. Reported
  as null, never as zero: "we could not read it" and "none were sent" are
  different facts, and conflating them errs in the direction that encourages
  sending more.

### Sending

The My Network path posts to
`sdui.requests.mynetwork.addaAddConnection`. Unlike comments and reactions, that
payload carries real data — `inviteeUrn.memberId`, `nonIterableProfileId`,
first and last name. It also carries page-bound UI state (a disabled-button key
derived from the rendered button, a base64 picture blob) and an `origin` naming
the surface the click came from (`InvitationOrigin_PYMK_COHORT_SECTION`).
Replaying it means reconstructing another page's internal state and claiming an
origin that did not happen, so the tool clicks the profile's Connect control
instead.

**A profile page carries five Connect controls.** Three belong to the profile
(header, card, sticky bar) and two or more to people in the "People also viewed"
rail — verified live: "Invite Gautam Jeyaraman to connect" beside "Invite
Muhammad Zain to connect". Only the aria-label's name separates them.

The profile owner's name comes from `document.title`; `querySelector('h1')`
returned nothing on this build, and profile pages carry **no** `data-view-name`
at all.

**Page JavaScript cannot activate the control** — `element.click()` on the
Connect anchor did nothing, the same as the post composer's share box. It needs
`Input.dispatchMouseEvent`.

### A safety check that checked nothing

A probe verified "no invitation was sent" by reading `numPendingInvitations`
before and after. That field counts invitations **received**, so it could never
have moved regardless of what the click did. The honest signal is the control's
own state: LinkedIn stops offering to invite once an invitation exists. Worth
remembering as a class of mistake — a check that cannot fail is not a check.


## Sending an invitation IS a clean API — the profile path, not My Network

A UI-driving tool was built first and failed live, then one captured send
deleted it. Both paths were seen; they are not the same request.

**My Network** posts SDUI (`sdui.requests.mynetwork.addaAddConnection`) — real
data, but wrapped in page-bound UI state keys and an `origin` naming the surface
clicked. Poor ground to replay.

**A profile page** posts plain voyager:

```
POST /voyager/api/voyagerRelationshipsDashMemberRelationships
     ?action=verifyQuotaAndCreateV2
     &decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2
accept: application/vnd.linkedin.normalized+json+2.1
x-li-deco-include-micro-schema: true

{"invitee":{"inviteeUnion":{"memberProfile":"urn:li:fsd_profile:<id>"}}}

-> 200 { data: { value: { invitationUrn: "urn:li:fsd_invitation:7497469300371464192" } } }
```

One line, carrying nothing but the person, and returning a real confirmation.

### Resolving a profile URL to a urn AND a name

```
GET /voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=<handle>
-> 200, carries ACoAA<id> and firstName/lastName
```

Both come from the same response, so the urn that gets invited is the urn whose
name was checked. `identity/profiles/<slug>/profileView` is gone (410).

### Refusals come with a code

Inviting someone who already has a pending invitation returns
`{"code":"CANT_RESEND_YET","status":400}` — verified. The code is worth
surfacing: "already invited" and "weekly quota spent" are different situations
that "HTTP 400" flattens into one. The action name `verifyQuotaAndCreateV2` says
LinkedIn checks the allowance server-side, which is the only place the limit is
ever visible — nothing reports the remaining count in advance.

### The UI path, for the record

The profile carries five Connect controls (three for the profile, two or more
for the "People also viewed" rail). Page JavaScript cannot activate them.
Clicking raises "Add a note to your invitation?" with "Send without a note" —
and that dialog is **not** a `[role="dialog"]` on this build, which is exactly
why the UI tool clicked Connect and then never found the confirmation. None of
that matters now, but it is the reason the API was worth finding.
