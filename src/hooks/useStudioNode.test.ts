// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStudioNode } from './useStudioNode'

function fakeIframe() {
  const posted: unknown[] = []
  return {
    posted,
    el: { contentWindow: { postMessage: (m: unknown) => { posted.push(m) } } } as unknown as HTMLIFrameElement,
  }
}

describe('useStudioNode', () => {
  it('asks the document for styles when a node is selected', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    expect(f.posted).toContainEqual({ cmd: 'readStyles', elementId: 'e1' })
  })

  it('sends only the changed property, so an unchanged edit writes nothing', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'fd-bridge', type: 'styles', elementId: 'e1', styles: { width: '100px', opacity: '1' } },
      }))
    })
    act(() => { result.current.update({ width: '120px', opacity: '1' }) })
    expect(f.posted).toContainEqual({ cmd: 'applyStyles', elementId: 'e1', patch: { width: '120px' } })
  })

  it('issues no write when nothing changed', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'fd-bridge', type: 'styles', elementId: 'e1', styles: { width: '100px' } },
      }))
    })
    const before = f.posted.length
    act(() => { result.current.update({ width: '100px' }) })
    expect(f.posted.length).toBe(before)
  })

  it('threads the tag along on select (Ruling D1) and asks for the stored effect too', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1', 'h1') })
    expect(result.current.tag).toBe('h1')
    expect(f.posted).toContainEqual({ cmd: 'readEffect', elementId: 'e1' })
  })

  it('clears the tag when selection is cleared', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1', 'h1') })
    act(() => { result.current.select(null) })
    expect(result.current.tag).toBeNull()
  })

  it('stores the effect params reported back by the bridge (Ruling D2)', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'fd-bridge', type: 'effect', elementId: 'e1', params: { kind: 'neon', intensity: 60 } },
      }))
    })
    expect(result.current.effect).toEqual({ kind: 'neon', intensity: 60 })
  })

  it('resets the effect to null on a fresh selection, so a stale effect never leaks onto the next node', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'fd-bridge', type: 'effect', elementId: 'e1', params: { kind: 'neon' } },
      }))
    })
    act(() => { result.current.select('e2') })
    expect(result.current.effect).toBeNull()
  })

  it('setEffectParams writes both the CSS patch and the effect attribute', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'fd-bridge', type: 'styles', elementId: 'e1', styles: { 'text-shadow': '' } },
      }))
    })
    act(() => {
      result.current.setEffectParams({ kind: 'shadow', offset: 8 }, { 'text-shadow': '8px 0px 0px #000' })
    })
    expect(f.posted).toContainEqual({ cmd: 'applyStyles', elementId: 'e1', patch: { 'text-shadow': '8px 0px 0px #000' } })
    expect(f.posted).toContainEqual({ cmd: 'writeEffect', elementId: 'e1', params: { kind: 'shadow', offset: 8 } })
  })

  it('runLayerCommand forwards a well-formed LayerCommand to the document', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.runLayerCommand({ cmd: 'rename', elementId: 'e1', name: 'Headline' }) })
    expect(f.posted).toContainEqual({ cmd: 'rename', elementId: 'e1', name: 'Headline' })
  })

  it('runLayerCommand drops a malformed command instead of forwarding it across the postMessage boundary', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.runLayerCommand({ cmd: 'rename', elementId: 'e1' } as unknown as Parameters<typeof result.current.runLayerCommand>[0]) })
    expect(f.posted).toEqual([])
  })

  it('runLayerCommand never forwards setLocked — it is editor-only state, not a document write', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.runLayerCommand({ cmd: 'setLocked', elementId: 'e1', locked: true }) })
    expect(f.posted).toEqual([])
  })
})
