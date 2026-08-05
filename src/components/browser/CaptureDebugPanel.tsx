import { useEffect, useState } from 'react'

/**
 * PoC panel: shows the live-captured ChatGPT response text as it streams in,
 * proving the fetch-tee capture pipeline (captureInject.ts → webviewPreload.ts
 * → main.ts → here) works end to end without touching the ChatGPT DOM.
 */
export default function CaptureDebugPanel() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')

  useEffect(() => {
    function onLive(_e: unknown, data: { textSoFar: string }) {
      setStatus('streaming')
      setText(data.textSoFar)
    }
    function onComplete(_e: unknown, data: { text: string; error?: string }) {
      setStatus(data.error ? 'error' : 'done')
      setText(data.text)
    }
    window.electronAPI.onCaptureLive(onLive)
    window.electronAPI.onCaptureComplete(onComplete)
    return () => {
      window.electronAPI.offCaptureLive(onLive)
      window.electronAPI.offCaptureComplete(onComplete)
    }
  }, [])

  if (status === 'idle') return null

  return (
    <div
      style={{
        // Fixed within the 220px ToolDock column (right sidebar) so the
        // native WebContentsView — which ends at that column's left edge —
        // never paints over this DOM element.
        position: 'fixed',
        bottom: '60px',
        right: '12px',
        width: '196px',
        maxHeight: '220px',
        overflowY: 'auto',
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        zIndex: 20,
        fontSize: '11px',
        color: 'var(--text-2)',
        whiteSpace: 'pre-wrap',
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
        Capture PoC — {status}
      </div>
      {text || '…waiting for tokens'}
    </div>
  )
}
