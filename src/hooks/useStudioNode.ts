import { useCallback, useEffect, useState } from 'react'
import { isBridgeMessage } from '@/lib/studioBridge'
import { stylePatch, type NodeStyles, type NodeSummary } from '@/lib/studioNode'
import { isLayerCommand, type LayerCommand } from '@/lib/layerOps'
import type { EffectParams } from '@/lib/textEffects'

/**
 * One selection, one style record, one write path. The panel renders this and
 * the agent's tools write through the same bridge commands, so a value can
 * never mean two different things depending on who asked.
 */
export function useStudioNode(iframe: HTMLIFrameElement | null) {
  const [selected, setSelected] = useState<string | null>(null)
  // Ruling D1: the selected node's tag, threaded through so a control like
  // Stroke can tell a text node from a box instead of offering both.
  const [tag, setTag] = useState<string | null>(null)
  const [styles, setStyles] = useState<NodeStyles>({})
  const [tree, setTree] = useState<NodeSummary[]>([])
  // Ruling D2: the params behind the currently-applied effect, read from the
  // document's data-fd-effect attribute so re-selecting a node (or reloading
  // the document) can repopulate the Effects sliders instead of resetting to
  // "none".
  const [effect, setEffect] = useState<EffectParams | null>(null)

  const post = useCallback((msg: unknown) => {
    iframe?.contentWindow?.postMessage(msg, '*')
  }, [iframe])

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!isBridgeMessage(ev.data)) return
      if (!('type' in ev.data)) return
      if (ev.data.type === 'styles') setStyles(ev.data.styles)
      if (ev.data.type === 'tree') setTree(ev.data.nodes)
      if (ev.data.type === 'effect') setEffect(ev.data.params)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const select = useCallback((elementId: string | null, nodeTag?: string | null) => {
    setSelected(elementId)
    setTag(nodeTag ?? null)
    setStyles({})
    setEffect(null)
    if (elementId) {
      post({ cmd: 'readStyles', elementId })
      post({ cmd: 'readEffect', elementId })
    }
  }, [post])

  const update = useCallback((next: NodeStyles) => {
    if (!selected) return
    const patch = stylePatch(styles, next)
    if (Object.keys(patch).length === 0) return
    post({ cmd: 'applyStyles', elementId: selected, patch })
  }, [selected, styles, post])

  const refreshTree = useCallback(() => { post({ cmd: 'readTree' }) }, [post])

  /**
   * Writes the params behind an applied effect back to the document (via
   * `writeEffect`) alongside the CSS patch that renders it (via the normal
   * `update` path) — the two are separate bridge commands because one is a
   * plain attribute write and the other is a style write, but the caller
   * (EffectsSection) treats them as a single "apply this effect" action.
   */
  const setEffectParams = useCallback((params: EffectParams | null, cssPatch: NodeStyles) => {
    if (!selected) return
    update(cssPatch)
    post({ cmd: 'writeEffect', elementId: selected, params })
  }, [selected, update, post])

  /**
   * The single door every layer mutation goes through. `isLayerCommand`
   * guards it because the value crosses from LayersPanel's `onCommand` prop
   * (and, from Task 10 on, the agent's `studio_layer_op` tool) into a
   * `postMessage` call — nothing on that boundary is type-checked, so a
   * malformed value must be dropped here rather than forwarded.
   *
   * `setLocked` is intentionally never posted to the iframe: per the spec it
   * is editor state, not document state, and LayersPanel already keeps it in
   * its own component-local `locked` map (reset on reload, never written
   * into the document HTML). Forwarding it here would give it a second,
   * contradictory home.
   */
  const runLayerCommand = useCallback((cmd: LayerCommand) => {
    if (!isLayerCommand(cmd)) return
    if (cmd.cmd === 'setLocked') return
    post(cmd)
  }, [post])

  return { selected, tag, styles, tree, effect, select, update, refreshTree, setEffectParams, runLayerCommand }
}
