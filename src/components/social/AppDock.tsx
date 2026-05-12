import { useState } from 'react'
import {
  Instagram, Facebook, Twitter, AtSign, Music, Linkedin, Image,
  MessageCircle, Youtube, Send, MessageSquare, Phone,
} from 'lucide-react'
import { SOCIAL_APPS } from '@/config/socialApps'
import { useSocialStore } from '@/store/useSocialStore'

const ICON_MAP: Record<string, React.ElementType> = {
  Instagram, Facebook, Twitter, AtSign, Music, Linkedin, Image,
  MessageCircle, Youtube, Send, MessageSquare, Phone,
}

export default function AppDock() {
  const { activePlatform, setActive } = useSocialStore()
  const [tooltip, setTooltip] = useState<string | null>(null)

  return (
    <div style={{
      width: '56px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      padding: '12px 0',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      overflowY: 'auto',
    }}>
      {SOCIAL_APPS.map(app => {
        const isActive = activePlatform === app.id
        const Icon = ICON_MAP[app.icon] ?? MessageCircle
        const showTip = tooltip === app.id

        return (
          <div key={app.id} style={{ position: 'relative' }}>
            <button
              onClick={() => setActive(isActive ? null : app.id)}
              onMouseEnter={() => setTooltip(app.id)}
              onMouseLeave={() => setTooltip(null)}
              title={app.name}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                border: isActive ? `1.5px solid ${app.color}` : '1.5px solid transparent',
                background: isActive ? `${app.color}18` : 'transparent',
                color: isActive ? app.color : 'var(--text-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s',
                flexShrink: 0,
                outline: 'none',
              }}
              onMouseOver={e => {
                if (!isActive) {
                  e.currentTarget.style.background = 'var(--surface-2)'
                  e.currentTarget.style.color = 'var(--text)'
                }
              }}
              onMouseOut={e => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--text-3)'
                }
              }}
            >
              <Icon size={18} strokeWidth={1.8} />
            </button>

            {/* Active dot */}
            {isActive && (
              <div style={{
                position: 'absolute',
                bottom: '2px', right: '2px',
                width: '6px', height: '6px',
                borderRadius: '50%',
                background: app.color,
                pointerEvents: 'none',
              }} />
            )}

            {/* Tooltip */}
            {showTip && (
              <div style={{
                position: 'absolute',
                right: '52px', top: '50%',
                transform: 'translateY(-50%)',
                background: 'var(--surface-3, #1a1a2e)',
                color: 'var(--text)',
                fontSize: '11px', fontWeight: 500,
                padding: '4px 8px', borderRadius: '6px',
                whiteSpace: 'nowrap', pointerEvents: 'none',
                zIndex: 999,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}>
                {app.name}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
