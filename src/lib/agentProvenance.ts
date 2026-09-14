/**
 * Part 3: "knowledge where the work happens" — a compact answer to "which
 * documents did the agent actually read for this reply", derived entirely
 * from data already persisted on the turn (AgentToolCallEntry), so this adds
 * no new backend field or migration.
 *
 * Only `brain_read_document` counts as "read" — `brain_search_documents`
 * only searched, it didn't necessarily pull content into the reply. The
 * path is parsed out of the tool's own result text (`readBrainDocument` in
 * electron/agent/brainNavigation.ts formats every successful read as
 * `"{title} ({type})\nPath: {path}\n\n{body}"`), since the recorded `prompt`
 * field only ever carries a `{prompt}` input key (leadAgent.ts) and is empty
 * for path/query-shaped tool inputs like this one.
 */

const READ_DOCUMENT_TOOL = 'mcp__workers__brain_read_document'
const PATH_LINE = /^Path: (.+)$/m

export function extractReadDocumentPaths(toolCalls: ReadonlyArray<{ tool: string; result: string; isError: boolean }>): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const call of toolCalls) {
    if (call.tool !== READ_DOCUMENT_TOOL || call.isError) continue
    const match = PATH_LINE.exec(call.result)
    if (!match) continue
    const path = match[1]
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}
