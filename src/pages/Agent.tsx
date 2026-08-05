import { useEffect, useRef, useState } from 'react'
import { Plus, Bot, AlertTriangle, Wrench, ChevronUp, ChevronDown, Cpu, Workflow, Globe } from 'lucide-react'
import {
  createAgentSession,
  appendAgentTurn,
  buildAgentHandoffPrompt,
  type AgentSession,
  type AgentToolCallEntry,
} from '@/lib/agentSession'
import type { AgentStreamEvent } from '@/types/electron'
import ProviderStatusStrip, { type ProviderStatus } from '@/components/agent/ProviderStatusStrip'
import { ChatBubble } from '@/components/chat/ChatBubble'
import { ChatInputBar } from '@/components/chat/ChatInputBar'

const AGENT_STORE_KEY = 'agentSession'

const PROVIDER_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', perplexity: 'Perplexity',
}
function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id
}

function isAgentSession(value: unknown): value is AgentSession {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AgentSession>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.entries) &&
    typeof candidate.created_at === 'string' &&
    typeof candidate.updated_at === 'string'
  )
}

const AGENT_CAPABILITIES = [
  {
    id: 'orchestration',
    title: 'Multi-Model Orchestration',
    subtitle: '5 Frontier AIs Coordinated',
    icon: Cpu,
    color: 'text-[#D97706]',
    bgColor: 'bg-[#FEF3C7]',
    borderColor: 'border-[#F59E0B]/40',
    prompt: 'Claude, analyze this request and coordinate multiple AI models to give a comprehensive, multi-perspective answer:',
  },
  {
    id: 'dispatch',
    title: 'Autonomous Task Dispatch',
    subtitle: 'Auto Task Breakdown & Queue',
    icon: Workflow,
    color: 'text-[#059669]',
    bgColor: 'bg-[#ECFDF5]',
    borderColor: 'border-[#10B981]/40',
    prompt: 'Claude, break down this task into sub-tasks and dispatch specialized AI workers to execute it step-by-step:',
  },
  {
    id: 'web',
    title: 'Live Web Execution',
    subtitle: 'Real-Time Capture & Extraction',
    icon: Globe,
    color: 'text-[#0284C7]',
    bgColor: 'bg-[#E0F2FE]',
    borderColor: 'border-[#0284C7]/40',
    prompt: 'Claude, perform live web execution to gather current information and synthesize a detailed update:',
  },
] as const

const AGENT_PLACEHOLDERS = [
  'Ask anything — Claude decides which AI worker to dispatch...',
  'Decompose complex research tasks across ChatGPT, Gemini & Grok...',
  'Perform live web execution and synthesize structured updates...',
  'Audit code architecture and cross-verify with specialized AI models...',
]

