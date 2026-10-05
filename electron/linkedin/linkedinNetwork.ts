/**
 * Reading the user's network: connections, and invitations in both directions.
 *
 * ── What has an API here, and what does not ──
 *
 * Three plain voyager REST endpoints, all confirmed 200 against the live
 * session (they appear in the CDP capture, called by LinkedIn itself):
 *
 *   relationships/connectionsSummary  -> numConnections
 *   relationships/invitationsSummary  -> numPendingInvitations, numNewInvitations
 *   relationships/invitationViews?q=receivedInvitation -> the received list
 *
 * What is NOT available, checked rather than assumed:
 *
 *   - **The sent-invitation list.** `/mynetwork/invitation-manager/sent/` is a
 *     `/flagship-web/` Server-Driven UI route; no voyager endpoint serves it.
 *     Eight query shapes on invitationViews and normInvitations were tried and
 *     all returned 400.
 *   - **The weekly invite allowance.** Four candidate endpoints returned 404.
 *     `invitationsSummary` has `numTotalSentInvitations` and
 *     `numSingleSentInvitations` fields, but LinkedIn returns null for both on
 *     this account — so they are reported as null rather than as zero, because
 *     "LinkedIn did not tell us" and "the user has sent none" are different
 *     facts and conflating them would be a lie in the direction that encourages
 *     sending more.
 *
 * That gap is the reason this module exists separately from any send tool: the
 * user can at least see where they stand before anything is sent on their
 * behalf.
 */

import { getLinkedInView } from './linkedin'
import type { LinkedInResult } from './linkedin'

const NOT_OPEN =
  'LinkedIn is not open. Open the Social page in FlowDesk, select LinkedIn and sign in, then retry.'

/**
 * Reads the network summary and, optionally, the received-invitation list.
 *
 * Received invitations are other people's names and headlines, so they are only
 * fetched when asked for, and capped.
 */
export function networkStatusScript(includeReceived: boolean, limit: number): string {
  const count = Math.min(Math.max(limit, 1), 50)
  return `(async function () {
  function csrf() {
    var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }

  async function api(url) {
    var token = csrf()
    if (!token) return { status: 0, error: 'no JSESSIONID cookie — not signed in to LinkedIn' }
    var r = await fetch(url, {
      credentials: 'include',
      headers: {
        'csrf-token': token,
        'accept': 'application/vnd.linkedin.normalized+json+2.1',
        'x-restli-protocol-version': '2.0.0',
        'x-li-lang': 'en_US',
      },
    })
    var t = await r.text()
    var j = null
    try { j = JSON.parse(t) } catch (e) {}
    return { status: r.status, json: j, text: j ? null : t.slice(0, 200) }
  }

  try {
    var conns = await api('/voyager/api/relationships/connectionsSummary')
    var invs = await api('/voyager/api/relationships/invitationsSummary')

    if (conns.status !== 200 && invs.status !== 200) {
      return { ok: false, error: 'LinkedIn did not answer the network endpoints (HTTP ' + conns.status + '/' + invs.status + ')' }
    }

    var c = (conns.json && conns.json.data) || {}
    var s = (invs.json && invs.json.data) || {}

    var result = {
      ok: true,
      connections: c.numConnections != null ? c.numConnections : null,
      invitationsReceivedPending: s.numPendingInvitations != null ? s.numPendingInvitations : null,
      invitationsReceivedNew: s.numNewInvitations != null ? s.numNewInvitations : null,
      // Reported as null, never coerced to 0. LinkedIn returns null here, and
      // "unknown" must not read as "none sent" to anything deciding whether it
      // is safe to send more.
      invitationsSentTotal: s.numTotalSentInvitations != null ? s.numTotalSentInvitations : null,
      weeklyInviteAllowance: null,
      note: 'LinkedIn exposes no endpoint for the sent-invitation list or the weekly invite allowance — the sent-invitations page is Server-Driven UI. Sent and allowance figures are unknown, not zero.',
    }

    ${includeReceived ? `
    var views = await api('/voyager/api/relationships/invitationViews?includeInsights=false&q=receivedInvitation&start=0&count=${count}')
    var elements = (views.json && views.json.data && views.json.data.elements) || []
    var included = (views.json && views.json.included) || []

    // The normalized response keeps profiles in \`included\`, referenced by urn
    // from the elements — so names are resolved through that map rather than
    // read off the element, where they are not.
    var byUrn = {}
    for (var i = 0; i < included.length; i++) {
      var inc = included[i]
      if (inc && inc.entityUrn) byUrn[inc.entityUrn] = inc
    }

    function nameOf(urn) {
      var p = urn && byUrn[urn]
      if (!p) return null
      var first = p.firstName || (p.title && p.title.text) || null
      var last = p.lastName || null
      return [first, last].filter(Boolean).join(' ') || null
    }

    var received = []
    for (var i = 0; i < elements.length; i++) {
      var e = elements[i]
      var inv = e.invitation || e
      var fromUrn = inv['*fromMember'] || inv.fromMemberUrn || (inv.fromMember && inv.fromMember.entityUrn) || null
      received.push({
        invitationUrn: inv.entityUrn || null,
        sharedSecret: inv.sharedSecret || null,
        from: nameOf(fromUrn),
        message: (inv.message || '').slice(0, 300) || null,
        sentAt: inv.sentTime || null,
      })
    }
    result.receivedInvitations = received
    result.receivedCount = received.length
    ` : ''}

    return result
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

/**
 * Reads how the user's network stands: connection count and invitations
 * received. Read-only.
 */
export async function liNetworkStatus(
  options: { includeReceived?: boolean; limit?: number; account?: string | number } = {},
): Promise<LinkedInResult> {
  const { account } = options
  const view = await getLinkedInView(account).catch(() => null)
  if (!view) return { ok: false, error: NOT_OPEN }

  try {
    const result = await view.webContents.executeJavaScript(
      networkStatusScript(options.includeReceived ?? false, options.limit ?? 10),
    )
    if (result && typeof result === 'object') return result as LinkedInResult
    return { ok: false, error: `the bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export const __testing = { networkStatusScript }
