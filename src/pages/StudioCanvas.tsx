import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Image as ImageIcon, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import DocumentTabs from '@/components/studio/DocumentTabs'
import LayersPanel from '@/components/studio/LayersPanel'
import ToolRail, { type StudioTool } from '@/components/studio/ToolRail'
import PropertiesPanel from '@/components/studio/PropertiesPanel'
import AgentWindow from '@/components/studio/AgentWindow'
import { useStudioNode } from '@/hooks/useStudioNode'
import { BRIDGE_SCRIPT, isBridgeMessage } from '@/lib/studioBridge'
import { clampZoom, fitToViewport, panBy, zoomAt, type Size, type ViewportState } from '@/lib/canvasViewport'
import { emptyHistory, record, undo as undoHistory, redo as redoHistory, type History } from '@/lib/editHistory'
import type { StudioDocumentMeta } from '@/types/electron'

/**
 * The canvas renders the document in an iframe rather than a native
 * WebContentsView: the document is local, trusted, self-contained HTML, and
 * an iframe scales and layers with the React UI instead of floating above
 * it, which every other page in this app works around with manual bounds
 * maths.
 */

interface Props { isActive: boolean }

export default function StudioCanvas({ isActive }: Props) {
  const api = window.electronAPI
  const [documents, setDocuments] = useState<StudioDocumentMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const [view, setView] = useState<ViewportState>({ panX: 0, panY: 0, zoom: 1 })
  const [bounds, setBounds] = useState<Size>({ width: 0, height: 0 })
  const [selection, setSelection] = useState<
    { artboardId: string; elementId: string; tag: string; rect: { x: number; y: number; width: number; height: number } } | null
  >(null)
  const [artboards, setArtboards] = useState<{ id: string; name: string }[]>([])
  const [activeArtboard, setActiveArtboard] = useState<string | null>(null)
  const [tool, setTool] = useState<StudioTool>('select')
  const viewportRef = useRef<HTMLDivElement>(null)
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null)
  const fittedFor = useRef<string | null>(null)
  // Tracks each artboard's last-known inner HTML so a 'sealed' message (fired
  // both by the initial id-assignment pass and by a panel edit's style write)
  // can hand applyEdit a real 'before' — a plain write here would silently
  // skip undo. The very first sealed message for an artboard has no prior
  // entry, so before === after and applyEdit correctly records nothing: id
  // assignment on load is not a user edit.
  const artboardHtmlRef = useRef<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<History>(emptyHistory())
  const node = useStudioNode(iframeEl)

  const active = documents.find(d => d.id === activeId) ?? null

  const refresh = useCallback(async () => {
    const list = await api.studioListDocuments()
    setDocuments(list)
    setActiveId(prev => prev && list.some(d => d.id === prev) ? prev : list[0]?.id ?? null)
  }, [api])

  const handleNewDocument = useCallback(async () => {
    const c = await api.studioCreateDocument()
    await refresh()
    setActiveId(c.id)
  }, [api, refresh])

  const handleCloseDocument = useCallback(async (id: string) => {
    if (!confirm('Delete this document? Its HTML is not recoverable.')) return
    await api.studioDeleteDocument(id)
    await refresh()
  }, [api, refresh])

  useEffect(() => { if (isActive) void refresh() }, [isActive, refresh])

  useEffect(() => {
    setBounds({ width: 0, height: 0 })
    setSelection(null)
    setHistory(emptyHistory())
    setArtboards([])
    setActiveArtboard(null)
    fittedFor.current = null
    artboardHtmlRef.current = {}
  }, [activeId])

  useEffect(() => {
    if (!activeId) { setHtml(''); return }
    void api.studioReadHtml(activeId).then(value => setHtml(value ?? ''))
  }, [activeId, api, documents])

  // The agent edits documents through its own tools, so the canvas follows
  // those writes rather than only the user's own actions.
  useEffect(() => {
    const onChanged = () => { void refresh() }
    api.onStudioDocumentChanged(onChanged)
    return () => api.offStudioDocumentChanged(onChanged)
  }, [api, refresh])

  // The layer tree and artboard list are only meaningful once the document
  // actually has content in the iframe, so re-read both whenever the html
  // this page is showing changes.
  useEffect(() => {
    if (!html) return
    node.refreshTree()
    iframeEl?.contentWindow?.postMessage({ cmd: 'readArtboards' }, '*')
  }, [html, iframeEl, node.refreshTree])

  /**
   * The single path every canvas edit takes: persist, then record. Phase 4+
   * gestures call this rather than writing to disk themselves, so undo can
   * never fall out of step with what is on disk.
   */
  const applyEdit = useCallback(async (artboardId: string, before: string, after: string) => {
    if (!activeId || before === after) return
    await api.studioWriteArtboardHtml(activeId, artboardId, after)
    setHistory(h => record(h, { artboardId, before, after }))
  }, [activeId, api])

  // The document reports its own natural size; the iframe is sized to it so
  // the world layer can transform a box that exactly contains the artboards.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isBridgeMessage(event.data)) return
      const msg = event.data
      if ('__fdCanvas' in msg) {
        if (msg.__fdCanvas === 'bounds') { setBounds({ width: msg.width, height: msg.height }); return }
        if (msg.__fdCanvas === 'selected') {
          setSelection({ artboardId: msg.artboardId, elementId: msg.elementId, tag: msg.tag, rect: msg.rect })
          // One selection model, three doors: a canvas click drives the same
          // node-selection state the layer tree and properties panel read.
          node.select(msg.elementId)
          // Clicking inside the iframe moves focus into its document, which
          // would silently kill the parent's keyboard shortcuts (undo, pan).
          viewportRef.current?.focus()
          return
        }
        if (msg.__fdCanvas === 'cleared') {
          setSelection(null)
          viewportRef.current?.focus()
          return
        }
        if (msg.__fdCanvas === 'sealed' && activeId) {
          // Ids are assigned once and written straight back, so a selection
          // made now still refers to the same element after a reload. A panel
          // style edit reaches this same branch (studioBridge posts the same
          // shape after applying a patch), so this is also the single write
          // + undo-record path for the properties panel.
          const before = artboardHtmlRef.current[msg.artboardId] ?? msg.html
          artboardHtmlRef.current[msg.artboardId] = msg.html
          void applyEdit(msg.artboardId, before, msg.html)
          // Ids just became stable, so this is the first moment the layer
          // tree and artboard list can be read reliably.
          node.refreshTree()
          iframeEl?.contentWindow?.postMessage({ cmd: 'readArtboards' }, '*')
          return
        }
        return
      }
      if ('type' in event.data && event.data.type === 'artboards') {
        setArtboards(event.data.boards)
        setActiveArtboard(prev => prev && event.data.boards.some(b => b.id === prev) ? prev : event.data.boards[0]?.id ?? null)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [activeId, api, applyEdit, iframeEl, node.select, node.refreshTree])

  // Phase 4 gestures will call this directly. Until then it is reachable from
  // DevTools so the persistence + undo path can be tested without waiting for
  // a drag implementation to exist.
  useEffect(() => {
    ;(window as unknown as { __fdApplyEdit?: typeof applyEdit }).__fdApplyEdit = applyEdit
    return () => { delete (window as unknown as { __fdApplyEdit?: typeof applyEdit }).__fdApplyEdit }
  }, [applyEdit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (!activeId) return
      e.preventDefault()
      const step = e.shiftKey ? redoHistory(history) : undoHistory(history)
      if (!step) return
      setHistory(step.history)
      const restored = e.shiftKey ? step.entry.after : step.entry.before
      // Keep the sealed-message 'before' cache in step with what undo/redo
      // just put on disk, or the next panel edit on this artboard would
      // record a 'before' that no longer matches reality.
      artboardHtmlRef.current[step.entry.artboardId] = restored
      void api.studioWriteArtboardHtml(activeId, step.entry.artboardId, restored)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, api, history])

  // A layer-tree row click goes through the same 'selectNode' bridge command
  // the canvas-click path answers with a 'selected' message for, so both
  // doors converge on the single __fdCanvas === 'selected' handler above
  // instead of one updating the overlay/header and the other silently not.
  const selectNodeFromLayers = useCallback((elementId: string) => {
    iframeEl?.contentWindow?.postMessage({ cmd: 'selectNode', elementId }, '*')
  }, [iframeEl])

  const fit = useCallback(() => {
    const box = viewportRef.current?.getBoundingClientRect()
    if (!box) return
    setView(fitToViewport(bounds, { width: box.width, height: box.height }))
  }, [bounds])

  // Fit once per document, when its size first becomes known — not on every
  // bounds report, or the user's own zoom would be undone mid-session.
  useEffect(() => {
    if (!activeId || bounds.width === 0) return
    if (fittedFor.current === activeId) return
    fittedFor.current = activeId
    fit()
  }, [activeId, bounds, fit])

  // Space-to-pan is modal, so the held state has to live outside React's
  // event flow: the key can be pressed while focus is anywhere in the page.
  const [spaceHeld, setSpaceHeld] = useState(false)
  const panning = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement | null
      // Never steal the spacebar from someone typing — the chat panel sits
      // in the same page.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false) }
    // A lost blur (alt-tab mid-drag) would otherwise leave the canvas stuck
    // in pan mode with no way back except pressing space again.
    const blur = () => { setSpaceHeld(false); panning.current = null }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // React attaches wheel listeners passively, so preventDefault inside
  // onWheel silently does nothing and ctrl+wheel zooms the whole app instead
  // of the canvas. This listener exists only to cancel that default.
  useEffect(() => {
    const viewportEl = viewportRef.current
    if (!viewportEl) return
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    viewportEl.addEventListener('wheel', block, { passive: false })
    return () => viewportEl.removeEventListener('wheel', block)
  }, [])

  // A middle-click over the iframe never reaches the React onPointerDown
  // handler below, because the iframe consumes the event in its own
  // document first. A capture-phase listener on the viewport itself fires
  // before the event can be dispatched into the iframe, so it can start the
  // pan directly.
  useEffect(() => {
    const viewportEl = viewportRef.current
    if (!viewportEl) return
    const onMiddleDown = (e: PointerEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      viewportEl.setPointerCapture(e.pointerId)
      panning.current = { x: e.clientX, y: e.clientY }
    }
    viewportEl.addEventListener('pointerdown', onMiddleDown, { capture: true })
    return () => viewportEl.removeEventListener('pointerdown', onMiddleDown, { capture: true })
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    const isPan = spaceHeld || e.button === 1
    if (!isPan) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    panning.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const from = panning.current
    if (!from) return
    panning.current = { x: e.clientX, y: e.clientY }
    setView(v => panBy(v, e.clientX - from.x, e.clientY - from.y))
  }

  const endPan = (e: React.PointerEvent) => {
    if (!panning.current) return
    panning.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  async function handleExport(kind: 'png' | 'pdf', artboardId?: string) {
    if (!activeId) return
    setBusy(true)
    try {
      const path = kind === 'png' && artboardId
        ? await api.studioExportPng(activeId, artboardId)
        : await api.studioExportPdf(activeId)
      alert(`Saved to:\n${path}`)
    } catch (error) {
      alert(`Export failed:\n${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const framedHtml = useMemo(
    () => (html ? html.replace('</body>', `<script>${BRIDGE_SCRIPT}</script></body>`) : ''),
    [html],
  )

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <DocumentTabs
        documents={documents}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={handleCloseDocument}
        onNew={handleNewDocument}
      />
      {/* Real header strip above the three-pane row, not an overlay -- an absolute
          toolbar centered over the canvas would cover artwork near the top of a
          fitted view. */}
      <div className="h-10 shrink-0 flex items-center gap-3 px-3 border-b border-border bg-surface">
        <span className="text-xs font-medium text-tx truncate max-w-[160px]">
          {active?.title ?? 'No document'}
        </span>
        {selection && (
          <span className="text-[10px] font-mono text-t3 truncate max-w-[160px]">
            &lt;{selection.tag}&gt; {selection.elementId}
          </span>
        )}
        <button onClick={() => setView(v => ({ ...v, zoom: clampZoom(v.zoom - 0.25) }))} title="Zoom out" className="text-t2 hover:text-tx">
          <ZoomOut size={14} />
        </button>
        <span className="text-[11px] font-mono text-t2 w-10 text-center">{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => setView(v => ({ ...v, zoom: clampZoom(v.zoom + 0.25) }))} title="Zoom in" className="text-t2 hover:text-tx">
          <ZoomIn size={14} />
        </button>
        <button onClick={fit} title="Fit to screen" className="text-t2 hover:text-tx">
          <Maximize2 size={14} />
        </button>
        <button
          onClick={() => setView(v => ({ ...v, zoom: 1 }))}
          title="Actual size"
          className="text-[11px] font-mono font-bold text-t2 hover:text-tx px-1"
        >
          1:1
        </button>
        <button
          onClick={() => void handleExport('pdf')}
          disabled={!active || active.artboards.length === 0 || busy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-border text-[11px] font-medium text-tx disabled:opacity-40"
        >
          <FileText size={12} /> Export PDF
        </button>
        <button
          onClick={() => activeArtboard && void handleExport('png', activeArtboard)}
          disabled={!activeArtboard || busy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-border text-[11px] font-medium text-tx disabled:opacity-40"
        >
          <ImageIcon size={12} /> Export PNG
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        <LayersPanel
          artboards={artboards}
          activeArtboard={activeArtboard}
          onSelectArtboard={setActiveArtboard}
          tree={node.tree}
          selected={node.selected}
          onSelectNode={selectNodeFromLayers}
          // Task 9 wires this to the bridge (group/ungroup/reorder/hide/lock/
          // rename/delete/duplicate all mutate through it); until then the
          // panel is display- and selection-only for those operations.
          onCommand={() => {}}
          styles={node.styles}
          onUpdateStyles={node.update}
        />
        <ToolRail tool={tool} onChange={setTool} />
        <div
          ref={viewportRef}
          tabIndex={-1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onWheel={e => {
            if (e.ctrlKey || e.metaKey) {
              const box = viewportRef.current?.getBoundingClientRect()
              if (!box) return
              // Exponential so each wheel notch is the same proportional step
              // whether zoomed far in or far out; a linear delta feels fast at
              // 400% and glacial at 10%.
              const factor = Math.exp(-e.deltaY * 0.002)
              setView(v => zoomAt(v, factor, e.clientX - box.left, e.clientY - box.top))
              return
            }
            setView(v => panBy(v, e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY))
          }}
          style={{ outline: 'none', background: 'var(--canvas-void)', cursor: panning.current ? 'grabbing' : spaceHeld ? 'grab' : 'default' }}
          className="flex-1 relative overflow-hidden"
        >
          {framedHtml ? (
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{
                transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                width: bounds.width || 1,
                height: bounds.height || 1,
                // An iframe consumes pointer events in its own document, which
                // would end the drag the moment the cursor crossed an artboard.
                pointerEvents: spaceHeld ? 'none' : 'auto',
              }}
            >
              <iframe
                ref={setIframeEl}
                title="Studio canvas"
                srcDoc={framedHtml}
                sandbox="allow-same-origin allow-scripts"
                className="border-0 block"
                style={{ width: bounds.width || 1, height: bounds.height || 1 }}
              />
              {selection && (
                <div
                  className="absolute pointer-events-none border-2 border-accent-border"
                  style={{
                    left: selection.rect.x,
                    top: selection.rect.y,
                    width: selection.rect.width,
                    height: selection.rect.height,
                    // Drawn in world space but kept one screen pixel thick at
                    // any zoom — a scaled border reads as blur at 400% and
                    // vanishes at 10%.
                    borderWidth: 1 / view.zoom,
                  }}
                />
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-t3">
                Select or create a document, then ask the agent to design it.
              </p>
            </div>
          )}
        </div>
        <PropertiesPanel
          styles={node.styles}
          onUpdate={node.update}
          hasSelection={node.selected !== null}
        />
      </div>
      <AgentWindow />
    </div>
  )
}
