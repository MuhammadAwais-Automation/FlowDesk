/**
 * Facebook feed bridge — built entirely on what live capture actually showed,
 * not on any documented or assumed shape.
 *
 * ── The wire format, and why it is not like LinkedIn's ──
 *
 * Facebook's client is Relay/GraphQL over a form-encoded POST, not JSON:
 *
 *   POST /api/graphql/
 *   content-type: application/x-www-form-urlencoded
 *   fb_dtsg=<token>&doc_id=28162094913407624&variables=<json>&...
 *
 * `doc_id` is the query identity (Facebook's equivalent of LinkedIn's
 * `queryId`) — a build-specific number that will rotate when Facebook ships a
 * new client. `fb_dtsg` is the CSRF-equivalent token, read fresh from the page
 * on every call rather than cached, since it can rotate within a session.
 *
 * ── The recorder's own default was wrong for this site ──
 *
 * The CDP recorder capped captured POST bodies at 2000 characters. That was
 * fine for LinkedIn's compact JSON payloads; it silently ate Facebook's,
 * because the body leads with tens of thousands of characters of obfuscated
 * `__dyn`/`__csr` routing state before `fb_dtsg`, `doc_id` and `variables` ever
 * appear. The first several capture attempts here showed those three fields as
 * simply absent — not malformed, absent — until the cap was raised to match
 * `MAX_BODY_SCAN` (see electron/discovery/cdpRecorder.ts).
 *
 * ── The variables template is captured verbatim, not reconstructed ──
 *
 * `variables` carries ~40 fields, most of them `__relay_internal__pv__*`
 * Relay build-time flags the query declares as required. A first attempt
 * guessed a small subset of "the fields that seemed to matter" and Facebook
 * returned `missing_required_variable_value` — GraphQL requires every declared
 * variable, and there was no way to know which ones from the outside. The
 * working version keeps the ENTIRE captured object and only overrides `count`,
 * `cursor`, `clientQueryId` and `recentVPVs` (session view-tracking telemetry,
 * confirmed safe to empty by testing, not by assumption).
 *
 * ── The response is not one JSON document ──
 *
 * `RELAY_INCREMENTAL_DELIVERY: true` in the captured variables makes Facebook
 * stream the response as newline-delimited JSON: an initial payload followed by
 * `@defer` patch chunks that fill in fields like `comet_sections` (where the
 * post's actual text lives) on a path basis (`{"path":["viewer","news_feed",
 * "edges",0,"node","comet_sections"],"data":{...}}`). A plain `JSON.parse(text)`
 * throws on the whole multi-line body and silently yields nothing — the same
 * shape of bug as every other "looked like success, was actually empty" mistake
 * in this project, just from a different cause.
 *
 * The fix used here is simpler than merging patches: set
 * `RELAY_INCREMENTAL_DELIVERY: false` in the sent variables. Facebook honours
 * it and returns one complete document as the first line, with every post's
 * full `comet_sections` already inlined. Verified live: four real posts came
 * back with author, message text and permalink in one round trip.
 */

/**
 * Captured from a real `CometNewsFeedPaginationQuery`, sanitised: `cursor` set
 * to null (was a real pagination token), `recentVPVs` emptied (session
 * view-tracking, confirmed safe to drop by testing), `clientQueryId` replaced
 * with a placeholder substituted at call time. Every `__relay_internal__pv__*`
 * flag is kept exactly as captured — trimming any of them is what produced
 * `missing_required_variable_value` on the first attempt.
 */
const FEED_VARIABLES_TEMPLATE = {
  RELAY_INCREMENTAL_DELIVERY: false,
  clientQueryId: '__CLIENT_QUERY_ID__',
  clientSession: null,
  connectionClass: 'EXCELLENT',
  count: 5,
  cursor: null as string | null,
  experimentalValues: null,
  feedLocation: 'NEWSFEED',
  feedStyle: 'DEFAULT',
  feedbackSource: 1,
  focusCommentID: null,
  orderby: ['TOP_STORIES'],
  privacySelectorRenderLocation: 'COMET_STREAM',
  recentVPVs: [] as unknown[],
  referringStoryRenderLocation: null,
  refreshMode: 'AUTO',
  renderLocation: 'homepage_stream',
  scale: 1,
  shouldChangeBRSLabelFieldName: false,
  shouldObfuscateCategoryField: true,
  shouldUseBRSLabelFieldNameV1: false,
  shouldUseBRSLabelFieldNameV2: false,
  useDefaultActor: false,
  __relay_internal__pv__GHLShouldChangeSponsoredAuctionDistanceFieldNamerelayprovider: true,
  __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV1relayprovider: true,
  __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV2relayprovider: false,
  __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
  __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
  __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
  __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider: false,
  __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
  __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
  __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
  __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
  __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider: false,
  __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
  __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
  __relay_internal__pv__IsMergQAPollsrelayprovider: false,
  __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
  __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
  __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
  __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
  __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider: true,
  __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
  __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider: false,
  __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
  __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
  __relay_internal__pv__StoriesShouldEnablePhotosensitiveContentWarningrelayprovider: false,
  __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
  __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
}

