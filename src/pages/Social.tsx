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
import { RotateCw, User, Edit2, Trash2 } from 'lucide-react'
import { SOCIAL_PLATFORMS, DEFAULT_PLATFORM_ID } from '@/config/socialPlatforms'
import type { GmailSession, SocialAccountRow } from '@/types/electron'

const RAIL_W = 64
const TOP_H = 44

interface Props { isActive: boolean }

interface TikTokAccount {
  id: string
  label: string
  partition: string
}

const DEFAULT_TIKTOK_ACCOUNTS: TikTokAccount[] = [
  { id: '1', label: 'Account 1 (@alphapaws6)', partition: 'social-tiktok' },
  { id: '2', label: 'Account 2', partition: 'social-tiktok-2' },
]

interface LinkedInAccount {
  id: string
  label: string
  partition: string
}

// Platforms whose account list comes from the main-process social registry
// (electron/socialAccounts.ts), so the switcher and the MCP/CLI tools agree on
// which slot is which.
const REGISTRY_SWITCHER = new Set(['pinterest', 'whatsapp', 'facebook'])

const DEFAULT_LINKEDIN_ACCOUNTS: LinkedInAccount[] = [
  { id: '1', label: 'Account 1 (Primary)', partition: 'social-linkedin' },
  { id: '2', label: 'Account 2', partition: 'social-linkedin-2' },
]

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
  const [gmailSessions, setGmailSessions] = useState<GmailSession[]>([])
  const [selectedEmail, setSelectedEmail] = useState<string>(() => {
    return localStorage.getItem('socialAccountEmail') || ''
  })
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccount[]>(() => {
    try {
      const saved = localStorage.getItem('socialTiktokAccounts')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return DEFAULT_TIKTOK_ACCOUNTS
  })
  const [selectedTikTokId, setSelectedTikTokId] = useState<string>(() => {
    return localStorage.getItem('socialSelectedTiktokId') || '1'
  })
  const [linkedinAccounts, setLinkedinAccounts] = useState<LinkedInAccount[]>(() => {
    try {
      const saved = localStorage.getItem('socialLinkedinAccounts')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return DEFAULT_LINKEDIN_ACCOUNTS
  })
  const [selectedLinkedInId, setSelectedLinkedInId] = useState<string>(() => {
    return localStorage.getItem('socialSelectedLinkedinId') || '1'
  })

  const platform = SOCIAL_PLATFORMS.find(p => p.id === activeId) ?? SOCIAL_PLATFORMS[0]
  const usesRegistry = REGISTRY_SWITCHER.has(platform.id)
  const [registryAccounts, setRegistryAccounts] = useState<SocialAccountRow[]>([])
  const [registrySelected, setRegistrySelected] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('socialRegistrySelected') || '{}') as Record<string, string> } catch { return {} }
  })

  const loadRegistry = useCallback(async () => {
    if (!usesRegistry || !api.socialAccounts) return
    const res = await api.socialAccounts(platform.id).catch(() => null)
    setRegistryAccounts(res?.ok && res.accounts ? res.accounts : [])
  }, [api, platform.id, usesRegistry])

  useEffect(() => { void loadRegistry() }, [loadRegistry])

  useEffect(() => {
    Promise.all([
      api.gmailList().catch(() => []),
      api.gmailGetAgentAccount().catch(() => null),
    ]).then(([sessions, agentEmail]) => {
      setGmailSessions(sessions)
      if (sessions.length > 0) {
        setSelectedEmail(prev => {
          if (prev && sessions.some(s => s.email === prev)) return prev
          const chosen = (agentEmail && sessions.some(s => s.email === agentEmail)) ? agentEmail : sessions[0].email
          localStorage.setItem('socialAccountEmail', chosen)
          return chosen
        })
      }
    })
  }, [api])

  const currentSession = gmailSessions.find(s => s.email === selectedEmail) ?? gmailSessions[0]
  const currentTikTok = tiktokAccounts.find(a => a.id === selectedTikTokId) ?? tiktokAccounts[0]
  const currentLinkedIn = linkedinAccounts.find(a => a.id === selectedLinkedInId) ?? linkedinAccounts[0]
  const platformRegistry = registryAccounts.filter(a => a.platform === platform.id)
  const selectedRegistryId = registrySelected[platform.id] ?? '1'
  const currentRegistry = usesRegistry
    ? platformRegistry.find(a => a.id === selectedRegistryId) ?? platformRegistry[0]
    : undefined

  let effectivePartition = platform.partition
  let effectiveTabId = `social-${platform.id}`

  if (platform.id === 'reddit' && currentSession) {
    effectivePartition = currentSession.partition
    effectiveTabId = `social-${platform.id}-${currentSession.email}`
  } else if (platform.id === 'tiktok' && currentTikTok) {
    effectivePartition = currentTikTok.partition
    effectiveTabId = currentTikTok.id === '1' ? 'social-tiktok' : `social-tiktok-${currentTikTok.id}`
  } else if (platform.id === 'linkedin' && currentLinkedIn) {
    effectivePartition = currentLinkedIn.partition
    effectiveTabId = currentLinkedIn.id === '1' ? 'social-linkedin' : `social-linkedin-${currentLinkedIn.id}`
  } else if (currentRegistry) {
    effectivePartition = currentRegistry.partition
    effectiveTabId = currentRegistry.id === '1' ? `social-${platform.id}` : `social-${platform.id}-${currentRegistry.id}`
  }

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
  // One tab id per platform/account, so switching platforms parks the previous view
  // rather than destroying it.
  useEffect(() => {
    if (!isActive) {
      api.hideView(effectiveTabId).catch(() => {})
      return
    }
    api.switchView(effectiveTabId, effectivePartition, platform.url).catch(() => {})
    applyBounds()
  }, [isActive, effectiveTabId, effectivePartition, platform.url, applyBounds])

  // Apply bounds when page becomes active or navigation sidebar width changes.
  // Window resizing is handled deterministically by Electron's native window resize
  // handler using customInsets, preventing race conditions and visual jitter.
  useEffect(() => {
    if (!isActive) return
    applyBounds()
  }, [isActive, applyBounds])

  useEffect(() => {
    return () => { api.hideView().catch(() => {}) }
  }, [api])

  // ── Synchronize TikTok active account with main process ─────────
  useEffect(() => {
    if (activeId === 'tiktok') {
      api.tiktokSetActiveAccount?.(selectedTikTokId).catch?.(() => {})
    }
  }, [api, activeId, selectedTikTokId])

  useEffect(() => {
    if (!api.onTikTokAccountSwitched) return
    const cleanup = api.onTikTokAccountSwitched((switchedId) => {
      setSelectedTikTokId(switchedId)
      localStorage.setItem('socialSelectedTiktokId', switchedId)
    })
    return cleanup
  }, [api])

  function selectPlatform(id: string) {
    setActiveId(id)
    localStorage.setItem('socialActivePlatform', id)
  }

  function handleAccountChange(email: string) {
    setSelectedEmail(email)
    localStorage.setItem('socialAccountEmail', email)
  }

  function handleRegistryChange(id: string) {
    const next = { ...registrySelected, [platform.id]: id }
    setRegistrySelected(next)
    localStorage.setItem('socialRegistrySelected', JSON.stringify(next))
  }

  async function handleAddRegistryAccount() {
    const res = await api.socialAddAccount?.(platform.id).catch(() => null)
    if (!res?.ok || !res.account) { if (res?.error) window.alert(res.error); return }
    await loadRegistry()
    handleRegistryChange(res.account.id)
  }

  async function handleRenameRegistryAccount() {
    if (!currentRegistry) return
    const newName = window.prompt('Enter account label:', currentRegistry.label)
    if (!newName || !newName.trim()) return
    const res = await api.socialAddAccount?.(platform.id, newName.trim(), currentRegistry.id).catch(() => null)
    if (res && !res.ok && res.error) window.alert(res.error)
    await loadRegistry()
  }

  function handleTikTokChange(id: string) {
    setSelectedTikTokId(id)
    localStorage.setItem('socialSelectedTiktokId', id)
    api.tiktokSetActiveAccount?.(id).catch?.(() => {})
  }

  function handleAddTikTokAccount() {
    const nextNum = tiktokAccounts.length + 1
    const newAccount: TikTokAccount = {
      id: String(nextNum),
      label: `Account ${nextNum}`,
      partition: `social-tiktok-${nextNum}`,
    }
    const updated = [...tiktokAccounts, newAccount]
    setTiktokAccounts(updated)
    setSelectedTikTokId(newAccount.id)
    localStorage.setItem('socialTiktokAccounts', JSON.stringify(updated))
    localStorage.setItem('socialSelectedTiktokId', newAccount.id)
    api.tiktokSetActiveAccount?.(newAccount.id).catch?.(() => {})
  }

  function handleRenameTikTokAccount() {
    if (!currentTikTok) return
    const currentLabel = currentTikTok.label
    const newName = window.prompt('Enter account label / username (e.g. @myhandle):', currentLabel)
    if (!newName || !newName.trim()) return

    const updated = tiktokAccounts.map(a =>
      a.id === currentTikTok.id ? { ...a, label: newName.trim() } : a,
    )
    setTiktokAccounts(updated)
    localStorage.setItem('socialTiktokAccounts', JSON.stringify(updated))
  }

  function handleRemoveTikTokAccount(id: string) {
    if (id === '1') {
      window.alert('Cannot remove the primary default account.')
      return
    }
    const accToRemove = tiktokAccounts.find(a => a.id === id)
    if (!window.confirm(`Are you sure you want to remove ${accToRemove?.label || 'this account'} profile?`)) return

    const tabIdToClose = id === '1' ? 'social-tiktok' : `social-tiktok-${id}`
    api.closeView(tabIdToClose).catch(() => {})

    const updated = tiktokAccounts.filter(a => a.id !== id)
    setTiktokAccounts(updated)
    localStorage.setItem('socialTiktokAccounts', JSON.stringify(updated))
    setSelectedTikTokId('1')
    localStorage.setItem('socialSelectedTiktokId', '1')
  }

  // ── Synchronize LinkedIn active account with main process ───────
  useEffect(() => {
    if (activeId === 'linkedin') {
      api.linkedinSetActiveAccount?.(selectedLinkedInId).catch?.(() => {})
    }
  }, [api, activeId, selectedLinkedInId])

  useEffect(() => {
    if (!api.onLinkedInAccountSwitched) return
    const cleanup = api.onLinkedInAccountSwitched((switchedId) => {
      setSelectedLinkedInId(switchedId)
      localStorage.setItem('socialSelectedLinkedinId', switchedId)
    })
    return cleanup
  }, [api])

  function handleLinkedInChange(id: string) {
    setSelectedLinkedInId(id)
    localStorage.setItem('socialSelectedLinkedinId', id)
    api.linkedinSetActiveAccount?.(id).catch?.(() => {})
  }

  function handleAddLinkedInAccount() {
    const nextNum = linkedinAccounts.length + 1
    const newAccount: LinkedInAccount = {
      id: String(nextNum),
      label: `Account ${nextNum}`,
      partition: `social-linkedin-${nextNum}`,
    }
    const updated = [...linkedinAccounts, newAccount]
    setLinkedinAccounts(updated)
    setSelectedLinkedInId(newAccount.id)
    localStorage.setItem('socialLinkedinAccounts', JSON.stringify(updated))
    localStorage.setItem('socialSelectedLinkedinId', newAccount.id)
    api.linkedinSetActiveAccount?.(newAccount.id).catch?.(() => {})
    api.linkedinSaveAccounts?.(updated).catch?.(() => {})
  }

  function handleRenameLinkedInAccount() {
    if (!currentLinkedIn) return
    const currentLabel = currentLinkedIn.label
    const newName = window.prompt('Enter account label / name (e.g. Sales, Lead Gen, Personal):', currentLabel)
    if (!newName || !newName.trim()) return

    const updated = linkedinAccounts.map(a =>
      a.id === currentLinkedIn.id ? { ...a, label: newName.trim() } : a,
    )
    setLinkedinAccounts(updated)
    localStorage.setItem('socialLinkedinAccounts', JSON.stringify(updated))
    api.linkedinSaveAccounts?.(updated).catch?.(() => {})
  }

  function handleRemoveLinkedInAccount(id: string) {
    if (id === '1') {
      window.alert('Cannot remove the primary default account.')
      return
    }
    const accToRemove = linkedinAccounts.find(a => a.id === id)
    if (!window.confirm(`Are you sure you want to remove ${accToRemove?.label || 'this account'} profile?`)) return

    const tabIdToClose = id === '1' ? 'social-linkedin' : `social-linkedin-${id}`
    api.closeView(tabIdToClose).catch(() => {})

    const updated = linkedinAccounts.filter(a => a.id !== id)
    setLinkedinAccounts(updated)
    localStorage.setItem('socialLinkedinAccounts', JSON.stringify(updated))
    setSelectedLinkedInId('1')
    localStorage.setItem('socialSelectedLinkedinId', '1')
    api.linkedinSaveAccounts?.(updated).catch?.(() => {})
  }

  return (
    <div className="flex h-full w-full">
      {/* Centre column — the native view is painted into the gap below the header */}
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="shrink-0 flex items-center justify-between px-4 border-b border-[#D6CFC0] bg-[#EBE5D5]"
          style={{ height: TOP_H }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: platform.accent }}
              />
              <span className="font-retro-mono text-xs font-bold uppercase tracking-wider text-stone-900 truncate">
                {platform.label}
              </span>
            </div>

            {/* TikTok Multi-Account Switcher */}
            {platform.id === 'tiktok' && (
              <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-[#D6CFC0]">
                <User size={13} className="text-stone-500 shrink-0" />
                <span className="font-retro-sans text-[11px] text-stone-600 hidden sm:inline">
                  Account:
                </span>
                <select
                  value={selectedTikTokId}
                  onChange={e => {
                    if (e.target.value === '__add_new__') {
                      handleAddTikTokAccount()
                    } else {
                      handleTikTokChange(e.target.value)
                    }
                  }}
                  className="font-retro-sans text-xs bg-[#FAF7F0] border border-[#D6CFC0] rounded px-2 py-0.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-400 cursor-pointer"
                >
                  {tiktokAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.label}
                    </option>
                  ))}
                  <option value="__add_new__">+ Add New Account…</option>
                </select>

                <button
                  type="button"
                  title="Rename account label"
                  onClick={handleRenameTikTokAccount}
                  className="p-1 hover:bg-[#FAF7F0] rounded text-stone-500 hover:text-stone-800 transition-colors"
                >
                  <Edit2 size={12} />
                </button>

                {tiktokAccounts.length > 1 && selectedTikTokId !== '1' && (
                  <button
                    type="button"
                    title="Remove this account profile"
                    onClick={() => handleRemoveTikTokAccount(selectedTikTokId)}
                    className="p-1 hover:bg-[#FAF7F0] rounded text-stone-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )}

            {/* Registry Multi-Account Switcher (Pinterest, WhatsApp, Facebook) */}
            {usesRegistry && platformRegistry.length > 0 && (
              <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-[#D6CFC0]">
                <User size={13} className="text-stone-500 shrink-0" />
                <span className="font-retro-sans text-[11px] text-stone-600 hidden sm:inline">
                  Account:
                </span>
                <select
                  value={currentRegistry?.id ?? '1'}
                  onChange={e => {
                    if (e.target.value === '__add_new__') {
                      void handleAddRegistryAccount()
                    } else {
                      handleRegistryChange(e.target.value)
                    }
                  }}
                  className="font-retro-sans text-xs bg-[#FAF7F0] border border-[#D6CFC0] rounded px-2 py-0.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-400 cursor-pointer"
                >
                  {platformRegistry.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.label}{acc.signedIn === false ? ' (signed out)' : ''}
                    </option>
                  ))}
                  <option value="__add_new__">+ Add New Account…</option>
                </select>

                <button
                  type="button"
                  title="Rename account label"
                  onClick={() => void handleRenameRegistryAccount()}
                  className="p-1 hover:bg-[#FAF7F0] rounded text-stone-500 hover:text-stone-800 transition-colors"
                >
                  <Edit2 size={12} />
                </button>
              </div>
            )}

            {/* LinkedIn Multi-Account Switcher */}
            {platform.id === 'linkedin' && (
              <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-[#D6CFC0]">
                <User size={13} className="text-stone-500 shrink-0" />
                <span className="font-retro-sans text-[11px] text-stone-600 hidden sm:inline">
                  Account:
                </span>
                <select
                  value={selectedLinkedInId}
                  onChange={e => {
                    if (e.target.value === '__add_new__') {
                      handleAddLinkedInAccount()
                    } else {
                      handleLinkedInChange(e.target.value)
                    }
                  }}
                  className="font-retro-sans text-xs bg-[#FAF7F0] border border-[#D6CFC0] rounded px-2 py-0.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-400 cursor-pointer"
                >
                  {linkedinAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.label}
                    </option>
                  ))}
                  <option value="__add_new__">+ Add New Account…</option>
                </select>

                <button
                  type="button"
                  title="Rename account label"
                  onClick={handleRenameLinkedInAccount}
                  className="p-1 hover:bg-[#FAF7F0] rounded text-stone-500 hover:text-stone-800 transition-colors"
                >
                  <Edit2 size={12} />
                </button>

                {linkedinAccounts.length > 1 && selectedLinkedInId !== '1' && (
                  <button
                    type="button"
                    title="Remove this account profile"
                    onClick={() => handleRemoveLinkedInAccount(selectedLinkedInId)}
                    className="p-1 hover:bg-[#FAF7F0] rounded text-stone-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )}

            {/* Google Account Connection Switcher */}
            {platform.id === 'reddit' && gmailSessions.length > 0 && (
              <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-[#D6CFC0]">
                <User size={13} className="text-stone-500 shrink-0" />
                <span className="font-retro-sans text-[11px] text-stone-600 hidden sm:inline">
                  Google Account:
                </span>
                <select
                  value={selectedEmail}
                  onChange={e => handleAccountChange(e.target.value)}
                  className="font-retro-sans text-xs bg-[#FAF7F0] border border-[#D6CFC0] rounded px-2 py-0.5 text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-400 cursor-pointer"
                >
                  {gmailSessions.map(s => (
                    <option key={s.email} value={s.email}>
                      {s.label || s.email}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
