export interface ParsedPayload {
  isJson: boolean
  data?: unknown
  rawText: string
  kind:
    | 'notebooks'
    | 'sources'
    | 'artifacts'
    | 'job'
    | 'whatsapp_chats'
    | 'whatsapp_messages'
    | 'project_files'
    | 'command_result'
    | 'generic_json'
    | 'plain_text'
}

export function parsePayload(text?: string): ParsedPayload {
  if (!text || typeof text !== 'string') {
    return { isJson: false, rawText: '', kind: 'plain_text' }
  }

  const trimmed = text.trim()
  if (
    (!trimmed.startsWith('{') && !trimmed.startsWith('[')) ||
    (!trimmed.endsWith('}') && !trimmed.endsWith(']'))
  ) {
    return { isJson: false, rawText: text, kind: 'plain_text' }
  }

  try {
    const data = JSON.parse(trimmed)
    const inner = (data && typeof data === 'object' && 'data' in data) ? (data as Record<string, unknown>).data : data

    if (inner && typeof inner === 'object') {
      const obj = inner as Record<string, unknown>
      if (Array.isArray(obj.notebooks)) return { isJson: true, data, rawText: text, kind: 'notebooks' }
      if (Array.isArray(obj.sources)) return { isJson: true, data, rawText: text, kind: 'sources' }
      if (Array.isArray(obj.artifacts)) return { isJson: true, data, rawText: text, kind: 'artifacts' }
      if (Array.isArray(obj.chats)) return { isJson: true, data, rawText: text, kind: 'whatsapp_chats' }
      if (Array.isArray(obj.messages)) return { isJson: true, data, rawText: text, kind: 'whatsapp_messages' }
      if (Array.isArray(obj.files)) return { isJson: true, data, rawText: text, kind: 'project_files' }
      if ('exitCode' in obj || ('stdout' in obj && 'stderr' in obj)) return { isJson: true, data, rawText: text, kind: 'command_result' }
      if ('status' in obj && ('jobId' in obj || 'kind' in obj)) return { isJson: true, data, rawText: text, kind: 'job' }
    }

    if (Array.isArray(data)) {
      if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
        const first = data[0] as Record<string, unknown>
        if ('title' in first && 'id' in first) return { isJson: true, data, rawText: text, kind: 'notebooks' }
        if ('body' in first && 'from' in first) return { isJson: true, data, rawText: text, kind: 'whatsapp_messages' }
      }
    }

    return { isJson: true, data, rawText: text, kind: 'generic_json' }
  } catch {
    return { isJson: false, rawText: text, kind: 'plain_text' }
  }
}

export function getPayloadPreviewSummary(text?: string): { title: string; count?: number; badge?: string } {
  const parsed = parsePayload(text)
  if (!parsed.isJson || !parsed.data) {
    return { title: text ? text.slice(0, 100) : 'No output' }
  }

  const inner = (parsed.data && typeof parsed.data === 'object' && 'data' in parsed.data)
    ? (parsed.data as Record<string, unknown>).data
    : parsed.data

  if (inner && typeof inner === 'object') {
    const obj = inner as Record<string, unknown>
    if (Array.isArray(obj.notebooks)) {
      return { title: `${obj.notebooks.length} Notebooks Loaded`, count: obj.notebooks.length, badge: 'NotebookLM' }
    }
    if (Array.isArray(obj.sources)) {
      return { title: `${obj.sources.length} Sources Listed`, count: obj.sources.length, badge: 'Sources' }
    }
    if (Array.isArray(obj.artifacts)) {
      return { title: `${obj.artifacts.length} Artifacts in Library`, count: obj.artifacts.length, badge: 'Artifacts' }
    }
    if (Array.isArray(obj.chats)) {
      return { title: `${obj.chats.length} WhatsApp Chats`, count: obj.chats.length, badge: 'WhatsApp' }
    }
    if (Array.isArray(obj.messages)) {
      return { title: `${obj.messages.length} WhatsApp Messages`, count: obj.messages.length, badge: 'WhatsApp' }
    }
    if (Array.isArray(obj.files)) {
      return { title: `${obj.files.length} Project Files`, count: obj.files.length, badge: 'Project' }
    }
    if ('exitCode' in obj) {
      const code = Number(obj.exitCode)
      return { title: `Command Result (Exit Code ${code})`, badge: code === 0 ? 'Success' : 'Error' }
    }
    if ('status' in obj) {
      return { title: `Status: ${String(obj.status)}`, badge: 'Status' }
    }
  }

  if (Array.isArray(parsed.data)) {
    return { title: `${parsed.data.length} Items Returned`, count: parsed.data.length, badge: 'Array' }
  }

  const keys = Object.keys(parsed.data)
  return { title: `JSON Object (${keys.length} keys)`, badge: 'JSON' }
}

export function formatPayloadDate(dateStr?: string): string {
  if (!dateStr) return '\u2014'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}