/** Query identity for the news-feed page. Will rotate when Facebook ships a new client. */
const FEED_DOC_ID = '28162094913407624'
const GRAPHQL_URL = '/api/graphql/'

const PRELUDE = `
  var FEED_VARIABLES_TEMPLATE = ${JSON.stringify(FEED_VARIABLES_TEMPLATE)}
  var FEED_DOC_ID = ${JSON.stringify(FEED_DOC_ID)}
  var GRAPHQL_URL = ${JSON.stringify(GRAPHQL_URL)}

  function dtsg() {
    var m = /"token":"([^"]{10,80})"/.exec(document.documentElement.innerHTML || '')
    return m ? m[1] : null
  }
  function userId() {
    var m = document.cookie.match(/c_user=(\\d+)/)
    return m ? m[1] : null
  }

  async function graphql(docId, friendlyName, variables) {
    var token = dtsg()
    var uid = userId()
    if (!token) return { status: 0, error: 'no fb_dtsg token found on the page — not signed in to Facebook' }
    if (!uid) return { status: 0, error: 'no c_user cookie — not signed in to Facebook' }

    var body = new URLSearchParams()
    body.set('av', uid)
    body.set('__user', uid)
    body.set('__a', '1')
    body.set('fb_dtsg', token)
    body.set('fb_api_caller_class', 'RelayModern')
    body.set('fb_api_req_friendly_name', friendlyName)
    body.set('doc_id', docId)
    body.set('variables', JSON.stringify(variables))

    var res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    var text = await res.text()

    // With RELAY_INCREMENTAL_DELIVERY:false the whole response is one JSON
    // document as the first line. It is still newline-terminated, so split
    // rather than assume — a bare JSON.parse(text) on a trailing newline is
    // usually harmless, but relying on that instead of handling it explicitly
    // is exactly the kind of assumption this bridge exists to avoid.
    var firstLine = String(text).split(String.fromCharCode(10))[0]
    var json = null
    try { json = JSON.parse(firstLine) } catch (e) {}

    return { status: res.status, json: json, raw: firstLine }
  }

  function safe(value) {
    try { return JSON.parse(JSON.stringify(value)) } catch (e) { return null }
  }
`

function buildScript(body: string): string {
  return `(async function () {
${PRELUDE}
    try {
${body}
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  })()`
}

/**
 * Reads the news feed.
 *
 * `cursor` pages further into the feed; omit it for the first page.
 */
export function feedScript(count: number, cursor?: string | null): string {
  return buildScript(`
    var variables = Object.assign({}, FEED_VARIABLES_TEMPLATE, {
      clientQueryId: 'flowdesk-' + Date.now(),
      count: ${JSON.stringify(count)},
      cursor: ${JSON.stringify(cursor ?? null)},
      recentVPVs: [],
    })

    var res = await graphql(FEED_DOC_ID, 'CometNewsFeedPaginationQuery', variables)
    if (res.status !== 200 || !res.json) {
      return {
        ok: false,
        error: 'Facebook did not confirm the feed request (HTTP ' + res.status + ')',
        detail: res.raw ? res.raw.slice(0, 300) : null,
        hint: res.status === 400 || res.status === 404
          ? 'FEED_DOC_ID may have rotated — read one feed page by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }
    if (res.json.errors) {
      return { ok: false, error: 'Facebook rejected the request', detail: JSON.stringify(res.json.errors).slice(0, 400) }
    }

    var edges = (res.json.data && res.json.data.viewer && res.json.data.viewer.news_feed
      && res.json.data.viewer.news_feed.edges) || []

    var posts = []
    for (var i = 0; i < edges.length; i++) {
      var node = edges[i] && edges[i].node
      if (!node) continue
      var story = null
      try { story = node.comet_sections.content.story } catch (e) {}

      posts.push({
        postId: node.post_id || null,
        // The id every write action (react, comment) targets. Distinct from
        // postId — verified against the live reaction mutation, which rejects
        // a bare post_id.
        feedbackId: (node.feedback && node.feedback.id) || null,
        author: (node.feedback && node.feedback.owning_profile && node.feedback.owning_profile.name) || null,
        // The id follow/unfollow targets (CometUserFollowMutation's
        // subscribee_id) — confirmed present on owning_profile by a live
        // read-only probe before being added here, not assumed.
        authorId: (node.feedback && node.feedback.owning_profile && node.feedback.owning_profile.id) || null,
        // The raw Relay node id (a big opaque base64 token), needed as the
        // id variable for CometFeedStoryMenuQuery — the query that opening
        // a post's "..." menu fires, and hideScript's entry point.
        nodeId: node.id || null,
        // Not every unit is a text post — ads and some recommendation units
        // carry no message.text at this path. null here means "not this kind
        // of post", not "the read failed".
        text: (story && story.message && story.message.text) || null,
        permalink: (story && story.wwwURL) || null,
        createdAt: node.creation_time || null,
        typename: node.__typename || null,
      })
    }

    var pageInfo = (res.json.data && res.json.data.viewer && res.json.data.viewer.news_feed
      && res.json.data.viewer.news_feed.page_info) || null

    return {
      ok: true,
      count: posts.length,
      posts: safe(posts),
      nextCursor: pageInfo ? pageInfo.end_cursor : null,
      hasNextPage: pageInfo ? !!pageInfo.has_next_page : null,
    }
  `)
}

