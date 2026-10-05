/**
 * Sending a connection invitation.
 *
 * ── This was a UI-driving tool, and reading one real send off the wire deleted it ──
 *
 * The first version navigated to the profile, matched the Connect control by
 * name against the four or five belonging to other people in the sidebar, sent
 * a trusted CDP click, then hunted for a "Send without a note" button in a
 * dialog. It failed live: the dialog is not a `[role="dialog"]` on this build,
 * so the confirmation was never found and the invitation never went.
 *
 * Then the same send was captured being made by hand:
 *
 *   POST /voyager/api/voyagerRelationshipsDashMemberRelationships
 *        ?action=verifyQuotaAndCreateV2
 *        &decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2
 *   {"invitee":{"inviteeUnion":{"memberProfile":"urn:li:fsd_profile:<id>"}}}
 *   -> 200 { data: { value: { invitationUrn: "urn:li:fsd_invitation:..." } } }
 *
 * One line, carrying nothing but the person. So the navigation, the click, the
 * name-matching against sidebar controls and the dialog hunt were all deleted.
 * Each of them was a way for this to fail quietly or hit the wrong person.
 *
 * Note that the My Network path is NOT this — it posts an SDUI request full of
 * page-bound state. The profile path is the clean one, and it is what this uses.
 *
 * ── How the wrong person is prevented now ──
 *
 * The profile URL's handle is resolved through
 * `identity/dash/profiles?q=memberIdentity`, which returns the member's urn AND
 * their real name. The caller states who they believe they are inviting, and if
 * the resolved name disagrees, nothing is sent. That check is stronger than the
 * old DOM one: it compares against what LinkedIn says the urn belongs to, which
 * is the same urn the invitation will carry.
 *
 * ── Quota ──
 *
 * The action is called `verifyQuotaAndCreateV2` — LinkedIn checks the allowance
 * server-side and refuses when it is spent, and that refusal is surfaced
 * verbatim. What LinkedIn does NOT offer is a way to read the remaining
 * allowance in advance: four candidate endpoints returned 404 and
 * `invitationsSummary` returns null for its sent counts. So FlowDesk also keeps
 * its own count and stops well short. That local ceiling is a floor under how
 * many an agent in a loop can send; it is not LinkedIn's limit and is never
 * reported as one.
 */

import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { getLinkedInView } from './linkedin'
import type { LinkedInResult } from './linkedin'

/**
 * FlowDesk's own ceiling, deliberately well under anything LinkedIn is thought
 * to allow.
 */
export const MAX_INVITES_PER_DAY = 15
export const MAX_INVITES_PER_WEEK = 60

const NOT_OPEN =
  'LinkedIn is not open. Open the Social page in FlowDesk, select LinkedIn and sign in, then retry.'

interface InviteLog {
  sentAt: number[]
}

function logPath(): string {
  return join(app.getPath('userData'), 'linkedin-invites.json')
}

async function readLog(): Promise<InviteLog> {
  try {
    return JSON.parse(await readFile(logPath(), 'utf8')) as InviteLog
  } catch {
    // No file yet, or unreadable. An empty log is the correct reading of both:
    // it permits sending, which is where a first-time user stands anyway.
    return { sentAt: [] }
  }
}

async function recordSend(at: number): Promise<void> {
  const log = await readLog()
  const weekAgo = at - 7 * 24 * 60 * 60_000
  log.sentAt = log.sentAt.filter(t => t > weekAgo)
  log.sentAt.push(at)
  await mkdir(dirname(logPath()), { recursive: true })
  await writeFile(logPath(), JSON.stringify(log), 'utf8')
}

export async function inviteBudget(now = Date.now()): Promise<{
  today: number; week: number; remainingToday: number; remainingWeek: number; blocked: boolean
}> {
  const log = await readLog()
  const dayAgo = now - 24 * 60 * 60_000
  const weekAgo = now - 7 * 24 * 60 * 60_000
  const today = log.sentAt.filter(t => t > dayAgo).length
  const week = log.sentAt.filter(t => t > weekAgo).length
  return {
    today,
    week,
    remainingToday: Math.max(0, MAX_INVITES_PER_DAY - today),
    remainingWeek: Math.max(0, MAX_INVITES_PER_WEEK - week),
    blocked: today >= MAX_INVITES_PER_DAY || week >= MAX_INVITES_PER_WEEK,
  }
}

