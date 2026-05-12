import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react'
import AppDock from '@/components/social/AppDock'
import { SOCIAL_APPS } from '@/config/socialApps'
import { useSocialStore } from '@/store/useSocialStore'

interface Props { isActive: boolean }

export default function SocialHub({ isActive }: Props) {
  const { activePlatform, setActive } = useSocialStore()
  const api = window.electronAPI as any
  const activeApp = SOCIAL_APPS.find(a => a.id === activePlatform)

  // Show / hide the WebContentsView when platform or page changes
  useEffect(() => {
    if (!isActive || !activePlatform || !activeApp) {
      api?.socialHide?.()
      return
    }
    api?.socialShow?.(activePlatform, `social-hub-${activePlatform}`, activeApp.url)
  }, [activePlatform, isActive])

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Nav bar — 44px, always visible */}
        <div style={{
          height: '44px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '0 12px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
        }}>
          {/* Back */}
          <NavBtn onClick={() => api?.socialGoBack?.()} title="Back">
            <ChevronLeft size={15} strokeWidth={2} />
          </NavBtn>

          {/* Forward */}
          <NavBtn onClick={() => api?.socialGoForward?.()} title="Forward">
            <ChevronRight size={15} strokeWidth={2} />
          </NavBtn>

          {/* Reload */}
          <NavBtn onClick={() => api?.socialReload?.()} title="Reload">
            <RotateCw size={13} strokeWidth={2} />
          </NavBtn>

          {/* Divider */}
          <div style={{ width: '1px', height: '18px', background: 'var(--border)', margin: '0 4px' }} />

          {/* Active platform indicator */}
          {activeApp ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: activeApp.color, flexShrink: 0,
              }} />
              <span style={{
                fontSize: '12px', fontWeight: 600,
                color: activeApp.color,
                fontFamily: 'var(--font-display, inherit)',
              }}>
                {activeApp.name}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>
              Select a platform →
            </span>
          )}
        </div>

        {/* WebContentsView fills the rest — empty state when nothing selected */}
        {!activePlatform ? (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            color: 'var(--text-3)',
          }}>
            <div style={{ fontSize: '32px', opacity: 0.3 }}>🌐</div>
            <span style={{ fontSize: '13px' }}>Click an icon to open a platform</span>
            <span style={{ fontSize: '11px', opacity: 0.6 }}>
              Each platform stays logged in separately
            </span>
          </div>
        ) : (
          /* Placeholder — WebContentsView renders here via Electron */
          <div style={{ flex: 1, background: 'var(--surface)' }} />
        )}
      </div>

      {/* ── Right dock ── */}
      <AppDock />
    </div>
  )
}

// ── Small helper ──────────────────────────────────────────────────
function NavBtn({ onClick, title, children }: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: '28px', height: '28px', borderRadius: '7px',
        border: 'none', background: 'transparent',
        color: 'var(--text-3)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.12s, color 0.12s',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--surface-2)'
        e.currentTarget.style.color = 'var(--text)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--text-3)'
      }}
    >
      {children}
    </button>
  )
}