/**
 * Reacting to a post.
 *
 * Captured from `CometUFIFeedbackReactMutation`:
 *
 *   POST /api/graphql/  doc_id=27646120298312844
 *   variables.input: { feedback_id, feedback_reaction_id, feedback_source: "OBJECT",
 *                       session_id, actor_id, client_mutation_id }
 *   -> 200 { data: { feedback_react: { feedback: { id, reaction_count, top_reactions } } } }
 *
 * The real capture also carried `attribution_id_v2` and `tracking` — an
 * encrypted blob and a page-instance breadcrumb, the same class of page-bound
 * telemetry as LinkedIn's `origin` and this bridge's own `recentVPVs`. Tested
 * live and reversibly (changed an existing reaction, then changed it straight
 * back): a payload with both fields OMITTED is accepted with 200 and no
 * errors. Kept out rather than fabricated.
 *
 * `feedback_id` is NOT the post id `feedScript` also returns — it is a
 * separate identifier the feed read exposes as `feedbackId`. The mutation
 * rejects a bare post id.
 *
 * ── The reaction type ids ──
 *
 * All seven were read directly off real requests the Facebook client sent
 * when each reaction was actually chosen by hand — not guessed and not taken
 * from any third-party list. Two levels of confidence, both from this
 * capture:
 *
 *   independently confirmed  — Love, Sad, Care: sent to a post carrying
 *     exactly one reaction afterwards (reaction_count: 1), so the response's
 *     own top_reactions[0] could only be naming that just-sent reaction.
 *
 *   confirmed by the request itself — Like, Haha, Wow, Angry: the id the
 *     live Facebook client actually transmitted at the moment that reaction
 *     was clicked, on posts that already carried other people's reactions
 *     (so the response's aggregate top_reactions list could not be used as a
 *     second, independent check the way it was for the first three).
 *
 * Only these seven are supported. A wrong id here would silently send the
 * wrong reaction — exactly the "field that lies" class of bug this project
 * keeps a catalogue of — so nothing is extrapolated beyond what was captured.
 */
export const REACTION_TYPES = {
  like: '1635855486666999',
  love: '1678524932434102',
  care: '613557422527858',
  haha: '115940658764963',
  wow: '478547315650144',
  sad: '908563459236466',
  angry: '444813342392137',
} as const

export type ReactionType = keyof typeof REACTION_TYPES

const REACT_DOC_ID = '27646120298312844'

export function reactScript(feedbackId: string, reactionType: ReactionType): string {
  const reactionId = REACTION_TYPES[reactionType]
  return buildScript(`
    var variables = {
      input: {
        feedback_id: ${JSON.stringify(feedbackId)},
        feedback_reaction_id: ${JSON.stringify(reactionId)},
        feedback_source: 'OBJECT',
        session_id: 'flowdesk-' + Date.now(),
        actor_id: userId(),
        client_mutation_id: String(Date.now()),
      },
      scale: 1,
      canUseNicknameOnComet: false,
      useDefaultActor: false,
      __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
    }

    var res = await graphql(${JSON.stringify(REACT_DOC_ID)}, 'CometUFIFeedbackReactMutation', variables)

    // Success is the server's own echo of the reaction, not the request
    // resolving. A 200 with no feedback_react is a failure — the same rule
    // every other write in this codebase learned the hard way.
    var fb = res.json && res.json.data && res.json.data.feedback_react && res.json.data.feedback_react.feedback

    if (res.status !== 200 || !fb || res.json.errors) {
      return {
        ok: false,
        error: 'Facebook did not confirm the reaction (HTTP ' + res.status + ')',
        detail: res.json && res.json.errors ? JSON.stringify(res.json.errors).slice(0, 300) : (res.raw ? res.raw.slice(0, 300) : null),
        hint: res.status === 400 || res.status === 404
          ? 'the reaction mutation doc_id may have rotated — react to one post by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }

    return {
      ok: true,
      reacted: true,
      reactionType: ${JSON.stringify(reactionType)},
      feedbackId: fb.id,
      reactionCount: fb.reaction_count ? fb.reaction_count.count : null,
    }
  `)
}

