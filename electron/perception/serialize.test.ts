import { describe, expect, it } from 'vitest'
import { RefTable } from './refs'
import { buildPageMap, diffMaps, domFacts, formatSummary, maskValue, type AXNode, type DOMSnapshotResult } from './serialize'
import type { PageMap } from './types'

interface FakeNode {
  id: number
  parent: number
  type?: number
  name?: string
  value?: string
  attrs?: Record<string, string>
  shadow?: 'open' | 'closed' | 'user-agent'
  click?: boolean
  rect?: [number, number, number, number]
}

/** A one-document DOMSnapshot built from readable nodes; `parent` is a node index. */
function snapshot(nodes: FakeNode[]): DOMSnapshotResult {
  const strings: string[] = []
  const s = (v: string) => { const i = strings.indexOf(v); return i >= 0 ? i : strings.push(v) - 1 }
  const shadow = nodes.flatMap((n, i) => (n.shadow ? [[i, s(n.shadow)]] : []))
  const laid = nodes.flatMap((n, i) => (n.rect ? [[i, n.rect] as const] : []))
  return {
    strings,
    documents: [{
      nodes: {
        parentIndex: nodes.map(n => n.parent),
        nodeType: nodes.map(n => n.type ?? 1),
        nodeName: nodes.map(n => s(n.name ?? (n.type === 3 ? '#text' : 'DIV'))),
        nodeValue: nodes.map(n => (n.value != null ? s(n.value) : -1)),
        backendNodeId: nodes.map(n => n.id),
        attributes: nodes.map(n => Object.entries(n.attrs ?? {}).flatMap(([k, v]) => [s(k), s(v)])),
        shadowRootType: { index: shadow.map(x => x[0]), value: shadow.map(x => x[1]) },
        isClickable: { index: nodes.flatMap((n, i) => (n.click ? [i] : [])) },
      },
      layout: { nodeIndex: laid.map(x => x[0]), bounds: laid.map(x => [...x[1]]) },
    }],
  }
}

const ax = (backendDOMNodeId: number, role: string, name = '', extra: Partial<AXNode> = {}): AXNode =>
  ({ nodeId: String(backendDOMNodeId), backendDOMNodeId, role: { value: role }, name: { value: name }, ...extra })

const page = (nodes: AXNode[], dom: FakeNode[], refs = new RefTable(), over: Partial<PageMap> = {}) => ({
  ...buildPageMap({
    url: 'https://example.com/', title: 'Example',
    frames: [{ frameId: 'F', loaderId: 'L1', nodes }],
    dom: domFacts(snapshot(dom)), scrollY: 0, viewportHeight: 800, pageHeight: 2000,
  }, refs),
  ...over,
})

describe('domFacts', () => {
  it('names an input inside nested shadow roots from the labelled host', () => {
    const facts = domFacts(snapshot([
      { id: 1, parent: -1, name: 'FACEPLATE-SEARCH-INPUT', attrs: { placeholder: 'Search Reddit' } },
      { id: 2, parent: 0, shadow: 'open', name: '#document-fragment', type: 11 },
      { id: 3, parent: 1, name: 'INNER-INPUT' },
      { id: 4, parent: 2, shadow: 'open', name: '#document-fragment', type: 11 },
      { id: 5, parent: 3, name: 'INPUT' },
    ]))
    expect(facts.hostLabel(5)).toBe('Search Reddit')
  })

  it('ignores user-agent shadow roots and unlabelled hosts', () => {
    const facts = domFacts(snapshot([
      { id: 1, parent: -1, name: 'X-BOX' },
      { id: 2, parent: 0, shadow: 'user-agent', type: 11 },
      { id: 3, parent: 1, name: 'INPUT' },
    ]))
    expect(facts.hostLabel(3)).toBe('')
  })

  it('reads rects, click listeners, sensitive inputs and inner text', () => {
    const facts = domFacts(snapshot([
      { id: 1, parent: -1, click: true, rect: [10.4, 20, 100, 30] },
      { id: 2, parent: 0, type: 3, value: '  Ali   Khan ' },
      { id: 3, parent: 0, type: 3, value: 'hello' },
      { id: 4, parent: -1, name: 'INPUT', attrs: { type: 'password' } },
      { id: 5, parent: -1, name: 'INPUT', attrs: { autocomplete: 'one-time-code' } },
    ]))
    expect(facts.rect(1)).toEqual({ x: 10, y: 20, w: 100, h: 30 })
    expect(facts.clickable(1)).toBe(true)
    expect(facts.clickable(2)).toBe(false)
    expect(facts.text(1)).toBe('Ali Khan hello')
    expect(facts.sensitive(4)).toBe(true)
    expect(facts.sensitive(5)).toBe(true)
    expect(facts.sensitive(1)).toBe(false)
  })
})

