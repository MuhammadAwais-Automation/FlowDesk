import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../sessions', () => ({
  findAnyViewByUrl: vi.fn(),
  ensureBackgroundView: vi.fn(),
  getActiveView: vi.fn(),
  getViewById: vi.fn(),
  showView: vi.fn(),
}))

const { tiktokStudioItemsScript, tiktokDeleteScript } = await import('./tiktok')
const { tiktokProfileScript, tiktokUpdateBioScript, tiktokBioLength } = await import('./tiktokProfile')

describe('TikTok in-session API scripts', () => {
  // executeJavaScript parses these as top-level scripts; a stray top-level
  // `return` or an unescaped newline inside the template breaks every call.
  it.each([
    ['studio item list', tiktokStudioItemsScript],
    ['profile', tiktokProfileScript],
    ['delete', () => tiktokDeleteScript('7690329157154393347')],
    ['update bio', () => tiktokUpdateBioScript('line one\nline "two" end')],
  ])('%s parses as a top-level script', (_name, build) => {
    expect(() => new vm.Script(build())).not.toThrow()
  })

  it('maps Studio items and follows the cursor', async () => {
    const pages = [
      { status_code: 0, has_more: true, cursor: 50, item_list: [{ item_id: '1', desc: 'a', create_time: '1790215544', visibility: 1, play_count: '75', like_count: '2' }] },
      { status_code: 0, has_more: false, cursor: 60, item_list: [{ item_id: '2', desc: 'b', visibility: 2 }] },
    ]
    const bodies: string[] = []
    ;(globalThis as any).fetch = async (_url: string, init: { body: string }) => {
      bodies.push(init.body)
      return { text: async () => JSON.stringify(pages.shift()) }
    }
    const out = await new Function(`return ${tiktokStudioItemsScript()}`)()
    expect(out.ok).toBe(true)
    expect(out.count).toBe(2)
    expect(out.posts[0]).toMatchObject({ id: '1', views: 75, likes: 2, visibility: 1 })
    expect(JSON.parse(bodies[1]).cursor).toBe(50)
  })

  it('finds the TikTok page client by source and confirms delete by status_code', async () => {
    const calls: unknown[] = []
    const clientModule = function (_e: unknown, t: any) { t.h = { csrfToken: 'tok', post: async (path: string, opts: unknown) => { calls.push([path, opts]); return { status_code: 0 } } } }
    // The finder matches on the module's source text, so give it that text.
    clientModule.toString = () => 'n.d(t,{h:function(){return x}});b=["/api/update/profile/","/api/commit/follow/user","/api/comment/publish"]'
    const modules: Record<string, any> = { 1: () => {}, 345146: clientModule }
    const req = Object.assign((id: string) => { const exp: any = {}; modules[id](null, exp); return exp }, { m: modules })
    ;(globalThis as any).window = { __LOADABLE_LOADED_CHUNKS__: { push: ([, , cb]: any[]) => cb(req) } }
    ;(globalThis as any).Response = class {}
    const out = await new Function(`return ${tiktokDeleteScript('42')}`)()
    expect(out).toMatchObject({ ok: true, deleted: true })
    expect(calls[0]).toEqual(['/api/aweme/delete/', { query: { aweme_id: '42', tt_csrf_token: 'tok' }, headers: { 'tt-csrf-token': 'tok' } }])
  })

  it('counts bio length the way TikTok does (emoji count 2)', () => {
    // TikTok's own editor showed 99 for this bio and 75 for the shorter one.
    expect(tiktokBioLength(['🐾 9 lives, 0 losses.', '🥊 UFC Champ | Gym Bro | Traveler', '🚨 Follow to see what I conquer tomorrow!👇'].join(String.fromCharCode(10)))).toBe(99)
    expect(tiktokBioLength(['🐾 9 lives, 0 losses.', '🥊 UFC Champ | Gym Bro', "🚨 Follow to see what's next👇"].join(String.fromCharCode(10)))).toBe(75)
  })

  it('reports an unsigned (empty) response as failure, not zero posts', async () => {
    ;(globalThis as any).fetch = async () => ({ text: async () => '' })
    const out = await new Function(`return ${tiktokStudioItemsScript()}`)()
    expect(out.ok).toBe(false)
  })
})