/** The handle in a profile URL: linkedin.com/in/<handle>/ */
export function handleFromProfileUrl(url: string): string | null {
  const match = /^https:\/\/(?:www\.)?linkedin\.com\/in\/([^/?#]+)/i.exec(String(url ?? '').trim())
  return match ? decodeURIComponent(match[1]) : null
}

const INVITE_URL =
  '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2' +
  '&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2'

/**
 * Resolves a profile handle to the member's urn and real name, then — only if
 * the name matches what the caller expected — sends the invitation.
 *
 * Both halves live in one script because separating them would let a caller
 * resolve once and send later against a urn that no longer matches the name
 * shown to the user.
 */
export function sendInviteScript(handle: string, expectedName: string): string {
  return `(async function () {
  function csrf() {
    var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }
  function enc(v) {
    return encodeURIComponent(String(v)).replace(/\\(/g, '%28').replace(/\\)/g, '%29')
  }
  async function api(url, options) {
    options = options || {}
    var token = csrf()
    if (!token) return { status: 0, error: 'no JSESSIONID cookie — not signed in to LinkedIn' }
    var headers = {
      'csrf-token': token,
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      'x-li-deco-include-micro-schema': 'true',
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json; charset=UTF-8'
    var r = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: headers,
      body: options.body,
    })
    var t = await r.text()
    var j = null
    try { j = JSON.parse(t) } catch (e) {}
    return { status: r.status, json: j, raw: t, text: j ? null : t.slice(0, 300) }
  }

  try {
    var handle = ${JSON.stringify(handle)}
    var expected = ${JSON.stringify(expectedName)}.replace(/\\s+/g, ' ').trim()

    var lookup = await api('/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=' + enc(handle))
    if (lookup.status !== 200) {
      return { ok: false, error: 'could not look up that profile (HTTP ' + lookup.status + ')', handle: handle }
    }

    // The member id and name, taken from the same response so they cannot
    // describe two different people.
    var idMatch = lookup.raw.match(/ACoAA[A-Za-z0-9_-]+/)
    var firstName = (lookup.raw.match(/"firstName":"([^"]{1,60})"/) || [])[1] || null
    var lastName = (lookup.raw.match(/"lastName":"([^"]{1,60})"/) || [])[1] || null
    if (!idMatch) return { ok: false, error: 'that profile returned no member id', handle: handle }

    var profileUrn = 'urn:li:fsd_profile:' + idMatch[0]
    var resolvedName = [firstName, lastName].filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim()

    if (expected && resolvedName && expected.toLowerCase() !== resolvedName.toLowerCase()) {
      // The caller believed this URL belonged to someone else. Sending anyway
      // would invite a person nobody chose, and an invitation cannot be
      // un-seen once it arrives.
      return {
        ok: false,
        error: 'that profile belongs to "' + resolvedName + '", not "' + expected + '" — nothing was sent',
        resolvedName: resolvedName,
        handle: handle,
      }
    }

    var res = await api(${JSON.stringify(INVITE_URL)}, {
      method: 'POST',
      body: JSON.stringify({ invitee: { inviteeUnion: { memberProfile: profileUrn } } }),
    })

    // Success is the invitation urn LinkedIn returns, not the request
    // resolving. A 200 without one is a failure — the rule this codebase
    // learned when a resolved promise was read as "message sent".
    var value = null
    try { value = res.json && res.json.data && res.json.data.value } catch (e) {}
    var invitationUrn = value && (value.invitationUrn || value['*invitation'])

    if (res.status !== 200 || !invitationUrn) {
      var detail = res.text || (res.json ? JSON.stringify(res.json).slice(0, 400) : null)

      // LinkedIn answers refusals with a machine-readable code, and it is far
      // more use than the status: an invitation that already exists returns
      // CANT_RESEND_YET (verified live), which is a different situation from a
      // spent quota and should not read the same to whoever gets this back.
      var code = null
      try { code = res.json && res.json.data && res.json.data.code } catch (e) {}

      var explained = null
      if (code === 'CANT_RESEND_YET') explained = 'an invitation to this person already exists, or was withdrawn too recently to resend'
      else if (/quota|limit/i.test(String(code) + ' ' + String(detail)) || res.status === 429) {
        explained = 'this looks like the weekly invitation limit — LinkedIn does not let the remaining allowance be read in advance, only refused at send time'
      }

      return {
        ok: false,
        error: explained
          ? explained + ' (' + (code || 'HTTP ' + res.status) + ')'
          : 'LinkedIn did not confirm the invitation (' + (code || 'HTTP ' + res.status) + ')',
        code: code,
        detail: detail,
        to: resolvedName,
        profileUrn: profileUrn,
      }
    }

    return {
      ok: true,
      sent: true,
      to: resolvedName,
      profileUrn: profileUrn,
      invitationUrn: invitationUrn,
      handle: handle,
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

/**
 * Sends one connection invitation.
 *
 * Approval happens in the tool layer above this — the only place that can show
 * the user who is about to be invited.
 */
export async function liSendConnectionRequest(
  profileUrl: string,
  expectedName: string,
  account?: string | number,
): Promise<LinkedInResult> {
  const handle = handleFromProfileUrl(profileUrl)
  if (!handle) {
    return { ok: false, error: `profileUrl must be a linkedin.com/in/... profile URL — got: ${profileUrl}` }
  }
  const name = String(expectedName ?? '').trim()
  if (!name) {
    return { ok: false, error: 'expectedName is required — it is what stops the wrong person being invited' }
  }

  const budget = await inviteBudget()
  if (budget.blocked) {
    return {
      ok: false,
      error: `FlowDesk's own invite limit reached (${budget.today} today, ${budget.week} this week). Nothing was sent.`,
      hint: "this is FlowDesk's ceiling, not LinkedIn's — LinkedIn does not expose its remaining allowance, so this is a deliberate floor under how many an agent can send",
      budget,
    }
  }

  const view = await getLinkedInView(account).catch(() => null)
  if (!view) return { ok: false, error: NOT_OPEN }

  try {
    const result = await view.webContents.executeJavaScript(sendInviteScript(handle, name)) as LinkedInResult
    if (!result || typeof result !== 'object') {
      return { ok: false, error: `the bridge returned a non-object: ${String(result)}` }
    }
    if (!result.ok) return { ...result, budget }

    await recordSend(Date.now())
    return {
      ...result,
      budget: await inviteBudget(),
      note: "confirmed by the invitation urn LinkedIn returned. The counts above are FlowDesk's own — LinkedIn's remaining weekly allowance is not readable, only refused at send time.",
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), budget }
  }
}

export const __testing = { sendInviteScript, handleFromProfileUrl, logPath, INVITE_URL }