describe('buildPageMap', () => {
  it('keeps controls and headings, lists landmarks, drops static text', () => {
    const m = page([
      ax(1, 'navigation', 'Primary'),
      ax(2, 'heading', 'Inbox', { properties: [{ name: 'level', value: { value: 1 } }] }),
      ax(3, 'button', 'Compose', { properties: [{ name: 'disabled', value: { value: true } }] }),
      ax(4, 'StaticText', 'just words'),
      ax(5, 'generic', ''),
    ], [{ id: 2, parent: -1, rect: [0, 0, 100, 20] }, { id: 3, parent: -1, rect: [0, 900, 50, 20] }])
    expect(m.landmarks).toEqual(['navigation "Primary"'])
    expect(m.items.map(i => [i.ref, i.role, i.name])).toEqual([['e1', 'heading', 'Inbox'], ['e2', 'button', 'Compose']])
    expect(m.items[0]).toMatchObject({ level: 1, inViewport: true })
    expect(m.items[1]).toMatchObject({ states: ['disabled'], inViewport: false })
  })

  it('treats clickable rows and divs as items, named from their text', () => {
    const m = page([ax(10, 'row', ''), ax(11, 'generic', ''), ax(12, 'listitem', '')], [
      { id: 10, parent: -1, click: true, rect: [0, 0, 300, 60] },
      { id: 99, parent: 0, type: 3, value: 'Mom — see you soon' },
      { id: 11, parent: -1, click: true, rect: [0, 70, 300, 60] },
      { id: 98, parent: 2, type: 3, value: 'Open settings' },
      { id: 12, parent: -1, rect: [0, 140, 300, 60] },
    ])
    expect(m.items.map(i => `${i.role} ${i.name}`)).toEqual(['row Mom — see you soon', 'generic Open settings'])
  })

  it('names an unnamed shadow-DOM textbox from its host', () => {
    const m = page([ax(5, 'textbox', '')], [
      { id: 1, parent: -1, attrs: { 'aria-label': 'Search' } },
      { id: 2, parent: 0, shadow: 'open', type: 11 },
      { id: 5, parent: 1, name: 'INPUT', rect: [0, 0, 200, 30] },
    ])
    expect(m.items[0].name).toBe('Search')
  })

  it('masks passwords and one-time codes', () => {
    const m = page([
      ax(1, 'textbox', 'Password', { value: { value: 'hunter2' } }),
      ax(2, 'textbox', 'Code', { value: { value: '123456' } }),
      ax(3, 'textbox', 'City', { value: { value: 'Lahore' } }),
    ], [{ id: 2, parent: -1, name: 'INPUT', attrs: { autocomplete: 'one-time-code' } }])
    expect(m.items.map(i => i.value)).toEqual(['••••', '••••', 'Lahore'])
    expect(maskValue('4111', 'Card number', false)).toBe('••••')
    expect(maskValue('', 'Password', false)).toBe('')
  })

  it('keeps the same ref for the same element across snapshots', () => {
    const refs = new RefTable()
    const a = page([ax(1, 'button', 'A'), ax(2, 'button', 'B')], [], refs)
    const b = page([ax(2, 'button', 'B'), ax(3, 'button', 'C')], [], refs)
    expect(a.items.map(i => i.ref)).toEqual(['e1', 'e2'])
    expect(b.items.map(i => i.ref)).toEqual(['e2', 'e3'])
  })
})

