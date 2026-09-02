import { describe, it, expect } from 'vitest'
import { isBridgeMessage, BRIDGE_SCRIPT } from './studioBridge'

describe('isBridgeMessage', () => {
  it('accepts a styles message', () => {
    expect(isBridgeMessage({ source: 'fd-bridge', type: 'styles', elementId: 'e1', styles: { width: '10px' } })).toBe(true)
  })

  it('accepts a tree message', () => {
    expect(isBridgeMessage({ source: 'fd-bridge', type: 'tree', nodes: [] })).toBe(true)
  })

  it('rejects a message from another frame with no source marker', () => {
    expect(isBridgeMessage({ type: 'styles', elementId: 'e1' })).toBe(false)
  })

  it('rejects an unknown type', () => {
    expect(isBridgeMessage({ source: 'fd-bridge', type: 'evaluate' })).toBe(false)
  })

  it('accepts an artboards message', () => {
    expect(isBridgeMessage({ source: 'fd-bridge', type: 'artboards', boards: [{ id: 'a1', name: 'Cover' }] })).toBe(true)
  })
})

describe('BRIDGE_SCRIPT', () => {
  it('handles both host commands', () => {
    expect(BRIDGE_SCRIPT).toContain('readStyles')
    expect(BRIDGE_SCRIPT).toContain('applyStyles')
  })

  it('reads styles through the shared property list rather than dumping everything', () => {
    expect(BRIDGE_SCRIPT).toContain('FD_PANEL_PROPERTIES')
  })

  it('handles the readArtboards command', () => {
    expect(BRIDGE_SCRIPT).toContain('readArtboards')
  })
})
