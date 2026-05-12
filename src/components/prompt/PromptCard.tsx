import { useState } from 'react'
import type { Prompt } from '@/types/database'

interface Props {
  prompt: Prompt
  selected: boolean
  onClick: () => void
  onTagClick?: (tag: string) => void
}

const VAR_REGEX = /\{\{([^}]+)\}\}/g

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

export default function PromptCard({ prompt, selected, onClick, onTagClick }: Props) {
  const [hovered, setHovered] = useState(false)

  const varMatches = prompt.variables.length > 0
    ? prompt.variables.length
    : (prompt.content.match(VAR_REGEX) ?? []).length

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: selected ? 'var(--accent-muted)' : 'var(--surface)',
        border: '1px solid ' + (selected ? 'var(--accent-border)' : (hovered ? 'var(--accent-border)' : 'var(--border)')),
        borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
        borderRadius: '10px',
        padding: '10px 12px',
        transform: hovered && !selected ? 'translateY(-1px)' : 'none',
        boxShadow: hovered && !selected ? '0 4px 12px rgba(0,0,0,0.12)' : 'none',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left' as const,
      }}
    >
      {/* Header row: title + favorite star */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <p
          className="text-xs font-semibold truncate"
          style={{ color: selected ? 'var(--accent)' : 'var(--text)', flex: 1, minWidth: 0 }}
        >
          {prompt.title}
        </p>
        {prompt.is_favorite && (
          <span style={{ color: 'var(--warning, #f59e0b)', fontSize: '12px', flexShrink: 0 }}>
            ★
          </span>
        )}
      </div>

      {/* Content preview with fade-out */}
      <div style={{
        position: 'relative',
        maxHeight: '2.4em',
        overflow: 'hidden',
        color: 'var(--text-3)',
        fontSize: '11px',
        lineHeight: '1.4',
        marginTop: '4px',
      }}>
        {prompt.content.slice(0, 120)}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: '1.2em',
          background: selected
            ? 'linear-gradient(transparent, var(--accent-muted))'
            : 'linear-gradient(transparent, var(--surface))',
        }} />
      </div>

      {/* Stats row */}
      {(prompt.used_count > 0 || prompt.last_used_at || varMatches > 0) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginTop: '6px',
          flexWrap: 'wrap',
        }}>
          {prompt.used_count > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
              {prompt.used_count}×
            </span>
          )}
          {prompt.last_used_at && (
            <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
              {relativeTime(prompt.last_used_at)}
            </span>
          )}
          {varMatches > 0 && (
            <span style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
            }}>
              {'{{'}{varMatches}{'}}'}
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {prompt.tags.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
          {prompt.tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              onClick={onTagClick ? (e) => { e.stopPropagation(); onTagClick(tag) } : undefined}
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '4px',
                background: 'var(--surface-2)',
                color: 'var(--text-3)',
                cursor: onTagClick ? 'pointer' : 'default',
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
