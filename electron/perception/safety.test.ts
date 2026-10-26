import { describe, expect, it } from 'vitest'
import { confirmReason } from './safety'

describe('confirmReason', () => {
  it('asks before clicks that send, post, pay or delete', () => {
    for (const name of ['Send', 'Post', 'Pay now', 'Delete chat', 'Submit', 'Place order', 'Publish']) {
      expect(confirmReason({ action: 'click' }, { role: 'button', name })).toMatch(/confirm: true/)
    }
  })

  it('lets harmless clicks through', () => {
    for (const name of ['Search', 'Next', 'Open menu', 'Sender settings']) {
      expect(confirmReason({ action: 'click' }, { role: 'button', name })).toBeNull()
    }
    expect(confirmReason({ action: 'click' }, { role: 'heading', name: 'Delete' })).toBeNull()
  })

  it('asks before Enter or a newline in a text field, but not in search', () => {
    expect(confirmReason({ action: 'key', key: 'Enter' }, { role: 'textbox', name: 'Type a message' })).toMatch(/Enter/)
    expect(confirmReason({ action: 'key', key: 'Enter' })).toMatch(/Enter/)
    expect(confirmReason({ action: 'type', text: 'hi\n' }, { role: 'textbox', name: 'Message' })).toMatch(/Enter/)
    expect(confirmReason({ action: 'key', key: 'Enter' }, { role: 'searchbox', name: '' })).toBeNull()
    expect(confirmReason({ action: 'key', key: 'Enter' }, { role: 'combobox', name: 'Search Reddit' })).toBeNull()
    expect(confirmReason({ action: 'type', text: 'hi' }, { role: 'textbox', name: 'Message' })).toBeNull()
    expect(confirmReason({ action: 'key', key: 'Escape' })).toBeNull()
  })
})
