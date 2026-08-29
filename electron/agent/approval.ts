/**
 * Shared approval contract for anything the lead agent (Claude or Codex)
 * wants to do that is worth asking the user about first.
 *
 * Deliberately its own file with no dependencies: leadAgent.ts,
 * codexLeadAgent.ts, tools.ts, whatsappTools.ts, and main.ts all need this
 * shape, and none of them should have to import each other just to agree on
 * what an approval request looks like.
 *
 * One mechanism serves two different call sites:
 *  - Claude's own canUseTool callback, for its built-in tools (Bash, Write,
 *    Edit, ...) — the SDK calls this before every tool use.
 *  - FlowDesk's own MCP tools (project_write_file, project_run_command,
 *    whatsapp_send_message, whatsapp_delete_message) call it directly from
 *    inside their handlers, because Codex's SDK exposes no equivalent
 *    per-call hook (confirmed against its type definitions: ApprovalMode is
 *    a static policy string set once at thread start, with no callback to
 *    answer an in-flight request) — so those tools are the only place a real
 *    per-action approval can happen when Codex is the provider.
 */
export interface ApprovalRequestInfo {
  /** The tool name as the model sees it, e.g. "Bash" or "whatsapp_send_message". */
  tool: string
  /** Short human sentence describing what is about to happen. */
  title: string
  /** Optional longer detail — a command line, a file path, a message body. */
  detail?: string
  /** The tool's raw input, for a UI that wants to render it structured. */
  input?: Record<string, unknown>
}

export type RequestApproval = (info: ApprovalRequestInfo) => Promise<boolean>

/** Used when no approval gate applies at all (e.g. bypass mode is on). */
export const alwaysApprove: RequestApproval = async () => true
