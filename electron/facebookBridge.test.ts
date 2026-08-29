import { describe, expect, it } from 'vitest'
import { feedScript, reactScript, commentScript, replyScript, shareScript, followScript, hideScript, REACTION_TYPES, __testing } from './facebookBridge'

/**
 * The variables shape came from a real CometNewsFeedPaginationQuery captured
 * live, not from documentation — see probes/FINDINGS-facebook.md. The
 * properties pinned here are the ones whose failure would not be loud: a
 * trimmed variables object that Facebook rejects with
 * missing_required_variable_value, a response silently read as empty because
 * of the incremental-delivery streaming format, or a feed item's absent text
 * misread as a failed call.
 */

describe('the variables template is captured, not reconstructed', () => {
  it('keeps every __relay_internal__pv__ flag from the real capture', () => {
    // A first version trimmed this down to "the fields that seemed to matter"
    // and Facebook returned missing_required_variable_value — GraphQL requires
    // every declared variable, and there is no way to know which from outside.
    const keys = Object.keys(__testing.FEED_VARIABLES_TEMPLATE)
    const relayFlags = keys.filter(k => k.startsWith('__relay_internal__pv__'))
    expect(relayFlags.length).toBeGreaterThan(30)
  })

  it('disables incremental delivery, so the response is one document', () => {
    // The captured request had RELAY_INCREMENTAL_DELIVERY:true, which streams
    // the response as newline-delimited JSON with @defer patches carrying the
    // actual post text (comet_sections). A plain JSON.parse on that multi-line
    // body throws and silently yields nothing. Verified live: setting this
    // false makes Facebook return one complete document with text inlined.
    expect(__testing.FEED_VARIABLES_TEMPLATE.RELAY_INCREMENTAL_DELIVERY).toBe(false)
  })

  it('empties recentVPVs rather than fabricating view-tracking telemetry', () => {
    // Confirmed safe to drop by testing a real request, not assumed — it is
    // client-side view-position telemetry, not something the query needs data
    // from to answer.
    expect(__testing.FEED_VARIABLES_TEMPLATE.recentVPVs).toEqual([])
  })
})

