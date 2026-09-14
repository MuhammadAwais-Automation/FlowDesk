/**
 * Five surfaces, each backed by data that's actually populated — not twelve,
 * several of them permanently empty. Independent research (PKM products,
 * local-first feasibility, this codebase's own data inventory) found no
 * evidence more dedicated knowledge surfaces improve outcomes, and the
 * previous tabs proved it: `entities`/`claims`/`summaries` were declared but
 * never written to (Graph always said "abhi curated entities nahi hain"),
 * and memories/knowledge were two stores nothing kept in sync.
 *
 * - Today: a dated stream, not a dashboard — every successful PKM tool
 *   (Logseq, Reflect, Tana) opens on a dated note, none open on a graph.
 * - Review: the write gate's candidates, plus unresolved links (Obsidian's
 *   "unlinked mentions" pattern — a zero-maintenance candidate-connection
 *   queue).
 * - Library: browse/search/read knowledge_documents. An "entity page" is
 *   just a filtered document plus its backlinks — no separate People &
 *   Organizations / Decisions & Goals tables needed.
 * - Ask: a question against the same documents, answered with citations
 *   that open the source at the passage — what NotebookLM/Notion AI/Reflect
 *   actually ship for "what does it know", not a standing inventory browser.
 * - Health: vault import, manifest preview, compaction, the memories
 *   migration, backup — the honesty console.
 */
export const BRAIN_TABS = ['Today', 'Review', 'Library', 'Ask', 'Health'] as const
export const INTELLIGENCE_TABS = ['Overview', 'Sources', 'Monitors', 'Pain Points', 'Trends', 'Opportunities', 'Decision Briefs'] as const

/**
 * The only recipes a monitor may schedule.
 *
 * These are exactly the recipes the Brain job runner claims
 * (`jobRunner.runOnce` → `socialRecipeDefinitions`). NotebookLM recipes are
 * deliberately absent: their Brain jobs are after-the-fact mirrors of the
 * NotebookLM job queue (`mirrorNotebookJobs`), so a Brain job enqueued for one
 * would sit queued forever with nothing to execute it.
 */
export const MONITORABLE_RECIPE_IDS = [
  'whatsapp.unread_intelligence',
  'linkedin.community_scan',
  'linkedin.opportunity_scan',
] as const

export type MonitorableRecipeId = (typeof MONITORABLE_RECIPE_IDS)[number]

/**
 * Where each monitorable recipe is run and consented from in the UI.
 *
 * Typed as a total `Record` over `MonitorableRecipeId` on purpose: consent is
 * granted only through a recipe's own run control, so a monitorable recipe with
 * no control here would be a monitor a user can create and never consent to —
 * claimed every window, silently skipped, with its "Last run" still advancing.
 * Adding an id above without adding its control fails typecheck.
 */
export const MONITORABLE_RECIPE_CONTROLS: Record<MonitorableRecipeId, { sourceId: string; actionLabel: string }> = {
  'whatsapp.unread_intelligence': { sourceId: 'whatsapp', actionLabel: 'Scan unread' },
  'linkedin.community_scan': { sourceId: 'linkedin', actionLabel: 'Scan community' },
  'linkedin.opportunity_scan': { sourceId: 'linkedin', actionLabel: 'Scan opportunities' },
}

export const INTELLIGENCE_SOURCES = [
  { id: 'notebooklm', title: 'NotebookLM', status: 'available', liveCapture: true, detail: 'Durable research and artifacts' },
  { id: 'whatsapp', title: 'WhatsApp', status: 'available', liveCapture: true, detail: 'Consent-gated unread intelligence' },
  { id: 'linkedin', title: 'LinkedIn', status: 'available', liveCapture: true, detail: 'Community and opportunity scans' },
  { id: 'reddit', title: 'Reddit', status: 'not_connected', liveCapture: false, detail: 'Connector contract and fixtures only' },
] as const
