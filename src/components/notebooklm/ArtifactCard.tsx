import { Download, ExternalLink, FileAudio, FileText, Film, Image, Map, Presentation, Table2, Sparkles } from 'lucide-react'

export interface NotebookArtifact {
  id: string
  title: string
  type: string
  status?: string
  createdAt?: string
  path?: string
}

const iconFor = (type: string) => {
  const value = type.toLowerCase()
  if (value.includes('audio')) return FileAudio
  if (value.includes('video')) return Film
  if (value.includes('slide')) return Presentation
  if (value.includes('info')) return Image
  if (value.includes('mind')) return Map
  if (value.includes('table') || value.includes('data')) return Table2
  return FileText
}

export function ArtifactCard({ artifact, onDownload, onOpen, downloading }: {
  artifact: NotebookArtifact
  onDownload: (artifact: NotebookArtifact) => void
  onOpen?: (artifact: NotebookArtifact) => void
  downloading?: boolean
}) {
  const Icon = iconFor(artifact.type)
  const ready = !artifact.status || ['ready', 'complete', 'completed'].includes(artifact.status.toLowerCase())

  return (
    <div className="group rounded-xl border border-border bg-surface p-3 transition-all hover:border-accent-border hover:shadow-md">
      <div className="flex gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-tx">{artifact.title || 'Untitled artifact'}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-t3">
            <span className="capitalize">{artifact.type.replaceAll('_', ' ')}</span>
            <span>•</span>
            <span className={ready ? 'text-emerald-600' : 'text-amber-600'}>{ready ? 'Ready' : artifact.status}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!ready || downloading} onClick={() => onDownload(artifact)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border text-xs font-semibold text-t2 transition-colors hover:bg-s2 hover:text-tx disabled:cursor-not-allowed disabled:opacity-50">
          {downloading ? <Sparkles size={13} className="animate-spin" /> : <Download size={13} />}{downloading ? 'Saving…' : artifact.path ? 'Save again' : 'Save'}
        </button>
        {artifact.path && onOpen && <button type="button" onClick={() => onOpen(artifact)} title="Open local artifact" className="grid h-8 w-8 place-items-center rounded-md border border-border text-t2 hover:bg-s2 hover:text-accent"><ExternalLink size={13} /></button>}
      </div>
    </div>
  )
}
