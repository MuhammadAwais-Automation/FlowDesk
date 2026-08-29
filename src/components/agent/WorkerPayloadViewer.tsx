import { useMemo, useState } from 'react'
import {
  Check,
  Code2,
  Copy,
  FileCode,
  FileText,
  Search,
  Sparkles,
} from 'lucide-react'
import { RetroMarkdown } from '@/components/chat/RetroMarkdown'

import {
  formatPayloadDate,
  parsePayload,
} from '@/lib/workerPayload'

interface NotebookItem {
  id?: string
  title?: string
  index?: number
  is_owner?: boolean
  created_at?: string
  modified_at?: string
}

function NotebooksVisualView({ data, search }: { data: unknown; search: string }) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const inner = (data && typeof data === 'object' && 'data' in data)
    ? (data as Record<string, unknown>).data
    : data

  const list: NotebookItem[] = Array.isArray(data)
    ? data
    : Array.isArray((inner as Record<string, unknown>)?.notebooks)
    ? (inner as Record<string, unknown>).notebooks as NotebookItem[]
    : []

  const filtered = useMemo(() => {
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(item =>
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.id && item.id.toLowerCase().includes(q)) ||
      String(item.index).includes(q)
    )
  }, [list, search])

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (list.length === 0) {
    return <div className="p-4 text-center text-xs text-stone-500 font-retro-mono">No notebooks found in payload.</div>
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between px-1 text-[11px] font-retro-tech font-bold text-stone-600">
        <span>Showing {filtered.length} of {list.length} Notebooks</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[480px] overflow-y-auto pr-1">
        {filtered.map((nb, i) => {
          const title = nb.title?.trim() ? nb.title : `Untitled Notebook #${nb.index ?? i + 1}`
          const id = nb.id ?? ''
          return (
            <div
              key={id || i}
              className="flex flex-col justify-between p-3 rounded-xl border-2 border-[#281E14]/30 bg-white hover:border-[#281E14] hover:shadow-[3px_3px_0px_0px_rgba(40,30,20,0.15)] transition-all group"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-retro-tech text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FAF7F0] border border-[#281E14]/30 text-stone-600 shrink-0">
                      #{nb.index ?? i + 1}
                    </span>
                    <h4 className="font-retro-tech text-xs font-bold text-[#281E14] truncate group-hover:text-[#D97706] transition-colors" title={title}>
                      {title}
                    </h4>
                  </div>
                  {nb.is_owner !== undefined && (
                    <span className={`font-retro-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 border ${
                      nb.is_owner ? 'bg-[#ECFDF5] border-[#047857]/30 text-[#047857]' : 'bg-[#FEF3C7] border-[#D97706]/30 text-[#B45309]'
                    }`}>
                      {nb.is_owner ? 'Owner' : 'Shared'}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-[10px] font-retro-mono text-stone-500">
                  <div>
                    <span className="block text-[8px] uppercase tracking-wider text-stone-400">Created</span>
                    <span className="truncate block">{formatPayloadDate(nb.created_at)}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] uppercase tracking-wider text-stone-400">Updated</span>
                    <span className="truncate block text-stone-700 font-semibold">{formatPayloadDate(nb.modified_at)}</span>
                  </div>
                </div>
              </div>

              {id && (
                <div className="mt-2.5 pt-2 border-t border-[#281E14]/10 flex items-center justify-between text-[10px] font-retro-mono">
                  <span className="text-stone-400 truncate max-w-[170px]" title={id}>
                    ID: {id.slice(0, 8)}&hellip;{id.slice(-6)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyId(id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FAF7F0] hover:bg-[#EBE5D5] border border-[#281E14]/30 text-stone-700 font-bold transition-all text-[9px] cursor-pointer"
                    title="Copy Notebook ID"
                  >
                    {copiedId === id ? (
                      <>
                        <Check size={10} className="text-[#047857]" />
                        <span className="text-[#047857]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={10} />
                        <span>Copy ID</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GenericKeyValueTable({ data, search }: { data: unknown; search: string }) {
  if (!data || typeof data !== 'object') {
    return <div className="p-3 text-xs font-retro-mono">{String(data)}</div>
  }

  const entries = Object.entries(data as Record<string, unknown>)
  const filtered = entries.filter(([k, v]) => {
    if (!search) return true
    const q = search.toLowerCase()
    return k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
  })

  return (
    <div className="rounded-xl border-2 border-[#281E14]/30 bg-white overflow-hidden font-retro-mono text-xs max-h-[480px] overflow-y-auto">
      <div className="divide-y divide-[#281E14]/15">
        {filtered.map(([key, val]) => (
          <div key={key} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-2.5 gap-1.5 hover:bg-[#FAF7F0]/60">
            <span className="font-bold text-[#281E14] text-[11px] font-retro-tech min-w-[140px] uppercase tracking-wider">
              {key}:
            </span>
            <div className="text-stone-800 break-all text-[11px] flex-1 text-left sm:text-right">
              {typeof val === 'object' && val !== null ? (
                <pre className="bg-[#FAF7F0] p-1.5 rounded border border-[#281E14]/20 text-[10px] text-left overflow-x-auto">
                  {JSON.stringify(val, null, 2)}
                </pre>
              ) : typeof val === 'boolean' ? (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  val ? 'bg-[#ECFDF5] text-[#047857] border border-[#047857]/30' : 'bg-[#FEF2F2] text-[#DC2626] border border-[#DC2626]/30'
                }`}>
                  {String(val)}
                </span>
              ) : (
                <span>{String(val)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ColorizedJson({ jsonString }: { jsonString: string }) {
  const colorized = useMemo(() => {
    return jsonString.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'text-[#A78BFA]' // number = purple
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-[#38BDF8] font-semibold' // key = light cyan/blue
          } else {
            cls = 'text-[#FBBF24]' // string = light amber
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-[#34D399] font-bold' // boolean = light emerald
        } else if (/null/.test(match)) {
          cls = 'text-[#9CA3AF] italic' // null = gray
        }
        return `<span class="${cls}">${match}</span>`
      }
    )
  }, [jsonString])

  return (
    <pre
      className="font-retro-mono text-[11px] leading-relaxed p-3.5 bg-[#1F1913] text-[#FAF7F0] rounded-xl border-2 border-[#281E14] overflow-x-auto whitespace-pre-wrap break-words max-h-[480px]"
      dangerouslySetInnerHTML={{ __html: colorized }}
    />
  )
}

export function WorkerPayloadViewer({
  rawText,
  provider,
}: {
  rawText?: string
  provider?: string
}) {
  const parsed = useMemo(() => parsePayload(rawText), [rawText])
  const [activeTab, setActiveTab] = useState<'smart' | 'json' | 'raw' | 'markdown'>(
    parsed.isJson ? 'smart' : 'markdown'
  )
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)

  const formattedJson = useMemo(() => {
    if (!parsed.isJson || !parsed.data) return ''
    try {
      return JSON.stringify(parsed.data, null, 2)
    } catch {
      return parsed.rawText
    }
  }, [parsed])

  const handleCopy = () => {
    const contentToCopy = activeTab === 'json' ? formattedJson : (rawText || '')
    navigator.clipboard.writeText(contentToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-3">
      {/* Top action bar: Tabs + Search + Copy */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-[#EBE5D5] border-2 border-[#281E14]">
        {/* Tab pills */}
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-[#281E14]/30">
          {provider && (
            <span className="font-retro-tech text-[10px] font-bold text-stone-500 uppercase px-1.5 py-0.5 border-r border-[#281E14]/20 mr-1">
              {provider}
            </span>
          )}
          {parsed.isJson && (
            <button
              type="button"
              onClick={() => setActiveTab('smart')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-retro-tech text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'smart'
                  ? 'bg-[#D97706] text-white shadow-[1px_1px_0px_0px_rgba(40,30,20,0.3)]'
                  : 'text-stone-700 hover:bg-[#FAF7F0]'
              }`}
            >
              <Sparkles size={12} />
              <span>Smart View</span>
            </button>
          )}

          {parsed.isJson && (
            <button
              type="button"
              onClick={() => setActiveTab('json')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-retro-tech text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'json'
                  ? 'bg-[#D97706] text-white shadow-[1px_1px_0px_0px_rgba(40,30,20,0.3)]'
                  : 'text-stone-700 hover:bg-[#FAF7F0]'
              }`}
            >
              <Code2 size={12} />
              <span>Formatted JSON</span>
            </button>
          )}

          {!parsed.isJson && (
            <button
              type="button"
              onClick={() => setActiveTab('markdown')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-retro-tech text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'markdown'
                  ? 'bg-[#D97706] text-white shadow-[1px_1px_0px_0px_rgba(40,30,20,0.3)]'
                  : 'text-stone-700 hover:bg-[#FAF7F0]'
              }`}
            >
              <FileText size={12} />
              <span>Markdown</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('raw')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-retro-tech text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'raw'
                ? 'bg-[#D97706] text-white shadow-[1px_1px_0px_0px_rgba(40,30,20,0.3)]'
                : 'text-stone-700 hover:bg-[#FAF7F0]'
            }`}
          >
            <FileCode size={12} />
            <span>Raw</span>
          </button>
        </div>

        {/* Right side: Search bar & Copy Button */}
        <div className="flex items-center gap-2 flex-1 justify-end min-w-[200px]">
          {activeTab === 'smart' && (
            <div className="relative flex-1 max-w-[220px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter items..."
                className="w-full pl-8 pr-2.5 py-1 bg-white border border-[#281E14]/30 rounded-lg text-xs font-retro-mono text-stone-800 placeholder:text-stone-400 outline-none focus:border-[#D97706] focus:ring-1 focus:ring-[#D97706]"
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-[#FAF7F0] active:translate-x-[1px] active:translate-y-[1px] border border-[#281E14] rounded-lg font-retro-tech text-xs font-bold text-stone-800 shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)] transition-all cursor-pointer shrink-0"
          >
            {copied ? (
              <>
                <Check size={13} className="text-[#047857]" />
                <span className="text-[#047857]">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={13} className="text-stone-600" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="min-h-[150px]">
        {activeTab === 'smart' && (
          <div className="animate-in fade-in duration-150">
            {parsed.kind === 'notebooks' ? (
              <NotebooksVisualView data={parsed.data} search={search} />
            ) : (
              <GenericKeyValueTable data={parsed.data} search={search} />
            )}
          </div>
        )}

        {activeTab === 'json' && (
          <div className="animate-in fade-in duration-150">
            <ColorizedJson jsonString={formattedJson} />
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="animate-in fade-in duration-150">
            <pre className="font-retro-mono text-[11px] leading-relaxed p-3.5 bg-white text-stone-900 rounded-xl border-2 border-[#281E14]/30 overflow-x-auto whitespace-pre-wrap break-words max-h-[480px]">
              {rawText || '\u2014'}
            </pre>
          </div>
        )}

        {activeTab === 'markdown' && (
          <div className="animate-in fade-in duration-150 bg-white p-3.5 rounded-xl border-2 border-[#281E14]/30">
            <RetroMarkdown content={rawText || ''} />
          </div>
        )}
      </div>
    </div>
  )
}
