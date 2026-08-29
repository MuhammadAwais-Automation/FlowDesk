/**
 * Social.tsx — social platforms in their own isolated sessions.
 *
 * Deliberately not part of the AI Browser: that page keys every tab to a
 * Gmail account partition, which is the right model for Google-linked tools
 * and the wrong one here. A WhatsApp session is established by scanning a QR
 * from a phone and has no Google account behind it at all, so this page gives
 * each platform its own partition and no login step of its own — you click
 * the platform and sign in inside the platform's own page, the way you would
 * in a browser.
 *
 * Layout is a centre view with a platform rail on the right. The rail is
 * fixed-width and the native WebContentsView is inset to leave room for it:
 * the view is a real OS-level surface painted over this window, so it cannot
 * be positioned by CSS and its bounds have to be computed here.
 */

import { useState, useEffect, useCallback } from 'react'
import { RotateCw } from 'lucide-react'
import { SOCIAL_PLATFORMS, DEFAULT_PLATFORM_ID } from '@/config/socialPlatforms'

const RAIL_W = 64
const TOP_H = 44

interface Props { isActive: boolean }

export default function Social({ isActive }: Props) {
  const api = window.electronAPI

  const [activeId, setActiveId] = useState<string>(() => {
    return localStorage.getItem('socialActivePlatform') || DEFAULT_PLATFORM_ID
  })
  const [navW, setNavW] = useState<number>(() => {
    const collapsed = localStorage.getItem('navCollapsed') === 'true'
    const saved = localStorage.getItem('navWidth')
    return collapsed ? 48 : saved ? Math.max(120, Math.min(320, Number(saved))) : 172
  })

  const platform = SOCIAL_PLATFORMS.find(p => p.id === activeId) ?? SOCIAL_PLATFORMS[0]

  // ── Sidebar resize ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => setNavW((e as CustomEvent<{ width: number }>).detail.width)
    window.addEventListener('nav-resize', handler)
    return () => window.removeEventListener('nav-resize', handler)
  }, [])

  const applyBounds = useCallback(() => {
    api
      .setCustomBounds(
        navW,
        TOP_H,
        Math.max(window.innerWidth - navW - RAIL_W, 100),
        Math.max(window.innerHeight - TOP_H, 100),
      )
      .catch(() => {})
  }, [api, navW])

  // ── Show the active platform's view ───────────────────────────────
  // One tab id per platform, so switching platforms parks the previous view
  // rather than destroying it — a WhatsApp session that had to sync its
  // history should not have to do it again just because Instagram was opened.
  useEffect(() => {
    if (!isActive) {
      api.hideView().catch(() => {})
      return
    }
    api.switchView(`social-${platform.id}`, platform.partition, platform.url).catch(() => {})
    applyBounds()
  }, [isActive, platform.id, applyBounds])

  useEffect(() => {
    if (!isActive) return
    applyBounds()
    window.addEventListener('resize', applyBounds)
    return () => window.removeEventListener('resize', applyBounds)
  }, [isActive, applyBounds])

  useEffect(() => {
    return () => { api.hideView().catch(() => {}) }
  }, [])

  function selectPlatform(id: string) {
    setActiveId(id)
    localStorage.setItem('socialActivePlatform', id)
  }

  return (
    <div className="flex h-full w-full">
      {/* Centre column — the native view is painted into the gap below the header */}
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="shrink-0 flex items-center justify-between px-4 border-b border-[#D6CFC0] bg-[#EBE5D5]"
          style={{ height: TOP_H }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: platform.accent }}
            />
            <span className="font-retro-mono text-xs font-bold uppercase tracking-wider text-stone-900 truncate">
              {platform.label}
            </span>
          </div>

          <button
            title={`Reload ${platform.label}`}
            onClick={() => api.viewReload().catch(() => {})}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-stone-600 hover:bg-[#FAF7F0] hover:text-stone-900 transition-colors"
          >
            <RotateCw size={14} />
          </button>
        </header>

        {/* Intentionally empty: the WebContentsView covers this area. The
            placeholder only shows through before the view has loaded. */}
        <div className="flex-1 flex items-center justify-center">
          <p className="font-retro-sans text-xs text-stone-400">Loading {platform.label}…</p>
        </div>
      </div>

      {/* Platform rail */}
      <aside
        className="shrink-0 flex flex-col items-center gap-2 py-3 border-l border-[#D6CFC0] bg-[#EBE5D5]"
        style={{ width: RAIL_W }}
      >
        {SOCIAL_PLATFORMS.map(({ id, label, icon: Icon, accent }) => {
          const active = id === platform.id
          return (
            <button
              key={id}
              title={label}
              onClick={() => selectPlatform(id)}
              className={`group relative flex items-center justify-center w-11 h-11 rounded-xl transition-all ${
                active
                  ? 'border-2 -translate-y-0.5'
                  : 'border border-transparent hover:bg-[#FAF7F0] hover:-translate-y-0.5'
              }`}
              style={
                active
                  ? {
                      background: `${accent}1A`,
                      borderColor: accent,
                      boxShadow: `2px 2px 0px 0px ${accent}4D`,
                    }
                  : undefined
              }
            >
              <Icon
                size={18}
                className={active ? '' : 'text-stone-500 group-hover:text-stone-800'}
                style={active ? { color: accent } : undefined}
              />
            </button>
          )
        })}
      </aside>
    </div>
  )
}
