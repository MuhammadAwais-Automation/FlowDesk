import { z } from 'zod'

export const socialRecipeRequestSchema = z.object({
  recipeId: z.enum(['whatsapp.unread_intelligence', 'linkedin.community_scan', 'linkedin.opportunity_scan', 'reddit.lead_sniper']),
  scopeId: z.string().min(1),
  accountId: z.string().min(1).nullable().optional(),
  parameters: z.object({
    query: z.string().trim().max(500).optional(),
    subreddit: z.string().trim().max(100).optional(),
    sort: z.enum(['hot', 'new', 'top', 'rising']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    retentionDays: z.number().int().min(1).max(365).optional(),
    continuationSessionId: z.string().min(1).optional(),
    // Present when a monitor scheduled this run; windowStart is what makes each
    // scheduled run its own job instead of deduplicating into the previous one.
    monitorId: z.string().min(1).optional(),
    windowStart: z.iso.datetime().optional(),
    mode: z.enum(['interactive', 'background', 'actionable_only']).optional(),
  }).strict(),
}).strict()

export type SocialRecipeRequest = z.infer<typeof socialRecipeRequestSchema>

export function recordsFromConnectorResult(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  for (const key of ['messages', 'chats', 'posts', 'results', 'elements', 'items', 'data']) {
    const collection = record[key]
    if (Array.isArray(collection)) {
      return collection.filter(item => item && typeof item === 'object').slice(0, 5000) as Array<Record<string, unknown>>
    }
  }
  // linkedin.search answers `{ clusters: [{ group, items: [...] }] }` — a
  // shape none of the flat keys above match, so every search result was
  // collapsing into a single opaque record with no text/url a recipe could
  // read. Flatten every cluster's items and fold each item's separate title/
  // subtitle/detail/summary fields into one `text` field so the normalize
  // step's existing field lookup (['text', 'body', 'lastMessage', 'title'])
  // finds real content, and its `url`/`externalId` lookups find the item's
  // own navigationUrl/trackingUrn rather than the whole search response's.
  const clusters = record.clusters
  if (Array.isArray(clusters)) {
    const items = clusters
      .filter((cluster): cluster is Record<string, unknown> => !!cluster && typeof cluster === 'object')
      .flatMap(cluster => (Array.isArray(cluster.items) ? cluster.items : []))
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    return items.slice(0, 5000).map(item => ({
      text: [item.title, item.subtitle, item.detail, item.summary].filter(part => typeof part === 'string' && part.length > 0).join(' — '),
      url: item.url ?? null,
      urn: item.urn ?? null,
    }))
  }
  return [record]
}
