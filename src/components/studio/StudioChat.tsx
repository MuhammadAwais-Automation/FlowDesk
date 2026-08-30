import { useEffect, useRef, useState } from 'react'
import { Send, Check, X } from 'lucide-react'
import { useAgentApprovals } from '@/hooks/useAgentApprovals'
import { RetroMarkdown } from '@/components/chat/RetroMarkdown'
import type { AgentRunEvent, AgentSessionMeta, AgentSessionTurn } from '@/types/electron'

/**
 * Studio's chat attaches to an existing agent session rather than starting
 * one. A second conversation the user cannot find on the Agent page would
 * split their history and break the one thing this panel exists for: turning
 * what was already discussed into a design without re-explaining it.
 */
const LAST_SESSION_KEY = 'agentActiveSessionId'

interface Props { isActive: boolean }

export default function StudioChat({ isActive }: Props) {
  const api = window.electronAPI
  const [session, setSession] = useState<AgentSessionMeta | null>(null)
  const [turns, setTurns] = useState<AgentSessionTurn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [liveText, setLiveText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { pending, respond } = useAgentApprovals(session?.id ?? null)

  async function load() {
    const sessions = await api.agentSessionList()
    // The session the user last had open, not sessions[0] — that is the most
    // recently UPDATED one, which jumps to whichever session an agent last
    // wrote to.
    const remembered = localStorage.getItem(LAST_SESSION_KEY)
    const chosen = sessions.find(s => s.id === remembered) ?? sessions[0] ?? null
    setSession(chosen)
    setTurns(chosen ? await api.agentSessionTurns(chosen.id) : [])
  }

  useEffect(() => { if (isActive) void load() }, [isActive])

  useEffect(() => {
    function onEvent(_e: unknown, run: AgentRunEvent) {
      if (!session || run.sessionId !== session.id) return
      const event = run.event
      if (event.type === 'text') setLiveText(prev => prev + event.text)
      if (event.type === 'done' || event.type === 'error') {
        setLiveText('')
        setSending(false)
        void load()
      }
    }
    api.onAgentEvent(onEvent)
    return () => api.offAgentEvent(onEvent)
  }, [api, session])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns.length, liveText, pending.length])

  async function handleSend() {
    const text = draft.trim()
    if (!text || !session || sending) return
    setDraft('')
    setSending(true)
    setLiveText('')
    await api.agentSendMessage({ prompt: text, sessionId: session.id, runId: crypto.randomUUID() })
  }

  if (!session) {
    return (
      <div className="w-[320px] shrink-0 border-l-2 border-[#281E14] bg-[#FAF7F0] flex items-center justify-center p-6">
        <p className="font-retro-mono text-[11px] text-stone-500 text-center">
          No agent session yet. Start one on the Agent page, then come back — Studio uses that same conversation.
        </p>
      </div>
    )
  }

  return (
    <div className="w-[320px] shrink-0 border-l-2 border-[#281E14] bg-[#FAF7F0] flex flex-col">
      <div className="h-14 shrink-0 px-3 flex items-center border-b-2 border-[#281E14] bg-[#EBE5D5]">
        <span className="font-retro-mono text-[11px] font-bold uppercase tracking-wider text-[#281E14] truncate">
          {session.title}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {turns.slice(-8).map(turn => (
          <div
            key={turn.id}
            className={`rounded-xl px-3 py-2 font-retro-sans text-[11px] leading-relaxed ${
              turn.role === 'user'
                ? 'bg-[#FEF3C7] border border-[#D97706]/40 text-[#92400E]'
                : 'bg-white border border-[#E2DBD0] text-stone-800'
            }`}
          >
            {/*
              Rendered as markdown, not raw text: a generated image reaches
              this panel as ![alt](flowdesk-image://….png), and as plain text
              the user saw that link spelled out instead of the picture. The
              old 600-char clamp is now a scroll cap — truncating the string
              could cut an image link in half and lose it entirely.
            */}
            <div className="max-h-64 overflow-y-auto">
              <RetroMarkdown content={turn.content} />
            </div>
          </div>
        ))}

        {liveText && (
          <div className="rounded-xl px-3 py-2 bg-white border border-[#E2DBD0] font-retro-sans text-[11px] text-stone-800">
            <div className="max-h-64 overflow-y-auto">
              <RetroMarkdown content={liveText} pending />
            </div>
          </div>
        )}

        {/* The agent is blocked until one of these is answered. */}
        {pending.map(request => (
          <div key={request.requestId} className="rounded-xl border-2 border-[#D97706] bg-[#FEF3C7] p-3 space-y-2">
            <p className="font-retro-sans text-[11px] font-bold text-[#92400E]">{request.title}</p>
            {request.detail && (
              <p className="font-retro-mono text-[10px] text-stone-600 break-words max-h-24 overflow-y-auto">{request.detail}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => respond(request.requestId, true)}
                className="retro-btn flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-[#059669] text-white border border-[#047857] font-retro-mono text-[11px] font-bold"
              >
                <Check size={11} /> Allow
              </button>
              <button
                onClick={() => respond(request.requestId, false)}
                className="retro-btn flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-white text-stone-700 border border-[#D6CFC0] font-retro-mono text-[11px] font-bold"
              >
                <X size={11} /> Deny
              </button>
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t-2 border-[#281E14] bg-[#EBE5D5]">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
            placeholder="Ask the agent to design something…"
            rows={2}
            className="flex-1 min-w-0 resize-none rounded-lg border-2 border-[#281E14] bg-white px-2 py-1.5 font-retro-sans text-[11px] outline-none"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!draft.trim() || sending}
            className="retro-btn shrink-0 self-end px-3 py-2 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border-2 border-[#B45309] disabled:opacity-40"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
