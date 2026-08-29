import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))

const { liNetworkStatus, __testing } = await import('./linkedinNetwork')
const { networkStatusScript } = __testing

describe('network status', () => {
  it('reports LinkedIn not being open as a result, not a throw', async () => {
    const out = await liNetworkStatus()
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('LinkedIn is not open')
  })

  it.each([[false], [true]])('parses as JavaScript with includeReceived=%s', includeReceived => {
    expect(() => new Function(`return ${networkStatusScript(includeReceived, 5)}`)).not.toThrow()
  })

  it('does not fetch other people\'s details unless asked', () => {
    // Received invitations are strangers' names and headlines. Off by default.
    expect(networkStatusScript(false, 5)).not.toContain('receivedInvitation')
    expect(networkStatusScript(true, 5)).toContain('receivedInvitation')
  })

  it('reports sent count and allowance as null, never as zero', () => {
    // LinkedIn returns null for both and exposes no allowance endpoint. Zero
    // would read as "none sent, safe to send more" — a lie in the one direction
    // that causes harm.
    const script = networkStatusScript(false, 5)
    expect(script).toContain('weeklyInviteAllowance: null')
    expect(script).toContain('unknown, not zero')
  })

  it('resolves names through the included map, where they actually live', () => {
    // The normalized response keeps profiles in `included`, referenced by urn.
    // Reading a name off the element returns nothing.
    expect(networkStatusScript(true, 5)).toContain('byUrn')
  })
})
