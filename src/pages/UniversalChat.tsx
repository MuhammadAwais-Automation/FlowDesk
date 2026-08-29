import { useEffect, useRef, useState } from 'react'
import { Plus, Terminal } from 'lucide-react'
import {
  createContinuityThread,
  appendContinuityEntry,
  appendUniqueContinuityEntry,
  type ContinuityThread,
} from '@/lib/conversationContinuity'
import { ChatBubble } from '@/components/chat/ChatBubble'
import { ChatInputBar } from '@/components/chat/ChatInputBar'
import { InlineDictationControl } from '@/components/voice/InlineDictationControl'
import { TypewriterDropdown } from '@/components/ui/TypewriterDropdown'
import type { UniversalChatRun } from '@/types/electron'

const UNIVERSAL_CHAT_STORE_KEY = 'universalChatSession'

const PROVIDERS = [
  { id: 'chatgpt', label: 'ChatGPT', num: '01' },
  { id: 'claude', label: 'Claude', num: '02' },
  { id: 'gemini', label: 'Gemini', num: '03' },
  { id: 'grok', label: 'Grok', num: '04' },
  { id: 'perplexity', label: 'Perplexity', num: '05' },
] as const

type ProviderId = typeof PROVIDERS[number]['id']

function providerLabel(id: string | null): string {
  return PROVIDERS.find(p => p.id === id)?.label ?? id ?? 'AI'
}

function isContinuityThread(value: unknown): value is ContinuityThread {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ContinuityThread>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.entries) &&
    typeof candidate.created_at === 'string' &&
    typeof candidate.updated_at === 'string'
  )
}

const UNIVERSAL_PLACEHOLDERS = [
  'Type your prompt here... (Press Enter to send)',
  'Direct message to selected target AI provider...',
  'Switch engines anytime using the typewriter selector...',
]

