/**
 * Studio.tsx — AI creation tools (image/video generation) in their own
 * isolated sessions.
 *
 * Same layout and view-hosting pattern as Social.tsx: a centre native view
 * with a tool rail on the right, one tab id per tool so switching tools
 * parks the previous view instead of destroying it. Kept as its own page
 * rather than folded into Social, since these are creation tools, not
 * social platforms, and rather than the AI Browser, since Google Flow's
 * session should not be tied to a `gmail-*` partition shared with unrelated
 * Google accounts.
 */

import { useState, useEffect, useCallback } from 'react'
import { RotateCw } from 'lucide-react'
import { STUDIO_TOOLS, DEFAULT_STUDIO_TOOL_ID } from '@/config/studioTools'
import type { GmailSession } from '@/types/electron'

const RAIL_W = 64
const TOP_H = 44

interface Props { isActive: boolean }

export default function Studio({ isActive }: Props) {
  const api = window.electronAPI

  const [activeId, setActiveId] = useState<string>(() => {
    return localStorage.getItem('studioActiveTool') || DEFAULT_STUDIO_TOOL_ID
  })
  const [navW, setNavW] = useState<number>(() => {
    const collapsed = localStorage.getItem('navCollapsed') === 'true'
    const saved = localStorage.getItem('navWidth')
    return collapsed ? 48 : saved ? Math.max(120, Math.min(320, Number(saved))) : 172
  })

  const tool = STUDIO_TOOLS.find(t => t.id === activeId) ?? STUDIO_TOOLS[0]

  // ── Google account selection, for tools whose login IS a Google account ──
  const [accounts, setAccounts] = useState<GmailSession[]>([])
  const [accountEmail, setAccountEmail] = useState<string>(() => {
    return localStorage.getItem(`studioAccount:${tool.id}`) || ''
  })

  useEffect(() => {
    if (!tool.requiresGoogleAccount) return
    window.electronAPI.gmailList().then(setAccounts).catch(() => {})
  }, [tool.requiresGoogleAccount])

  useEffect(() => {
    setAccountEmail(localStorage.getItem(`studioAccount:${tool.id}`) || '')
  }, [tool.id])

  function selectAccount(email: string) {
    setAccountEmail(email)
    localStorage.setItem(`studioAccount:${tool.id}`, email)
  }

  const account = accounts.find(a => a.email === accountEmail) ?? null
  // A fixed tool partition, or the chosen Google account's own partition —
  // never a partition invented for this page, so a Google-account tool
  // reuses the exact login already established on the Accounts page.
  const partition = tool.requiresGoogleAccount ? account?.partition : tool.partition

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

  useEffect(() => {
    if (!isActive) {
      api.hideView().catch(() => {})
      return
    }
    if (!partition) {
      // Google-account tool with nothing picked yet — nothing to show until
      // the user chooses which added account to use.
      api.hideView().catch(() => {})
      return
    }
    // Same tab id electron/flow.ts uses for each account's hidden worker, so the
    // MCP/agent tools and this page share one view instead of two Chromium
    // instances fighting over the same partition's storage locks. The id carries
    // the account: a view is cached by id, so one id for every account kept
    // showing the first account's page after a switch.
    api.switchView(tool.id === 'flow' ? `flow-worker-${partition}` : `studio-${tool.id}`, partition, tool.url).catch(() => {})
    applyBounds()
  }, [isActive, tool.id, partition, applyBounds])

  useEffect(() => {
    if (!isActive) return
    applyBounds()
    window.addEventListener('resize', applyBounds)
    return () => window.removeEventListener('resize', applyBounds)
  }, [isActive, applyBounds])

  useEffect(() => {
    return () => { api.hideView().catch(() => {}) }
  }, [])

  function selectTool(id: string) {
    setActiveId(id)
    localStorage.setItem('studioActiveTool', id)
  }

  return (
    <div className="flex h-full w-full">
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="shrink-0 flex items-center justify-between px-4 border-b border-[#D6CFC0] bg-[#EBE5D5]"
          style={{ height: TOP_H }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: tool.accent }}
            />
            <span className="font-retro-mono text-xs font-bold uppercase tracking-wider text-stone-900 truncate">
              {tool.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {tool.requiresGoogleAccount && (
              // A native <select>: its list opens in its own OS window above the
              // page view. An HTML dropdown here would be painted underneath it.
              <select
                value={account?.email ?? ''}
                onChange={e => selectAccount(e.target.value)}
                className="max-w-[220px] font-retro-sans text-xs bg-[#FAF7F0] border border-[#D6CFC0] rounded-lg px-2.5 py-1 text-stone-700 focus:outline-none focus:ring-1 focus:ring-stone-400 cursor-pointer"
              >
                <option value="" disabled>
                  {accounts.length === 0 ? 'No Google accounts — add one on the Accounts page' : 'Choose Google account'}
                </option>
                {accounts.map(a => (
                  <option key={a.email} value={a.email}>{a.email}</option>
                ))}
              </select>
            )}
            <button
              title={`Reload ${tool.label}`}
              onClick={() => api.viewReload().catch(() => {})}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-stone-600 hover:bg-[#FAF7F0] hover:text-stone-900 transition-colors"
            >
              <RotateCw size={14} />
            </button>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center">
          <p className="font-retro-sans text-xs text-stone-400">
            {tool.requiresGoogleAccount && !account
              ? 'Choose a Google account above to open Google Flow.'
              : `Loading ${tool.label}…`}
          </p>
        </div>
      </div>

      <aside
        className="shrink-0 flex flex-col items-center gap-2 py-3 border-l border-[#D6CFC0] bg-[#EBE5D5]"
        style={{ width: RAIL_W }}
      >
        {STUDIO_TOOLS.map(({ id, label, icon: Icon, accent }) => {
          const active = id === tool.id
          return (
            <button
              key={id}
              title={label}
              onClick={() => selectTool(id)}
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
