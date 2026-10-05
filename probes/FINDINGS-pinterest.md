# Pinterest — capture findings (2026-10-05)

Probes `pin-01..07` (read-only), run in the hidden `persist:social-pinterest` window, signed out.

## Session
- `_auth` is HttpOnly and exists for visitors too (`0`); `1` = signed in. `csrftoken` is readable.
- Signed out, `__PWS_INITIAL_PROPS__.initialReduxState.users` holds one visitor (`unauth_id`, no username).

## Read wire format
`GET /resource/<Name>/get/?source_url=<path>&data={"options":{…},"context":{}}&_=<ms>`
Headers the web app sends (without them: `Invalid Request`):
`X-Requested-With: XMLHttpRequest`, `Accept: application/json, text/javascript, */*, q=0.01`,
`X-App-Version: <appVersion from page HTML>`, `X-Pinterest-AppState: active`,
`X-Pinterest-Source-Url: <path>`, `X-Pinterest-PWS-Handler: <route file>`.
Answer: `{ resource_response: { code: 0, message: "ok", data, bookmark } }`; paging = `options.bookmarks: [bookmark]`, `-end-` = last page; unknown user/pin → HTTP 404.

| Resource | options | handler | signed out |
|---|---|---|---|
| UserResource | username, field_set_key:"profile" | www/[username].js | ok |
| BoardsFeedResource | username, field_set_key:"profile_grid_item", sort:"last_pinned_to" | www/[username].js | ok |
| UserActivityPinsResource | username, field_set_key:"grid_item" | www/[username]/_created.js | ok |
| BoardResource → BoardFeedResource | username+slug → board_id, board_url, field_set_key:"react_grid_pin" | www/[username]/[slug].js | ok |
| PinResource | id, field_set_key:"detailed" | www/pin/[id].js | ok |
| RelatedModulesResource | pin_id, source:"deep_linking" | www/pin/[id].js | ok |
| AdvancedTypeaheadResource | term, pin_scope:"pins" | www/index.js | ok |
| BaseSearchResource | query, scope:"pins", rs | www/search/[scope].js | **gated: 0 results** |

Pin fields used: `title`/`grid_title`, `description`, `link`, `images.{orig,736x,…}.url`,
`aggregated_pin_data.aggregated_stats.saves`, `repin_count`, `comment_count`, `created_at`,
`pinner.username`, `board.{name,url}`, `videos`.

## Not captured (needs a signed-in account and the user's approval)
Save/repin, create pin, follow, comment, messages.