/**
 * Commenting on a post.
 *
 * ── The first version guessed a subset of fields and was wrong ──
 *
 * A hand-picked subset — feedLocation, feedbackSource, groupID, and six input
 * fields — returned `missing_required_variable_value` on a real, approved,
 * live attempt. The cause was not the two fields trimmed on the (correct)
 * precedent from reactScript; it was **entirely different fields that were
 * never included at all**: `session_id`, `idempotence_token`, and a dozen
 * top-level fields (`translationType`, `canUseNicknameOnComet`,
 * `focusCommentID`, `inviteShortLinkKey`, `renderLocation`, `scale`,
 * `useDefaultActor`, five more `__relay_internal__pv__*` flags). The first
 * capture reviewed had been read past too quickly to notice they were there.
 *
 * The fix is the one this project's own findings already state as the rule:
 * copy the ENTIRE captured object verbatim, the same way `FEED_VARIABLES_TEMPLATE`
 * does, and override only what actually needs to vary per call. This mutation
 * template does that.
 *
 *   POST /api/graphql/  doc_id=27687311557628355
 *   fb_api_req_friendly_name=useCometUFICreateCommentMutation
 *
 * `feedLocation: "POST_PERMALINK_DIALOG"` and `groupID: null` are both
 * confirmed-real values from a genuine, successful, non-group comment — not
 * placeholders. `attribution_id_v2` and `tracking` are shipped with their real
 * captured values rather than trimmed a second time on an unverified guess;
 * trimming them for comments, if wanted, is a separate thing to verify later,
 * not something to assume from the reaction mutation working that way.
 */
const COMMENT_DOC_ID = '27687311557628355'

const COMMENT_VARIABLES_TEMPLATE = {
  feedLocation: 'POST_PERMALINK_DIALOG',
  feedbackSource: 2,
  groupID: null as string | null,
  input: {
    client_mutation_id: '__CLIENT_MUTATION_ID__',
    attachments: null,
    feedback_id: '__FEEDBACK_ID__',
    formatting_style: null,
    is_inline_vote_enabled_for_qna: false,
    message: { ranges: [] as unknown[], text: '__TEXT__' },
    attribution_id_v2:
      'CometSinglePostDialogRoot.react,comet.post.single_dialog,unexpected,0,0,,,;' +
      'CometHomeRoot.react,comet.home,unexpected,0,0,0,,;CometHomeRoot.react,comet.home,logo,0,0,0,,',
    vod_video_timestamp: null,
    is_tracking_encrypted: true,
    tracking: [] as unknown[],
    feedback_source: 'OBJECT',
    idempotence_token: '__IDEMPOTENCE_TOKEN__',
    session_id: '__SESSION_ID__',
  },
  inviteShortLinkKey: null,
  renderLocation: null,
  scale: 1,
  useDefaultActor: false,
  focusCommentID: null,
  translationType: 'AUTO_TRANSLATE',
  canUseNicknameOnComet: false,
  __relay_internal__pv__groups_comet_use_glvrelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
}

export function commentScript(feedbackId: string, text: string, groupId: string | null = null): string {
  return buildScript(`
    var variables = JSON.parse(JSON.stringify(${JSON.stringify(COMMENT_VARIABLES_TEMPLATE)}))
    variables.groupID = ${JSON.stringify(groupId)}
    variables.input.feedback_id = ${JSON.stringify(feedbackId)}
    variables.input.message.text = ${JSON.stringify(text)}
    variables.input.client_mutation_id = String(Date.now())
    variables.input.session_id = 'flowdesk-' + Date.now()
    variables.input.idempotence_token = 'client:' + 'flowdesk-' + Date.now() + '-' + Math.random().toString(36).slice(2)

    var res = await graphql(${JSON.stringify(COMMENT_DOC_ID)}, 'useCometUFICreateCommentMutation', variables)

    // Success is the server's own comment_create echo, not the request
    // resolving — the same rule every other write in this codebase learned
    // the hard way.
    var fb = res.json && res.json.data && res.json.data.comment_create && res.json.data.comment_create.feedback

    if (res.status !== 200 || !fb || res.json.errors) {
      return {
        ok: false,
        error: 'Facebook did not confirm the comment (HTTP ' + res.status + ')',
        detail: res.json && res.json.errors ? JSON.stringify(res.json.errors).slice(0, 300) : (res.raw ? res.raw.slice(0, 300) : null),
        hint: res.status === 400 || res.status === 404
          ? 'the comment mutation doc_id may have rotated — comment on one post by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }

    return {
      ok: true,
      commented: true,
      text: ${JSON.stringify(text)},
      commentCount: fb.comment_rendering_instance && fb.comment_rendering_instance.comments
        ? fb.comment_rendering_instance.comments.total_count
        : null,
    }
  `)
}

