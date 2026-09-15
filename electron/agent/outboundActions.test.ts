import { describe, expect, it } from 'vitest'
import { extractOutboundActions } from './outboundActions'

describe('extractOutboundActions', () => {
  it('keeps actions that changed something outside FlowDesk', () => {
    expect(extractOutboundActions([
      { tool: 'whatsapp', name: 'mcp__workers__whatsapp_send_message', isError: false },
    ])).toEqual([{ tool: 'mcp__workers__whatsapp_send_message', label: 'Sent a WhatsApp message', failed: false }])
  })

  it('ignores reads, which the turn itself already implies', () => {
    expect(extractOutboundActions([
      { tool: 'whatsapp', name: 'mcp__workers__whatsapp_list_chats', isError: false },
      { tool: 'whatsapp', name: 'mcp__workers__whatsapp_unread', isError: false },
      { tool: 'mcp__workers__linkedin_feed', name: 'mcp__workers__linkedin_feed', isError: false },
      { tool: 'mcp__workers__brain_answer_pack', name: 'mcp__workers__brain_answer_pack', isError: false },
    ])).toEqual([])
  })

  it('keeps a failed attempt rather than quietly dropping it', () => {
    expect(extractOutboundActions([
      { tool: 'mcp__workers__linkedin_send_message', name: 'mcp__workers__linkedin_send_message', isError: true },
    ])).toEqual([{ tool: 'mcp__workers__linkedin_send_message', label: 'Sent a LinkedIn message', failed: true }])
  })

  it('cannot identify an action without the raw name, and says nothing rather than guessing', () => {
    // Every whatsapp_* call arrives with tool === 'whatsapp'; a missing `name`
    // must not be read as "some whatsapp action happened".
    expect(extractOutboundActions([{ tool: 'whatsapp', isError: false }])).toEqual([])
  })

  it('records every action in a turn, in order, including repeats', () => {
    expect(extractOutboundActions([
      { tool: 'whatsapp', name: 'mcp__workers__whatsapp_send_message', isError: false },
      { tool: 'mcp__workers__linkedin_create_post', name: 'mcp__workers__linkedin_create_post', isError: false },
      { tool: 'whatsapp', name: 'mcp__workers__whatsapp_send_message', isError: false },
    ]).map(action => action.label)).toEqual([
      'Sent a WhatsApp message', 'Published a LinkedIn post', 'Sent a WhatsApp message',
    ])
  })
})
