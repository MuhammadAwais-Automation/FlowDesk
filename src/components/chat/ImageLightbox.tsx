import { useEffect, useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'

interface ImageLightboxProps {
  src: string
  alt: string
  onClose: () => void
}

/**
 * Full-screen click-to-enlarge viewer for generated images. No external
 * lightbox dependency — this project keeps small UI needs like this as a
 * plain component rather than pulling in a package (same call as the
 * hand-rolled Markdown-image regex in ChatBubble).
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setDownloading(true)
    try {
      // IPC to the main process (image:download → dialog.showSaveDialog +
      // copyFile), not a renderer-side fetch(src)+blob — a fetch() to a
      // different-scheme URL (flowdesk-image://) from the page's own
      // http/file origin is cross-origin, and our protocol handler's
      // response carries no CORS headers, so that approach silently fails.
      // Copying the file directly in the main process sidesteps CORS
      // entirely and gives a native Save-As dialog as a bonus.
      await window.electronAPI.imageDownload(src)
    } catch {
      // Best-effort — no error UI for a save-image failure.
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          onClick={handleDownload}
          disabled={downloading}
          aria-label="Download image"
          title="Download image"
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
        >
          {downloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <X size={18} />
        </button>
      </div>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
      />
    </div>
  )
}