/**
 * Replying to a comment.
 *
 * Captured live from a real reply: same mutation as a top-level comment
 * (`useCometUFICreateCommentMutation`, same doc_id), with two input fields a
 * plain comment never carries, and one field pointed at the COMMENT rather
 * than the post:
 *
 *   input.feedback_id               = base64("feedback:<postId>_<commentId>")
 *                                      <- the COMMENT's own feedback thread,
 *                                         not the post's feedbackId
 *   input.reply_comment_parent_fbid = base64("comment:<postId>_<commentId>")
 *   input.reply_target_clicked      = true
 *
 * Both ids were confirmed by decoding the real base64 values a live reply
 * sent: `feedback:1380867884232663_2272040403544271` and
 * `comment:1380867884232663_2272040403544271` — the same `<postId>_<commentId>`
 * pair, two different prefixes. Encoded here with `btoa`, the same function
 * the real client's own encoding produces byte-for-byte.
 *
 * Everything else — the ~20 top-level and input fields the plain comment
 * mutation needed once its full shape was actually read — carries over
 * unchanged from `COMMENT_VARIABLES_TEMPLATE`, on the same "copy the whole
 * object" rule that mutation itself had to learn the hard way.
 */
export function replyScript(postId: string, commentId: string, text: string, groupId: string | null = null): string {
  return buildScript(`
    var variables = JSON.parse(JSON.stringify(${JSON.stringify(COMMENT_VARIABLES_TEMPLATE)}))
    variables.groupID = ${JSON.stringify(groupId)}
    variables.input.message.text = ${JSON.stringify(text)}
    variables.input.client_mutation_id = String(Date.now())
    variables.input.session_id = 'flowdesk-' + Date.now()
    variables.input.idempotence_token = 'client:' + 'flowdesk-' + Date.now() + '-' + Math.random().toString(36).slice(2)

    var postId = ${JSON.stringify(postId)}
    var commentId = ${JSON.stringify(commentId)}
    variables.input.feedback_id = btoa('feedback:' + postId + '_' + commentId)
    variables.input.reply_comment_parent_fbid = btoa('comment:' + postId + '_' + commentId)
    variables.input.reply_target_clicked = true

    var res = await graphql(${JSON.stringify(COMMENT_DOC_ID)}, 'useCometUFICreateCommentMutation', variables)

    var fb = res.json && res.json.data && res.json.data.comment_create && res.json.data.comment_create.feedback

    if (res.status !== 200 || !fb || res.json.errors) {
      return {
        ok: false,
        error: 'Facebook did not confirm the reply (HTTP ' + res.status + ')',
        detail: res.json && res.json.errors ? JSON.stringify(res.json.errors).slice(0, 300) : (res.raw ? res.raw.slice(0, 300) : null),
        hint: res.status === 400 || res.status === 404
          ? 'the comment mutation doc_id may have rotated — reply to one comment by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }

    return { ok: true, replied: true, text: ${JSON.stringify(text)} }
  `)
}

/**
 * Sharing (reposting) a post to the feed.
 *
 * ── Why this could not be solved by matching ids ──
 *
 * The write mutation (`ComposerStoryCreateMutation`) needs
 * `input.attachments[0].link.share_scrape_data`, a JSON string like
 * `{"share_type":37,"share_params":[<id>]}`. The first capture obtained was a
 * PHOTO share, where that id (122320400270199656) did NOT match either the
 * photo's own fbid from its share-dialog URL (122320400228199656) or any
 * `postId` `feedScript` returns. Treating this as a matching problem — "which
 * of feedScript's fields equals this number" — was the wrong approach.
 *
 * ── The actual fix: ask Facebook for it, the same way its own client does ──
 *
 * Before a real share is submitted, the client fires a read-only query,
 * `CometUnifiedShareSheetDialogQuery`, passing the post's own permalink URL
 * (the same `permalink` field `feedScript` already returns). Facebook's
 * response carries `data.link_preview.share_scrape_data` — already in the
 * exact string shape the write mutation needs, computed server-side. No
 * client-side id math or matching is needed at all.
 *
 * Verified live and read-only (no post was created): calling this query with
 * a real permalink returned `share_scrape_data` whose embedded id
 * (27599915689690169) was IDENTICAL to that post's own permalink id — proving
 * the mismatch seen on the photo capture was specific to photo posts (which
 * apparently have a separate id namespace), not a sign the whole approach was
 * wrong. Fetching it fresh per post sidesteps the need to know which
 * namespace applies.
 *
 * `shareableParams.url` and `storyParams.url` both need a real URL — passing
 * `shareableParams: null` (a natural first guess, since only `storyParams`
 * seemed to vary in the one capture read closely) produced
 * `noncoercible_argument_value`. Both must be set, even to the same URL for a
 * plain (non-photo) post.
 *
 * ── The write mutation itself ──
 *
 *   POST /api/graphql/  doc_id=27300941309579835
 *   fb_api_req_friendly_name=ComposerStoryCreateMutation
 *
 * `input.audience.privacy.base_state` is the only field controlling who can
 * see the share. The one real capture obtained used `"FRIENDS"` (the poster's
 * own default audience) — no other value has been captured live. Other
 * `base_state` strings (`SELF`, `EVERYONE`, ...) are Facebook's well-documented,
 * years-stable Graph API privacy vocabulary rather than a build-specific
 * opaque id, so `shareScript` accepts an override — but only `'FRIENDS'` is
 * backed by a live capture; anything else is unverified until captured.
 */
