import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/flowdesk-test' } }))
vi.mock('node:fs/promises', () => ({
  readFile: async () => { throw new Error('no log') },
  writeFile: async () => {},
  mkdir: async () => {},
}))

const { liSendConnectionRequest, inviteBudget, MAX_INVITES_PER_DAY, __testing } =
  await import('./linkedinConnect')
const { sendInviteScript, handleFromProfileUrl, INVITE_URL } = __testing

/**
 * An invitation reaches a real person and cannot be taken back quietly. The two
 * failures worth pinning are inviting the WRONG person, and sending so many
 * that LinkedIn penalises the account.
 *
 * The request shape came from a real invitation captured off the wire, not from
 * documentation — see FINDINGS-linkedin.md.
 */

describe('reading the person out of a profile URL', () => {
  it.each([
    ['https://www.linkedin.com/in/gautamjeyaraman/', 'gautamjeyaraman'],
    ['https://linkedin.com/in/some-handle-123', 'some-handle-123'],
    ['https://www.linkedin.com/in/handle/?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3AX', 'handle'],
  ])('reads %s as %s', (url, handle) => {
    expect(handleFromProfileUrl(url)).toBe(handle)
  })

  it.each([
    'https://example.com/in/someone',
    'linkedin.com/in/someone',
    'https://www.linkedin.com/feed/',
    '',
  ])('rejects %s', bad => {
    expect(handleFromProfileUrl(bad)).toBeNull()
  })
})

describe('refusing before anything is sent', () => {
  it('refuses a URL that is not a profile', async () => {
    const out = await liSendConnectionRequest('https://www.linkedin.com/feed/', 'Someone')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('profile URL')
  })

  it('requires the expected name, which is what prevents the wrong invite', async () => {
    const out = await liSendConnectionRequest('https://www.linkedin.com/in/someone/', '  ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('expectedName is required')
  })

  it('reports LinkedIn not being open as a result, not a throw', async () => {
    const out = await liSendConnectionRequest('https://www.linkedin.com/in/someone/', 'Someone')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('LinkedIn is not open')
  })
})

describe('the request carries only the person', () => {
  const script = sendInviteScript('gautamjeyaraman', 'Gautam Jeyaraman')

  it('parses as JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('sends the captured shape — invitee.inviteeUnion.memberProfile', () => {
    expect(script).toContain('invitee: { inviteeUnion: { memberProfile: profileUrn } }')
    expect(script).toContain('verifyQuotaAndCreateV2')
  })

  it('resolves the urn and the name from the same lookup', () => {
    // Taken from one response so the id and the name cannot describe two
    // different people — the urn checked is the urn that gets invited.
    expect(script).toContain('memberIdentity=')
    expect(script).toContain('resolvedName')
  })

  it('stops when the resolved name disagrees with what the caller expected', () => {
    expect(script).toContain("expected.toLowerCase() !== resolvedName.toLowerCase()")
    expect(script).toContain('nothing was sent')
  })

  it('escapes the handle rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = sendInviteScript(nasty, 'X')
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('not reporting success the server did not give', () => {
  const script = sendInviteScript('someone', 'Someone')

  it('requires the invitation urn, not just a 200', () => {
    expect(script).toContain('!invitationUrn')
    expect(script).toContain('did not confirm the invitation')
  })

  it('surfaces the refusal code LinkedIn returns, which says more than the status', () => {
    // Verified live: inviting someone who already has a pending invitation
    // returns {"code":"CANT_RESEND_YET","status":400}. That is a different
    // situation from a spent quota and must not read the same to whoever gets
    // the result back — "HTTP 400" alone would flatten them together.
    expect(script).toContain('CANT_RESEND_YET')
    expect(script).toContain('already exists')
    expect(script).toContain('code: code')
  })

  it('names the weekly limit as the likely cause when the send is refused', () => {
    // The action is verifyQuotaAndCreate: LinkedIn checks the allowance itself
    // and refuses at send time. It is the only place the limit is ever visible,
    // since no endpoint reports the remaining count in advance.
    expect(script).toContain('weekly invitation limit')
  })

  it('no longer drives the UI, which is how this failed live', () => {
    // The first version clicked the Connect control and then hunted for a
    // "Send without a note" button inside a [role="dialog"]. That dialog is not
    // a role=dialog on this build, so the confirmation was never found and the
    // invitation never went. One captured request replaced all of it.
    expect(script).not.toContain('dispatchMouseEvent')
    expect(script).not.toContain('Send without a note')
    expect(INVITE_URL).toContain('/voyager/api/')
  })
})

describe('the budget ceiling', () => {
  it('starts permissive when no log exists', async () => {
    const budget = await inviteBudget()
    expect(budget.today).toBe(0)
    expect(budget.blocked).toBe(false)
    expect(budget.remainingToday).toBe(MAX_INVITES_PER_DAY)
  })

  it("is FlowDesk's own ceiling and never claims to be LinkedIn's", async () => {
    // LinkedIn caps invites per week and penalises accounts that keep hitting
    // the wall, but exposes no way to read the remaining allowance — four
    // candidates returned 404 and invitationsSummary returns null. So this is a
    // floor under agent damage, not a model of LinkedIn's policy.
    const out = await liSendConnectionRequest('https://www.linkedin.com/in/x/', 'X')
    expect(String(out.error)).not.toContain('LinkedIn allows')
  })
})
