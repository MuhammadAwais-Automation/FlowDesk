/**
 * LinkedIn Server-Driven UI actions, called directly.
 *
 * The feed's write actions (react, comment, reply) are SDUI server-requests:
 * POST /flagship-web/rsc-action/actions/server-request?sduiid=<requestId>.
 * They looked unreplayable because the comment payload carries a *binding
 * key*, not the text — but the same request also carries a `states` array
 * holding that key's value. So the client can name its own key and supply the
 * text alongside it (probe lkc-02). See probes/FINDINGS-linkedin.md.
 *
 * Success is HTTP 200 AND an empty `response.errors` on the streamed "0:"
 * line; a rejected request still answers 200 with errors filled in.
 */

type Key = { key: { value: { $case: 'id'; id: string } } }

const idKey = (id: string): Key => ({ key: { value: { $case: 'id', id } } })

function actorMetadata(activityId: string) {
  return {
    $type: 'proto.sdui.common.RequestMetadata',
    currentActor: {
      $type: 'proto.sdui.bindings.core.Bindable',
      key: { key: { value: { $case: 'id', id: `identitySwitcherActorContext-urn:li:activity:${activityId}` } }, namespace: '' },
      content: { $case: 'stringBinding', stringBinding: {} },
    },
  }
}

const activityThread = (activityId: string) => ({ threadUrnActivityThreadUrn: { activityUrn: { activityId } } })

/**
 * Wraps requestedArguments the way the web client does: once inside
 * serverRequest, once at the top level with states/screenId/knownTemplateIds
 * INSIDE it (one level up the server answers 500).
 */
export function sduiEnvelope(
  requestId: string,
  requestedArguments: Record<string, unknown>,
  states: unknown[] = [],
  isApfcEnabled = false,
): string {
  return JSON.stringify({
    requestId,
    serverRequest: {
      requestId,
      requestedArguments,
      onClientRequestFailureAction: { actions: [] },
      // createComment sends true; with false the comment is still written but
      // the response render fails with a 500 — a write that reads as a failure.
      isApfcEnabled,
      isStreaming: false,
      rumPageKey: '',
    },
    states,
    requestedArguments: {
      ...requestedArguments,
      states,
      screenId: 'com.linkedin.sdui.flagshipnav.feed.UpdateDetail',
      knownTemplateIds: [],
    },
  })
}

function memoryState(key: string, value: unknown, originalProtoCase: string) {
  return {
    key,
    namespace: 'MemoryNamespace',
    value,
    originalProtoCase,
    protoKey: { $type: 'proto.sdui.Key', value: { $case: 'id', id: key } },
  }
}

/** The web client's optimistic keys are UUIDs; derive one deterministically. */
function uuidFrom(seed: string): string {
  let h = ''
  for (let i = 0; h.length < 32; i++) h += ((seed.charCodeAt(i % seed.length) * 31 + i * 7) % 16).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * createComment. `stateId` only has to be unique per request: the server
 * resolves commentFieldBinding against the states sent with it.
 */
export function commentRequestBody(activityId: string, text: string, stateId: string): string {
  const k = (name: string) => `${name}-${stateId}`
  const names = ['commentBoxText', 'richCommentBoxText', 'commentBoxLinkPreviewIngestedContentId', 'commentBoxExternalImageUrl', 'commentBoxExternalImageId']
  const binding = (name: string) => ({ key: k(name), namespace: 'MemoryNamespace' })
  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    requestedStateKeys: names.map(n => idKey(k(n))),
    payload: {
      optimisticKey: `auto-component-${uuidFrom(stateId)}`,
      collection: {
        updateKey: {
          feedType: 3,
          items: [{ feedUpdateUrn: { updateUrnActivityUrn: { activityUrn: { activityId } } }, trackingId: '' }],
          aggregationType: 0,
          isVideoCarousel: false,
        },
        threadUrn: activityThread(activityId),
      },
      commentFieldBinding: binding('commentBoxText'),
      richCommentFieldBinding: binding('richCommentBoxText'),
      linkPreviewIngestedContentId: binding('commentBoxLinkPreviewIngestedContentId'),
      externalImageUrl: binding('commentBoxExternalImageUrl'),
      externalImageId: binding('commentBoxExternalImageId'),
    },
    requestMetadata: actorMetadata(activityId),
  }
  const states = [
    memoryState(k('commentBoxText'), text, 'stringValue'),
    memoryState(k('richCommentBoxText'), { text, attribute: [], $type: 'TextModel', source: 'local' }, 'textModelForWrite'),
    memoryState(k('commentBoxLinkPreviewIngestedContentId'), '', 'stringValue'),
    memoryState(k('commentBoxExternalImageUrl'), '', 'stringValue'),
    memoryState(k('commentBoxExternalImageId'), '', 'stringValue'),
  ]
  return sduiEnvelope('com.linkedin.sdui.comments.createComment', requestedArguments, states, true)
}

export function reactionRequestBody(activityId: string, kind: 'create' | 'delete'): string {
  return sduiEnvelope(`com.linkedin.sdui.reactions.${kind}`, {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    requestedStateKeys: [],
    payload: { threadUrn: activityThread(activityId), reactionType: 'ReactionType_LIKE', reactionSource: 'Update' },
    requestMetadata: actorMetadata(activityId),
  })
}

/** In-page script: POST one SDUI server-request and judge it by response.errors. */
export function sduiRequestScript(requestId: string, body: string): string {
  const url = `/flagship-web/rsc-action/actions/server-request?sduiid=${requestId}`
  return `(async function () {
    try {
      var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
      if (!m) return { ok: false, error: 'no JSESSIONID cookie — not signed in to LinkedIn' }
      var res = await fetch(${JSON.stringify(url)}, {
        method: 'POST',
        credentials: 'include',
        headers: { 'csrf-token': m[1], 'content-type': 'application/json', 'x-li-rsc-stream': 'true' },
        body: ${JSON.stringify(body)},
      })
      var text = await res.text()
      // Streamed RSC: numbered lines, the response object on the "0:" line.
      var line = text.split('\\n').find(function (l) { return l.indexOf('0:') === 0 })
      var parsed = null
      try { parsed = line ? JSON.parse(line.slice(2)) : null } catch (e) {}
      var errors = parsed && parsed.response && parsed.response.errors
      if (res.status !== 200 || !Array.isArray(errors)) {
        return { ok: false, status: res.status, error: 'unexpected ${requestId} response', snippet: text.slice(0, 300) }
      }
      if (errors.length) {
        return { ok: false, status: res.status, error: errors.map(function (e) { return e.message || JSON.stringify(e) }).join('; ').slice(0, 300) }
      }
      return { ok: true, status: res.status }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}
