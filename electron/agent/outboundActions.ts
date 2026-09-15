/**
 * Which tool calls are worth a line in the activity timeline.
 *
 * Deliberately narrow: an action belongs here only if it changed something
 * outside FlowDesk. Reading a chat list or checking unread counts is already
 * implied by the turn itself, and logging all 36 worker tools would bury the
 * few entries a person actually wants to find later ("did I reply to Yasir?").
 *
 * One allowlist in one place, rather than an emit call added to 36 tool
 * handlers that would then drift apart.
 */

/** Raw MCP tool name → what to show. Anything absent is not timeline-worthy. */
const OUTBOUND_TOOLS: Record<string, string> = {
  mcp__workers__whatsapp_send_message: 'Sent a WhatsApp message',
  mcp__workers__whatsapp_send_file: 'Sent a file on WhatsApp',
  mcp__workers__whatsapp_delete_message: 'Deleted a WhatsApp message',
  mcp__workers__linkedin_send_message: 'Sent a LinkedIn message',
  mcp__workers__linkedin_create_post: 'Published a LinkedIn post',
  mcp__workers__linkedin_comment_on_post: 'Commented on a LinkedIn post',
  mcp__workers__linkedin_reply_to_comment: 'Replied to a LinkedIn comment',
  mcp__workers__linkedin_send_connection_request: 'Sent a LinkedIn connection request',
  mcp__workers__linkedin_delete_post: 'Deleted a LinkedIn post',
  mcp__workers__linkedin_delete_comment: 'Deleted a LinkedIn comment',
  mcp__workers__notebooklm_create_notebook: 'Created a NotebookLM notebook',
  mcp__workers__notebooklm_add_source: 'Added a source to NotebookLM',
  mcp__workers__generate_image: 'Generated an image',
}

export interface OutboundAction {
  tool: string
  label: string
  failed: boolean
}

export interface OutboundToolCall {
  tool: string
  /** Raw MCP name. Absent on older records and on providers that do not send it. */
  name?: string
  isError: boolean
}

/**
 * Failed attempts are kept. "Tried to message Yasir and it failed" is exactly
 * the kind of thing worth finding in yesterday's note, and dropping it would
 * make the timeline quietly optimistic.
 */
export function extractOutboundActions(toolCalls: ReadonlyArray<OutboundToolCall>): OutboundAction[] {
  const actions: OutboundAction[] = []
  for (const call of toolCalls) {
    // `tool` is a provider id for some providers (every whatsapp_* call arrives
    // as 'whatsapp'), so only the raw name can identify the action.
    const label = call.name === undefined ? undefined : OUTBOUND_TOOLS[call.name]
    if (label === undefined) continue
    actions.push({ tool: call.name as string, label, failed: call.isError })
  }
  return actions
}
