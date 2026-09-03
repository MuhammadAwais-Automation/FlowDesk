import { describe, expect, it } from 'vitest'
import { readElement, patchStyle, patchAttr, applyLayerCommand, findElement } from './nodeOps'

const HTML = `<div data-fd-el="a1" style="color: red; font-size: 12px;"><span data-fd-el="b1">Hi</span><span data-fd-el="c1">Bye</span></div><p data-fd-el="d1">Tail</p>`

describe('readElement', () => {
  it('reads tag and parsed inline style', () => {
    const el = readElement(HTML, 'a1')
    expect(el?.tag).toBe('div')
    expect(el?.style).toEqual({ color: 'red', 'font-size': '12px' })
  })

  it('returns null for an id not present', () => {
    expect(readElement(HTML, 'nope')).toBeNull()
  })

  it('reads an arbitrary attribute', () => {
    const withAttr = `<div data-fd-el="x" data-fd-name="Hero"></div>`
    expect(readElement(withAttr, 'x')?.attrs('data-fd-name')).toBe('Hero')
  })
})

describe('patchStyle', () => {
  it('adds a new property without disturbing existing ones', () => {
    const html = patchStyle(HTML, 'a1', { 'letter-spacing': '2px' })!
    const el = readElement(html, 'a1')!
    expect(el.style).toEqual({ color: 'red', 'font-size': '12px', 'letter-spacing': '2px' })
  })

  it('overwrites an existing property', () => {
    const html = patchStyle(HTML, 'a1', { color: 'blue' })!
    expect(readElement(html, 'a1')!.style.color).toBe('blue')
  })

  it('removes a property when patched with null', () => {
    const html = patchStyle(HTML, 'a1', { color: null })!
    expect(readElement(html, 'a1')!.style.color).toBeUndefined()
  })

  it('leaves sibling and descendant markup untouched', () => {
    const html = patchStyle(HTML, 'a1', { color: 'blue' })!
    expect(html).toContain('<span data-fd-el="b1">Hi</span>')
    expect(html).toContain('<p data-fd-el="d1">Tail</p>')
  })

  it('returns null when the element does not exist', () => {
    expect(patchStyle(HTML, 'nope', { color: 'blue' })).toBeNull()
  })
})

describe('patchAttr', () => {
  it('sets a new attribute', () => {
    const html = patchAttr(HTML, 'b1', 'data-fd-effect', '{"kind":"neon"}')!
    expect(readElement(html, 'b1')!.attrs('data-fd-effect')).toBe('{"kind":"neon"}')
  })

  it('removes an attribute when value is null', () => {
    const withAttr = patchAttr(HTML, 'b1', 'data-fd-effect', '{"kind":"neon"}')!
    const removed = patchAttr(withAttr, 'b1', 'data-fd-effect', null)!
    expect(readElement(removed, 'b1')!.attrs('data-fd-effect')).toBeUndefined()
  })
})

describe('applyLayerCommand', () => {
  it('setHidden(true) sets display:none', () => {
    const result = applyLayerCommand(HTML, { cmd: 'setHidden', elementId: 'b1', hidden: true })
    expect(result.changed).toBe(true)
    expect(readElement(result.html, 'b1')!.style.display).toBe('none')
  })

  it('setHidden(false) clears display', () => {
    const hidden = applyLayerCommand(HTML, { cmd: 'setHidden', elementId: 'b1', hidden: true }).html
    const shown = applyLayerCommand(hidden, { cmd: 'setHidden', elementId: 'b1', hidden: false })
    expect(readElement(shown.html, 'b1')!.style.display).toBeUndefined()
  })

  it('setLocked is a documented no-op, not a silent one', () => {
    const result = applyLayerCommand(HTML, { cmd: 'setLocked', elementId: 'b1', locked: true })
    expect(result.changed).toBe(false)
    expect(result.html).toBe(HTML)
    expect(result.note).toMatch(/editor-only/)
  })

  it('rename writes data-fd-name', () => {
    const result = applyLayerCommand(HTML, { cmd: 'rename', elementId: 'b1', name: 'Headline' })
    expect(result.changed).toBe(true)
    expect(readElement(result.html, 'b1')!.attrs('data-fd-name')).toBe('Headline')
  })

  it('delete removes the element and its subtree', () => {
    const result = applyLayerCommand(HTML, { cmd: 'delete', elementId: 'b1' })
    expect(result.changed).toBe(true)
    expect(findElement(result.html, 'b1')).toBeNull()
    expect(result.html).toContain('c1')
  })

  it('duplicate inserts a sibling copy with fresh ids throughout the subtree', () => {
    const result = applyLayerCommand(HTML, { cmd: 'duplicate', elementId: 'a1' })
    expect(result.changed).toBe(true)
    const ids = [...result.html.matchAll(/data-fd-el="([^"]+)"/g)].map(m => m[1])
    expect(new Set(ids).size).toBe(ids.length) // every id unique, including the clone's descendants
    expect(ids.length).toBe(7) // original a1,b1,c1,d1 + cloned a1,b1,c1
  })

  it('reorder moves an element to front (end of siblings)', () => {
    const result = applyLayerCommand(HTML, { cmd: 'reorder', elementId: 'b1', beforeId: null })
    expect(result.changed).toBe(true)
    const cIdx = result.html.indexOf('c1')
    const bIdx = result.html.indexOf('b1')
    expect(cIdx).toBeLessThan(bIdx)
  })

  it('reorder before a sibling places it immediately before that sibling', () => {
    const result = applyLayerCommand(HTML, { cmd: 'reorder', elementId: 'c1', beforeId: 'b1' })
    expect(result.changed).toBe(true)
    const cIdx = result.html.indexOf('c1')
    const bIdx = result.html.indexOf('b1')
    expect(cIdx).toBeLessThan(bIdx)
  })

  it('reorder refuses when the two elements are not siblings', () => {
    const result = applyLayerCommand(HTML, { cmd: 'reorder', elementId: 'b1', beforeId: 'd1' })
    expect(result.changed).toBe(false)
    expect(result.note).toMatch(/not siblings/)
  })

  it('group wraps the given elements in a new element and preserves order', () => {
    const result = applyLayerCommand(HTML, { cmd: 'group', elementIds: ['c1', 'b1'] })
    expect(result.changed).toBe(true)
    const bIdx = result.html.indexOf('b1')
    const cIdx = result.html.indexOf('c1')
    expect(bIdx).toBeLessThan(cIdx) // document order preserved despite input order
  })

  it('ungroup unwraps a wrapper, keeping its children in place', () => {
    const grouped = applyLayerCommand(HTML, { cmd: 'group', elementIds: ['b1', 'c1'] })
    const wrapperId = grouped.note.match(/into (\S+)\./)![1]
    const result = applyLayerCommand(grouped.html, { cmd: 'ungroup', elementId: wrapperId })
    expect(result.changed).toBe(true)
    expect(findElement(result.html, wrapperId)).toBeNull()
    expect(findElement(result.html, 'b1')).not.toBeNull()
    expect(findElement(result.html, 'c1')).not.toBeNull()
  })

  it('reports a clear failure rather than a silent no-op for a missing element', () => {
    const result = applyLayerCommand(HTML, { cmd: 'delete', elementId: 'nope' })
    expect(result.changed).toBe(false)
    expect(result.note).toContain('nope')
    expect(result.html).toBe(HTML)
  })
})
