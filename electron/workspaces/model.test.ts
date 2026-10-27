import { describe, expect, it } from 'vitest'
import { createWorkspace, findWorkspace, MAX_ACTIVITY, nextTabId, normalizeUrl, parseViewId, pushActivity, sanitizeStored, viewIdFor, type AgentActivity } from './model'

describe('normalizeUrl', () => {
  it('adds https to a bare host and keeps http(s) urls', () => {
    expect(normalizeUrl('gmail.com')).toBe('https://gmail.com/')
    expect(normalizeUrl('mail.google.com/mail/u/0')).toBe('https://mail.google.com/mail/u/0')
    expect(normalizeUrl('https://www.tiktok.com/@x')).toBe('https://www.tiktok.com/@x')
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173/')
  })

  it('turns words into a Google search', () => {
    expect(normalizeUrl('best ai tools')).toBe('https://www.google.com/search?q=best%20ai%20tools')
  })

  it('refuses schemes a page could abuse', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('file:///C:/Windows/win.ini')).toBeNull()
    expect(normalizeUrl('ms-msdt:/id')).toBeNull()
    expect(normalizeUrl('  ')).toBeNull()
    expect(normalizeUrl('about:blank')).toBe('about:blank')
  })
})

describe('workspace ids', () => {
  it('creates a workspace with its own partition and no clash', () => {
    let n = 0
    const rand = () => [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5][n++ % 12]
    const a = createWorkspace(' Work ', [], new Date('2026-10-27T00:00:00Z'), rand)
    expect(a).toMatchObject({ id: '000000', name: 'Work', partition: 'ws-000000', tabs: [], activeTab: null })
    n = 0
    const b = createWorkspace('TikTok 2', [a], new Date(), rand)
    expect(b.id).not.toBe(a.id)
  })

  it('round-trips view ids and numbers tabs after the highest', () => {
    const ws = { ...createWorkspace('x', []), id: 'ab12cd' }
    expect(viewIdFor(ws, { id: 't3' })).toBe('ws-ab12cd-t3')
    expect(parseViewId('ws-ab12cd-t3')).toEqual({ ws: 'ab12cd', tab: 't3' })
    expect(parseViewId('social-tiktok-2')).toBeNull()
    ws.tabs = [{ id: 't1', url: 'about:blank', title: '' }, { id: 't4', url: 'about:blank', title: '' }]
    expect(nextTabId(ws)).toBe('t5')
  })

  it('finds by id or name, ignoring case', () => {
    const list = [{ ...createWorkspace('Work', []), id: 'aaa111' }, { ...createWorkspace('TikTok 2', []), id: 'bbb222' }]
    expect(findWorkspace(list, 'bbb222')?.name).toBe('TikTok 2')
    expect(findWorkspace(list, 'tiktok 2')?.id).toBe('bbb222')
    expect(findWorkspace(list, 'nope')).toBeNull()
  })
})

describe('sanitizeStored', () => {
  it('drops broken entries and dangerous tab urls, fixes the active tab', () => {
    const out = sanitizeStored([
      { id: 'aaa111', name: 'Work', tabs: [{ id: 't1', url: 'javascript:x', title: '' }, { id: 't2', url: 'https://a.com/', title: 'A' }], activeTab: 't1' },
      { id: 'BAD ID', name: 'x' },
      { id: 'aaa111', name: 'dupe' },
      null,
    ])
    expect(out).toHaveLength(1)
    expect(out[0].tabs.map(t => t.id)).toEqual(['t2'])
    expect(out[0].activeTab).toBe('t2')
    expect(out[0].partition).toBe('ws-aaa111')
    expect(sanitizeStored('nope')).toEqual([])
  })
})

describe('pushActivity', () => {
  it('keeps the newest entries only', () => {
    let log: AgentActivity[] = []
    for (let i = 0; i < MAX_ACTIVITY + 10; i++) log = pushActivity(log, { at: '', view: 'v', kind: 'act', text: String(i), ok: true })
    expect(log).toHaveLength(MAX_ACTIVITY)
    expect(log.at(-1)?.text).toBe(String(MAX_ACTIVITY + 9))
  })
})