export default function UniversalChat() {
  const api = window.electronAPI
  const [session, setSession] = useState<ContinuityThread | null>(null)
  const [provider, setProvider] = useState<ProviderId>('chatgpt')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sendingRef = useRef(false)
  const sessionRef = useRef<ContinuityThread | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const handledRunsRef = useRef(new Set<string>())

  useEffect(() => { sessionRef.current = session }, [session])

  // Load or create Universal Chat session
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const stored = await api.storeGet(UNIVERSAL_CHAT_STORE_KEY)
      if (cancelled) return
      if (isContinuityThread(stored)) {
        setSession(stored)
      } else {
        const created = createContinuityThread({ title: 'Universal Chat' })
        await api.storeSet(UNIVERSAL_CHAT_STORE_KEY, created)
        if (!cancelled) setSession(created)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /* old capture listeners intentionally replaced by the durable request journal.
  useEffect(() => {
    function onLive(_e: unknown, data: { tool: string; textSoFar: string }) {
      if (!sendingRef.current || data.tool !== providerRef.current) return
      setLiveText(data.textSoFar)
    }
    function onComplete(_e: unknown, data: { tool: string; text: string; error?: string }) {
      if (!sendingRef.current || data.tool !== providerRef.current) return

      if (!data.text.trim() && !data.error) return

      sendingRef.current = false
      setSending(false)
      setLiveText('')

      if (!data.text.trim()) {
        setError(`No response from ${providerLabel(data.tool)} — try again.`)
        return
      }

      setSession(prev => {
        if (!prev) return prev
        const next = appendContinuityEntry(prev, {
          role: 'assistant',
          content: data.text,
          provider: providerRef.current,
        })
        api.storeSet(UNIVERSAL_CHAT_STORE_KEY, next).catch(() => {})
        return next
      })
    }
    api.onCaptureLive(onLive)
    api.onCaptureComplete(onComplete)
    return () => {
      api.offCaptureLive(onLive)
      api.offCaptureComplete(onComplete)
    }
  }, []) */

  function applyRun(run: UniversalChatRun) {
    if (run.sessionId !== sessionRef.current?.id) return
    setProvider(run.provider as ProviderId)
    if (run.status === 'running') {
      sendingRef.current = true
      setSending(true)
      setLiveText(run.liveText)
      setError(null)
      return
    }
    sendingRef.current = false
    setSending(false)
    setLiveText('')
    if (run.status === 'completed' && run.text && !handledRunsRef.current.has(run.requestId)) {
      handledRunsRef.current.add(run.requestId)
      setSession(prev => {
        if (!prev) return prev
        const result = appendUniqueContinuityEntry(prev, { role: 'assistant', content: run.text!, provider: run.provider })
        if (result.added) api.storeSet(UNIVERSAL_CHAT_STORE_KEY, result.thread).catch(() => {})
        return result.thread
      })
    } else if (run.status !== 'completed') setError(run.error || `${providerLabel(run.provider)} response did not complete.`)
  }

  useEffect(() => {
    const onEvent = (_e: unknown, data: { run: UniversalChatRun }) => applyRun(data.run)
    api.onUniversalChatEvent(onEvent)
    return () => api.offUniversalChatEvent(onEvent)
  }, [])

  useEffect(() => {
    if (!session) return
    api.universalChatGetRunState(session.id).then(snapshot => snapshot.runs.forEach(applyRun)).catch(() => {})
  }, [session?.id])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [session?.entries.length, liveText])

  async function persist(next: ContinuityThread) {
    setSession(next)
    await api.storeSet(UNIVERSAL_CHAT_STORE_KEY, next)
  }

  async function handleNewSession() {
    if (sendingRef.current) return
    const created = createContinuityThread({ title: 'Universal Chat' })
    await persist(created)
    setError(null)
  }

  async function handleSend(textToSend?: string) {
    const text = (textToSend || input).trim()
    if (!text || !session || sendingRef.current) return

    sendingRef.current = true
    setSending(true)
    setError(null)
    setInput('')
    setLiveText('')

    const withUser = appendContinuityEntry(session, { role: 'user', content: text, provider })
    await persist(withUser)

    const viewResult = await api.universalChatStart({ sessionId: session.id, provider, text })
    if ('error' in viewResult) {
      sendingRef.current = false
      setSending(false)
      setError(
        viewResult.error === 'provider_busy'
          ? `${providerLabel(provider)} already has a response in progress. Please wait for it to finish.`
          : `${providerLabel(provider)} isn't supported yet.`
      )
      return
    }

    /* const ok = await api.universalChatSend(viewResult.tabId, text, provider)
    if (!ok) {
      clearWatchdog()
      sendingRef.current = false
      setSending(false)
      setError(`Could not send the message to ${providerLabel(provider)} — the tab may still be loading, try again.`)
      return
    }

    clearWatchdog()
    watchdogRef.current = setTimeout(() => {
      if (!sendingRef.current) return
      sendingRef.current = false
      setSending(false)
      setLiveText('')
      setError(`No response from ${providerLabel(provider)} — try again.`)
    }, 45000) */
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!session) return null

  const hasMessages = session.entries.length > 0

  return (
    <div className="flex flex-col h-full bg-[#FAF7F0] bg-dot-matrix bg-scanline relative overflow-hidden select-none">
      {/* Neo-Brutalist Workstation Header */}
      <div className="flex items-center justify-between shrink-0 h-14 px-6 border-b-2 border-[#281E14] bg-[#EBE5D5]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-white border-2 border-[#281E14] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.25)]">
              <Terminal size={15} className="text-[#D97706]" />
            </div>
            <span className="font-retro-tech text-sm font-bold uppercase tracking-wider text-[#281E14]">
              UNIVERSAL AI CHAT
            </span>
          </div>
          <span className="font-retro-mono text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#FAF7F0] border-2 border-[#281E14] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.22)] text-[#B45309] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
            SELECTED: {providerLabel(provider)}
          </span>
        </div>

        <button
          type="button"
          onClick={handleNewSession}
          disabled={sending}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 text-white border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.25)] hover:shadow-[3px_3px_0px_0px_rgba(40,30,20,0.32)] active:translate-x-[1px] active:translate-y-[1px] font-retro-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer outline-none focus:outline-none"
        >
          <Plus size={14} />
          <span>New Session</span>
        </button>
      </div>

      {!hasMessages ? (
        /* Empty State — Unified Multi-Provider Chat Hero */
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center text-center max-w-2xl w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
            
            {/* Status Badge */}
            <div className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.2)] animate-float-slow">
              <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
              <span className="font-retro-terminal text-xs font-bold uppercase tracking-widest text-[#281E14]">
                UNIVERSAL AI WORKSPACE // READY
              </span>
            </div>

            {/* Retro Display Headings */}
            <h1 className="font-retro-tech text-3xl sm:text-4xl font-extrabold tracking-tight text-[#281E14] mb-1.5 uppercase leading-tight">
              UNIVERSAL AI CHAT
            </h1>
            <h2 className="font-retro-serif text-xl sm:text-2xl text-[#B45309] italic mb-3 font-normal">
              Direct Multi-Agent Provider Switch
            </h2>

            {/* Clean Simple Copy */}
            <p className="font-retro-mono text-xs sm:text-sm text-stone-700 mb-6 max-w-lg leading-relaxed">
              Interact with <span className="font-bold text-[#281E14] bg-[#FEF3C7] px-1.5 py-0.5 rounded border border-[#F59E0B]/30">ChatGPT, Claude, Gemini, Grok, & Perplexity</span> in one place. Switch your target AI anytime.
            </p>

            {/* Retro Command Lead-In */}
            <div className="font-retro-terminal text-xs font-bold uppercase tracking-widest text-stone-600 mb-3 flex items-center justify-center gap-1.5">
              <span className="text-[#D97706] text-sm font-extrabold">&gt;</span>
              <span>SELECT AI PROVIDER</span>
              <span className="inline-block w-2 h-3.5 bg-[#D97706] animate-cursor-blink ml-0.5" />
            </div>

            {/* Model Selector Pills */}
            <div className="flex items-center justify-center gap-2.5 flex-wrap mb-8">
              {PROVIDERS.map(p => {
                const isActive = p.id === provider
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    className={`font-retro-tech text-xs font-bold px-4 py-2 rounded-xl border-2 border-[#281E14] transition-all duration-200 cursor-pointer outline-none focus:outline-none ${
                      isActive
                        ? 'bg-[#D97706] text-white shadow-[2px_2px_0px_0px_rgba(40,30,20,0.35)] -translate-y-0.5'
                        : 'bg-white text-[#281E14] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.2)] hover:bg-[#FEF3C7] hover:shadow-[2.5px_2.5px_0px_0px_rgba(40,30,20,0.3)] hover:-translate-y-0.5'
                    }`}
                  >
                    <span className="opacity-50 text-[10px] mr-1.5 font-retro-mono">[{p.num}]</span>
                    {p.label}
                  </button>
                )
              })}
            </div>

            {/* Input Bar Container */}
            <div className="w-full max-w-[680px]">
              <ChatInputBar
                input={input}
                onInputChange={setInput}
                onSend={() => handleSend()}
                onKeyDown={handleKeyDown}
                sending={sending}
                autoFocus
                placeholders={UNIVERSAL_PLACEHOLDERS}
                leftSlot={
                  <TypewriterDropdown
                    options={PROVIDERS.map(p => ({ id: p.id, label: `${p.num} ${p.label}` }))}
                    value={provider}
                    onChange={p => setProvider(p as ProviderId)}
                    dropUp={true}
                    className="w-40 sm:w-48"
                  />
                }
                rightSlot={
                  <InlineDictationControl
                    surface="universal"
                    surfaceSessionId={session.id}
                    provider={provider === 'gemini' ? 'gemini' : 'chatgpt'}
                    onProviderChange={(nextProvider) => setProvider(nextProvider)}
                    disabled={sending}
                    onTranscript={(transcript) => setInput(transcript)}
                  />
                }
              />
            </div>

          </div>
        </div>
      ) : (
        <>
          {/* Conversation Message List */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 select-text">
            <div className="max-w-3xl mx-auto flex flex-col gap-4">
              {session.entries.map(entry => (
                <ChatBubble
                  key={entry.id}
                  role={entry.role === 'user' ? 'user' : 'assistant'}
                  content={entry.content}
                  label={providerLabel(entry.provider)}
                />
              ))}
              {sending && (
                <ChatBubble
                  role="assistant"
                  content={liveText}
                  label={providerLabel(provider)}
                  pending
                />
              )}
            </div>
          </div>

          {/* Floating Footer Input Bar */}
          <div className="p-4 sm:pb-6 bg-transparent relative z-10 shrink-0">
            <div className="max-w-3xl mx-auto">
              <ChatInputBar
                input={input}
                onInputChange={setInput}
                onSend={() => handleSend()}
                onKeyDown={handleKeyDown}
                sending={sending}
                placeholders={UNIVERSAL_PLACEHOLDERS}
                leftSlot={
                  <TypewriterDropdown
                    options={PROVIDERS.map(p => ({ id: p.id, label: `${p.num} ${p.label}` }))}
                    value={provider}
                    onChange={p => setProvider(p as ProviderId)}
                    dropUp={true}
                    className="w-40 sm:w-48"
                  />
                }
                rightSlot={
                  <InlineDictationControl
                    surface="universal"
                    surfaceSessionId={session.id}
                    provider={provider === 'gemini' ? 'gemini' : 'chatgpt'}
                    onProviderChange={(nextProvider) => setProvider(nextProvider)}
                    disabled={sending}
                    onTranscript={(transcript) => setInput(transcript)}
                  />
                }
              />
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 font-retro-mono text-xs font-bold px-4 py-3 rounded-xl bg-[#FEE2E2] border-2 border-[#281E14] text-[#DC2626] shadow-[4px_4px_0px_0px_rgba(40,30,20,0.3)] max-w-xl w-[90%] text-center animate-in fade-in slide-in-from-bottom-2 duration-200 flex items-center justify-between gap-3">
          <span className="flex-1 text-left break-words">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 p-1 hover:bg-[#FCA5A5] rounded-md text-[#991B1B] transition-colors cursor-pointer"
            title="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
