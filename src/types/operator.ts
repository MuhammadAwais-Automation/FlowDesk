/**
 * Brain v3 operator records as the renderer sees them (window.electronAPI.brainOperator).
 * Mirrors electron/brain/operator/store.ts; the renderer cannot import from electron/.
 */
export type FactStatus = 'accepted' | 'proposed' | 'rejected'
export interface OpFact { id: string; subject: string; field: string; value: unknown; status: FactStatus; source: string; validFrom: string; validTo: string | null; recordedAt: string }
export interface OpBrand { id: string; name: string; status: 'active' | 'proposed' | 'archived'; fields: Record<string, unknown>; createdAt: string }
export interface OpAccount { platform: string; slotId: string; label: string; lastActionAt: string | null; fields: Record<string, unknown> }
export interface OpHandoff { summary: string; decisions?: string[]; next?: string; focus?: string }
export interface OpSession { id: string; client: string; startedAt: string; lastSeenAt: string; endedAt: string | null; endReason: string | null; reads: Record<string, number>; writes: number; errors: number; handoff: OpHandoff | null }
export interface OpEvent { id: string; at: string; sessionId: string | null; platform: string; account: string | null; tool: string; kind: 'write' | 'read' | 'system'; outcome: 'ok' | 'error'; targetId: string | null; targetUrl: string | null; contentId: string | null; error: string | null; summary: string | null }
export type ContentStage = 'idea' | 'made' | 'approved' | 'scheduled' | 'live' | 'measured' | 'dropped'
export const CONTENT_STAGES: ContentStage[] = ['idea', 'made', 'approved', 'scheduled', 'live', 'measured']
export interface OpContent { id: string; brandId: string | null; kind: string; title: string; stage: ContentStage; ideaSource: string | null; data: Record<string, unknown>; createdAt: string; updatedAt: string }
export interface OpContentLink { id: string; contentId: string; at: string; type: string; platform: string | null; account: string | null; externalId: string | null; url: string | null; detail: string | null }
export interface OpMetric { id: string; at: string; platform: string; account: string | null; externalId: string; contentId: string | null; metrics: Record<string, number> }
export interface OpContentDetail { content: OpContent; links: OpContentLink[]; metrics: OpMetric[]; events: OpEvent[] }
export interface OpLearning { id: string; statement: string; scope: string | null; evidence: unknown[]; confidence: number; status: 'proposed' | 'accepted' | 'rejected' | 'retired'; createdAt: string; decidedAt: string | null }
export interface OpTask { id: string; title: string; brandId: string | null; platform: string | null; account: string | null; dueAt: string | null; state: 'open' | 'waiting' | 'done' | 'cancelled'; waitingOn: string | null; source: string; externalId: string | null; contentId: string | null; notes: string | null; createdAt: string; updatedAt: string }
export interface OpInboxItem { id: string; at: string; kind: string; title: string; body: string; refId: string | null; needsAgent: boolean; status: 'new' | 'taken' | 'done'; takenBy: string | null; packet: { jobId?: string; instructions?: string } | null; updatedAt: string }
export interface OpJob { id: string; recipe: string; params: Record<string, unknown>; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; progress: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; resultPath: string | null; summary: string | null; error: string | null; sessionId: string | null; monitorId: string | null }
export interface OpMonitor { id: string; recipe: string; params: Record<string, unknown>; everyMinutes: number; status: 'active' | 'paused'; lastRunAt: string | null; nextRunAt: string; createdAt: string }
export interface OpLogEntry { id: string; at: string; type: string; title: string; body: string }
export interface OpRecipe { id: string; title: string; description: string }
export interface OpOverview { brands: number; accounts: number; content: number; inboxNew: number; jobsActive: number; learningsProposed: number; factsProposed: number; tasksWaiting: number }
export interface OpJobResult { job: OpJob; ready: boolean; summary?: string; page?: number; pages?: number; total?: number; items?: unknown[]; data?: unknown }
