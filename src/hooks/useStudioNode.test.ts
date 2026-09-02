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
})
