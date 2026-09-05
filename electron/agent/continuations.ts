interface ContinuationItem {
  id: string
  jobId: string
  sessionId: string
}

interface CompletedJob {
  id: string
  recipeId: string
  status: string
  result: Record<string, unknown> | null
}

export function groupContinuations(items: ContinuationItem[]) {
  const groups = new Map<string, ContinuationItem[]>()
  for (const item of items) groups.set(item.sessionId, [...(groups.get(item.sessionId) ?? []), item])
  return [...groups.entries()].map(([sessionId, grouped]) => ({ sessionId, items: grouped }))
}

function compactManifest(job: CompletedJob) {
  const result = job.result ?? {}
  return {
    jobId: job.id,
    recipeId: job.recipeId,
    status: job.status,
    recordCount: result.recordCount,
    coverage: result.coverage,
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 10) : undefined,
    failures: Array.isArray(result.failures) ? result.failures.slice(0, 10) : undefined,
    artifactRefs: Array.isArray(result.artifactRefs) ? result.artifactRefs.slice(0, 20) : undefined,
  }
}

export function buildContinuationPrompt(sessionId: string, jobs: CompletedJob[]) {
  const manifests = jobs.map(compactManifest)
  const serialized = JSON.stringify(manifests, null, 2).slice(0, 1_500)
  return [
    'FlowDesk Brain background research is ready. Resume the existing user goal without repeating prior work.',
    `Session: ${sessionId}`,
    'Only compact manifests are included. Use cited artifact handles for drill-down when needed.',
    serialized,
  ].join('\n')
}
