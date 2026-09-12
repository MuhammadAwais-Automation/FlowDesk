export const BRAIN_TABS = ['Overview', 'Ask Brain', 'Memories', 'Review Inbox', 'People & Organizations', 'Decisions & Goals', 'Opportunities', 'Timeline', 'Graph', 'Jobs', 'Vault', 'Settings'] as const
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

export const INTELLIGENCE_SOURCES = [
  { id: 'notebooklm', title: 'NotebookLM', status: 'available', liveCapture: true, detail: 'Durable research and artifacts' },
  { id: 'whatsapp', title: 'WhatsApp', status: 'available', liveCapture: true, detail: 'Consent-gated unread intelligence' },
  { id: 'linkedin', title: 'LinkedIn', status: 'available', liveCapture: true, detail: 'Community and opportunity scans' },
  { id: 'reddit', title: 'Reddit', status: 'not_connected', liveCapture: false, detail: 'Connector contract and fixtures only' },
] as const
