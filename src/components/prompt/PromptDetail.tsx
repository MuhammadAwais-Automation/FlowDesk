import { useState, useRef, useEffect } from 'react'
import { Copy, Trash2, Edit2, Clock, Star, Files } from 'lucide-react'
import { usePromptStore } from '@/store/usePromptStore'
import { extractVariables } from '@/lib/variables'
import type { Prompt, PromptVersion } from '@/types/database'
import PromptEditor from './PromptEditor'

interface Props {
  prompt: Prompt
  onTagClick?: (tag: string) => void
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export default function PromptDetail({ prompt, onTagClick }: Props) {
  const { removePrompt, updatePrompt, getVersionHistory, duplicatePrompt } = usePromptStore()
  const [showEditor, setShowEditor] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<PromptVersion[]>([])
  const [copied, setCopied] = useState(false)
  const [copiedVar, setCopiedVar] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyVarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    if (copyVarTimeoutRef.current) clearTimeout(copyVarTimeoutRef.current)
  }, [])

  const variables = extractVariables(prompt.content)

  function renderContent(content: string) {
    const parts = content.split(/(\{\{[^}]+\}\})/g)
    return parts.map((part, i) => {
      if (part.match(/^\{\{[^}]+\}\}$/)) {
        const isCopied = copiedVar === part
        return (
          <span
            key={i}
            onClick={() => handleCopyVar(part)}
            title={isCopied ? 'Copied!' : 'Click to copy'}
            style={{
              display: 'inline-block',
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '6px',
              margin: '0 2px',
              fontFamily: 'monospace',
              background: isCopied ? 'var(--success-muted)' : 'var(--accent-muted)',
              color: isCopied ? 'var(--success)' : 'var(--accent)',
              border: `1px solid ${isCopied ? 'var(--success)' : 'var(--accent-border)'}`,
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
              userSelect: 'none',
            }}
          >
            {isCopied ? 'Copied!' : part}
          </span>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt.content)
    setCopied(true)
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
  }

  async function handleCopyVar(varText: string) {
    await navigator.clipboard.writeText(varText)
    setCopiedVar(varText)
    if (copyVarTimeoutRef.current) clearTimeout(copyVarTimeoutRef.current)
    copyVarTimeoutRef.current = setTimeout(() => setCopiedVar(null), 1000)
  }

  async function handleViewHistory() {
    const h = await getVersionHistory(prompt.id)
    setHistory(h)
    setShowHistory(true)
  }

  async function toggleFavorite() {
    await updatePrompt(prompt.id, { is_favorite: !prompt.is_favorite })
  }

  const actionBtnStyle: React.CSSProperties = {
    color: 'var(--text-3)',
    borderRadius: '8px',
    padding: '6px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  return (
    <div style={{ padding: '20px', height: '100%', overflowY: 'auto', background: 'var(--bg)' }}>

      {/* Header */}
      <div
        style={{
          borderLeft: '4px solid var(--accent)',
          paddingLeft: '14px',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <h2
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--text)',
              fontFamily: 'Outfit, sans-serif',
              margin: 0,
              lineHeight: 1.4,
              flex: 1,
            }}
          >
            {prompt.title}
          </h2>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
            <button
              onClick={toggleFavorite}
              title="Favorite"
              style={{
                ...actionBtnStyle,
                color: prompt.is_favorite ? 'var(--warning)' : 'var(--text-3)',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <Star size={14} fill={prompt.is_favorite ? 'currentColor' : 'none'} />
            </button>

            <button
              onClick={handleCopy}
              title="Copy"
              style={actionBtnStyle}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <Copy size={14} />
            </button>

            <button
              onClick={() => duplicatePrompt(prompt.id)}
              title="Duplicate"
              style={actionBtnStyle}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <Files size={14} />
            </button>

            <button
              onClick={() => setShowEditor(true)}
              title="Edit"
              style={actionBtnStyle}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <Edit2 size={14} />
            </button>

            <button
              onClick={handleViewHistory}
              title="History"
              style={actionBtnStyle}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <Clock size={14} />
            </button>

            <button
              onClick={() => { if (window.confirm('Delete this prompt?')) removePrompt(prompt.id) }}
              title="Delete"
              style={{ ...actionBtnStyle, color: 'var(--danger)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--danger-muted)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <p style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '5px', marginBottom: 0 }}>
          Used {prompt.used_count}×
          {prompt.last_used_at && ` · Last: ${relativeTime(prompt.last_used_at)}`}
          {' · '}v{prompt.version}
          {variables.length > 0 && ` · {{${variables.length} var${variables.length !== 1 ? 's' : ''}}}`}
        </p>
      </div>

      {/* Copied toast */}
      {copied && (
        <div
          style={{
            marginBottom: '12px',
            fontSize: '12px',
            padding: '6px 12px',
            borderRadius: '8px',
            background: 'var(--success-muted)',
            color: 'var(--success)',
          }}
        >
          Copied to clipboard!
        </div>
      )}

      {/* Tags */}
      {prompt.tags.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {prompt.tags.map(t => (
            <span
              key={t}
              onClick={() => onTagClick?.(t)}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '6px',
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
                cursor: onTagClick ? 'pointer' : 'default',
              }}
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* Content box */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '14px',
          fontSize: '12px',
          fontFamily: 'monospace',
          lineHeight: '1.6',
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          marginBottom: '16px',
        }}
      >
        {renderContent(prompt.content)}
      </div>

      {/* Variables section */}
      {variables.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <p
            style={{
              fontSize: '10px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-3)',
              marginBottom: '8px',
            }}
          >
            Variables
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {variables.map(v => {
              const chip = `{{${v}}}`
              const isCopied = copiedVar === chip
              return (
                <span
                  key={v}
                  onClick={() => handleCopyVar(chip)}
                  title={isCopied ? 'Copied!' : 'Click to copy'}
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    background: isCopied ? 'var(--success-muted)' : 'var(--accent-muted)',
                    color: isCopied ? 'var(--success)' : 'var(--accent)',
                    border: `1px solid ${isCopied ? 'var(--success)' : 'var(--accent-border)'}`,
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                    userSelect: 'none',
                  }}
                >
                  {isCopied ? 'Copied!' : chip}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Inject via AI Browser */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span style={{ fontSize: '18px' }}>⚡</span>
        <div>
          <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '2px' }}>
            Inject via AI Browser
          </p>
          <p style={{ fontSize: '11px', color: 'var(--text-3)' }}>
            Open a tab in AI Browser, then use the ⚡ inject bar at the top to send this prompt.
          </p>
        </div>
      </div>

      {/* Prompt Editor modal */}
      {showEditor && (
        <PromptEditor
          prompt={prompt}
          workspaceId={prompt.workspace_id}
          folderId={prompt.folder_id}
          onClose={() => setShowEditor(false)}
        />
      )}

      {/* Version History modal */}
      {showHistory && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            background: 'rgba(20,27,45,0.4)',
          }}
          onClick={() => setShowHistory(false)}
        >
          <div
            style={{
              borderRadius: '12px',
              padding: '20px',
              width: '384px',
              maxHeight: '70vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px', color: 'var(--text)' }}>
              Version History
            </h3>
            <p style={{ fontSize: '12px', marginBottom: '12px', color: 'var(--text-3)' }}>
              Current: v{prompt.version}
            </p>
            {history.length === 0 ? (
              <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>No previous versions saved yet.</p>
            ) : (
              history.map(h => (
                <div key={h.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <p style={{ fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: 'var(--text-2)' }}>
                    v{h.version} — {new Date(h.created_at).toLocaleString()}
                  </p>
                  <p
                    style={{
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      color: 'var(--text-3)',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {h.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