describe('feedScript', () => {
  const script = feedScript(5)

  it('parses as JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('reads fb_dtsg fresh from the page rather than caching a stale value', () => {
    // fb_dtsg can rotate within a session; caching it across calls is how a
    // long-running tool starts failing partway through a run for no visible
    // reason.
    expect(script).toContain('function dtsg()')
    expect(script).toContain('document.documentElement.innerHTML')
  })

  it('reads the user id from the c_user cookie, not a regex over the page', () => {
    // Verified live: c_user is present and reliable; scraping USER_ID out of
    // inline HTML was the first approach tried and is more fragile.
    expect(script).toContain("document.cookie.match(/c_user=")
  })

  it('parses only the first line of the response', () => {
    // Even with RELAY_INCREMENTAL_DELIVERY:false the body is newline-terminated.
    // A bare JSON.parse(text) happens to work here but relies on the trailing
    // newline being harmless rather than handling the shape explicitly.
    expect(script).toContain('split(String.fromCharCode(10))')
  })

  it('sends the request as form-urlencoded, not JSON', () => {
    // Facebook's GraphQL endpoint takes a form body (fb_dtsg, doc_id, variables
    // as top-level fields), unlike LinkedIn's JSON-bodied GraphQL. Sending JSON
    // here would be rejected outright.
    expect(script).toContain("'content-type': 'application/x-www-form-urlencoded'")
  })

  it('overrides only count, cursor, clientQueryId and recentVPVs per call', () => {
    expect(script).toContain('clientQueryId:')
    expect(script).toContain('count: 5')
  })

  it('escapes a cursor rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = feedScript(5, nasty)
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('reading the response without over-trusting its shape', () => {
  const script = feedScript(5)

  it('treats a missing message.text as "not this kind of post", not a failure', () => {
    // Ads and recommendation units carry no text at the message.text path.
    // Verified live: 2 of 4 real feed items had null text and null author,
    // and that is correct, not a partial failure.
    expect(script).toContain('|| null')
  })

  it('requires the response before claiming success', () => {
    expect(script).toContain('res.status !== 200 || !res.json')
    expect(script).toContain('did not confirm the feed request')
  })

  it('surfaces GraphQL errors distinctly from a transport failure', () => {
    expect(script).toContain('res.json.errors')
  })

  it('names the likely cause when the doc_id has rotated', () => {
    // doc_id is a build-specific identifier, Facebook's equivalent of
    // LinkedIn's queryId, and will change when Facebook ships a new client.
    expect(script).toContain('may have rotated')
  })

  it('returns pagination info so a caller can read further without guessing', () => {
    expect(script).toContain('nextCursor')
    expect(script).toContain('hasNextPage')
  })
})

describe('reaction type ids', () => {
  it('carries all seven, each read off a real request the client sent', () => {
    // Love, Sad, Care were independently confirmed: sent to a post that ended
    // up with exactly one reaction (reaction_count: 1), so the response's own
    // top_reactions[0] could only be naming the reaction just sent. Like,
    // Haha, Wow, Angry are the id the live client transmitted when that
    // reaction was clicked, on posts that already carried others' reactions.
    expect(Object.keys(REACTION_TYPES).sort()).toEqual(
      ['angry', 'care', 'haha', 'like', 'love', 'sad', 'wow'].sort()
    )
  })

  it('are the exact numeric ids captured, not a third-party reference list', () => {
    expect(REACTION_TYPES.love).toBe('1678524932434102')
    expect(REACTION_TYPES.sad).toBe('908563459236466')
    expect(REACTION_TYPES.care).toBe('613557422527858')
  })
})

describe('reactScript', () => {
  const script = reactScript('ZmVlZGJhY2s6MTIz', 'love')

  it('parses as JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('sends the captured mutation shape', () => {
    expect(script).toContain('27646120298312844')
    expect(script).toContain("'CometUFIFeedbackReactMutation'")
    expect(script).toContain('feedback_id:')
    expect(script).toContain('feedback_reaction_id:')
  })

  it('omits attribution_id_v2 and tracking, verified live as unnecessary', () => {
    // The real capture carried an encrypted `tracking` blob and an
    // `attribution_id_v2` breadcrumb naming the page surface the click came
    // from — the same class of page-bound telemetry as this bridge's own
    // recentVPVs. Tested reversibly (changed an existing reaction, then
    // changed it straight back): a payload omitting both is accepted with 200
    // and no errors.
    expect(script).not.toContain('attribution_id_v2')
    expect(script).not.toContain('tracking')
  })

  it('requires the reaction echoed back, not just a 200', () => {
    expect(script).toContain('!fb')
    expect(script).toContain('did not confirm the reaction')
  })

  it('names the likely cause when the mutation doc_id has rotated', () => {
    expect(script).toContain('may have rotated')
  })

  it('escapes the feedback id rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = reactScript(nasty, 'like')
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('feed exposes feedbackId, which reactions need and postId is not', () => {
  it('reads node.feedback.id, not node.post_id, into feedbackId', () => {
    const script = feedScript(5)
    expect(script).toContain('feedbackId:')
    expect(script).toContain('node.feedback && node.feedback.id')
  })
})

describe('commentScript', () => {
  const script = commentScript('ZmVlZGJhY2s6MTIz', 'nice post')

  it('parses as JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('sends the captured mutation shape, text in variables.input.message.text', () => {
    expect(script).toContain('27687311557628355')
    expect(script).toContain("'useCometUFICreateCommentMutation'")
    expect(script).toContain('variables.input.message.text =')
  })

  it('carries the FULL captured variables object, not a hand-picked subset', () => {
    // A hand-picked subset — six input fields plus three top-level ones —
    // returned missing_required_variable_value on a real, approved, live
    // attempt. The missing fields were never guessed correctly because they
    // were never looked for: session_id, idempotence_token, and a dozen
    // top-level fields including five more __relay_internal__pv__ flags.
    // Fixed the same way the feed script already had to be: copy the entire
    // captured object, override only what must vary per call.
    const keys = Object.keys(__testing.COMMENT_VARIABLES_TEMPLATE)
    expect(keys).toContain('translationType')
    expect(keys).toContain('canUseNicknameOnComet')
    expect(keys).toContain('focusCommentID')
    expect(keys).toContain('inviteShortLinkKey')
    expect(keys.filter(k => k.startsWith('__relay_internal__pv__')).length).toBeGreaterThanOrEqual(5)
    expect(Object.keys(__testing.COMMENT_VARIABLES_TEMPLATE.input)).toContain('session_id')
    expect(Object.keys(__testing.COMMENT_VARIABLES_TEMPLATE.input)).toContain('idempotence_token')
  })

  it('generates a fresh session_id and idempotence_token per call', () => {
    expect(script).toContain("variables.input.session_id = 'flowdesk-'")
    expect(script).toContain("variables.input.idempotence_token = 'client:'")
  })

  it('defaults groupID to null, confirmed accepted for a plain feed post', () => {
    // A second real capture on a non-group post carried groupID: null and
    // succeeded — so null is sent deliberately, not a gap left by guessing.
    expect(commentScript('x', 'y')).toContain('variables.groupID = null')
  })

  it('sends the group id when the post lives inside a group', () => {
    expect(commentScript('x', 'y', 'group123')).toContain('variables.groupID = "group123"')
  })

  it('keeps feedLocation fixed at the value both real captures used', () => {
    // Identical across a group-post capture and a plain-feed-post capture,
    // so it is sent as a constant rather than varied on an untested theory.
    expect(__testing.COMMENT_VARIABLES_TEMPLATE.feedLocation).toBe('POST_PERMALINK_DIALOG')
  })

  it('ships attribution_id_v2 and tracking with real captured values, not trimmed on an unverified guess', () => {
    // Dropping these entirely was tried first, on the (wrong, for this
    // mutation) precedent that it worked for reactScript. It is not evidence
    // for a different mutation in the same API family — trimming here would
    // need its own live verification, not assumed here.
    expect(__testing.COMMENT_VARIABLES_TEMPLATE.input.attribution_id_v2).toBeTruthy()
    expect(__testing.COMMENT_VARIABLES_TEMPLATE.input).toHaveProperty('tracking')
  })

  it('requires the comment echoed back, not just a 200', () => {
    expect(script).toContain('!fb')
    expect(script).toContain('did not confirm the comment')
  })

  it('names the likely cause when the mutation doc_id has rotated', () => {
    expect(script).toContain('may have rotated')
  })

  it('escapes the comment text rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = commentScript('x', nasty)
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('replyScript', () => {
  const script = replyScript('1380867884232663', '2272040403544271', 'thanks')

  it('parses as JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('uses the same mutation and doc_id as a plain comment', () => {
    // Confirmed live: a reply is the same useCometUFICreateCommentMutation,
    // not a separate reply endpoint.
    expect(script).toContain('27687311557628355')
    expect(script).toContain("'useCometUFICreateCommentMutation'")
  })

  it('targets the comment own feedback thread, not the post', () => {
    // Decoded from a real reply: feedback_id is
    // base64("feedback:<postId>_<commentId>") — the comment's own thread —
    // not the post's feedbackId a plain top-level comment uses.
    expect(script).toContain("btoa('feedback:' + postId + '_' + commentId)")
  })

  it('sets reply_comment_parent_fbid, the field a plain comment never carries', () => {
    expect(script).toContain("btoa('comment:' + postId + '_' + commentId)")
    expect(script).toContain('reply_comment_parent_fbid')
  })

  it('sets reply_target_clicked, confirmed present on every real reply captured', () => {
    expect(script).toContain('reply_target_clicked = true')
  })

  it('carries the full comment variables template, not a re-guessed subset', () => {
    // The plain comment mutation already had to learn this the hard way; a
    // reply is the same mutation, so it needs the same ~20 fields, inlined
    // as real values rather than assumed present some other way.
    expect(script).toContain('translationType')
    expect(script).toContain('canUseNicknameOnComet')
    expect(script.match(/__relay_internal__pv__/g)?.length ?? 0).toBeGreaterThanOrEqual(5)
  })

  it('requires the reply echoed back, not just a 200', () => {
    expect(script).toContain('!fb')
    expect(script).toContain('did not confirm the reply')
  })

  it('escapes the reply text rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = replyScript('1', '2', nasty)
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('shareScript', () => {
  const script = shareScript('https://www.facebook.com/x/posts/123', 'check this out')

  it('fetches share_scrape_data from the share-dialog query instead of guessing an id', () => {
    // A first approach tried to match a photo share's share_params against
    // feedScript's postId and failed — the ids are from different namespaces
    // for photo posts. The fix used here mirrors what Facebook's own client
    // does: ask CometUnifiedShareSheetDialogQuery for it, using the post's
    // own permalink, and read share_scrape_data back off the response.
    expect(script).toContain('CometUnifiedShareSheetDialogQuery')
    expect(script).toContain('share_scrape_data')
  })

  it('sends both shareableParams and storyParams as real URLs, not null', () => {
    // shareableParams: null produced noncoercible_argument_value live — both
    // fields need a real url, even for a plain (non-photo) post.
    expect(script).toContain('shareableParams: { url: permalink }')
    expect(script).toContain('storyParams: { url: permalink }')
  })

  it('defaults audience to FRIENDS, the only privacy value confirmed live', () => {
    expect(shareScript('https://www.facebook.com/x/posts/123')).toContain('base_state: "FRIENDS"')
  })

  it('passes through an explicit privacy override', () => {
    expect(shareScript('https://www.facebook.com/x/posts/123', '', 'SELF')).toContain('base_state: "SELF"')
  })

  it('carries the reshare_original_post flag captured from the real mutation', () => {
    expect(script).toContain('RESHARE_ORIGINAL_POST')
  })

  it('requires the story echoed back, not just a 200', () => {
    expect(script).toContain('!story')
    expect(script).toContain('did not confirm the share')
  })

  it('escapes the message text rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = shareScript('https://www.facebook.com/x/posts/123', nasty)
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('followScript', () => {
  const script = followScript('100050500269286')

  it('targets subscribee_id, confirmed from a real CometUserFollowMutation capture', () => {
    expect(script).toContain('subscribee_id: "100050500269286"')
    expect(script).toContain("subscribe_location: 'PROFILE'")
  })

  it('requires the subscribee echoed back, not just a 200', () => {
    expect(script).toContain('!subscribee')
    expect(script).toContain('did not confirm the follow')
  })

  it('does not fabricate an unfollow direction', () => {
    // Only actor_subscribe (follow) has been captured live. Unfollow is very
    // likely a different mutation with its own doc_id, not a boolean toggle
    // on this one — asserting that no such thing was invented here.
    expect(script).not.toContain('unsubscribe')
    expect(script).not.toContain('unfollow')
  })
})

describe('hideScript', () => {
  const script = hideScript('some-node-id')

  it('opens the post menu first instead of constructing hideable_token', () => {
    // hideable_token and story_permalink_token are large opaque
    // session-scoped tokens Facebook computes server-side; the fix (like
    // shareScript's share_scrape_data) is to fetch them fresh via
    // CometFeedStoryMenuQuery rather than reconstruct them.
    expect(script).toContain('CometFeedStoryMenuQuery')
    expect(script).toContain('nfx_action_menu_items')
  })

  it('picks the menu item whose action.type is HIDE, not just the first NFX item', () => {
    // The same menu also lists Snooze, Unfollow, and Report entries with an
    // identical shape (action.context, hideable_token, ...) — picking "the
    // first NFX-shaped item" would silently fire the wrong action.
    expect(script).toContain("items[i].action.type === 'HIDE'")
  })

  it('forwards the menu item context verbatim, not reconstructed', () => {
    expect(script).toContain('context: hideItem.action.context')
  })

  it('sends HIDE_XOUT, confirmed from a real live hide click', () => {
    expect(script).toContain("type: 'HIDE_XOUT'")
  })

  it('does not also fire the post-hide "unfollow this page too" prompt', () => {
    // A real hide click was followed by a separate UNSUBSCRIBE_DIRECTED_TARGET
    // mutation from Facebook's own "want to see fewer posts from this Page"
    // follow-up. That is a distinct action the user did not ask for here.
    expect(script).not.toContain('UNSUBSCRIBE_DIRECTED_TARGET')
  })

  it('fails cleanly when the post has no Hide option, without guessing a fallback', () => {
    expect(script).toContain('no Hide option found')
  })

  it('requires the execute result echoed back, not just a 200', () => {
    expect(script).toContain('!executed')
    expect(script).toContain('did not confirm the hide')
  })
})
