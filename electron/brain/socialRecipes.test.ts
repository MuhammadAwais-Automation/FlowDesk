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

  it('flattens linkedin.search clusters into individual records with a real text and url', () => {
    // linkedin.search answers { clusters: [{ items: [...] }] }, which matches
    // none of the flat collection keys above — the whole response used to
    // collapse into a single opaque record, so every "Scan opportunities" run
    // produced one merged record with no per-result text or link back to the
    // actual post/profile.
    const searchResult = {
      ok: true,
      query: 'react developer',
      clusters: [
        {
          group: 'Posts',
          items: [
            { title: 'Looking for a React developer', subtitle: 'Jane Doe', detail: '2nd', summary: 'urgent contract role', urn: 'urn:li:fsd_profile:1', url: 'https://www.linkedin.com/in/jane' },
          ],
        },
        {
          group: 'Jobs',
          items: [
            { title: 'Senior React Engineer', subtitle: 'Acme Inc', detail: null, summary: null, urn: 'urn:li:job:2', url: 'https://www.linkedin.com/jobs/view/2' },
          ],
        },
      ],
    }

    const records = recordsFromConnectorResult(searchResult)

    expect(records).toHaveLength(2)
    expect(records[0].text).toBe('Looking for a React developer — Jane Doe — 2nd — urgent contract role')
    expect(records[0].url).toBe('https://www.linkedin.com/in/jane')
    expect(records[0].urn).toBe('urn:li:fsd_profile:1')
    expect(records[1].text).toBe('Senior React Engineer — Acme Inc')
    expect(records[1].url).toBe('https://www.linkedin.com/jobs/view/2')
  })

  it('bounds flattened cluster records to 5000 like every other connector shape', () => {
    const searchResult = { ok: true, clusters: [{ group: 'Posts', items: Array.from({ length: 6000 }, (_, id) => ({ title: `post ${id}`, urn: String(id), url: null })) }] }
    expect(recordsFromConnectorResult(searchResult)).toHaveLength(5000)
  })
})
