import { useCallback, useEffect, useState } from 'react'
import { isBridgeMessage } from '@/lib/studioBridge'
import { stylePatch, type NodeStyles, type NodeSummary } from '@/lib/studioNode'

/**
 * One selection, one style record, one write path. The panel renders this and
 * the agent's tools write through the same bridge commands, so a value can
 * never mean two different things depending on who asked.
 */
export function useStudioNode(iframe: HTMLIFrameElement | null) {
  const [selected, setSelected] = useState<string | null>(null)
  const [styles, setStyles] = useState<NodeStyles>({})
  const [tree, setTree] = useState<NodeSummary[]>([])

  const post = useCallback((msg: unknown) => {
    iframe?.contentWindow?.postMessage(msg, '*')
  }, [iframe])

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!isBridgeMessage(ev.data)) return
      if (ev.data.type === 'styles') setStyles(ev.data.styles)
      if (ev.data.type === 'tree') setTree(ev.data.nodes)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const select = useCallback((elementId: string | null) => {
    setSelected(elementId)
    setStyles({})
    if (elementId) post({ cmd: 'readStyles', elementId })
  }, [post])

  const update = useCallback((next: NodeStyles) => {
    if (!selected) return
    const patch = stylePatch(styles, next)
    if (Object.keys(patch).length === 0) return
    post({ cmd: 'applyStyles', elementId: selected, patch })
  }, [selected, styles, post])

  const refreshTree = useCallback(() => { post({ cmd: 'readTree' }) }, [post])

  return { selected, styles, tree, select, update, refreshTree }
}
