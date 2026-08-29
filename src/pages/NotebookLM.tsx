import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity, Ban, BotMessageSquare, BookOpen, BrainCircuit, Check, ChevronRight, AlertCircle,
  FilePlus2, Files, Link, Loader2, LogIn, MessageSquareQuote, Plus,
  FolderOpen, RefreshCw, RotateCcw, Search, Send, Sparkles, Upload, Square, Trash2,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ChevronDown, ChevronUp,
} from 'lucide-react'
import { ArtifactCard, type NotebookArtifact } from '@/components/notebooklm/ArtifactCard'
import { SectionTitle } from '@/components/notebooklm/SectionTitle'
import { recoverInterruptedNotebookChat } from '@/lib/notebooklmContinuity'

type Notebook = { id: string; title: string; sourceCount?: number; updatedAt?: string }
type ResearchJob = { id: string; status: string; message?: string; notebookId?: string; kind?: 'research' | 'artifact'; query?: string; artifactType?: string; startedAt?: string; cancelled?: boolean; durable?: boolean }
type ChatReply = { answer?: string; text?: string; citations?: Array<{ title?: string; url?: string; sourceId?: string }> }
type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations?: ChatReply['citations']
  state?: 'queued' | 'thinking' | 'streaming' | 'complete' | 'cancelled' | 'error'
  createdAt: string
  prompt?: string
}
type ChatEvent = { requestId?: string; type?: 'queued' | 'thinking' | 'delta' | 'citations' | 'done' | 'error'; text?: string; citations?: ChatReply['citations']; error?: string }
type GoogleAccount = { email: string; label: string | null }

/** Kept local while the preload contract is being integrated. */
interface NotebookLMBridge {
  notebooklmStatus: () => Promise<{ connected?: boolean; email?: string; status?: string; details?: { email?: string } }>
  notebooklmSelectAccount: (email: string | null) => Promise<unknown>
  gmailList: () => Promise<GoogleAccount[]>
  notebooklmLogin: () => Promise<unknown>
  notebooksCreate: (input: { title: string }) => Promise<Notebook>
  notebooksList: () => Promise<Notebook[]>
  sourcesAdd: (input: { notebookId: string; type: 'url' | 'text'; value: string; title?: string }) => Promise<unknown>
  sourceCounts: (notebookIds: string[]) => Promise<Record<string, number>>
  researchStart: (input: { notebookId: string; mode: 'fast' | 'deep'; query: string }) => Promise<ResearchJob>
  researchStatus: (input: { notebookId: string; jobId?: string }) => Promise<ResearchJob | ResearchJob[]>
  chatAsk: (input: { notebookId: string; question: string }) => Promise<ChatReply>
  // Optional while the main-process streaming bridge rolls out. Keeping this
  // contract optional lets the Studio retain a safe non-streaming fallback.
  notebooklmChatStart?: (input: { notebookId: string; question: string; requestId: string }) => Promise<{ requestId?: string } | void>
  notebooklmChatCancel?: (input: { requestId: string }) => Promise<void>
  onNotebooklmChatEvent?: (callback: (event: unknown, data: ChatEvent) => void) => void
  offNotebooklmChatEvent?: (callback: (event: unknown, data: ChatEvent) => void) => void
  notebooklmStartChatStream?: (notebookId: string, question: string, requestId?: string) => Promise<{ requestId: string }>
  notebooklmCancelChatStream?: (requestId: string) => Promise<{ cancelled: boolean }>
  onNotebooklmChatStream?: (callback: (data: { type: 'queued' | 'thinking' | 'delta' | 'citations' | 'done' | 'error'; requestId: string; text?: string; citations?: ChatReply['citations']; error?: string }) => void) => (() => void)
  artifactsList: (input: { notebookId: string }) => Promise<NotebookArtifact[]>
  artifactGenerate: (input: { notebookId: string; type: string; prompt?: string }) => Promise<ResearchJob>
  artifactDownload: (input: { notebookId: string; kind: string; artifactId: string; format?: 'pdf' | 'pptx' | 'json' | 'markdown' | 'html' }) => Promise<{ path?: string }>
  notebooklmJobsList: (notebookId?: string) => Promise<unknown[]>
  notebooklmJobsStartResearch: (input: { notebookId: string; query: string; mode?: 'fast' | 'deep' }) => Promise<unknown>
  notebooklmJobsGenerateArtifact: (input: { notebookId: string; kind: string; instructions?: string }) => Promise<unknown>
  notebooklmJobsRefresh: (id: string) => Promise<unknown>
  notebooklmJobsCancel: (id: string) => Promise<unknown>
  notebooklmJobsRetry: (id: string) => Promise<unknown>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
}

const artifactKinds = [
  ['report', 'Report'], ['slide_deck', 'Slides'], ['audio_overview', 'Audio'], ['video_overview', 'Video'],
  ['quiz', 'Quiz'], ['flashcards', 'Cards'], ['infographic', 'Infographic'], ['mind_map', 'Mind map'], ['data_table', 'Data table'],
]