export default function Agent() {
  const api = window.electronAPI
  const [session, setSession] = useState<AgentSession | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [toolStatus, setToolStatus] = useState<Record<string, ProviderStatus>>({})
  const [error, setError] = useState<string | null>(null)
  const [hoveredCapId, setHoveredCapId] = useState<string | null>(null)
  const [flashCapId, setFlashCapId] = useState<string | null>(null)

  const sendingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const toolCallsRef = useRef<Map<string, AgentToolCallEntry>>(new Map())
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearWatchdog() {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }

  function resetWatchdog() {
    clearWatchdog()
    watchdogRef.current = setTimeout(() => {
      if (!sendingRef.current) return
      sendingRef.current = false
      setSending(false)
      setLiveText('')
      setError('Agent turn timed out — try again.')
    }, 150000)
  }

  // Load or create Agent session
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const stored = await api.storeGet(AGENT_STORE_KEY)
      if (cancelled) return
      if (isAgentSession(stored)) {
        setSession(stored)
      } else {
        const created = createAgentSession()
        await api.storeSet(AGENT_STORE_KEY, created)
        if (!cancelled) setSession(created)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Agent event stream listener
  useEffect(() => {
    function onEvent(_e: unknown, event: AgentStreamEvent) {
      if (!sendingRef.current) return
      resetWatchdog()

      if (event.type === 'text') {
        setLiveText(prev => prev + event.text)
      } else if (event.type === 'tool_call') {
        toolCallsRef.current.set(event.toolUseId, { tool: event.tool, prompt: event.prompt, result: '', isError: false })
        setToolStatus(prev => ({ ...prev, [event.tool]: 'thinking' }))
      } else if (event.type === 'tool_progress') {
        // Heartbeat signal
      } else if (event.type === 'tool_result') {
        const entry = toolCallsRef.current.get(event.toolUseId)
        if (entry) {
          entry.result = event.text
          entry.isError = event.isError
        }
        setToolStatus(prev => ({ ...prev, [event.tool]: event.isError ? 'error' : 'done' }))
      } else if (event.type === 'done') {
        clearWatchdog()
        sendingRef.current = false
        setSending(false)
        setLiveText('')
        setSession(prev => {
          if (!prev) return prev
          const next = appendAgentTurn(prev, {
            role: 'assistant',
            content: event.text,
            toolCalls: Array.from(toolCallsRef.current.values()),
          })
          api.storeSet(AGENT_STORE_KEY, next).catch(() => {})
          return next
        })
        toolCallsRef.current.clear()
      } else if (event.type === 'error') {
        clearWatchdog()
        sendingRef.current = false
        setSending(false)
        setLiveText('')
        setError(event.message)
      }
    }
    api.onAgentEvent(onEvent)
    return () => { api.offAgentEvent(onEvent) }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [session?.entries.length, liveText])

  async function persist(next: AgentSession) {
    setSession(next)
    await api.storeSet(AGENT_STORE_KEY, next)
  }

  async function handleNewSession() {
    if (sendingRef.current) return
    clearWatchdog()
    const created = createAgentSession()
    await persist(created)
    setError(null)
    setToolStatus({})
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || !session || sendingRef.current) return

    sendingRef.current = true
    setSending(true)
    setError(null)
    setInput('')
    setLiveText('')
    setToolStatus({})
    toolCallsRef.current.clear()

    const composed = session.entries.length > 0 ? buildAgentHandoffPrompt(session, text) : text

    const withUser = appendAgentTurn(session, { role: 'user', content: text })
    await persist(withUser)

    resetWatchdog()

    try {
      await api.agentSendMessage(composed)
    } catch {
      if (sendingRef.current) {
        clearWatchdog()
        sendingRef.current = false
        setSending(false)
        setError('Agent turn failed to start.')
      }
    }
  }

  async function handleStop() {
    await api.agentAbort().catch(() => {})
    clearWatchdog()
    sendingRef.current = false
    setSending(false)
    setLiveText('')
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
      {/* Neo-Brutalist Header */}
      <div className="flex items-center justify-between shrink-0 h-14 px-6 border-b-2 border-[#281E14] bg-[#EBE5D5]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-white border-2 border-[#281E14] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.25)]">
              <Bot size={16} className="text-[#D97706]" />
            </div>
            <span className="font-retro-tech text-sm font-bold uppercase tracking-wider text-[#281E14]">
              AUTONOMOUS AGENT DECK
            </span>
          </div>
          <span className="font-retro-mono text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#FAF7F0] border-2 border-[#281E14] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.22)] text-[#B45309] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
            CLAUDE ORCHESTRATOR
          </span>
        </div>

        <div className="flex items-center gap-3">
          <ProviderStatusStrip status={toolStatus} />
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
      </div>

      {!hasMessages ? (
        /* Empty State — Ultra-Modern Retro Cyber Workstation Hero */
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center text-center max-w-3xl w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
            
            {/* Live Status Badge */}
            <div className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.2)] animate-float-slow">
              <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
              <span className="font-retro-terminal text-xs font-bold uppercase tracking-widest text-[#281E14]">
                AUTONOMOUS AGENT ORCHESTRATION // ONLINE
              </span>
            </div>

            {/* Retro Display Headings */}
            <h1 className="font-retro-tech text-3xl sm:text-4xl font-extrabold tracking-tight text-[#281E14] mb-1.5 uppercase leading-tight">
              AUTONOMOUS AI AGENT
            </h1>
            <h2 className="font-retro-serif text-xl sm:text-2xl text-[#B45309] italic mb-3 font-normal">
              Claude Multi-Model Orchestration Deck
            </h2>

            {/* Powerful Copy */}
            <p className="font-retro-mono text-xs sm:text-sm text-stone-700 mb-6 max-w-lg leading-relaxed">
              Claude leads your workflow — automatically analyzing your prompts, delegating sub-tasks across <span className="font-bold text-[#281E14] bg-[#FEF3C7] px-1.5 py-0.5 rounded border border-[#F59E0B]/30">ChatGPT, Gemini, Grok & Perplexity</span>, and synthesizing unified results.
            </p>

            {/* Retro Cyberdeck Directive Switchboard (Replaces Cards) */}
            <div className="w-full max-w-2xl mb-7 bg-[#EBE5D5] border-2 border-[#281E14] rounded-xl shadow-[4px_4px_0px_0px_rgba(40,30,20,0.25)] overflow-hidden">
              {/* Panel Console Header */}
              <div className="flex items-center justify-between px-3.5 py-2 bg-[#DDD6C1] border-b-2 border-[#281E14]">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 font-retro-mono text-[11px] font-extrabold text-[#281E14]">
                    <span className="text-[#D97706] font-black">+</span>
                    <span>SYS_DIRECTIVES.BUS</span>
                  </div>
                  <span className="font-retro-terminal text-[9px] px-2 py-0.5 rounded bg-[#281E14] text-[#FDE68A] font-bold tracking-widest uppercase shadow-[1px_1px_0px_0px_rgba(40,30,20,0.15)]">
                    CLICK TO INJECT
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#D97706] animate-pulse" />
                    <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                    <span className="w-2 h-2 rounded-full bg-[#0284C7]" />
                  </div>
                  <span className="font-retro-terminal text-[10px] font-bold text-stone-600 uppercase tracking-widest hidden sm:inline">
                    MODES [01-03]
                  </span>
                </div>
              </div>

              {/* Directive Channels - Unified Hardware Switchboard */}
              <div className="p-2 sm:p-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-[#FAF7F0]">
                {AGENT_CAPABILITIES.map((cap, idx) => {
                  const IconComp = cap.icon
                  const keyLegend = `F${idx + 1}`

                  return (
                    <button
                      key={cap.id}
                      type="button"
                      onMouseEnter={() => setHoveredCapId(cap.id)}
                      onMouseLeave={() => setHoveredCapId(null)}
                      onClick={() => {
                        setInput(cap.prompt)
                        setFlashCapId(cap.id)
                        setTimeout(() => setFlashCapId(null), 350)
                      }}
                      className={`group relative flex flex-col justify-between text-left p-3 rounded-lg border-2 border-[#281E14] transition-all duration-150 cursor-pointer outline-none ${
                        flashCapId === cap.id
                          ? 'bg-[#FEF3C7] shadow-none translate-x-[2px] translate-y-[2px]'
                          : 'bg-white hover:bg-[#FEFCE8] shadow-[2.5px_2.5px_0px_0px_rgba(40,30,20,0.2)] hover:shadow-[3.5px_3.5px_0px_0px_rgba(40,30,20,0.28)] hover:-translate-y-0.5 active:translate-x-[1.5px] active:translate-y-[1.5px] active:shadow-none'
                      }`}
                    >
                      {/* Top Row: Key Badge & Icon Container */}
                      <div className="flex items-center justify-between w-full mb-2">
                        <span className="font-retro-terminal text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-[#281E14] text-[#FDE68A] border border-[#281E14] shadow-[1px_1px_0px_0px_rgba(40,30,20,0.15)]">
                          [{keyLegend}]
                        </span>
                        <div className={`p-1.5 rounded-md border-2 border-[#281E14] ${cap.bgColor} ${cap.color} group-hover:scale-105 transition-transform`}>
                          <IconComp size={15} />
                        </div>
                      </div>

                      {/* Title & Subtitle */}
                      <div className="mb-2">
                        <div className="font-retro-tech text-xs font-bold text-[#281E14] uppercase leading-tight group-hover:text-[#D97706] transition-colors">
                          {cap.title}
                        </div>
                        <div className="font-retro-mono text-[10px] text-stone-500 font-semibold mt-0.5">
                          {cap.subtitle}
                        </div>
                      </div>

                      {/* Bottom Action Strip */}
                      <div className="pt-1.5 border-t border-[#281E14]/15 flex items-center justify-between w-full font-retro-terminal text-[10px] text-stone-600 font-bold group-hover:text-[#281E14]">
                        <span className="flex items-center gap-1 text-[#D97706]">
                          <span className="font-black">&gt;</span>
                          <span className="group-hover:underline uppercase">INJECT</span>
                        </span>
                        <span className="text-[11px] font-mono group-hover:translate-x-0.5 transition-transform">↵</span>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Live Telemetry Prompt Stream Footer */}
              <div className="px-3.5 py-1.5 bg-[#DDD6C1] border-t-2 border-[#281E14] flex items-center justify-between text-[10px] font-retro-mono text-[#281E14]">
                <div className="flex items-center gap-2 truncate max-w-[85%]">
                  <span className="font-bold text-[#D97706] shrink-0 uppercase tracking-wide">&gt; TELEMETRY:</span>
                  <span className="truncate text-stone-700 font-medium">
                    {hoveredCapId
                      ? AGENT_CAPABILITIES.find(c => c.id === hoveredCapId)?.prompt
                      : 'Hover over or click a directive channel above to auto-inject payload prompt.'}
                  </span>
                </div>
                <span className="font-retro-terminal font-bold text-stone-600 shrink-0 ml-2 uppercase tracking-widest hidden sm:inline">
                  [READY_BUS]
                </span>
              </div>
            </div>

            {/* Retro Command Lead-In */}
            <div className="font-retro-terminal text-xs font-bold uppercase tracking-widest text-stone-600 mb-3 flex items-center justify-center gap-1.5">
              <span className="text-[#D97706] text-sm font-extrabold">&gt;</span>
              <span>ENTER AGENT DIRECTIVE</span>
              <span className="inline-block w-2 h-3.5 bg-[#D97706] animate-cursor-blink ml-0.5" />
            </div>

            {/* Input Bar Container */}
            <div className="w-full max-w-[680px]">
              <ChatInputBar
                input={input}
                onInputChange={setInput}
                onSend={handleSend}
                onKeyDown={handleKeyDown}
                sending={sending}
                onStop={handleStop}
                autoFocus
                placeholders={AGENT_PLACEHOLDERS}
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
                  role={entry.role}
                  content={entry.content}
                  label={entry.role === 'assistant' ? 'Agent' : undefined}
                  toolCalls={entry.toolCalls.length > 0 ? <ToolCallList calls={entry.toolCalls} /> : undefined}
                />
              ))}
              {sending && (
                <ChatBubble
                  role="assistant"
                  content={liveText}
                  label="Agent"
                  pending
                  toolCalls={toolCallsRef.current.size > 0 ? <ToolCallList calls={Array.from(toolCallsRef.current.values())} /> : undefined}
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
                onSend={handleSend}
                onKeyDown={handleKeyDown}
                sending={sending}
                onStop={handleStop}
                placeholders={AGENT_PLACEHOLDERS}
              />
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 font-retro-mono text-xs font-bold px-4 py-2.5 rounded-xl bg-[#FEE2E2] border-2 border-[#281E14] text-[#DC2626] shadow-[3px_3px_0px_0px_rgba(40,30,20,0.25)] max-w-md text-center animate-in fade-in duration-200">
          {error}
        </div>
      )}
    </div>
  )
}

function ToolCallList({ calls }: { calls: AgentToolCallEntry[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full my-2">
      {calls.map((call, i) => (
        <ToolCallCard key={i} call={call} />
      ))}
    </div>
  )
}

function ToolCallCard({ call }: { call: AgentToolCallEntry }) {
  const [expanded, setExpanded] = useState(true)
  const isPending = !call.result && !call.isError
  const provider = providerLabel(call.tool)

  return (
    <div className="rounded-xl border-2 border-[#281E14] bg-white overflow-hidden shadow-[2px_2px_0px_0px_rgba(40,30,20,0.2)] hover:shadow-[3px_3px_0px_0px_rgba(40,30,20,0.28)] transition-all animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Mini Retro Workstation Window Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        className="flex items-center justify-between px-3 py-2 bg-[#EBE5D5] border-b-2 border-[#281E14] cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          {/* Traffic light window controls */}
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#FF5F56] border border-[#281E14]/50" />
            <span className="w-2 h-2 rounded-full bg-[#FFBD2E] border border-[#281E14]/50" />
            <span className="w-2 h-2 rounded-full bg-[#27C93F] border border-[#281E14]/50" />
          </div>

          <div className="h-3 w-[1.5px] bg-[#281E14]/30 mx-1" />

          {call.isError ? (
            <AlertTriangle size={13} className="text-[#DC2626]" />
          ) : (
            <Wrench size={13} className="text-[#D97706]" />
          )}

          <span className="font-retro-tech text-xs font-bold text-[#281E14]">
            Dispatched {provider}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isPending ? (
            <span className="font-retro-mono text-[9px] font-bold uppercase px-2 py-0.5 rounded-md bg-[#FEF3C7] border border-[#281E14] text-[#B45309] flex items-center gap-1 shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-ping" />
              Executing…
            </span>
          ) : call.isError ? (
            <span className="font-retro-mono text-[9px] font-bold uppercase px-2 py-0.5 rounded-md bg-[#FEE2E2] border border-[#281E14] text-[#DC2626] shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)]">
              Failed
            </span>
          ) : (
            <span className="font-retro-mono text-[9px] font-bold uppercase px-2 py-0.5 rounded-md bg-[#ECFDF5] border border-[#281E14] text-[#047857] shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)]">
              Done
            </span>
          )}

          <span className="text-[#281E14] hover:text-[#D97706] transition-colors">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </div>
      </div>

      {/* Expandable Window Body */}
      <div className="p-3 space-y-2 font-retro-mono">
        <div className="text-xs text-stone-800 bg-[#FAF7F0] p-2.5 rounded-lg border border-[#281E14]/30">
          <div className="text-[#D97706] font-bold text-[10px] uppercase mb-1">
            &gt; Dispatch Prompt
          </div>
          <p className="text-stone-900 leading-relaxed whitespace-pre-wrap">{call.prompt}</p>
        </div>

        {expanded && (
          <div className="text-xs text-stone-900 bg-white p-3 rounded-lg border border-[#281E14]/30 whitespace-pre-wrap leading-relaxed animate-in fade-in duration-150">
            <div className="font-bold text-[10px] text-stone-600 uppercase mb-1">
              Worker Payload Output
            </div>
            {call.result ? (
              call.result
            ) : (
              <span className="text-stone-400 italic">Waiting for AI worker response...</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
