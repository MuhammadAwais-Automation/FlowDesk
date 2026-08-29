# Reading a capture: replayable or interface-only?

The whole method turns on this one judgement, and it is the judgement people get
wrong in both directions — building a fragile clicking tool when a clean API was
right there, or spending a day trying to replay something that can never work.

`scripts/analyze_capture.py` ranks candidates for you. This document is how to
check its work, because it is a heuristic and you are the one deciding.

## The test

**Does the request carry what the action MEANS, or what the interface NEEDS?**

If you posted the words "hello world" and the payload contains `"hello world"`,
the request carries meaning. Replay it.

If the payload contains `{"key":"connect-button-disabled-jane-doe-a40427a6"}`,
the request carries a pointer into a page that no longer exists. There is
nothing to copy.

## Worked example — the same site, both kinds

These two requests both create a LinkedIn connection invitation. They were
captured minutes apart, on the same account, doing the same thing.

### From the My Network page — interface-only

```
POST /flagship-web/rsc-action/actions/server-request?sduiid=...addaAddConnection
{
  "requestedArguments": {
    "requestedStateKeys": [
      {"key":{"value":{"$case":"id","id":"guidedFlowNumSentInvites"}},"namespace":""}
    ],
    "payload": {
      "inviteeUrn": {"memberId": "377284368"},
      "nonIterableProfileId": "ACoAABZ85xAB2QcKpn1J...",
      "firstName": "Imanol",
      "lastName": "Echazarreta",
      "isDisabled": {"key":"connect-button-disabled-imanol-echazarreta-a40427a6"},
      "connectionState": {"key":"state:invitation:urn:li:member:377284368"},
      "origin": "InvitationOrigin_PYMK_COHORT_SECTION",
      "profilePictureRenderPayload": "AApVaHR0cHM6Ly9tZWRpYS5s..."
    }
  }
}
```

Note what is happening. The person IS in there — member id, name, profile id. It
is tempting to call this replayable. But look at the rest: a disabled-button key
derived from the rendered button, an encoded picture blob, a `requestedStateKeys`
list naming pieces of interface state, and an `origin` asserting which surface
the click came from.

Replaying this means fabricating another page's internal state and claiming an
origin that did not happen. It may work today. It is not something to build on.

`analyze_capture.py` marks this **mixed** — data present, but bound to a page.

### From the person's profile page — replayable

```
POST /voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2
     &decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2
accept: application/vnd.linkedin.normalized+json+2.1
x-li-deco-include-micro-schema: true

{"invitee":{"inviteeUnion":{"memberProfile":"urn:li:fsd_profile:ACoAAAyLrWsB..."}}}

-> 200 {"data":{"value":{"invitationUrn":"urn:li:fsd_invitation:7497469300371464192"}}}
```

One line. Nothing but the person. A confirmation id in the response.

**Same outcome, same account, same site — one surface is replayable and the
other is not.** This is the single most useful thing in this document: if the
first path you look at is interface-only, find another way a human can do the
same thing before concluding there is no API. A profile page instead of a list.
A detail view instead of a feed. A settings page instead of an inline control.

## Signals, and how much to trust them

| Signal | Weight |
|---|---|
| Content you typed appears verbatim in the payload | Strongest. Replayable. |
| Payload is short (< 400 chars) and reads like arguments | Strong. |
| Response returns an id for the thing created | Strong — and it is your success check later. |
| URL path is a versioned API (`/api/`, `/voyager/`, `/graphql`) | Moderate. Necessary, not sufficient. |
| URL is `rsc-action`, `server-request`, `.rsc`, `_next` | Interface-only, nearly always. |
| Payload has `componentKey`, `stateKey`, `BindingImpl`, `namespace` | Interface state. |
| Payload has a base64 blob of render data | Interface state. |
| `origin` / `clientContext` naming a screen | Bound to that screen. |

## GraphQL query ids rotate

Sites that use GraphQL identify operations by a build hash:

```
/voyager/api/graphql?action=execute&queryId=voyagerContentcreationDashShares.80089eb2e82a2dfa23cb621fb09eb7bf
```

That hash changes when the site ships a new client, and the call then fails.
This is not a reason to avoid the API — it is a reason to **say so in the error
message**, so the fix is a five-minute recapture rather than an afternoon:

```
hint: 'the queryId may have rotated — perform the action by hand with the
       recorder running and read the new one off the wire'
```

You can also sweep every query id the client ships, without performing anything.
See `templates/queryid-sweep-probe.js`. It answers "does this operation exist at
all" in one read, which is worth knowing before deciding something is impossible.

## The accept header decides the SHAPE, not just the encoding

This one cost a live failure. The same URL, requested two ways:

```
accept: application/json
-> {"data":{...}}                      no `included` array at all

accept: application/vnd.linkedin.normalized+json+2.1
-> {"data":{...},"included":[...]}     the data you actually needed
```

A delete tool asked for the first, found no `included`, correctly refused to
delete anything, and reported that the post could not be resolved. The anchor
was right; the representation was wrong.

**Copy the headers from the capture, including `accept`.** If a response looks
strangely empty, this is the first thing to check.

## When the content is genuinely absent

Sometimes nothing carries what you typed. That is a real answer. Before
accepting it:

1. Confirm the action happened while recording — check the call count moved.
2. Check the buffer did not roll over (a long session evicts early calls).
3. Try a shorter, more distinctive fragment — text is often reformatted.
4. Try the same action from a different surface in the app.
5. For uploads, search for the filename or the byte size instead.

If it still is not there, the app is server-driven for that action. Say so
plainly and read `dom-driving.md`.
