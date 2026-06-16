/**
 * PromptBar — slim action bar below the AIBrowser tab strip.
 *
 * Shows only when there is an active browser tab. Provides:
 *   - "Inject Prompt" → opens command-palette overlay
 *   - Back / Forward / Reload nav controls
 *
 * Architecture (bug-free):
 *   1. User clicks "Inject" → api.hideView() synchronously → setState(open)
 *   2. Overlay is pure React (fixed, z-50) — no native view overlap possible
 *   3. On close → if activeTab, api.switchView() to restore view
 *   No setTimeout, no ResizeObserver, no timing hacks.
 */

import { useState, useEffect, useRef } from 'react'
import { Zap, X, Search, ArrowLeft, Send, ClipboardPlus, GitBranch, Trash2, Radar } from 'lucide-react'
import type { BrowserTab } from '@/types/browser'
import { getInjectTool, isToolTab } from '@/types/browser'
import type { Prompt, PromptCategory } from '@/types/electron'
import {
  CONTINUITY_STORE_KEY,
  appendUniqueContinuityEntry,
  appendContinuityEntry,
  buildContextPassport,
  createContinuityThread,
  getContinuityStats,
  type ContinuityThread,
} from '@/lib/conversationContinuity'

const BAR_H = 40  // combined browser chrome is 40 tabs + 44 header + 40 prompt bar

interface Props {
  activeTab: BrowserTab | null
  isActive: boolean
}

function extractVars(content: string): string[] {
  return [...new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))]
}

