# Google Flow "UNUSUAL_ACTIVITY" — research (2026-10-13)

Problem: `flow_generate_video` gets `PUBLIC_ERROR_UNUSUAL_ACTIVITY` after about
five videos in a row; later requests are accepted, then silently dropped
(`notFound`, credits refunded). By hand in Flow's own UI the same account keeps
generating for an hour.

Constraint: no bot-detection evasion. Flow decides; FlowDesk must behave like
the page itself and stop when Flow says no.

## Questions asked

- Mechanism: what does UNUSUAL_ACTIVITY mean in Flow, and is it reCAPTCHA?
- Mechanism: how does Flow's own page mint its reCAPTCHA token, and how does FlowDesk?
- Prior art: what did other Flow automations (FlowKit, flow2api, gflow-cli) hit and fix?
- Constraints: what limits does Google publish for Flow?
- Maintenance/risk: can automation get the account blocked for manual use too?
- Unlisted alternative: is there a path where FlowDesk sends nothing itself?

## What the research found

1. **Same break, other tools, same date.** Since Flow's front-end build of
   2026-09-22, every reCAPTCHA-gated RPC sent by FlowKit returns
   `PUBLIC_ERROR_UNUSUAL_ACTIVITY` (gRPC 7) while the UI on the same account,
   browser and tab still works. Payload, action, site key and headers were
   byte-compared to the UI and matched; rate limit and IP were ruled out.
   [FlowKit #58](https://github.com/crisng95/flowkit/issues/58)
2. **The token recipe changed.** Tokens from
   `grecaptcha.enterprise.execute(SITE_KEY, {action})` are rejected; the page
   itself does `ready()` → render an invisible widget bound to its own site key
   → `execute(widgetId, {action})`. A/B on one account: old way 3/3 refused, new
   way generated (images only, small sample).
   [FlowKit PR #62](https://github.com/crisng95/flowkit/pull/62),
   [commit 1eae10b](https://github.com/crisng95/flowkit/commit/1eae10b)
   — FlowDesk still mints the old way (`electron/flowBridge.ts`, `getRecaptchaToken`).
3. **That fix did not last.** "It did work for a few hours, then it does not
   work anymore" (PR #62 comment); a Playwright UI path also failed again after a
   browser restart, suspected session/profile risk score (#58 comments).
4. **Account risk is real.** After extension testing, two accounts were blocked
   for manual Flow generation too, for days, with no documented recovery —
   yet "generation through Flow's built-in agent still works on the same
   account". [FlowKit #67](https://github.com/crisng95/flowkit/issues/67)
5. **Retrying makes it worse (hypothesis in #67/#68):** hot retries and
   repeated mints after a refusal may build up the risk signal; proposed fix is
   a persistent hold that never retries UNUSUAL_ACTIVITY.
6. **Google's own guidance:** retry after a couple of minutes, no VPN/proxy;
   failed generations cost no credits.
   [Flow help](https://support.google.com/flow/answer/16353333?hl=en)
7. **gflow-cli**, which lets the page's own JavaScript issue the request,
   showed no UNUSUAL_ACTIVITY in its nightly canary (#58 comment).

## What this changes

- Root cause is most likely **how FlowDesk talks to Flow**, not speed alone:
  a direct batchexecute call with a token minted outside the page's own
  submit path. Pacing alone will not fix it.
- Re-implementing the widget recipe copies the page more closely, but it is a
  moving target, others describe it as evading detection, and it stopped
  working within hours. Not recommended.
- FlowDesk already has the right pattern for images: `electron/flowUi.ts`
  types into Flow's own prompt box and presses its own button, so Flow's code
  builds and sends every request. Video still uses the direct `YhhmEf` call.

## Recommendation

1. Move `flow_generate_video` (and image-to-video, extend) onto the UI path in
   `flowUi.ts`: the agent prompt box + Agent settings for the video model,
   one generation at a time per account, waiting for each to finish.
2. Fail closed: on the first `UNUSUAL_ACTIVITY` (or a job that comes back
   `notFound` with a refund), park that account for several hours, persisted
   across restarts, and never retry automatically. Tell the user.
3. Keep the direct RPCs only for reads (media status, project media, models),
   which are not reCAPTCHA-gated.
4. Test on one account with low stakes first, a handful of videos in a row,
   because a block can also stop manual use.

## Still unverified

- That the UI path avoids the flag for more than ~5 videos in a row →
  generate 8 videos one after another through the UI on one account.
- That the account currently flagged recovers by itself, and how long it
  takes → check `flow_accounts`/a single UI generation after 24 h.
- The exact Agent-settings controls for video (model, ratio, count) on today's
  build → read-only probe of the settings panel before building.
- Whether Flow's agent wraps prompts (rewrites them) for video like it does for
  images → compare the prompt shown on the generated media with the input.
