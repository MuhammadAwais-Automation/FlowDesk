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
      // Fetch + blob rather than a bare <a download href={src}> — more
      // reliable across custom URL schemes (flowdesk-image://) than
      // relying on the browser's native download-attribute handling.
      const res = await fetch(src)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const ext = blob.type.split('/')[1] || 'png'
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `flowdesk-image-${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(blobUrl)
    } catch {
      // Best-effort — no error UI for a save-image failure, matches the
      // rest of this file's quiet-failure style (downloadAndSaveGeneratedImage
      // in main.ts also fails silently on fetch errors).
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
