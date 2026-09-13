import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus, Bot, BrainCircuit, Cpu, Database, Ghost, Workflow, Globe, ShieldOff, Wrench } from 'lucide-react'
import {
  createAgentSession,
  appendAgentTurn,
  type AgentSession,
  type AgentToolCallEntry,
} from '@/lib/agentSession'
import { makeContinuityId } from '@/lib/conversationContinuity'
import type { AgentRunEvent, AgentStreamEvent, AgentSessionMeta } from '@/types/electron'
import type { AppSettings } from '@/types/database'
import SessionList from '@/components/agent/SessionList'
import ProviderStatusStrip, { type ProviderStatus } from '@/components/agent/ProviderStatusStrip'
import { WorkerToolCardList } from '@/components/agent/WorkerToolCard'
import { ChatBubble } from '@/components/chat/ChatBubble'
import { ChatInputBar } from '@/components/chat/ChatInputBar'
import { InlineDictationControl } from '@/components/voice/InlineDictationControl'
import { ProjectCommandDeck } from '@/components/agent/ProjectCommandDeck'
import ToolApprovalDialog from '@/components/agent/ToolApprovalDialog'
import { useAgentApprovals } from '@/hooks/useAgentApprovals'
import AgentToolsPanel from '@/components/agent/AgentToolsPanel'

const AGENT_CAPABILITIES = [
  { id: 'orchestration', title: 'Multi-Model Orchestration', subtitle: '5 Frontier AIs Coordinated', icon: Cpu, color: 'text-[#D97706]', bgColor: 'bg-[#FEF3C7]', borderColor: 'border-[#F59E0B]/40', prompt: 'Analyze this request and coordinate multiple AI models to give a comprehensive, multi-perspective answer:' },
  { id: 'dispatch', title: 'Autonomous Task Dispatch', subtitle: 'Auto Task Breakdown & Queue', icon: Workflow, color: 'text-[#059669]', bgColor: 'bg-[#ECFDF5]', borderColor: 'border-[#10B981]/40', prompt: 'Break down this task into sub-tasks and dispatch specialized AI workers to execute it step-by-step:' },
  { id: 'web', title: 'Live Web Execution', subtitle: 'Real-Time Capture & Extraction', icon: Globe, color: 'text-[#0284C7]', bgColor: 'bg-[#E0F2FE]', borderColor: 'border-[#0284C7]/40', prompt: 'Perform live web execution to gather current information and synthesize a detailed update:' },
] as const

const AGENT_PLACEHOLDERS = [
  'Describe what you want to build in the active project...',
  'Ask the Agent to research, plan, or coordinate a task...',
  'Give a precise directive - approvals appear before risky work...',
]

