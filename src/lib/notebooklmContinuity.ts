export interface DurableNotebookChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  state?: 'queued' | 'thinking' | 'streaming' | 'complete' | 'cancelled' | 'error'
  createdAt: string
  prompt?: string
  [key: string]: unknown
}

/** A local chat worker cannot survive a full app exit. Preserve any partial
 * answer, but make the terminal state honest and regenerable on restart. */
export function recoverInterruptedNotebookChat<T extends DurableNotebookChatMessage>(messages: T[]): T[] {
  return messages.map(message => message.role === 'assistant' && ['queued', 'thinking', 'streaming'].includes(message.state ?? '')
    ? {
        ...message,
        state: 'error',
        text: message.text || 'This answer was interrupted because FlowDesk closed. Regenerate to try again.',
      }
    : message) as T[]
}
