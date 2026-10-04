import { describe, expect, it, vi } from 'vitest'

// A fake LinkedIn page: executeJavaScript answers the comments list or the
// createComment request, whichever script it is handed.
const state = { comments: [] as { commentId: string; text: string }[], sent: [] as string[], writeOn500: true }
const webContents = {
  executeJavaScript: vi.fn(async (script: string) => {
    if (script.includes('sdui.comments.createComment')) {
      state.sent.push(script)
      // LinkedIn's observed behaviour: writes the comment, answers 500.
      if (state.writeOn500) state.comments.push({ commentId: '999', text: 'Nice post' })
      return { ok: false, status: 500, error: 'unexpected response' }
    }
    return { ok: true, comments: state.comments.slice() }
  }),
}
vi.mock('./linkedin', () => ({ getLinkedInView: async () => ({ webContents }) }))

const { liCommentOnPost } = await import('./linkedinComment')

describe('commenting over the API', () => {
  it('reports success from the comment list, not from the 500 LinkedIn answers with', async () => {
    Object.assign(state, { comments: [{ commentId: '1', text: 'older' }], sent: [], writeOn500: true })
    const out = await liCommentOnPost('123', 'Nice post')
    expect(out).toMatchObject({ ok: true, commented: true, commentId: '999', via: 'api' })
    // Sent exactly once: a 500 must not turn into a retried duplicate.
    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]).toContain('Nice post')
  }, 15_000)

  it('fails when no new comment with that text appears', async () => {
    Object.assign(state, { comments: [{ commentId: '1', text: 'Nice post' }], sent: [], writeOn500: false })
    const out = await liCommentOnPost('123', 'Nice post')
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/did not appear/)
  }, 15_000)
})