describe('formatSummary', () => {
  it('puts the summary first and lists only what is in view', () => {
    const m = page([
      ax(1, 'search'),
      ax(2, 'heading', 'Feed', { properties: [{ name: 'level', value: { value: 2 } }] }),
      ax(3, 'textbox', 'Search', { value: { value: 'cats' }, properties: [{ name: 'focused', value: { value: true } }] }),
      ax(4, 'link', 'Far away'),
    ], [{ id: 2, parent: -1, rect: [0, 0, 1, 1] }, { id: 3, parent: -1, rect: [0, 10, 1, 1] }, { id: 4, parent: -1, rect: [0, 1500, 1, 1] }])
    expect(formatSummary(m)).toBe([
      'Example — https://example.com/',
      'scroll 0 of 2000px, viewport 800px · 3 items, 2 in view',
      'landmarks: search',
      'headings: h2 "Feed"',
      'in view:',
      '[e1] heading "Feed" (h2)',
      '[e2] textbox "Search" = "cats" (focused)',
      '… 1 more not listed (1 link) — scope "all" or scroll to see them',
    ].join('\n'))
    expect(formatSummary(m, { scope: 'all' })).toContain('[e3] link "Far away"')
  })
})

describe('diffMaps', () => {
  const many = Array.from({ length: 30 }, (_, i) => ax(100 + i, 'link', `Story number ${i}`))
  const laid = many.map((n, i): FakeNode => ({ id: n.backendDOMNodeId!, parent: -1, rect: [0, i * 20, 100, 18] }))

  it('says unchanged when nothing on screen moved', () => {
    const refs = new RefTable()
    expect(diffMaps(page(many, laid, refs), page(many, laid, refs))).toEqual({ mode: 'unchanged', text: 'no visible change' })
  })

  it('sends a small delta for a typed value and a new toast', () => {
    const refs = new RefTable()
    const box = (v: string) => ax(1, 'textbox', 'Message', { value: { value: v } })
    const prev = page([box(''), ...many], [{ id: 1, parent: -1, rect: [0, 700, 100, 20] }, ...laid], refs)
    const next = page([box('hi'), ...many, ax(2, 'status', 'Draft saved')], [{ id: 1, parent: -1, rect: [0, 700, 100, 20] }, { id: 2, parent: -1, rect: [0, 0, 50, 20] }, ...laid], refs)
    const d = diffMaps(prev, next)
    expect(d).toEqual({ mode: 'delta', text: '~ [e1] textbox "Message" = "hi"\n+ [e32] status "Draft saved"' })
  })

  it('lists what disappeared', () => {
    const refs = new RefTable()
    const prev = page([ax(1, 'dialog', 'Confirm'), ...many], [{ id: 1, parent: -1, rect: [0, 0, 10, 10] }, ...laid], refs)
    const next = page(many, laid, refs)
    expect(diffMaps(prev, next)).toEqual({ mode: 'delta', text: '- [e1] dialog "Confirm"' })
  })

  it('sends the full map for a new page or a delta of 70% or more', () => {
    const refs = new RefTable()
    const prev = page(many, laid, refs)
    expect(diffMaps(prev, page(many, laid, refs, { url: 'https://example.com/next' })).mode).toBe('full')
    expect(diffMaps(null, prev).mode).toBe('full')
    const replaced = many.map(n => ax(n.backendDOMNodeId! + 1000, 'link', `Other ${n.backendDOMNodeId}`))
    const next = page(replaced, replaced.map((n, i): FakeNode => ({ id: n.backendDOMNodeId!, parent: -1, rect: [0, i * 20, 100, 18] })), refs)
    const d = diffMaps(prev, next)
    expect(d.mode).toBe('full')
    expect(d.text).toBe(formatSummary(next))
  })
})