const SHARE_DIALOG_DOC_ID = '27699349389751397'
const SHARE_CREATE_DOC_ID = '27300941309579835'

export type SharePrivacy = 'FRIENDS' | 'SELF' | 'EVERYONE'

export function shareScript(permalink: string, message: string = '', privacy: SharePrivacy = 'FRIENDS'): string {
  return buildScript(`
    var permalink = ${JSON.stringify(permalink)}

    var dialogRes = await graphql(${JSON.stringify(SHARE_DIALOG_DOC_ID)}, 'CometUnifiedShareSheetDialogQuery', {
      feedLocation: 'NEWSFEED',
      hasParentStory: true,
      isComposerDisabled: false,
      isLinkSharingEnabled: true,
      isShareToFeedDisabled: false,
      privacySelectorRenderLocation: 'COMET_COMPOSER',
      qe_optional_share_to_page: true,
      scale: 1,
      shareableParams: { url: permalink },
      storyParams: { url: permalink },
    })

    var linkPreview = dialogRes.json && dialogRes.json.data && dialogRes.json.data.link_preview
    var shareScrapeData = linkPreview && linkPreview.share_scrape_data

    if (dialogRes.status !== 200 || !shareScrapeData) {
      return {
        ok: false,
        error: 'Facebook did not return share data for this post (HTTP ' + dialogRes.status + ')',
        detail: dialogRes.json && dialogRes.json.errors ? JSON.stringify(dialogRes.json.errors).slice(0, 400) : (dialogRes.raw ? dialogRes.raw.slice(0, 300) : null),
        hint: dialogRes.status === 400 || dialogRes.status === 404
          ? 'the share-dialog doc_id may have rotated — open the Share dialog on one post by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }

    var variables = {
      input: {
        composer_entry_point: 'share_modal',
        composer_source_surface: 'feed_story',
        composer_type: 'share',
        idempotence_token: 'flowdesk-' + Date.now() + '_FEED',
        source: 'WWW',
        attachments: [{ link: { link_call_to_action_type: null, link_preview_photo_id: null, share_scrape_data: shareScrapeData } }],
        reshare_original_post: 'RESHARE_ORIGINAL_POST',
        audience: { privacy: { allow: [], base_state: ${JSON.stringify(privacy)}, deny: [], tag_expansion_state: 'UNSPECIFIED' } },
        is_tracking_encrypted: true,
        tracking: [],
        message: { ranges: [], text: ${JSON.stringify(message)} },
        logging: { composer_session_id: 'flowdesk-' + Date.now() },
        event_share_metadata: { surface: 'newsfeed' },
        actor_id: userId(),
        client_mutation_id: String(Date.now()),
      },
      feedLocation: 'NEWSFEED',
      feedbackSource: 1,
      focusCommentID: null,
      gridMediaWidth: null,
      groupID: null,
      scale: 1,
      privacySelectorRenderLocation: 'COMET_STREAM',
      checkPhotosToReelsUpsellEligibility: false,
      referringStoryRenderLocation: null,
      renderLocation: 'homepage_stream',
      useDefaultActor: false,
      inviteShortLinkKey: null,
      isFeed: true,
      isFundraiser: false,
      isFunFactPost: false,
      isGroup: false,
      isEvent: false,
      isTimeline: false,
      isSocialLearning: false,
      isPageNewsFeed: false,
      isProfileReviews: false,
      isWorkSharedDraft: false,
      __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
      __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
      __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
      __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
      __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
      __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
      __relay_internal__pv__IsWorkUserrelayprovider: false,
      __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
      __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
      __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
      __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider: false,
      __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
      __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
      __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
      __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
      __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider: false,
      __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
      __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
      __relay_internal__pv__IsMergQAPollsrelayprovider: false,
      __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
      __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider: true,
      __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider: false,
      __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
      __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
      __relay_internal__pv__StoriesShouldEnablePhotosensitiveContentWarningrelayprovider: false,
      __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
      __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
      __relay_internal__pv__groups_comet_use_glvrelayprovider: false,
      __relay_internal__pv__GHLShouldChangeSponsoredAuctionDistanceFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV1relayprovider: true,
      __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV2relayprovider: false,
    }

    var res = await graphql(${JSON.stringify(SHARE_CREATE_DOC_ID)}, 'ComposerStoryCreateMutation', variables)

    var story = res.json && res.json.data && res.json.data.story_create
    if (res.status !== 200 || !story || res.json.errors) {
      return {
        ok: false,
        error: 'Facebook did not confirm the share (HTTP ' + res.status + ')',
        detail: res.json && res.json.errors ? JSON.stringify(res.json.errors).slice(0, 400) : (res.raw ? res.raw.slice(0, 300) : null),
        hint: res.status === 400 || res.status === 404
          ? 'the share mutation doc_id may have rotated — share one post by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }

    return { ok: true, shared: true, privacy: ${JSON.stringify(privacy)} }
  `)
}