function fillVars(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`)
}

function renderPreview(text: string) {
  const parts = text.split(/({{[\w]+}})/)
  return parts.map((part, i) =>
    part.startsWith('{{') && part.endsWith('}}')
      ? (
        <span
          key={i}
          style={{
            background: '#FEF3C7', color: '#92400E',
            borderRadius: '3px', padding: '0 4px',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em',
          }}
        >
          {part}
        </span>
      )
      : <span key={i}>{part}</span>
  )
}

function isContinuityThread(value: unknown): value is ContinuityThread {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ContinuityThread>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.entries) &&
    typeof candidate.created_at === 'string' &&
    typeof candidate.updated_at === 'string'
  )
}

type OverlayStep = 'list' | 'fill'

export default function PromptBar({ activeTab, isActive }: Props) {
  const api = window.electronAPI
  const [open, setOpen] = useState(false)
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [categories, setCategories] = useState<PromptCategory[]>([])
  const [search, setSearch] = useState('')
  const [step, setStep] = useState<OverlayStep>('list')
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const [injectStatus, setInjectStatus] = useState<'idle' | 'success' | 'error' | 'unsupported'>('idle')
  const [continuityThread, setContinuityThread] = useState<ContinuityThread | null>(null)
  const [continuityStatus, setContinuityStatus] = useState<'idle' | 'captured' | 'continued' | 'empty' | 'unsupported' | 'error' | 'cleared' | 'duplicate' | 'auto-on' | 'auto-off'>('idle')
  const [autoCapture, setAutoCapture] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const continuityStats = getContinuityStats(continuityThread)

  async function getOrCreateContinuityThread(): Promise<ContinuityThread> {
    const stored = await api.storeGet(CONTINUITY_STORE_KEY)
    if (isContinuityThread(stored)) {
      setContinuityThread(stored)
      return stored
    }

    const created = createContinuityThread({ title: 'AI Browser Continuity', workspaceId: null })
    await saveContinuityThread(created)
    return created
  }

  async function saveContinuityThread(thread: ContinuityThread): Promise<void> {
    await api.storeSet(CONTINUITY_STORE_KEY, thread)
    setContinuityThread(thread)
  }

  async function loadContinuityThread(): Promise<void> {
    const stored = await api.storeGet(CONTINUITY_STORE_KEY)
    setContinuityThread(isContinuityThread(stored) ? stored : null)
  }

  // Reset overlay state on close
  function resetOverlay() {
    setSearch('')
    setStep('list')
    setSelectedPrompt(null)
    setVarValues({})
    setInjectStatus('idle')
  }

  // Open: hide native view first, then load prompts + show overlay
  async function openOverlay() {
    if (!activeTab || !isToolTab(activeTab)) return
    await api.hideView().catch(() => {})
    const [ps, cats] = await Promise.all([
      api.promptsList(),
      api.promptsCategoriesList(),
    ])
    setPrompts(ps)
    setCategories(cats)
    resetOverlay()
    setOpen(true)
  }

  // Close: restore native view
  function closeOverlay() {
    setOpen(false)
    resetOverlay()
    if (isActive && activeTab) {
      api.switchView(activeTab.id, activeTab.gmail.partition, activeTab.url).catch(() => {})
    }
  }

  // Focus search when overlay opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    loadContinuityThread().catch(() => setContinuityStatus('error'))
  }, [])

  // Global hotkey: open-prompt-bar event from App.tsx
  useEffect(() => {
    const handler = () => { if (activeTab && isToolTab(activeTab)) openOverlay() }
    window.addEventListener('open-prompt-bar', handler)
    return () => window.removeEventListener('open-prompt-bar', handler)
  }, [activeTab])

  // Keyboard: Escape closes
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOverlay() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, isActive, activeTab])

  useEffect(() => {
    if (!autoCapture || !isActive || !activeTab || !isToolTab(activeTab)) return
    const tool = getInjectTool(activeTab.url)
    if (!tool) return

    const interval = window.setInterval(() => {
      captureLatestAssistantResponse(false).catch(() => setContinuityStatus('error'))
    }, 5000)

    return () => window.clearInterval(interval)
  }, [autoCapture, activeTab?.id, activeTab?.url, isActive])

  function getActiveProvider(tab: BrowserTab): string | null {
    if (!isToolTab(tab)) return null
    return getInjectTool(tab.url) ?? tab.tool.name
  }

  async function captureSelectedResponse() {
    if (!activeTab || !isToolTab(activeTab)) {
      setContinuityStatus('unsupported')
      return
    }

    const selectedText = await api.getSelectedText().catch(() => '')
    if (!selectedText.trim()) {
      setContinuityStatus('empty')
      return
    }

    try {
      const thread = await getOrCreateContinuityThread()
      const updated = appendContinuityEntry(thread, {
        role: 'assistant',
        content: selectedText,
        provider: getActiveProvider(activeTab),
        accountEmail: activeTab.gmail.email,
      })
      await saveContinuityThread(updated)
      setContinuityStatus('captured')
    } catch {
      setContinuityStatus('error')
    }
  }

  async function captureLatestAssistantResponse(showDuplicateStatus = true) {
    if (!activeTab || !isToolTab(activeTab)) {
      setContinuityStatus('unsupported')
      return false
    }

    const tool = getInjectTool(activeTab.url)
    if (!tool) {
      setContinuityStatus('unsupported')
      return false
    }

    const assistantText = await api.captureLatestAssistant(activeTab.id, tool).catch(() => '')
    if (!assistantText.trim()) {
      if (showDuplicateStatus) setContinuityStatus('empty')
      return false
    }

    try {
      const thread = await getOrCreateContinuityThread()
      const result = appendUniqueContinuityEntry(thread, {
        role: 'assistant',
        content: assistantText,
        provider: getActiveProvider(activeTab),
        accountEmail: activeTab.gmail.email,
      })
      await saveContinuityThread(result.thread)
      setContinuityStatus(result.added ? 'captured' : (showDuplicateStatus ? 'duplicate' : 'idle'))
      return result.added
    } catch {
      setContinuityStatus('error')
      return false
    }
  }

  async function injectHandoffPrompt() {
    if (!activeTab || !isToolTab(activeTab)) {
      setContinuityStatus('unsupported')
      return
    }

    const thread = await getOrCreateContinuityThread()
    if (!getContinuityStats(thread).hasContext) {
      setContinuityStatus('empty')
      return
    }

    const tool = getInjectTool(activeTab.url)
    if (!tool) {
      setContinuityStatus('unsupported')
      return
    }

    const prompt = buildContextPassport(thread, {
      targetProvider: getActiveProvider(activeTab),
      targetAccountEmail: activeTab.gmail.email,
    })
    const ok = await api.injectToTab(activeTab.id, prompt, tool).catch(() => false)
    setContinuityStatus(ok ? 'continued' : 'error')
  }

  async function clearContinuityThread() {
    await api.storeSet(CONTINUITY_STORE_KEY, null)
    setContinuityThread(null)
    setContinuityStatus('cleared')
  }

  function toggleAutoCapture() {
    setAutoCapture(current => {
      const next = !current
      setContinuityStatus(next ? 'auto-on' : 'auto-off')
      return next
    })
  }

  function selectPrompt(p: Prompt) {
    const vars = extractVars(p.content)
    setSelectedPrompt(p)
    setVarValues(Object.fromEntries(vars.map(v => [v, ''])))
    setInjectStatus('idle')
    if (vars.length > 0) {
      setStep('fill')
    } else {
      setStep('fill') // show preview even with no vars
    }
  }

  async function handleInject() {
    if (!selectedPrompt || !activeTab) return
    if (!isToolTab(activeTab)) {
      setInjectStatus('unsupported')
      return
    }
    const filled = fillVars(selectedPrompt.content, varValues)
    const tool = getInjectTool(activeTab.url)
    if (!tool) {
      setInjectStatus('unsupported')
      return
    }
    // Use injectToTab — works even though view is currently hidden (hideView sets activeTabId=null)
    const ok = await api.injectToTab(activeTab.id, filled, tool).catch(() => false)
    setInjectStatus(ok ? 'success' : 'error')
    if (ok) {
      const thread = await getOrCreateContinuityThread()
      const updated = appendContinuityEntry(thread, {
        role: 'user',
        content: filled,
        provider: getActiveProvider(activeTab),
        accountEmail: activeTab.gmail.email,
      })
      await saveContinuityThread(updated)
      setContinuityStatus('captured')
      setTimeout(() => closeOverlay(), 600)
    }
  }

  const filteredPrompts = prompts.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.content.toLowerCase().includes(search.toLowerCase())
  )

  const vars = selectedPrompt ? extractVars(selectedPrompt.content) : []
  const filledContent = selectedPrompt ? fillVars(selectedPrompt.content, varValues) : ''
  const canInject = !!selectedPrompt && vars.every(v => varValues[v]?.trim())
  const continuityStatusText = {
    idle: '',
    captured: 'Context saved',
    continued: 'Handoff injected',
    empty: 'Select text or save a prompt first',
    unsupported: 'Continuity works on supported AI tabs',
    error: 'Continuity action failed',
    cleared: 'Continuity cleared',
    duplicate: 'Already captured',
    'auto-on': 'Auto capture on',
    'auto-off': 'Auto capture off',
  }[continuityStatus]

  // ── Bar (always rendered when there's an active tab) ──────────

  if (!activeTab) return null

  return (
    <>
      {/* ── PROMPT BAR ─────────────────────────────────────────── */}
      <div
        style={{
          height: `${BAR_H}px`,
          display: 'flex', alignItems: 'center',
          gap: '6px', padding: '0 10px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        {isToolTab(activeTab) ? (
          <button
            onClick={openOverlay}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 11px', borderRadius: '7px', cursor: 'pointer',
              background: 'var(--accent-muted)', border: '1px solid var(--accent-border)',
              color: 'var(--accent)', fontSize: '11.5px', fontWeight: 600,
              transition: 'all 0.12s', flexShrink: 0,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'var(--accent)'
              ;(e.currentTarget as HTMLElement).style.color = 'white'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
            }}
          >
            <Zap size={11} fill="currentColor" />
            Inject Prompt
          </button>
        ) : (
          <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
            Prompt injection sirf AI tabs ke liye available hai
          </span>
        )}

        <div style={{ width: '1px', height: '18px', background: 'var(--border)', margin: '0 2px' }} />

        <span
          title={continuityStats.lastUpdatedAt ? `Last saved: ${continuityStats.lastUpdatedAt}` : 'No continuity context yet'}
          style={{
            fontSize: '10.5px',
            color: continuityStats.hasContext ? 'var(--accent)' : 'var(--text-3)',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          Continuity {continuityStats.entryCount}
        </span>

        {isToolTab(activeTab) && (
          <>
            <button
              onClick={captureSelectedResponse}
              title="Save selected text from the current AI page as context"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 9px', borderRadius: '7px', cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-2)', fontSize: '11px', fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <ClipboardPlus size={11} />
              Capture
            </button>

            <button
              onClick={toggleAutoCapture}
              title="Automatically capture the latest assistant response from this AI tab"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 9px', borderRadius: '7px', cursor: 'pointer',
                background: autoCapture ? 'var(--success-muted)' : 'transparent',
                border: `1px solid ${autoCapture ? 'var(--success)' : 'var(--border)'}`,
                color: autoCapture ? 'var(--success)' : 'var(--text-2)',
                fontSize: '11px', fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <Radar size={11} />
              Auto
            </button>

            <button
              onClick={() => { captureLatestAssistantResponse(true).catch(() => setContinuityStatus('error')) }}
              title="Capture the latest visible assistant response now"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 9px', borderRadius: '7px', cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-2)', fontSize: '11px', fontWeight: 600,
                flexShrink: 0,
              }}
            >
              Sync
            </button>

            <button
              onClick={injectHandoffPrompt}
              disabled={!continuityStats.hasContext}
              title="Inject a structured Context Passport into this AI tab"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 9px', borderRadius: '7px',
                cursor: continuityStats.hasContext ? 'pointer' : 'not-allowed',
                background: continuityStats.hasContext ? 'var(--accent-muted)' : 'transparent',
                border: '1px solid var(--accent-border)',
                color: continuityStats.hasContext ? 'var(--accent)' : 'var(--text-3)',
                fontSize: '11px', fontWeight: 600,
                flexShrink: 0,
              }}
            >
              <GitBranch size={11} />
              Passport
            </button>

            {continuityStats.hasContext && (
              <button
                onClick={clearContinuityThread}
                title="Clear saved continuity context"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '26px', height: '26px', borderRadius: '7px',
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-3)', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </>
        )}

        {continuityStatusText && (
          <span style={{
            marginLeft: 'auto',
            fontSize: '10.5px',
            color: continuityStatus === 'error' || continuityStatus === 'unsupported' || continuityStatus === 'empty'
              ? 'var(--danger)'
              : 'var(--success)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {continuityStatusText}
          </span>
        )}
      </div>

      {/* ── INJECT OVERLAY ─────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={closeOverlay}
        >
          <div
            style={{
              width: '100%', maxWidth: '540px',
              maxHeight: '80vh',
              background: 'var(--surface)',
              borderRadius: '16px',
              border: '1px solid var(--border)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08)',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              animation: 'slideUpFadeIn 0.18s ease',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── LIST STEP ─────────────────────────────────────── */}
            {step === 'list' && (
              <>
                {/* Search */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <Search size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search prompts..."
                    style={{
                      flex: 1, border: 'none', background: 'transparent',
                      fontSize: '13px', color: 'var(--text)', outline: 'none',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  />
                  <button
                    onClick={closeOverlay}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '24px', height: '24px', borderRadius: '6px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-3)', flexShrink: 0,
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Prompt list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                  {filteredPrompts.length === 0 && (
                    <div style={{
                      padding: '40px 20px', textAlign: 'center',
                      color: 'var(--text-3)', fontSize: '12px',
                    }}>
                      {prompts.length === 0
                        ? 'No prompts yet — create some in the Prompts page'
                        : 'No prompts match your search'}
                    </div>
                  )}
                  {filteredPrompts.map(p => {
                    const pVars = extractVars(p.content)
                    const cat = categories.find(c => c.id === p.categoryId)
                    return (
                      <button
                        key={p.id}
                        onClick={() => selectPrompt(p)}
                        style={{
                          width: '100%', textAlign: 'left',
                          padding: '10px 12px', borderRadius: '10px',
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          transition: 'background 0.1s',
                          display: 'flex', flexDirection: 'column', gap: '4px',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)', flex: 1 }}>
                            {p.name}
                          </span>
                          {pVars.length > 0 && (
                            <span style={{
                              fontSize: '10px', fontWeight: 600,
                              background: '#FEF3C7', color: '#92400E',
                              borderRadius: '5px', padding: '1px 6px',
                              flexShrink: 0,
                            }}>
                              {pVars.length} var{pVars.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {cat && (
                            <span style={{
                              fontSize: '10px', fontWeight: 500,
                              borderRadius: '5px', padding: '1px 6px',
                              background: `${cat.color}18`, color: cat.color,
                              flexShrink: 0,
                            }}>
                              {cat.name}
                            </span>
                          )}
                        </div>
                        <span style={{
                          fontSize: '11px', color: 'var(--text-3)',
                          display: '-webkit-box', WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          lineHeight: 1.5,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}>
                          {p.content.slice(0, 120)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* ── FILL STEP ─────────────────────────────────────── */}
            {step === 'fill' && selectedPrompt && (
              <>
                {/* Header */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <button
                    onClick={() => { setStep('list'); setInjectStatus('idle') }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '26px', height: '26px', borderRadius: '7px',
                      background: 'var(--surface-2)', border: 'none', cursor: 'pointer',
                      color: 'var(--text-2)', flexShrink: 0,
                    }}
                  >
                    <ArrowLeft size={13} />
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', flex: 1 }}>
                    {selectedPrompt.name}
                  </span>
                  <button
                    onClick={closeOverlay}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '26px', height: '26px', borderRadius: '7px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-3)', flexShrink: 0,
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                  {/* Variable fields */}
                  {vars.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                      <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', margin: 0 }}>
                        Fill Variables
                      </p>
                      {vars.map(v => (
                        <div key={v} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{
                            fontSize: '10.5px', fontWeight: 600, color: 'var(--text-2)',
                            display: 'flex', alignItems: 'center', gap: '5px',
                          }}>
                            <span style={{
                              background: '#FEF3C7', color: '#92400E',
                              borderRadius: '3px', padding: '1px 5px',
                              fontFamily: 'JetBrains Mono, monospace', fontSize: '0.9em',
                            }}>
                              {`{{${v}}}`}
                            </span>
                          </label>
                          <input
                            autoFocus={vars.indexOf(v) === 0}
                            value={varValues[v] ?? ''}
                            onChange={e => setVarValues(prev => ({ ...prev, [v]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter' && canInject) handleInject() }}
                            placeholder={`Enter ${v}...`}
                            style={{
                              width: '100%', padding: '8px 10px',
                              borderRadius: '8px', border: '1px solid var(--border)',
                              background: 'var(--surface-2)', color: 'var(--text)',
                              fontSize: '12px', outline: 'none', fontFamily: 'DM Sans, sans-serif',
                              transition: 'border-color 0.12s',
                            }}
                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Preview */}
                  <div>
                    <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>
                      Preview
                    </p>
                    <div style={{
                      padding: '12px', borderRadius: '10px',
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      fontSize: '11.5px', lineHeight: 1.7,
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'var(--text-2)',
                      maxHeight: '160px', overflowY: 'auto',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {renderPreview(filledContent)}
                    </div>
                  </div>
                </div>

                {/* Footer: inject */}
                <div style={{
                  padding: '12px 16px',
                  borderTop: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: '10px',
                }}>
                  {injectStatus === 'unsupported' && (
                    <span style={{ fontSize: '11px', color: 'var(--danger)', flex: 1 }}>
                      Injection not supported for this tool (only ChatGPT, Claude, Gemini, Grok)
                    </span>
                  )}
                  {injectStatus === 'error' && (
                    <span style={{ fontSize: '11px', color: 'var(--danger)', flex: 1 }}>
                      Injection failed — is the AI tool input visible?
                    </span>
                  )}
                  {injectStatus === 'success' && (
                    <span style={{ fontSize: '11px', color: 'var(--success)', flex: 1 }}>
                      Prompt injected!
                    </span>
                  )}
                  {injectStatus === 'idle' && <div style={{ flex: 1 }} />}

                  <button
                    onClick={handleInject}
                    disabled={!canInject}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '8px 18px', borderRadius: '9px', cursor: canInject ? 'pointer' : 'not-allowed',
                      background: canInject ? 'var(--accent)' : 'var(--surface-3)',
                      border: 'none',
                      color: canInject ? 'white' : 'var(--text-3)',
                      fontSize: '12px', fontWeight: 600,
                      transition: 'all 0.12s', flexShrink: 0,
                    }}
                    onMouseEnter={e => {
                      if (canInject) (e.currentTarget as HTMLElement).style.opacity = '0.88'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.opacity = '1'
                    }}
                  >
                    <Send size={12} />
                    Inject
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUpFadeIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  )
}
