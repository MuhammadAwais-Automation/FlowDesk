import { z } from 'zod'

export const socialRecipeRequestSchema = z.object({
  recipeId: z.enum(['whatsapp.unread_intelligence', 'linkedin.community_scan', 'linkedin.opportunity_scan']),
  scopeId: z.string().min(1),
  accountId: z.string().min(1).nullable().optional(),
  parameters: z.object({
    query: z.string().trim().max(500).optional(),
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
  return [record]
}
