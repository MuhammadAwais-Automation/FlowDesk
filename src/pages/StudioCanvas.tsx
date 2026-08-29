import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, FileText, Image as ImageIcon, ZoomIn, ZoomOut } from 'lucide-react'
import StudioChat from '@/components/studio/StudioChat'
import type { StudioDocumentMeta } from '@/types/electron'

/**
 * The canvas renders the document in an iframe rather than a native
 * WebContentsView: the document is local, trusted, self-contained HTML, and
 * an iframe scales and layers with the React UI instead of floating above
 * it, which every other page in this app works around with manual bounds
 * maths.
 */

/**
 * Injected into the frame to fit artboards to the panel.
 *
 * An artboard is authored at its real pixel size — up to 1440 wide, or 3000
 * tall for a page — so without this the frame simply scrolls a full-size
 * document and the user never sees a whole design at once.
 */
const FIT_SCRIPT = (zoom: number) => `
  (function () {
    var pad = 48;
    var avail = document.documentElement.clientWidth - pad;
    document.querySelectorAll('.fd-artboard').forEach(function (el) {
      var w = Number(el.getAttribute('data-fd-w')) || el.offsetWidth;
      var h = Number(el.getAttribute('data-fd-h')) || el.offsetHeight;
      var scale = Math.min(1, avail / w) * ${zoom};
      el.style.transform = 'scale(' + scale + ')';
      el.style.transformOrigin = 'top center';
      // Reserve the scaled height too, or the next artboard overlaps this one.
      el.style.marginBottom = (h * scale - h + 24) + 'px';
    });
  })();
`

interface Props { isActive: boolean }

export default function StudioCanvas({ isActive }: Props) {
  const api = window.electronAPI
  const [documents, setDocuments] = useState<StudioDocumentMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const [zoom, setZoom] = useState(1)
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
    void api.studioReadHtml(activeId).then(value => setHtml(value ?? ''))
  }, [activeId, api, documents])

  // The agent edits documents through its own tools, so the canvas follows
  // those writes rather than only the user's own actions.
  useEffect(() => {
    const onChanged = () => { void refresh() }
    api.onStudioDocumentChanged(onChanged)
    return () => api.offStudioDocumentChanged(onChanged)
  }, [api, refresh])

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

  const framedHtml = html ? html.replace('</body>', `<script>${FIT_SCRIPT(zoom)}</script></body>`) : ''

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
          <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} title="Zoom out"><ZoomOut size={14} /></button>
          <span className="font-retro-mono text-[11px] text-stone-600 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} title="Zoom in"><ZoomIn size={14} /></button>
          <button
            onClick={() => void handleExport('pdf')}
            disabled={!active || active.artboards.length === 0 || busy}
            className="retro-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border-2 border-[#281E14] font-retro-mono text-[11px] font-bold text-[#281E14] disabled:opacity-40"
          >
            <FileText size={12} /> Export PDF
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-[#e9e6df]">
          {framedHtml ? (
            <iframe
              title="Studio canvas"
              srcDoc={framedHtml}
              sandbox="allow-same-origin allow-scripts"
              className="w-full h-full border-0"
            />
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