function bridge() { return window.electronAPI as unknown as NotebookLMBridge }
function friendlyError(error: unknown) { return error instanceof Error ? error.message : 'NotebookLM request failed. Please try again.' }
function jobActive(status?: string) { return !status || ['queued', 'running', 'processing', 'pending'].includes(status.toLowerCase()) }
function statusConnected(status: { connected?: boolean; status?: string }) { return status.connected === true || status.status === 'ok' }
const jobsKey = (email: string) => `notebooklm:jobs:${email || 'default'}`
const pathsKey = (email: string) => `notebooklm:artifactPaths:${email || 'default'}`
const chatKey = (email: string, notebookId: string) => `notebooklm:chat:${email || 'default'}:${notebookId}`
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function normaliseJob(value: unknown, fallback: Partial<ResearchJob>): ResearchJob {
  const data = asRecord(value); const nested = asRecord(data.data); const result = Object.keys(nested).length ? nested : data
  const request = asRecord(result.request)
  const kind = result.kind === 'artifact' || fallback.kind === 'artifact' ? 'artifact' : 'research'
  return {
    ...fallback,
    id: String(result.id ?? result.job_id ?? result.task_id ?? fallback.id ?? `${kind}-${Date.now()}`),
    status: String(result.status ?? result.state ?? fallback.status ?? 'queued'),
    message: typeof result.message === 'string' ? result.message : typeof result.error === 'string' ? result.error : fallback.message,
    notebookId: String(result.notebookId ?? result.notebook_id ?? request.notebookId ?? fallback.notebookId ?? ''),
    kind,
    query: typeof result.query === 'string' ? result.query : typeof request.query === 'string' ? request.query : typeof request.instructions === 'string' ? request.instructions : fallback.query,
    artifactType: typeof result.artifactType === 'string' ? result.artifactType : typeof request.kind === 'string' ? request.kind : fallback.artifactType,
    startedAt: typeof result.startedAt === 'string' ? result.startedAt : typeof result.createdAt === 'string' ? result.createdAt : fallback.startedAt,
    cancelled: String(result.status ?? '').toLowerCase() === 'cancelled' || fallback.cancelled,
  }
}

function listFrom(value: unknown): Record<string, unknown>[] {
  const data = asRecord(value); const candidate = data.data ?? data.items ?? data.notebooks ?? data.artifacts ?? value
  return Array.isArray(candidate) ? candidate.map(asRecord) : []
}
function canonicalArtifactType(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-')
  const aliases: Record<string, string> = {
    'audio-overview': 'audio', overview: 'audio', podcast: 'audio',
    'video-overview': 'video', 'slide-deck': 'slide-deck', deck: 'slide-deck',
    flashcard: 'flashcards', cards: 'flashcards',
    'mind-map': 'mind-map', map: 'mind-map',
    'data-table': 'data-table', table: 'data-table',
    'briefing-doc': 'report', 'study-guide': 'report', 'blog-post': 'report',
  }
  return (aliases[key] ?? key) || 'report'
}

function StudioSection({ icon, title, detail, action, children, defaultOpen = true }: {
  icon: typeof Search; title: string; detail: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_0_rgba(15,23,42,0.04)]">
    <div className={`flex items-start gap-2 px-4 pt-4 ${open ? 'pb-1' : 'pb-4'}`}>
      <div className="min-w-0 flex-1"><SectionTitle icon={icon} title={title} detail={detail} /></div>
      <div className="flex shrink-0 items-center gap-1">{action}<button type="button" onClick={() => setOpen(value => !value)} title={open ? `Collapse ${title}` : `Expand ${title}`} className="grid h-7 w-7 place-items-center rounded-md border border-border bg-base text-t3 transition hover:border-accent hover:bg-accent-soft hover:text-accent">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></div>
    </div>
    {open && <div className="px-4 pb-4">{children}</div>}
  </section>
}
void StudioSection

