# Pinterest — what can be built (analysis 2026-10-05)

Source: live capture on the signed-in business account (Social → Pinterest, account 1), CDP recorder
(`probes/out/_network-bg-pinterest-com.json`, local only), probes `pin-10..32`, and the 59 `*Resource`
names found in the web app's own JS (`pin-10-catalog`). Read-only: nothing was posted, saved or sent.

## How Pinterest's web app talks to its server

- `GET /resource/<Name>/get/?source_url=…&data={"options":{…}}` — reads (already used by our 10 tools).
- `POST /resource/<Name>/create|update|delete/` (form body `source_url`, `data`) + `X-CSRFToken` — writes.
- **`/resource/ApiResource/get|create|update/` with `options.url = "/v3/…"`** — a generic proxy to
  Pinterest's internal v3 API and `ads/v4` API. This is the big find: one helper reaches many endpoints.
- `POST /_/graphql/` with a `queryHash` — a few newer reads (user, merchant).
- Anti-abuse in the page: `/v3/spam/fingerprints/`, `/v3/sessions/verify/` (reCAPTCHA token), Arkose.
  Writes must stay slow, human-paced and approved; never automate those checks.

## Already built (10 read tools, live-verified)
status, user, user_boards, user_pins, board_pins, pin, related_pins, suggest, search (signed in), outlier.

## New READ tools — endpoint seen answering 200 live

| Tool idea | Endpoint (captured) | What it gives |
|---|---|---|
| `pinterest_trends` | ApiResource `/v3/trends/top/search_query/` {country, end_date, num_terms_to_return, trends_preset} + `/v3/trends/latest_available_date/` | Trending search terms per country, with seasonality score |
| `pinterest_audience` | `AudienceInsightsDataResource` {business_id, audience_type …} | My audience: age, gender, location, interests (business account) |
| `pinterest_my_boards` | `BoardsResource` {username, privacy_filter:"all", sort} | Own boards incl. secret ones (board picker for saving/creating) |
| `pinterest_inbox` | `ConversationsResource` | DM conversation list |
| `pinterest_comments_inbox` | ApiResource `/v3/interactions/users/<me>/` | Comments/replies on my pins, unread count |
| `pinterest_notifications` | `NewsHubBadgeResource` (+ `NewsHubDetailsResource` in JS) | Notification count / list |
| `pinterest_me` | ApiResource `/v3/users/me/`, `/v3/users/settings/`, `/vx/business_access/profiles/` | Which account, business profiles |
| `pinterest_recent_engaged` | ApiResource `/v3/users/me/recent/engaged/pin/stories/` | Pins I recently engaged with |

Seen only as names in the JS (need one capture each before building): `UnifiedCommentsResource` (comments of a
pin), `BoardSectionsResource` / `BoardSectionPinsResource`, `VisualSearchFlashlightUnifiedResource` (similar
pins for an image), `ScheduledPinsResource` (my scheduled pins), `UserFollowingResource` /
`InterestFollowingResource`, `ConversationMessagesResource` (messages of a DM), `TodayArticleFeedResource`.
Analytics (`analytics.pinterest.com`): page did not render in the hidden window — capture it once in the
visible Social tab.

## WRITE tools — possible, each needs ONE approved live capture first

| Tool idea | Resource in the JS | Notes |
|---|---|---|
| `pinterest_save_pin` | `RepinResource` create | Save a pin to my board (+ section) |
| `pinterest_create_pin` | pin builder: image upload + `PinResource` create | Image (from ChatGPT/Flow), title, description, link, board, alt text |
| `pinterest_schedule_pin` | `ScheduledPinsResource` / pin create with publish date | Business accounts can schedule |
| `pinterest_create_board` / `_section` | `BoardResource` / `BoardSectionResource` create | |
| `pinterest_follow` | `UserFollowingResource` / `InterestFollowingResource` | |
| `pinterest_comment` | `AggregatedCommentResource` / `UnifiedCommentsResource` | Reply to comments on my pins |
| `pinterest_react` | `ReactionsResource` | |
| `pinterest_send_message` | `ConversationMessagesResource` | DMs (business accounts may be limited) |
| `pinterest_delete_pin` / `_edit_pin` | `PinResource` delete/update | destructive → approval policy |

## Frameworks / workflows these enable

1. **Niche research engine** — suggest → trends (country) → search → outlier → pin details → report
   (keywords, seasonality, winning formats, outbound domains). Read-only; can be built now.
2. **Pin content factory** — trend keyword → ChatGPT image 2:3 (Module 1) → SEO title/description →
   create pin with link → schedule. Needs create/schedule capture.
3. **Competitor watch** — daily new pins + outliers of chosen creators/boards, saved to Brain (Module 3).
4. **Engagement inbox** — comments + DMs + notifications in one view; replies only with approval.
5. **Audience-driven planning** — audience insights (age/location/interests) + trends → content calendar.
6. **Board curator** — related pins of a seed pin → pick best → save to own board/section (approved, slow).
7. **Multi-account publisher** — same pipeline across Pinterest accounts via the account switcher.
8. **Visual search** — "find pins like this image" for product/competitor research.

## Recommended order
1. Read tools from the verified table (trends, audience, my_boards, comments_inbox, inbox, notifications, me).
2. Niche research skill/workflow (framework 1).
3. With the user's approval: capture save-pin and create-pin once each on a test board → build writes.
4. Content factory + scheduler (frameworks 2, 7).