/**
 * Following a profile.
 *
 * Captured from a real click on a profile's Follow button:
 *
 *   POST /api/graphql/  doc_id=28018963647735121
 *   fb_api_req_friendly_name=CometUserFollowMutation
 *
 *   variables.input: { subscribee_id, subscribe_location: "PROFILE",
 *                       actor_id, client_mutation_id,
 *                       attribution_id_v2, is_tracking_encrypted, tracking }
 *   -> 200 { data: { actor_subscribe: { subscribee: { profile_action, ... } } } }
 *
 * `subscribee_id` is the target's numeric user id — `feedScript` exposes this
 * as `authorId` (a field distinct from `feedbackId`, confirmed present on
 * `owning_profile` by a live read-only probe before being added, per this
 * project's own rule against fields that were never actually checked).
 *
 * `attribution_id_v2` and `tracking` are the same class of page-bound
 * telemetry trimmed successfully in `reactScript` (an encrypted breadcrumb
 * naming the UI surface); kept out here too rather than fabricated, though
 * unlike reactScript this has not yet been verified with a live round-trip on
 * this specific mutation.
 *
 * Only the FOLLOW direction (`actor_subscribe`) has been captured. Unfollow
 * is very likely a separate mutation (`actor_unsubscribe` or similar, its own
 * doc_id) — not yet captured, so `unfollowScript` does not exist yet. Do not
 * assume this mutation takes a boolean toggle; that would be exactly the kind
 * of assumption this bridge exists to avoid.
 */
const FOLLOW_DOC_ID = '28018963647735121'

export function followScript(subscribeeId: string): string {
  return buildScript(`
    var variables = {
      input: {
        subscribee_id: ${JSON.stringify(subscribeeId)},
        subscribe_location: 'PROFILE',
        actor_id: userId(),
        client_mutation_id: String(Date.now()),
        is_tracking_encrypted: false,
        tracking: null,
      },
      scale: 1,
    }

    var res = await graphql(${JSON.stringify(FOLLOW_DOC_ID)}, 'CometUserFollowMutation', variables)

    var subscribee = res.json && res.json.data && res.json.data.actor_subscribe && res.json.data.actor_subscribe.subscribee
    if (res.status !== 200 || !subscribee || res.json.errors) {
      return {
        ok: false,
        error: 'Facebook did not confirm the follow (HTTP ' + res.status + ')',
        detail: res.json && res.json.errors ? JSON.stringify(res.json.errors).slice(0, 300) : (res.raw ? res.raw.slice(0, 300) : null),
        hint: res.status === 400 || res.status === 404
          ? 'the follow mutation doc_id may have rotated — follow one profile by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }

    return { ok: true, followed: true, subscribeeId: ${JSON.stringify(subscribeeId)} }
  `)
}