export default function Agent() {
  const api = window.electronAPI
  const [sessions, setSessions] = useState<AgentSessionMeta[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<AgentSession | null>(null)
  const { pending: pendingApprovals, respond: handleApprovalResponse } = useAgentApprovals(activeSessionId)
  // Studio's chat panel attaches to whichever session the user was actually
  // in here, rather than the most recently updated one (which would jump to
  // whatever session an agent last wrote to).
  useEffect(() => {
    if (activeSessionId) localStorage.setItem('agentActiveSessionId', activeSessionId)
  }, [activeSessionId])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [liveToolCalls, setLiveToolCalls] = useState<AgentToolCallEntry[]>([])
  const [toolStatus, setToolStatus] = useState<Record<string, ProviderStatus>>({})
  const [error, setError] = useState<string | null>(null)
  const [leadAgentProvider, setLeadAgentProvider] = useState<AppSettings['leadAgentProvider']>('claude')
  const [bypassPermissions, setBypassPermissions] = useState(false)
  const [showToolsPanel, setShowToolsPanel] = useState(false)
  const [hasActiveProject, setHasActiveProject] = useState(false)
  const [brainScope, setBrainScope] = useState<{ type: string; name: string } | null>(null)
  const [brainMode, setBrainMode] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('agentBrainMode') ?? '{}') as Partial<{ use: boolean; learn: boolean; temporary: boolean }>
      return { use: saved.use !== false, learn: saved.learn !== false, temporary: saved.temporary === true }
    } catch {
      return { use: true, learn: true, temporary: false }
    }
  })

  useEffect(() => {
    localStorage.setItem('agentBrainMode', JSON.stringify(brainMode))
  }, [brainMode])

  const sendingRef = useRef(false)
  const sessionRef = useRef<AgentSession | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const liveTextRef = useRef('')
  const appliedSequenceRef = useRef(0)
  const bufferedEventsRef = useRef<AgentRunEvent[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialScrollRef = useRef(true)
  // Map keyed by toolUseId — mutated for correlation; mirrored into liveToolCalls
  // state so React re-renders. Snapshot this into the session on `done` BEFORE
  // clearing (clearing first caused worker cards to vanish with the pending bubble).
  const toolCallsRef = useRef<Map<string, AgentToolCallEntry>>(new Map())
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function syncLiveToolCalls() {
    setLiveToolCalls(Array.from(toolCallsRef.current.values()).map(c => ({ ...c })))
  }

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
      setError('Agent turn timed out — try again.')
      setError('This task is still running in the background. You can wait for updates or press Stop to cancel it.')
      return
    }, 150000)
  }

  function persistPartialRun(runEvent: AgentRunEvent, reason: string) {
    const partialText = liveTextRef.current.trim()
    const persistedCalls = Array.from(toolCallsRef.current.values()).map(call => ({ ...call }))
    toolCallsRef.current.clear()
    setLiveText('')
    liveTextRef.current = ''
    setLiveToolCalls([])
    setSession(previous => {
      if (!previous || previous.entries.some(entry => entry.role === 'assistant' && entry.runId === runEvent.runId)) return previous
      const content = partialText
        ? `${partialText}\n\n[Run stopped: ${reason}]`
        : `[Run stopped: ${reason}]`
      const next = appendAgentTurn(previous, { role: 'assistant', content, toolCalls: persistedCalls, runId: runEvent.runId })
      sessionRef.current = next
      return next
    })
  }

  function applyRunEvent(runEvent: AgentRunEvent) {
    const activeSession = sessionRef.current
    if (!activeSession) {
      bufferedEventsRef.current.push(runEvent)
      return
    }
    if (runEvent.sessionId !== activeSession.id || runEvent.runId !== activeRunIdRef.current || runEvent.sequence <= appliedSequenceRef.current) {
      if (localStorage.getItem('flowdesk:agent-debug') === '1') {
        console.debug('[FlowDesk Agent UI] ignored event', { runId: runEvent.runId, sequence: runEvent.sequence, activeRunId: activeRunIdRef.current, appliedSequence: appliedSequenceRef.current })
      }
      return
    }
    if (localStorage.getItem('flowdesk:agent-debug') === '1') {
      console.debug('[FlowDesk Agent UI] applying event', { runId: runEvent.runId, sequence: runEvent.sequence, type: runEvent.event.type })
    }
    appliedSequenceRef.current = runEvent.sequence
    const event: AgentStreamEvent = runEvent.event
    if (event.type !== 'done' && event.type !== 'error') {
      sendingRef.current = true
      setSending(true)
      resetWatchdog()
    }

    if (event.type === 'text') {
      setLiveText(prev => {
        const next = prev + event.text
        liveTextRef.current = next
        return next
      })
    } else if (event.type === 'tool_call') {
      toolCallsRef.current.set(event.toolUseId, { tool: event.tool, prompt: event.prompt, result: '', isError: false })
      syncLiveToolCalls()
      setToolStatus(prev => ({ ...prev, [event.tool]: 'thinking' }))
    } else if (event.type === 'tool_result') {
      const entry = toolCallsRef.current.get(event.toolUseId)
      if (entry) {
        entry.result = event.text
        entry.isError = event.isError
        syncLiveToolCalls()
      }
      setToolStatus(prev => ({ ...prev, [event.tool]: event.isError ? 'error' : 'done' }))
      // approval_request is handled by useAgentApprovals via its own
      // independent onAgentEvent subscription — Studio's chat panel needed
      // the same handling and had none, which is why it lives in a shared
      // hook rather than only here.
    } else if (event.type === 'done') {
      const persistedCalls = Array.from(toolCallsRef.current.values()).map(c => ({ ...c }))
      // SDK success results are occasionally an empty summary even though
      // streamed assistant text was already received. Never discard that
      // visible work at the terminal event.
      const content = event.text.trim() || liveTextRef.current.trim() || 'Agent completed without a text response.'
      toolCallsRef.current.clear()
      clearWatchdog()
      sendingRef.current = false
      setSending(false)
      // A 'done' event is unambiguous proof the run finished. Nothing in this
      // file ever cleared `error` on success — a stale watchdog warning, or
      // "Cancelling the Agent run…" from Stop (agent:abort resolves and marks
      // the run cancelled well before this terminal event actually arrives),
      // sat on screen forever after the run it described was long over.
      setError(null)
      setLiveText('')
      liveTextRef.current = ''
      setLiveToolCalls([])
      // Any approval still queued for this run is cleared by
      // useAgentApprovals itself on this same 'done' event.
      setSession(prev => {
        if (!prev || prev.entries.some(entry => entry.role === 'assistant' && entry.runId === runEvent.runId)) return prev
        const next = appendAgentTurn(prev, { role: 'assistant', content, toolCalls: persistedCalls, runId: runEvent.runId })
        sessionRef.current = next
        return next
      })
      api.agentSessionList().then(setSessions).catch(() => {})
    } else if (event.type === 'error') {
      clearWatchdog()
      sendingRef.current = false
      setSending(false)
      // Cleared by useAgentApprovals itself on this same 'error' event.
      persistPartialRun(runEvent, event.message)
      setError(/maximum number of turns|reached max.*turn/i.test(event.message)
        ? 'Agent safety limit reached after 16 steps. Your completed tool work is saved; send “continue from the completed work” to resume safely.'
        : event.message)
    }
  }

  // Load Agent sessions
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [list, runState, rawSettings] = await Promise.all([
        api.agentSessionList(),
        api.agentGetRunState(),
        api.storeGet('settings'),
      ])
      if (cancelled) return
      const settingsPartial = rawSettings as Partial<AppSettings> | null
      const configuredProvider = settingsPartial?.leadAgentProvider
      setLeadAgentProvider(configuredProvider === 'codex' ? 'codex' : configuredProvider === 'antigravity' ? 'antigravity' : 'claude')
      setBypassPermissions(settingsPartial?.agentBypassPermissions === true)
      // Whether project tools exist at all depends on an active project, and
      // the tools panel should say so accurately before the first message —
      // not only after a send has happened to look it up.
      api.projectList()
        .then(scope => { if (!cancelled) setHasActiveProject(Boolean(scope.activeProjectId)) })
        .catch(() => {})
      // Which Brain scope a turn actually uses used to be invisible — the
      // session-scope bug this surfaces meant Use/Learn silently did nothing.
      api.brainGetActiveScope()
        .then(scope => { if (!cancelled) setBrainScope(scope) })
        .catch(() => {})
      if (list.length === 0) {
        const created = await api.agentSessionCreate()
        if (cancelled) return
        setSessions([created])
        setActiveSessionId(created.id)
        return
      }
      setSessions(list)
      setActiveSessionId(list[0].id)
      activeRunIdRef.current = runState.sessionId === list[0]?.id ? runState.runId : null
      if (runState.status === 'running' && runState.sessionId === list[0]?.id) {
        sendingRef.current = true
        setSending(true)
        resetWatchdog()
      }
      const replay = [...runState.events, ...bufferedEventsRef.current]
        .sort((a, b) => a.sequence - b.sequence)
      bufferedEventsRef.current = []
      replay.forEach(applyRunEvent)
    })()
    return () => { cancelled = true }
  }, [])

  // Load turns for the active session
  useEffect(() => {
    if (!activeSessionId) return
    let cancelled = false
    ;(async () => {
      const turns = await api.agentSessionTurns(activeSessionId)
      if (cancelled) return
      const loaded = createAgentSession()
      loaded.id = activeSessionId
      loaded.entries = turns.map(turn => ({
        id: turn.id,
        role: turn.role,
        content: turn.content,
        toolCalls: turn.toolCalls,
        created_at: turn.createdAt,
      }))
      setSession(loaded)
      sessionRef.current = loaded
    })()
    return () => { cancelled = true }
  }, [activeSessionId])

  // Agent event stream listener
  useEffect(() => {
    function onEvent(_e: unknown, payload: AgentRunEvent) {
      applyRunEvent(payload)
      return
      /* Legacy renderer-only handler retained temporarily for source-history
         context; run replay above is now the authoritative path.
      resetWatchdog()

      if (event.type === 'text') {
        setLiveText(prev => prev + event.text)
      } else if (event.type === 'tool_call') {
        toolCallsRef.current.set(event.toolUseId, { tool: event.tool, prompt: event.prompt, result: '', isError: false })
        syncLiveToolCalls()
        setToolStatus(prev => ({ ...prev, [event.tool]: 'thinking' }))
      } else if (event.type === 'tool_progress') {
        // Heartbeat signal
      } else if (event.type === 'tool_result') {
        const entry = toolCallsRef.current.get(event.toolUseId)
        if (entry) {
          entry.result = event.text
          entry.isError = event.isError
          syncLiveToolCalls()
        }
        setToolStatus(prev => ({ ...prev, [event.tool]: event.isError ? 'error' : 'done' }))
      } else if (event.type === 'done') {
        // Snapshot worker cards first — must survive past the pending-bubble unmount.
        const persistedCalls = Array.from(toolCallsRef.current.values()).map(c => ({ ...c }))
        toolCallsRef.current.clear()
        clearWatchdog()
        sendingRef.current = false
        setSending(false)
        setLiveText('')
        setLiveToolCalls([])
        setSession(prev => {
          if (!prev) return prev
          const next = appendAgentTurn(prev, {
            role: 'assistant',
            content: event.text,
            toolCalls: persistedCalls,
          })
          api.storeSet(AGENT_STORE_KEY, next).catch(() => {})
          return next
        })
      } else if (event.type === 'error') {
        clearWatchdog()
        sendingRef.current = false
        setSending(false)
        setLiveText('')
        setLiveToolCalls([])
        setError(event.message)
      }
      */
    }
    api.onAgentEvent(onEvent)
    return () => { api.offAgentEvent(onEvent) }
  }, [])

  // On a route remount, jump straight to the active/latest work. A smooth
  // animation from the first message makes a busy session look frozen.
  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const behavior: ScrollBehavior = initialScrollRef.current ? 'auto' : 'smooth'
    container.scrollTo({ top: container.scrollHeight, behavior })
    initialScrollRef.current = false
  }, [session?.entries.length, liveText, sending])

  /**
   * Reuses an empty session instead of creating another one.
   *
   * Creating on every click filled the sidebar with identical "New Session"
   * cards holding nothing, because a session with no turns is
   * indistinguishable from the one the click before it made. An empty
   * session IS a blank slate, so handing the existing one back is the same
   * thing the user asked for, without the clutter.
   */
  async function handleNewSession() {
    if (sendingRef.current) return
    clearWatchdog()
    const existingEmpty = sessions.find(s => s.turnCount === 0)
    const target = existingEmpty ?? await api.agentSessionCreate()
    if (!existingEmpty) setSessions(await api.agentSessionList())
    setActiveSessionId(target.id)
    setError(null)
    setLiveToolCalls([])
    setToolStatus({})
  }

  /**
   * Switching mid-run is allowed: the turn runs in the main process and
   * publishes to a numbered run log, so leaving and coming back replays it.
   * Blocking the switch stranded the user on one chat for the length of a
   * long turn with no way to read anything else.
   */
  function handleSelectSession(id: string) {
    setActiveSessionId(id)
    setLiveToolCalls([])
    setToolStatus({})
  }

  async function handleRenameSession(id: string, title: string) {
    await api.agentSessionRename(id, title)
    setSessions(await api.agentSessionList())
  }

  async function handleDeleteSession(id: string) {
    if (!confirm('Delete this session? The conversation cannot be recovered.')) return
    await api.agentSessionDelete(id)
    const remaining = await api.agentSessionList()
    setSessions(remaining)
    if (activeSessionId === id) {
      setActiveSessionId(remaining[0]?.id ?? null)
      if (remaining.length === 0) {
        const created = await api.agentSessionCreate()
        setSessions([created])
        setActiveSessionId(created.id)
      }
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || !session || sendingRef.current) return

    sendingRef.current = true
    setSending(true)
    setError(null)
    setInput('')
    setLiveText('')
    liveTextRef.current = ''
    setLiveToolCalls([])
    setToolStatus({})
    toolCallsRef.current.clear()
    appliedSequenceRef.current = 0

    // The provider's own session now carries the history, and main.ts adds
    // catch-up text only when the conversation moved between providers.
    // Prepending a recap here would duplicate what the provider already has.
    const handoff = text
    const projectScope = await api.projectList().catch(() => null)
    const activeProject = projectScope?.projects.find(project => project.id === projectScope.activeProjectId)
    setHasActiveProject(Boolean(activeProject))
    const composed = activeProject
      ? `[Active FlowDesk project]\nName: ${activeProject.title}\nRoot folder: ${activeProject.rootPath}\n\n${handoff}\n\nDo not claim any file was changed unless a project-runtime tool reports that change. Ask for confirmation before a destructive command.`
      : handoff
    const runId = makeContinuityId()
    activeRunIdRef.current = runId

    const withUser = appendAgentTurn(session, { role: 'user', content: text, runId })
    sessionRef.current = withUser
    setSession(withUser)

    resetWatchdog()

    try {
      await api.agentSendMessage({ prompt: composed, sessionId: session.id, runId, brain: brainMode })
      // IPC events are live delivery, not the source of truth. The invoke
      // resolves only after the main-process run finishes, so replay its
      // journal here as a final acknowledgement in case a renderer event was
      // dropped during a Vite reload, route remount, or listener transition.
      const terminalState = await api.agentGetRunState()
      if (terminalState.sessionId === session.id && terminalState.runId === runId) {
        terminalState.events
          .filter(event => event.sequence > appliedSequenceRef.current)
          .sort((a, b) => a.sequence - b.sequence)
          .forEach(applyRunEvent)
      }
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
    setError('Cancelling the Agent run…')
    await api.agentAbort().catch(() => setError('Could not cancel the Agent run. It may still be working.'))
  }

  async function handleToggleBypass() {
    const next = !bypassPermissions
    setBypassPermissions(next)
    // Persisted, not per-run: the user turns this on to stop being asked,
    // and having it silently reset on the next turn would defeat that.
    const raw = (await api.storeGet('settings').catch(() => null)) as Partial<AppSettings> | null
    await api.storeSet('settings', { ...(raw ?? {}), agentBypassPermissions: next }).catch(() => {
      setBypassPermissions(!next)
      setError('Could not save the permission setting.')
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!session) return null

  const hasMessages = session.entries.length > 0
  const leadAgentLabel = leadAgentProvider === 'codex' ? 'CODEX' : leadAgentProvider === 'antigravity' ? 'ANTIGRAVITY' : 'CLAUDE'

  return (
    <div className="flex h-full w-full overflow-hidden">
      <SessionList
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={handleSelectSession}
        onCreate={handleNewSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
      />
      <div className="flex-1 min-w-0 flex flex-col h-full bg-[#FAF7F0] bg-dot-matrix bg-scanline relative overflow-hidden select-none">
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
            {leadAgentLabel} ORCHESTRATOR
          </span>
        </div>

        <div className="flex items-center gap-3">
          <ProviderStatusStrip status={toolStatus} />

          {brainScope && !brainMode.temporary && (
            <span
              title={`This turn's Brain scope: ${brainScope.name} (${brainScope.type})`}
              className="hidden items-center gap-1 px-2 py-1 font-retro-mono text-[10px] font-bold uppercase text-stone-400 sm:flex"
            >
              Scope: {brainScope.name}
            </span>
          )}
          <div className="flex items-center rounded-lg border-2 border-[#281E14] bg-white shadow-[2px_2px_0px_0px_rgba(40,30,20,0.22)] overflow-hidden" aria-label="Brain controls">
            <button
              type="button"
              onClick={() => setBrainMode(value => ({ ...value, use: !value.use, temporary: false }))}
              title="Use relevant saved Brain context in this Agent turn"
              aria-pressed={brainMode.use && !brainMode.temporary}
              className={`flex items-center gap-1 px-2 py-1.5 font-retro-mono text-[10px] font-bold uppercase ${brainMode.use && !brainMode.temporary ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'text-stone-500'}`}
            >
              <BrainCircuit size={12} /> Use
            </button>
            <button
              type="button"
              onClick={() => setBrainMode(value => ({ ...value, learn: !value.learn, temporary: false }))}
              title="Allow this Agent turn to save explicit memories and durable research"
              aria-pressed={brainMode.learn && !brainMode.temporary}
              className={`flex items-center gap-1 px-2 py-1.5 border-l border-[#281E14] font-retro-mono text-[10px] font-bold uppercase ${brainMode.learn && !brainMode.temporary ? 'bg-[#DCFCE7] text-[#047857]' : 'text-stone-500'}`}
            >
              <Database size={12} /> Learn
            </button>
            <button
              type="button"
              onClick={() => setBrainMode(value => ({ ...value, temporary: !value.temporary }))}
              title="Temporary mode: no automatic Brain context and no durable Brain writes"
              aria-pressed={brainMode.temporary}
              className={`flex items-center gap-1 px-2 py-1.5 border-l border-[#281E14] font-retro-mono text-[10px] font-bold uppercase ${brainMode.temporary ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'text-stone-500'}`}
            >
              <Ghost size={12} /> Temp
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowToolsPanel(v => !v)}
              title={`Show which tools ${leadAgentLabel} can use`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.22)] active:translate-x-[1px] active:translate-y-[1px] font-retro-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer outline-none focus:outline-none ${
                showToolsPanel ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-white hover:bg-[#FAF7F0] text-stone-700'
              }`}
            >
              <Wrench size={13} />
              <span>Tools</span>
            </button>
            {showToolsPanel && (
              <AgentToolsPanel
                provider={leadAgentProvider}
                bypassPermissions={bypassPermissions}
                hasActiveProject={hasActiveProject}
                onClose={() => setShowToolsPanel(false)}
              />
            )}
          </div>

          <button
            type="button"
            onClick={handleToggleBypass}
            title={
              bypassPermissions
                ? 'Bypass is ON — every tool runs without asking. Click to require approval again.'
                : 'Approval required before risky tools. Click to bypass and stop being asked.'
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.22)] active:translate-x-[1px] active:translate-y-[1px] font-retro-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer outline-none focus:outline-none ${
              bypassPermissions
                ? 'bg-[#FEE2E2] text-[#DC2626]'
                : 'bg-white hover:bg-[#FAF7F0] text-stone-700'
            }`}
          >
            <ShieldOff size={13} />
            <span>{bypassPermissions ? 'Bypass ON' : 'Bypass OFF'}</span>
          </button>

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
          <ProjectCommandDeck
            agentState={sending ? 'working' : session.entries.length > 0 ? 'complete' : 'idle'}
            onDirective={setInput}
          />
          <div className="hidden relative z-10 flex flex-col items-center text-center max-w-3xl w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
            
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
              {leadAgentLabel === 'CODEX' ? 'Codex' : 'Claude'} Multi-Model Orchestration Deck
            </h2>

            {/* Powerful Copy */}
            <p className="font-retro-mono text-xs sm:text-sm text-stone-700 mb-6 max-w-lg leading-relaxed">
              {leadAgentLabel === 'CODEX' ? 'Codex' : 'Claude'} leads your workflow — automatically analyzing your prompts, delegating sub-tasks across <span className="font-bold text-[#281E14] bg-[#FEF3C7] px-1.5 py-0.5 rounded border border-[#F59E0B]/30">ChatGPT, Gemini, Grok & Perplexity</span>, and synthesizing unified results.
            </p>

            {/* Interactive Capability Workstation Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl mb-7">
              {AGENT_CAPABILITIES.map(cap => {
                const IconComp = cap.icon
                return (
                  <div
                    key={cap.id}
                    onClick={() => setInput(cap.prompt)}
                    className="group relative flex flex-col items-start text-left p-3.5 rounded-xl bg-white border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.2)] hover:shadow-[3.5px_3.5px_0px_0px_rgba(40,30,20,0.28)] hover:-translate-y-1 transition-all duration-200 cursor-pointer overflow-hidden"
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <div className={`p-2 rounded-lg border ${cap.bgColor} ${cap.borderColor} ${cap.color} group-hover:scale-110 transition-transform`}>
                        <IconComp size={16} />
                      </div>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse opacity-80" />
                    </div>

                    <div className="font-retro-tech text-xs font-bold text-[#281E14] uppercase mb-0.5 group-hover:text-[#D97706] transition-colors leading-snug">
                      {cap.title}
                    </div>

                    <div className="font-retro-mono text-[10px] text-stone-500 font-medium">
                      {cap.subtitle}
                    </div>

                    {/* Subtle hover indicator arrow */}
                    <div className="absolute right-3 bottom-2.5 text-[11px] font-retro-mono text-[#D97706] opacity-0 group-hover:opacity-100 transition-opacity font-bold">
                      ›
                    </div>
                  </div>
                )
              })}
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
                rightSlot={
                  <InlineDictationControl
                    surface="agent"
                    surfaceSessionId={session.id}
                    provider="chatgpt"
                    disabled={sending}
                    onTranscript={(transcript) => setInput(transcript)}
                  />
                }
              />
            </div>

          </div>
          <div className="mt-5 w-full max-w-3xl">
            <p className="mb-2 text-center font-retro-mono text-[10px] font-bold tracking-[0.18em] text-slate-500">SEND A DIRECTIVE TO THE ACTIVE AGENT</p>
            <ChatInputBar
              input={input}
              onInputChange={setInput}
              onSend={handleSend}
              onKeyDown={handleKeyDown}
              sending={sending}
              onStop={handleStop}
              autoFocus
              placeholders={AGENT_PLACEHOLDERS}
              rightSlot={
                <InlineDictationControl
                  surface="agent"
                  surfaceSessionId={session.id}
                  provider="chatgpt"
                  disabled={sending}
                  onTranscript={(transcript) => setInput(transcript)}
                />
              }
            />
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
                  toolCalls={entry.toolCalls.length > 0 ? <WorkerToolCardList calls={entry.toolCalls} /> : undefined}
                />
              ))}
              {sending && (
                <ChatBubble
                  role="assistant"
                  content={liveText}
                  label="Agent"
                  pending
                  toolCalls={liveToolCalls.length > 0 ? <WorkerToolCardList calls={liveToolCalls} /> : undefined}
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
                rightSlot={
                  <InlineDictationControl
                    surface="agent"
                    surfaceSessionId={session.id}
                    provider="chatgpt"
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
            &times;
          </button>
        </div>
      )}

      {pendingApprovals.length > 0 && (
        <ToolApprovalDialog
          approval={pendingApprovals[0]}
          queueLength={pendingApprovals.length}
          onRespond={handleApprovalResponse}
        />
      )}
      </div>
    </div>
  )
}
