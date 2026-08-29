import { useCallback, useEffect, useState } from 'react'
import type { AgentRunEvent } from '@/types/electron'
import type { PendingApproval } from '@/components/agent/ToolApprovalDialog'

/**
 * The approval queue, shared by every surface that can start an agent turn.
 *
 * The agent is blocked on the answer, so any surface able to send a message
 * must also be able to answer a prompt — a panel that ignores
 * approval_request leaves the run hanging with no way to finish it. Studio's
 * chat panel needed exactly this and had none, which is why it is a shared
 * hook rather than logic living only inside Agent.tsx.
 *
 * Matches only on sessionId, not runId/sequence: main.ts's agent:sendMessage
 * is single-flight (a new send aborts the previous run and denies its
 * pending approvals), so at most one run per session can genuinely have an
 * outstanding approval at a time, and a duplicate delivery of the same
 * requestId is already a no-op below.
 */
export function useAgentApprovals(sessionId: string | null) {
  const api = window.electronAPI
  const [pending, setPending] = useState<PendingApproval[]>([])

  useEffect(() => {
    setPending([])

    function onEvent(_e: unknown, run: AgentRunEvent) {
      if (sessionId && run.sessionId !== sessionId) return
      if (run.event.type === 'approval_request') {
        const { requestId, tool, title, detail, input } = run.event
        setPending(prev => prev.some(p => p.requestId === requestId)
          ? prev
          : [...prev, { requestId, tool, title, ...(detail ? { detail } : {}), ...(input ? { input } : {}) }])
      }
      // A finished or failed run cannot still be waiting on an answer — the
      // main process already resolved anything outstanding as denied (see
      // denyAllPendingApprovals in main.ts's finally block).
      if (run.event.type === 'done' || run.event.type === 'error') setPending([])
    }
    api.onAgentEvent(onEvent)
    return () => api.offAgentEvent(onEvent)
  }, [api, sessionId])

  const respond = useCallback((requestId: string, approved: boolean) => {
    // Drop it from the queue immediately rather than waiting on the IPC
    // round trip: the run is blocked on this answer, so any delay here is
    // felt directly as the dialog sitting there after a click.
    setPending(prev => prev.filter(p => p.requestId !== requestId))
    void api.agentApprovalResponse(requestId, approved)
  }, [api])

  return { pending, respond }
}
