import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, FileText, Image as ImageIcon, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import StudioChat from '@/components/studio/StudioChat'
import { BRIDGE_SCRIPT, isBridgeMessage } from '@/lib/studioBridge'
import { clampZoom, fitToViewport, panBy, zoomAt, type Size, type ViewportState } from '@/lib/canvasViewport'
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
  const viewportRef = useRef<HTMLDivElement>(null)
  const fittedFor = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)

  const active = documents.find(d => d.id === activeId) ?? null

  const refresh = useCallback(async () => {
    const list = await api.studioListDocuments()
    setDocuments(list)
    setActiveId(prev => prev && list.some(d => d.id === prev) ? prev : list[0]?.id ?? null)
  }, [api])

  useEffect(() => { if (isActive) void refresh() }, [isActive, refresh])

  useEffect(() => {
    if (!activeId) { setHtml(''); return }
    setBounds({ width: 0, height: 0 })
    fittedFor.current = null
    void api.studioReadHtml(activeId).then(value => setHtml(value ?? ''))
  }, [activeId, api, documents])

  // The agent edits documents through its own tools, so the canvas follows
  // those writes rather than only the user's own actions.
  useEffect(() => {
    const onChanged = () => { void refresh() }
    api.onStudioDocumentChanged(onChanged)
    return () => api.offStudioDocumentChanged(onChanged)
  }, [api, refresh])

  // The document reports its own natural size; the iframe is sized to it so
  // the world layer can transform a box that exactly contains the artboards.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isBridgeMessage(event.data) || event.data.__fdCanvas !== 'bounds') return
      setBounds({ width: event.data.width, height: event.data.height })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

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
    const node = viewportRef.current
    if (!node) return
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    node.addEventListener('wheel', block, { passive: false })
    return () => node.removeEventListener('wheel', block)
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
    <div className="flex h-full bg-[#FAF7F0]">
      <div className="w-[240px] shrink-0 flex flex-col border-r-2 border-[#281E14]">
        <div className="flex items-center justify-between h-14 px-3 border-b-2 border-[#281E14] bg-[#EBE5D5]">
          <span className="font-retro-mono text-[11px] font-bold uppercase tracking-wider text-[#281E14]">Documents</span>
          <button
            onClick={async () => { const c = await api.studioCreateDocument(); await refresh(); setActiveId(c.id) }}
            className="retro-btn flex items-center gap-1 px-2 py-1 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] font-retro-mono text-[11px] font-bold"
          >
            <Plus size={11} /> New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {documents.length === 0 ? (
            <p className="font-retro-mono text-[11px] text-stone-500 p-3 text-center">
              No documents yet. Ask the agent to design something.
            </p>
          ) : documents.map(doc => (
            <div
              key={doc.id}
              onClick={() => setActiveId(doc.id)}
              className={`group p-2.5 rounded-xl cursor-pointer transition-all ${
                doc.id === activeId ? 'border-2 border-[#D97706] bg-[#FEF3C7]' : 'border border-[#E2DBD0] bg-white hover:border-[#D97706]/40'
              }`}
            >
              <div className="flex items-center gap-1">
                <p className="flex-1 min-w-0 truncate font-retro-sans text-[11px] font-bold text-stone-900">{doc.title}</p>
                <button
                  onClick={async e => {
                    e.stopPropagation()
                    if (!confirm('Delete this document? Its HTML is not recoverable.')) return
                    await api.studioDeleteDocument(doc.id)
                    await refresh()
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  <Trash2 size={11} className="text-stone-400 hover:text-[#DC2626]" />
                </button>
              </div>
              <p className="font-retro-mono text-[10px] text-stone-500 mt-0.5">
                {doc.artboards.length} artboard{doc.artboards.length === 1 ? '' : 's'}
              </p>
              {doc.id === activeId && doc.artboards.map(board => (
                <button
                  key={board.id}
                  onClick={e => { e.stopPropagation(); void handleExport('png', board.id) }}
                  disabled={busy}
                  className="mt-1 w-full text-left px-2 py-1 rounded bg-white/70 border border-[#E2DBD0] font-retro-mono text-[10px] text-stone-700 hover:border-[#D97706] flex items-center gap-1 disabled:opacity-40"
                  title="Export this artboard as PNG"
                >
                  <ImageIcon size={9} />
                  <span className="truncate">{board.name || board.id}</span>
                  <span className="ml-auto text-stone-400">{board.width}×{board.height}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 h-14 px-4 border-b-2 border-[#281E14] bg-[#EBE5D5] shrink-0">
          <span className="font-retro-sans text-sm font-bold text-[#281E14] truncate flex-1">
            {active?.title ?? 'No document'}
          </span>
          <button onClick={() => setView(v => ({ ...v, zoom: clampZoom(v.zoom - 0.25) }))} title="Zoom out"><ZoomOut size={14} /></button>
          <span className="font-retro-mono text-[11px] text-stone-600 w-10 text-center">{Math.round(view.zoom * 100)}%</span>
          <button onClick={() => setView(v => ({ ...v, zoom: clampZoom(v.zoom + 0.25) }))} title="Zoom in"><ZoomIn size={14} /></button>
          <button onClick={fit} title="Fit to screen"><Maximize2 size={14} /></button>
          <button
            onClick={() => setView(v => ({ ...v, zoom: 1 }))}
            title="Actual size"
            className="font-retro-mono text-[11px] font-bold text-stone-700 px-1"
          >
            1:1
          </button>
          <button
            onClick={() => void handleExport('pdf')}
            disabled={!active || active.artboards.length === 0 || busy}
            className="retro-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border-2 border-[#281E14] font-retro-mono text-[11px] font-bold text-[#281E14] disabled:opacity-40"
          >
            <FileText size={12} /> Export PDF
          </button>
        </div>

        <div
          ref={viewportRef}
          className="flex-1 min-h-0 relative overflow-hidden bg-[#e9e6df]"
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
          style={{ cursor: panning.current ? 'grabbing' : spaceHeld ? 'grab' : 'default' }}
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
                title="Studio canvas"
                srcDoc={framedHtml}
                sandbox="allow-same-origin allow-scripts"
                className="border-0 block"
                style={{ width: bounds.width || 1, height: bounds.height || 1 }}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="font-retro-mono text-xs text-stone-500">
                Select or create a document, then ask the agent to design it.
              </p>
            </div>
          )}
        </div>
      </div>

      <StudioChat isActive={isActive} />
    </div>
  )
}
