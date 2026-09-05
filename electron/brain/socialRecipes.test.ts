import { describe, expect, it } from 'vitest'
import { socialRecipeRequestSchema, recordsFromConnectorResult } from './socialRecipes'

describe('social recipe boundary', () => {
  it('allows only locked read recipes', () => {
    expect(socialRecipeRequestSchema.parse({ recipeId: 'whatsapp.unread_intelligence', scopeId: 'scope', accountId: 'a1', parameters: {} }).recipeId).toBe('whatsapp.unread_intelligence')
    expect(() => socialRecipeRequestSchema.parse({ recipeId: 'reddit.live_scrape', scopeId: 'scope', parameters: {} })).toThrow()
  })

  it('extracts bounded records from known connector collection keys', () => {
    expect(recordsFromConnectorResult({ ok: true, chats: [{ id: '1' }, { id: '2' }] })).toHaveLength(2)
    expect(recordsFromConnectorResult({ ok: true, posts: Array.from({ length: 6000 }, (_, id) => ({ id })) })).toHaveLength(5000)
  })
})