/**
 * Hiding a post ("Hide post" / "See fewer posts like this").
 *
 * Same discovery shape as sharing: rather than trying to construct the huge
 * opaque tokens this needs, ask Facebook for them the way its own client
 * does — by opening the post's "..." menu first.
 *
 *   POST /api/graphql/  doc_id=27757775690570026
 *   fb_api_req_friendly_name=CometFeedStoryMenuQuery
 *   variables.id = <the post's raw Relay node id — feedScript's `nodeId`>
 *
 * The response's `feed_unit.nfx_action_menu_items` is the full "..." menu —
 * Hide, Snooze, Unfollow, Report, Save, etc. Each `StoryNFXActionMenuItem`
 * carries an `action.type` (e.g. `"HIDE"`, `"SNOOZE_ACTOR"`, `"UNSUBSCRIBE"`)
 * and an `action.context` — a JSON string ALREADY containing
 * `hideable_token`, `story_permalink_token`, `session_id`, and `tracking`,
 * computed server-side for that exact post and session. Nothing here needs
 * to be constructed; it needs to be found and forwarded verbatim, the same
 * lesson `shareScript` already learned from `share_scrape_data`.
 *
 * A REAL live "Hide post" click confirmed the write mutation:
 *
 *   POST /api/graphql/  doc_id=28386627231026039
 *   fb_api_req_friendly_name=CometFeedStoryExecuteNFXActionMutation
 *   variables.input: { context: <the menu item's action.context, verbatim>,
 *                       type: "HIDE_XOUT", actor_id, client_mutation_id }
 *   -> 200 { data: { cix_nfx_actions_execute: { ... } } }
 *
 * Only the HIDE menu entry (`action.type === 'HIDE'` →
 * `input.type: 'HIDE_XOUT'`) has been confirmed against a real click.
 * `SNOOZE_ACTOR`/`UNSUBSCRIBE`/etc. appear in the same menu with the same
 * context shape and are very likely the same mutation with a different
 * `type` string, but none of those specific clicks has been captured — only
 * `hideScript` (HIDE) ships; snooze/unfollow-via-menu do not exist yet.
 *
 * The mutation Facebook fires immediately after a hide (a "want to see fewer
 * posts from this Page too?" follow-up, `UNSUBSCRIBE_DIRECTED_TARGET` via a
 * different mutation, `useExecuteNFXActionMutation`) is a SEPARATE action the
 * user did not ask for here and is deliberately not sent — hiding one post
 * should only hide that post.
 */
const MENU_DOC_ID = '27757775690570026'
const NFX_ACTION_DOC_ID = '28386627231026039'

export function hideScript(nodeId: string): string {
  return buildScript(`
    var menuRes = await graphql(${JSON.stringify(MENU_DOC_ID)}, 'CometFeedStoryMenuQuery', {
      crosspostCallerName: 'fx_product_foundation_client_FXOnline_client_cache',
      crosspostCustomPartnerParams: [],
      crosspostServiceNames: [],
      feed_location: 'NEWSFEED',
      feed_menu_icon_variant: 'FILLED',
      id: ${JSON.stringify(nodeId)},
      renderLocation: 'homepage_stream',
      scale: 1,
      serialized_frtp_identifiers: null,
      shouldFetchCrosspostMetadata: false,
      story_debug_info: null,
      __relay_internal__pv__CometFeedStoryCopyLinkMenuItem_isLinkSharingEnabledrelayprovider: true,
    })

    var items = (menuRes.json && menuRes.json.data && menuRes.json.data.feed_unit && menuRes.json.data.feed_unit.nfx_action_menu_items) || []
    var hideItem = null
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].action && items[i].action.type === 'HIDE') { hideItem = items[i]; break }
    }

    if (menuRes.status !== 200 || !hideItem) {
      return {
        ok: false,
        error: hideItem ? ('Facebook did not return the post menu (HTTP ' + menuRes.status + ')') : 'no Hide option found in this post\\'s menu — it may be the user\\'s own post',
        detail: menuRes.json && menuRes.json.errors ? JSON.stringify(menuRes.json.errors).slice(0, 300) : null,
        hint: menuRes.status === 400 || menuRes.status === 404
          ? 'the menu query doc_id may have rotated — open a post\\'s "..." menu by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }

    var variables = {
      input: {
        context: hideItem.action.context,
        type: 'HIDE_XOUT',
        actor_id: userId(),
        client_mutation_id: String(Date.now()),
      },
      scale: 1,
    }

    var res = await graphql(${JSON.stringify(NFX_ACTION_DOC_ID)}, 'CometFeedStoryExecuteNFXActionMutation', variables)
    var executed = res.json && res.json.data && res.json.data.cix_nfx_actions_execute

    if (res.status !== 200 || !executed || res.json.errors) {
      return {
        ok: false,
        error: 'Facebook did not confirm the hide (HTTP ' + res.status + ')',
        detail: res.json && res.json.errors ? JSON.stringify(res.json.errors).slice(0, 300) : (res.raw ? res.raw.slice(0, 300) : null),
        hint: res.status === 400 || res.status === 404
          ? 'the hide mutation doc_id may have rotated — hide one post by hand with the CDP recorder running and read the new doc_id off the wire'
          : undefined,
      }
    }

    return { ok: true, hidden: true }
  `)
}

export const __testing = { FEED_VARIABLES_TEMPLATE, FEED_DOC_ID, GRAPHQL_URL, REACT_DOC_ID, COMMENT_DOC_ID, COMMENT_VARIABLES_TEMPLATE, SHARE_DIALOG_DOC_ID, SHARE_CREATE_DOC_ID, FOLLOW_DOC_ID, MENU_DOC_ID, NFX_ACTION_DOC_ID, buildScript }