export default function NotebookLM() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [accounts, setAccounts] = useState<GoogleAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [activeNotebookId, setActiveNotebookId] = useState('')
  const [newNotebook, setNewNotebook] = useState('')
  const [sourceType, setSourceType] = useState<'url' | 'text'>('url')
  const [sourceValue, setSourceValue] = useState('')
  const [researchQuery, setResearchQuery] = useState('')
  const [researchMode, setResearchMode] = useState<'fast' | 'deep'>('deep')
  const [job, setJob] = useState<ResearchJob | null>(null)
  const [jobs, setJobs] = useState<ResearchJob[]>([])
  const [artifactPaths, setArtifactPaths] = useState<Record<string, string>>({})
  const [health, setHealth] = useState<'checking' | 'healthy' | 'attention'>('checking')
  const [question, setQuestion] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [activeChatRequest, setActiveChatRequest] = useState<string | null>(null)
  const [artifacts, setArtifacts] = useState<NotebookArtifact[]>([])
  const [artifactPrompt, setArtifactPrompt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loginPending, setLoginPending] = useState(false)
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(() => localStorage.getItem('notebooklm:left-rail-collapsed') === 'true')
  const [rightRailCollapsed, setRightRailCollapsed] = useState(() => localStorage.getItem('notebooklm:right-rail-collapsed') === 'true')
  const ignoredChatRequests = useRef(new Set<string>())
  const hydratedChatKey = useRef<string | null>(null)
  const activeChatRequestRef = useRef<string | null>(null)

  const activeNotebook = useMemo(() => notebooks.find(item => item.id === activeNotebookId), [notebooks, activeNotebookId])

  useEffect(() => { activeChatRequestRef.current = activeChatRequest }, [activeChatRequest])

  useEffect(() => { localStorage.setItem('notebooklm:left-rail-collapsed', String(leftRailCollapsed)) }, [leftRailCollapsed])
  useEffect(() => { localStorage.setItem('notebooklm:right-rail-collapsed', String(rightRailCollapsed)) }, [rightRailCollapsed])

  const loadNotebooks = useCallback(async () => {
    const result = listFrom(await bridge().notebooksList()).map(item => {
      const count = item.sourceCount ?? item.source_count
      return { id: String(item.id ?? item.notebook_id ?? ''), title: String(item.title ?? item.name ?? 'Untitled notebook'), sourceCount: typeof count === 'number' ? count : undefined }
    }).filter(item => item.id)
    setNotebooks(result)
    setActiveNotebookId(current => current || result[0]?.id || '')
    // NotebookLM's notebook-list response has no counts. Fetch them outside
    // the render path; the main-process cache and concurrency cap keep this
    // accurate without a burst of redundant source-list commands.
    // Start with the first visible notebooks. Remaining counts are requested
    // as the user selects a notebook, instead of turning a 36-notebook
    // account into a long serial queue every time this page remounts.
    void bridge().sourceCounts(result.slice(0, 12).map(item => item.id)).then(counts => {
      setNotebooks(current => current.map(item => counts[item.id] === undefined ? item : { ...item, sourceCount: counts[item.id] }))
    }).catch(() => {})
  }, [])

  const loadArtifacts = useCallback(async (notebookId = activeNotebookId) => {
    if (!notebookId) return
    const result = listFrom(await bridge().artifactsList({ notebookId })).map(item => ({ id: String(item.id ?? item.artifact_id ?? ''), title: String(item.title ?? item.name ?? item.type ?? 'NotebookLM artifact'), type: canonicalArtifactType(item.type_id ?? item.type ?? item.kind), status: typeof item.status === 'string' ? item.status : undefined, createdAt: typeof item.created_at === 'string' ? item.created_at : undefined, path: artifactPaths[String(item.id ?? item.artifact_id ?? '')] }))
    setArtifacts(result.filter(item => item.id))
  }, [activeNotebookId, artifactPaths])

  const loadAccountState = useCallback(async (address: string) => {
    const [storedJobs, storedPaths, durableJobs] = await Promise.all([
      bridge().storeGet(jobsKey(address)),
      bridge().storeGet(pathsKey(address)),
      bridge().notebooklmJobsList(),
    ])
    const durable = Array.isArray(durableJobs) ? durableJobs.map(item => normaliseJob(item, { durable: true })) : []
    const legacy = Array.isArray(storedJobs) ? (storedJobs as ResearchJob[]).filter(item => !durable.some(saved => saved.id === item.id)) : []
    setJobs([...durable, ...legacy].slice(0, 30))
    setArtifactPaths(asRecord(storedPaths) as Record<string, string>)
  }, [])

  useEffect(() => {
    let disposed = false
    ;(async () => {
      try {
        const savedAccounts = await bridge().gmailList()
        if (!disposed) setAccounts(savedAccounts)
        const status = await bridge().notebooklmStatus()
        if (disposed) return
        const isConnected = statusConnected(status)
        setConnected(isConnected); setHealth(isConnected ? 'healthy' : 'attention')
        setEmail(status.email || status.details?.email || '')
        const address = status.email || status.details?.email || ''
        setSelectedAccount(address)
        await loadAccountState(address)
        if (isConnected) await loadNotebooks()
      } catch { if (!disposed) setConnected(false) }
    })()
    return () => { disposed = true }
  }, [loadAccountState, loadNotebooks])

  useEffect(() => { loadArtifacts().catch(() => {}) }, [activeNotebookId, loadArtifacts])

  // Each notebook has a small durable transcript. It is deliberately scoped
  // by account + notebook so one account cannot leak chat context into another.
  useEffect(() => {
    let disposed = false
    hydratedChatKey.current = null
    setChatMessages([])
    if (!activeNotebookId) return
    const key = chatKey(email, activeNotebookId)
    bridge().storeGet(key).then(value => {
      if (!disposed) {
        hydratedChatKey.current = key
        setChatMessages(recoverInterruptedNotebookChat(Array.isArray(value) ? value as ChatMessage[] : []))
      }
    }).catch(() => { if (!disposed) setChatMessages([]) })
    return () => { disposed = true }
  }, [email, activeNotebookId])

  useEffect(() => {
    const key = email && activeNotebookId ? chatKey(email, activeNotebookId) : ''
    if (key && hydratedChatKey.current === key) bridge().storeSet(key, chatMessages).catch(() => {})
  }, [chatMessages, email, activeNotebookId])

  useEffect(() => {
    const api = bridge()
    if (api.onNotebooklmChatStream) {
      const stop = api.onNotebooklmChatStream(payload => {
        if (ignoredChatRequests.current.has(payload.requestId)) return
        setChatMessages(current => current.map(message => {
          if (message.id !== payload.requestId) return message
          if (payload.type === 'delta') return { ...message, text: `${message.text}${payload.text || ''}`, state: 'streaming' }
          if (payload.type === 'citations') return { ...message, citations: payload.citations || message.citations }
          if (payload.type === 'done') return { ...message, text: payload.text || message.text, state: 'complete' }
          if (payload.type === 'error') return { ...message, text: payload.error || 'NotebookLM could not complete this answer.', state: 'error' }
          return { ...message, state: 'thinking' }
        }))
        if (payload.type === 'done' || payload.type === 'error') setActiveChatRequest(current => current === payload.requestId ? null : current)
      })
      return stop
    }
    if (!api.onNotebooklmChatEvent) return
    const onEvent = (_event: unknown, payload: ChatEvent) => {
      if (!payload.requestId || ignoredChatRequests.current.has(payload.requestId)) return
      setChatMessages(current => current.map(message => {
        if (message.id !== payload.requestId) return message
        if (payload.type === 'delta') return { ...message, text: `${message.text}${payload.text || ''}`, state: 'streaming' }
        if (payload.type === 'citations') return { ...message, citations: payload.citations || message.citations }
        if (payload.type === 'done') return { ...message, text: payload.text || message.text, citations: payload.citations || message.citations, state: 'complete' }
        if (payload.type === 'error') return { ...message, text: payload.error || 'NotebookLM could not complete this answer.', state: 'error' }
        return { ...message, state: payload.type === 'thinking' ? 'thinking' : 'queued' }
      }))
      if (payload.type === 'done' || payload.type === 'error') setActiveChatRequest(current => current === payload.requestId ? null : current)
    }
    api.onNotebooklmChatEvent(onEvent)
    return () => api.offNotebooklmChatEvent?.(onEvent)
  }, [])

  useEffect(() => () => {
    const requestId = activeChatRequestRef.current
    if (!requestId) return
    ignoredChatRequests.current.add(requestId)
    void bridge().notebooklmCancelChatStream?.(requestId).catch(() => {})
  }, [])

  useEffect(() => {
    if (!activeNotebookId) return
    void bridge().sourceCounts([activeNotebookId]).then(counts => {
      if (counts[activeNotebookId] === undefined) return
      setNotebooks(current => current.map(item => item.id === activeNotebookId ? { ...item, sourceCount: counts[item.id] } : item))
    }).catch(() => {})
  }, [activeNotebookId])

  useEffect(() => { if (email) bridge().storeSet(jobsKey(email), jobs).catch(() => {}) }, [jobs, email])
  useEffect(() => { if (email) bridge().storeSet(pathsKey(email), artifactPaths).catch(() => {}) }, [artifactPaths, email])

  useEffect(() => {
    if (!loginPending) return
    const timer = window.setInterval(async () => {
      try {
        const status = await bridge().notebooklmStatus()
        if (!statusConnected(status)) return
        setLoginPending(false)
        setConnected(true)
        const address = status.email || status.details?.email || ''
        setEmail(address)
        setSelectedAccount(address)
        setNotice('NotebookLM connected successfully.')
        await loadAccountState(address)
        await loadNotebooks()
      } catch { /* Login is still in progress. */ }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [loginPending, loadAccountState, loadNotebooks])

  useEffect(() => {
    if (!job || !jobActive(job.status)) return
    const timer = window.setInterval(async () => {
      try {
        const result = job.durable
          ? await bridge().notebooklmJobsRefresh(job.id)
          : await bridge().researchStatus({ notebookId: job.notebookId || activeNotebookId, jobId: job.id })
        const next = Array.isArray(result) ? result.find(item => item.id === job.id) || result[0] : result
        if (next) {
          const updated = normaliseJob(next, job)
          rememberJob(updated)
          if (!jobActive(updated.status)) loadArtifacts().catch(() => {})
        }
      } catch { /* The job remains visible; a manual refresh can retry. */ }
    }, 3500)
    return () => window.clearInterval(timer)
  }, [job, activeNotebookId, loadArtifacts])

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(null); setNotice(null)
    try { await action() } catch (cause) { setError(friendlyError(cause)) } finally { setBusy(null) }
  }

  function rememberJob(next: ResearchJob) {
    setJob(next)
    setJobs(current => [next, ...current.filter(item => item.id !== next.id)].slice(0, 30))
  }

  const connect = () => run('connect', async () => {
    await bridge().notebooklmSelectAccount(selectedAccount || null)
    await bridge().notebooklmLogin()
    setLoginPending(true)
    setNotice('Google sign-in window opened. Complete login there; FlowDesk will connect automatically.')
  })

  const createNotebook = () => run('create', async () => {
    const title = newNotebook.trim(); if (!title) return
    const created = await bridge().notebooksCreate({ title })
    setNewNotebook(''); await loadNotebooks(); setActiveNotebookId(created.id)
    setNotice(`“${created.title}” is ready for sources.`)
  })

  const addSource = () => run('source', async () => {
    const value = sourceValue.trim(); if (!activeNotebookId || !value) return
    await bridge().sourcesAdd({ notebookId: activeNotebookId, type: sourceType, value })
    setSourceValue(''); await loadNotebooks(); setNotice('Source added. NotebookLM is processing it now.')
  })

  const startResearch = () => run('research', async () => {
    const query = researchQuery.trim(); if (!activeNotebookId || !query) return
    const response = await bridge().notebooklmJobsStartResearch({ notebookId: activeNotebookId, mode: researchMode, query })
    rememberJob(normaliseJob(response, { notebookId: activeNotebookId, kind: 'research', query, durable: true, startedAt: new Date().toISOString() })); setNotice(`${researchMode === 'deep' ? 'Deep' : 'Fast'} research started.`)
  })

  const ask = (questionOverride?: string) => run('ask', async () => {
    const text = (questionOverride ?? question).trim(); if (!activeNotebookId || !text) return
    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()
    setQuestion('')
    setChatMessages(current => [...current,
      { id: `user-${requestId}`, role: 'user', text, createdAt: now },
      { id: requestId, role: 'assistant', text: '', state: 'queued', createdAt: now, prompt: text },
    ])
    setActiveChatRequest(requestId)
    const api = bridge()
    const startStream = api.notebooklmStartChatStream
    if (startStream && api.onNotebooklmChatStream) {
      const started = await startStream(activeNotebookId, text, requestId)
      // The backend owns a stronger stream id. Replace the optimistic bubble
      // id before any first token can be delivered.
      setChatMessages(current => current.map(message => message.id === requestId ? { ...message, id: started.requestId, state: 'thinking' } : message))
      setActiveChatRequest(started.requestId)
      return
    }
    if (api.notebooklmChatStart && api.onNotebooklmChatEvent) {
      await api.notebooklmChatStart({ notebookId: activeNotebookId, question: text, requestId })
      return
    }
    // Compatibility fallback for older main-process builds. The UI still has
    // a visible thinking bubble; real token events arrive once the new bridge
    // is available, without changing this page again.
    setChatMessages(current => current.map(message => message.id === requestId ? { ...message, state: 'thinking' } : message))
    const result = await api.chatAsk({ notebookId: activeNotebookId, question: text })
    if (ignoredChatRequests.current.has(requestId)) return
    setChatMessages(current => current.map(message => message.id === requestId ? {
      ...message, text: result.answer || result.text || 'No answer returned.', citations: result.citations, state: 'complete',
    } : message))
    setActiveChatRequest(current => current === requestId ? null : current)
  })

  const cancelChat = () => run('cancel-chat', async () => {
    if (!activeChatRequest) return
    const requestId = activeChatRequest
    await stopChatRequest(requestId)
    setChatMessages(current => current.map(message => message.id === requestId ? { ...message, state: 'cancelled', text: message.text || 'Answer stopped.' } : message))
    setActiveChatRequest(null)
  })

  async function stopChatRequest(requestId: string) {
    ignoredChatRequests.current.add(requestId)
    const api = bridge()
    const cancelStream = api.notebooklmCancelChatStream
    if (cancelStream) await cancelStream(requestId)
    else {
      const cancelLegacy = api.notebooklmChatCancel
      if (cancelLegacy) await cancelLegacy({ requestId })
    }
  }

  async function selectNotebook(notebookId: string) {
    const requestId = activeChatRequestRef.current
    if (requestId) await stopChatRequest(requestId).catch(() => {})
    setActiveChatRequest(null)
    setActiveNotebookId(notebookId)
    setJob(null)
  }

  const regenerate = (message: ChatMessage) => {
    if (!message.prompt || activeChatRequest) return
    ask(message.prompt)
  }

  const clearChat = () => {
    if (!activeNotebookId || activeChatRequest) return
    setChatMessages([])
    bridge().storeSet(chatKey(email, activeNotebookId), []).catch(() => {})
  }

  const generate = (type: string) => run(`generate:${type}`, async () => {
    if (!activeNotebookId) return
    const response = await bridge().notebooklmJobsGenerateArtifact({ notebookId: activeNotebookId, kind: type, instructions: artifactPrompt.trim() || undefined })
    rememberJob(normaliseJob(response, { notebookId: activeNotebookId, kind: 'artifact', artifactType: type, query: artifactPrompt.trim(), durable: true, startedAt: new Date().toISOString() })); setNotice(`${type.replaceAll('_', ' ')} generation queued.`)
  })

  const download = (artifact: NotebookArtifact) => run(`download:${artifact.id}`, async () => {
    const result = asRecord(await bridge().artifactDownload({ notebookId: activeNotebookId, kind: artifact.type, artifactId: artifact.id }))
    const path = typeof result.path === 'string' ? result.path : undefined
    if (path) setArtifactPaths(current => ({ ...current, [artifact.id]: path }))
    setNotice(path ? `Saved to ${path}` : 'Artifact saved to your FlowDesk library.')
  })

  const cancelJob = (entry: ResearchJob) => run(`cancel:${entry.id}`, async () => {
    const response = entry.durable ? await bridge().notebooklmJobsCancel(entry.id) : undefined
    const cancelled = response
      ? normaliseJob(response, { ...entry, durable: true, cancelled: true })
      : { ...entry, status: 'cancelled', cancelled: true, message: 'Stopped tracking locally. The NotebookLM job may still finish remotely.' }
    rememberJob(cancelled); setNotice(cancelled.message || 'Job cancelled.')
  })

  const retryJob = (entry: ResearchJob) => run(`retry:${entry.id}`, async () => {
    if (!entry.notebookId) return
    if (entry.durable) {
      const response = await bridge().notebooklmJobsRetry(entry.id)
      rememberJob(normaliseJob(response, { ...entry, id: undefined, status: 'queued', cancelled: false, durable: true, startedAt: new Date().toISOString() }))
    } else if (entry.kind === 'artifact') {
      const response = await bridge().artifactGenerate({ notebookId: entry.notebookId, type: entry.artifactType || 'report', prompt: entry.query || undefined })
      rememberJob(normaliseJob(response, { ...entry, id: '', status: 'queued', cancelled: false, startedAt: new Date().toISOString() }))
    } else {
      const response = await bridge().researchStart({ notebookId: entry.notebookId, mode: researchMode, query: entry.query || 'Continue the prior research request' })
      rememberJob(normaliseJob(response, { ...entry, id: '', status: 'queued', cancelled: false, startedAt: new Date().toISOString() }))
    }
    setNotice('Job restarted.')
  })

  const openArtifact = (artifact: NotebookArtifact) => {
    if (!artifact.path) return
    window.open(`file:///${artifact.path.replaceAll('\\', '/')}`, '_blank', 'noopener,noreferrer')
  }

  const refreshHealth = () => run('health', async () => {
    setHealth('checking')
    const status = await bridge().notebooklmStatus()
    const ready = statusConnected(status)
    setConnected(ready); setHealth(ready ? 'healthy' : 'attention')
    setEmail(status.email || status.details?.email || email)
    setNotice(ready ? 'NotebookLM profile is healthy and ready.' : 'NotebookLM needs a sign-in refresh.')
  })

  const switchAccount = (nextEmail: string) => run('account', async () => {
    const requestId = activeChatRequestRef.current
    if (requestId) await stopChatRequest(requestId).catch(() => {})
    await bridge().notebooklmSelectAccount(nextEmail || null)
    setActiveChatRequest(null); setSelectedAccount(nextEmail); setEmail(nextEmail); setConnected(false); setHealth('attention'); setNotebooks([]); setActiveNotebookId(''); setArtifacts([]); setJobs([]); setArtifactPaths({}); setChatMessages([])
    setNotice('Account changed. Connect this NotebookLM profile to continue.')
  })

  if (connected === null) return <div className="grid h-full place-items-center bg-base"><Loader2 className="animate-spin text-accent" /></div>

  if (!connected) return (
    <div className="notebook-connect flex h-full items-center justify-center overflow-auto bg-base p-6">
      <div className="notebook-connect__card w-full max-w-xl rounded-2xl border border-border bg-surface p-8 shadow-lg">
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent"><BrainCircuit size={25} /></div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-accent">Research Studio</p>
        <h1 className="mt-2 text-2xl font-bold text-tx">Connect NotebookLM</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-t2">Choose one of your FlowDesk Google accounts. It gets its own secure NotebookLM profile; your Agent and Research Studio will use the same selected account.</p>
        {accounts.length > 0 && <div className="mt-5"><label className="mb-1.5 block text-xs font-semibold text-t2">Google account</label><select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-base px-3 text-sm text-tx outline-none focus:border-accent"><option value="">Choose an account</option>{accounts.map(account => <option key={account.email} value={account.email}>{account.label || account.email} ({account.email})</option>)}</select><p className="mt-1.5 text-[11px] text-t3">First connection may ask Google to confirm this account once.</p></div>}
        <div className="mt-6 rounded-xl border border-border bg-s2 p-4 text-xs leading-5 text-t2">
          <div className="mb-1 flex items-center gap-2 font-semibold text-tx"><Check size={14} className="text-emerald-600" /> Full notebook control</div>
          Create notebooks, add sources, run grounded research, and generate reports, audio, videos, slides, quizzes and more.
        </div>
        <button type="button" onClick={connect} disabled={busy === 'connect' || loginPending || (accounts.length > 0 && !selectedAccount)} className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-bold text-inverse transition-colors hover:bg-accent-h disabled:opacity-60">
          {busy === 'connect' || loginPending ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} {loginPending ? 'Waiting for Google sign-in…' : 'Connect Google Account'}
        </button>
        {(error || notice) && <p className={`mt-4 text-xs ${error ? 'text-danger' : 'text-t2'}`}>{error || notice}</p>}
      </div>
    </div>
  )

  return (
    <div className="notebook-studio flex h-full min-w-0 flex-col overflow-hidden bg-base text-tx">
      <header className="notebook-studio__header flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-5">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-inverse"><BrainCircuit size={17} /></div>
          <div><h1 className="text-sm font-bold">NotebookLM Research Studio</h1><p className="text-[10px] text-t3">Grounded research, artifacts & Agent-ready context</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setLeftRailCollapsed(value => !value)} title={leftRailCollapsed ? 'Show notebook rail' : 'Hide notebook rail'} className="grid h-7 w-7 place-items-center rounded-md border border-border bg-base text-t3 hover:border-accent-border hover:text-accent">{leftRailCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}</button>
          <button type="button" onClick={() => setRightRailCollapsed(value => !value)} title={rightRailCollapsed ? 'Show studio rail' : 'Hide studio rail'} className="grid h-7 w-7 place-items-center rounded-md border border-border bg-base text-t3 hover:border-accent-border hover:text-accent">{rightRailCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}</button>
          {accounts.length > 1 && <select value={selectedAccount || email} onChange={e => switchAccount(e.target.value)} disabled={busy === 'account'} className="h-7 max-w-48 rounded-md border border-border bg-base px-2 text-[11px] text-t2 outline-none focus:border-accent"><option value={email}>{email || 'Active account'}</option>{accounts.filter(account => account.email !== email).map(account => <option key={account.email} value={account.email}>{account.label || account.email}</option>)}</select>}
          <button type="button" title="Check NotebookLM health" onClick={refreshHealth} disabled={busy === 'health'} className="flex items-center gap-1.5 rounded-full border border-border bg-s2 py-1 pl-2 pr-2.5 text-[11px] text-t2 hover:border-accent-border"><span className={`h-1.5 w-1.5 rounded-full ${health === 'healthy' ? 'bg-emerald-500' : health === 'checking' ? 'animate-pulse bg-amber-500' : 'bg-danger'}`} />{health === 'healthy' ? 'Ready' : health === 'checking' ? 'Checking' : 'Sign-in needed'}</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className={`notebook-studio__rail hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-base md:flex ${leftRailCollapsed ? 'w-12 p-2' : 'w-64 p-3'}`}>
          {leftRailCollapsed ? <div className="flex flex-col items-center gap-3"><BookOpen size={17} className="text-accent" /><button type="button" onClick={() => setLeftRailCollapsed(false)} title="Show notebooks" className="grid h-8 w-8 place-items-center rounded-md text-t3 hover:bg-s2 hover:text-accent"><PanelLeftOpen size={15} /></button></div> : <>
          <SectionTitle icon={BookOpen} title="Notebooks" detail="Agent can use the selected notebook." />
          <div className="flex gap-1.5"><input value={newNotebook} onChange={e => setNewNotebook(e.target.value)} onKeyDown={e => e.key === 'Enter' && createNotebook()} placeholder="New notebook name" className="min-w-0 flex-1 rounded-md border border-border bg-base px-2.5 text-xs outline-none focus:border-accent" /><button onClick={createNotebook} disabled={!newNotebook.trim() || busy === 'create'} className="grid h-8 w-8 place-items-center rounded-md bg-accent text-inverse disabled:opacity-50"><Plus size={15} /></button></div>
          <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {notebooks.map(notebook => <button key={notebook.id} onClick={() => { void selectNotebook(notebook.id) }} className={`w-full rounded-lg p-2.5 text-left transition-colors ${activeNotebookId === notebook.id ? 'bg-accent-soft text-accent' : 'text-t2 hover:bg-s2'}`}><div className="truncate text-xs font-semibold">{notebook.title}</div><div className="mt-1 text-[10px] opacity-70">{notebook.sourceCount === undefined ? 'Loading sources…' : `${notebook.sourceCount} sources`}</div></button>)}
            {!notebooks.length && <p className="p-2 text-xs text-t3">Create your first notebook to begin.</p>}
          </div>
          <button onClick={() => run('refresh', loadNotebooks)} className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-border py-2 text-[11px] font-semibold text-t2 hover:bg-s2"><RefreshCw size={12} /> Refresh</button>
          </>}
        </aside>

        <main className="notebook-studio__canvas min-w-0 flex-1 overflow-y-auto p-5">
          {!activeNotebook ? <div className="notebook-studio__empty grid h-full place-items-center text-center text-t3"><div><Files className="mx-auto mb-3" size={26} /><p className="text-sm">Choose or create a notebook to start research.</p></div></div> : <div className={`notebook-studio__grid mx-auto grid max-w-6xl gap-4 ${rightRailCollapsed ? 'max-w-3xl grid-cols-1' : 'xl:grid-cols-[1.05fr_0.95fr]'}`}>
            <div className="space-y-4">
              <section className="rounded-xl border border-border bg-surface p-4"><SectionTitle icon={Upload} title="Add grounded sources" detail={`Add to ${activeNotebook.title}. URLs and pasted notes are available now.`} /><div className="flex gap-2"><select value={sourceType} onChange={e => setSourceType(e.target.value as 'url' | 'text')} className="rounded-md border border-border bg-base px-2 text-xs"><option value="url">URL</option><option value="text">Text</option></select><textarea value={sourceValue} onChange={e => setSourceValue(e.target.value)} placeholder={sourceType === 'url' ? 'https://…' : 'Paste a note, brief, or research context…'} className="h-20 min-w-0 flex-1 resize-none rounded-md border border-border bg-base p-2.5 text-xs outline-none focus:border-accent" /></div><button onClick={addSource} disabled={!sourceValue.trim() || busy === 'source'} className="mt-2 flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-bold text-inverse disabled:opacity-50">{busy === 'source' ? <Loader2 size={13} className="animate-spin" /> : <Link size={13} />} Add source</button></section>
              <section className="rounded-xl border border-border bg-surface p-4"><SectionTitle icon={Search} title="Deep Research" detail="Find and import research, then use it as cited notebook context." /><textarea value={researchQuery} onChange={e => setResearchQuery(e.target.value)} placeholder="What should NotebookLM investigate?" className="h-20 w-full resize-none rounded-md border border-border bg-base p-2.5 text-xs outline-none focus:border-accent" /><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex rounded-md border border-border p-0.5 text-[11px]">{(['fast', 'deep'] as const).map(mode => <button key={mode} onClick={() => setResearchMode(mode)} className={`rounded px-2.5 py-1 font-semibold capitalize ${researchMode === mode ? 'bg-accent-soft text-accent' : 'text-t3'}`}>{mode}</button>)}</div><button onClick={startResearch} disabled={!researchQuery.trim() || busy === 'research'} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-bold text-inverse disabled:opacity-50">{busy === 'research' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Start research</button></div></section>
              <section className="rounded-xl border border-border bg-surface p-4">
                <SectionTitle icon={MessageSquareQuote} title="Ask with citations" detail="A live, grounded conversation for this notebook." action={chatMessages.length ? <button onClick={clearChat} disabled={Boolean(activeChatRequest)} title="Clear this notebook's chat history" className="text-t3 hover:text-danger disabled:opacity-40"><Trash2 size={14} /></button> : undefined} />
                <div className="mb-3 max-h-80 space-y-3 overflow-y-auto pr-1">
                  {!chatMessages.length && <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-t3">Ask a question to start a saved, source-grounded chat.</p>}
                  {chatMessages.map(message => message.role === 'user' ? <div key={message.id} className="ml-8 rounded-lg bg-accent px-3 py-2 text-xs leading-5 text-inverse"><p className="whitespace-pre-wrap">{message.text}</p></div> : <div key={message.id} className="mr-3 rounded-lg border border-border bg-s2 p-3 text-xs leading-5 text-t2">
                    {(message.state === 'queued' || message.state === 'thinking') && !message.text && <div className="flex items-center gap-2 text-t3"><Loader2 size={13} className="animate-spin text-accent" /><span>{message.state === 'queued' ? 'Queued with NotebookLM…' : 'Reading your sources and drafting an answer…'}</span></div>}
                    <p className="whitespace-pre-wrap">{message.text}</p>
                    {message.state === 'streaming' && <span className="ml-1 inline-block h-3 w-1 animate-pulse rounded-sm bg-accent align-middle" />}
                    {message.state === 'cancelled' && <p className="mt-2 text-[10px] text-t3">Stopped locally. You can regenerate this answer.</p>}
                    {message.state === 'error' && <p className="mt-2 text-[10px] text-danger">This request failed. Regenerate to try again.</p>}
                    {Boolean(message.citations?.length) && <div className="mt-3 border-t border-border pt-2"><p className="mb-1 font-semibold text-tx">Citations</p>{message.citations?.map((citation, index) => citation.url ? <a key={index} href={citation.url} target="_blank" rel="noreferrer" className="block truncate text-accent hover:underline">[{index + 1}] {citation.title || citation.url}</a> : <p key={index} className="truncate text-t2">[{index + 1}] {citation.title || citation.sourceId || 'Notebook source'}</p>)}</div>}
                    {message.state !== 'queued' && message.state !== 'thinking' && <button onClick={() => regenerate(message)} disabled={Boolean(activeChatRequest)} className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-t3 hover:text-accent disabled:opacity-40"><RotateCcw size={11} /> Regenerate</button>}
                  </div>)}
                </div>
                <div className="flex gap-2"><input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && ask()} placeholder="Ask a question about your sources…" disabled={Boolean(activeChatRequest)} className="min-w-0 flex-1 rounded-md border border-border bg-base px-3 text-xs outline-none focus:border-accent disabled:opacity-60" /><button onClick={activeChatRequest ? cancelChat : () => ask()} disabled={activeChatRequest ? busy === 'cancel-chat' : !question.trim() || busy === 'ask'} title={activeChatRequest ? 'Stop answer' : 'Send question'} className={`grid h-8 w-8 place-items-center rounded-md text-inverse disabled:opacity-50 ${activeChatRequest ? 'bg-danger hover:bg-danger/90' : 'bg-accent'}`}>{activeChatRequest ? <Square size={13} fill="currentColor" /> : busy === 'ask' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</button></div>
              </section>
            </div>
            {!rightRailCollapsed && <div className="space-y-4">
              <section className="rounded-xl border border-border bg-surface p-4"><SectionTitle icon={Sparkles} title="Artifact Studio" detail="Turn your grounded notebook into useful deliverables." /><input value={artifactPrompt} onChange={e => setArtifactPrompt(e.target.value)} placeholder="Optional focus or style, e.g. executive audience" className="mb-3 w-full rounded-md border border-border bg-base px-3 py-2 text-xs outline-none focus:border-accent" /><div className="grid grid-cols-3 gap-2">{artifactKinds.map(([value, label]) => <button key={value} onClick={() => generate(value)} disabled={Boolean(busy?.startsWith('generate:'))} className="rounded-lg border border-border bg-base px-2 py-2.5 text-center text-[11px] font-semibold text-t2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50">{label}</button>)}</div></section>
              <section className="rounded-xl border border-border bg-surface p-4">
                <SectionTitle icon={Activity} title="Research & generation jobs" detail="Saved locally, so you can return after a restart." action={<button onClick={() => activeNotebookId && loadArtifacts()} className="text-t3 hover:text-accent"><RefreshCw size={14} /></button>} />
                {jobs.filter(entry => entry.notebookId === activeNotebookId).length ? <div className="max-h-64 space-y-2 overflow-y-auto pr-1">{jobs.filter(entry => entry.notebookId === activeNotebookId).map(entry => {
                  const active = jobActive(entry.status) && !entry.cancelled
                  return <div key={entry.id} className={`rounded-lg border p-2.5 ${job?.id === entry.id ? 'border-accent-border bg-accent-soft/30' : 'border-border bg-s2'}`}>
                    <div className="flex items-start gap-2"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'animate-pulse bg-amber-500' : entry.status === 'completed' || entry.status === 'ready' ? 'bg-emerald-500' : entry.status === 'cancelled' ? 'bg-t3' : 'bg-danger'}`} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold capitalize text-tx">{entry.kind === 'artifact' ? `${(entry.artifactType || 'artifact').replaceAll('_', ' ')} generation` : `${entry.query || 'Research'} research`}</p><p className="mt-0.5 text-[10px] text-t3">{entry.message || (active ? 'NotebookLM is working; progress refreshes automatically.' : entry.status)}</p></div><button onClick={() => setJob(entry)} title="Track this job" className="text-t3 hover:text-accent"><ChevronRight size={14} /></button></div>
                    <div className="mt-2 flex gap-1.5">{active && <button onClick={() => cancelJob(entry)} disabled={busy === `cancel:${entry.id}`} className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-semibold text-t2 hover:bg-base"><Ban size={11} /> Stop tracking</button>}<button onClick={() => retryJob(entry)} disabled={Boolean(busy?.startsWith('retry:'))} className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-semibold text-t2 hover:bg-base"><RotateCcw size={11} /> Retry</button></div>
                  </div>
                })}</div> : <p className="text-xs text-t3">Start research or generate an artifact to build a durable job history.</p>}
              </section>
              <section className="rounded-xl border border-border bg-surface p-4"><SectionTitle icon={FilePlus2} title="Artifact library" detail="Completed output can be saved locally and opened from this workspace." />{artifacts.length ? <div className="grid gap-2 sm:grid-cols-2">{artifacts.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact} onDownload={download} onOpen={openArtifact} downloading={busy === `download:${artifact.id}`} />)}</div> : <div className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-t3"><BotMessageSquare className="mx-auto mb-2 opacity-60" size={18} />No generated artifacts yet.</div>}<div className="mt-3 flex items-center gap-1.5 text-[10px] text-t3"><FolderOpen size={12} /> Downloads remain in your local FlowDesk artifact library.</div></section>
            </div>}
          </div>}
        </main>
      </div>
      {(error || notice) && <div className={`absolute bottom-4 left-1/2 z-20 flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg ${error ? 'border-danger bg-danger-m text-danger' : 'border-accent-border bg-surface text-tx'}`}>{error ? <AlertCircle size={14} /> : <Check size={14} className="text-emerald-600" />}<span>{error || notice}</span><button onClick={() => { setError(null); setNotice(null) }} className="ml-2 text-t3 hover:text-tx"><ChevronRight size={14} /></button></div>}
    </div>
  )
}
