import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { readSavedImage } from '../savedImages'
import { getProviderUsage, getAllProviderUsage, formatUsage } from '../providerUsage'

/**
 * Lets the agent SEE an image FlowDesk already saved, rather than only
 * holding a link to one.
 *
 * Without this, an image-generation turn ended with the agent describing
 * what it had ASKED for — the provider's reply carries only a
 * `flowdesk-image://…` reference, so a result that ignored half the prompt,
 * or came back malformed, was reported to the user as a success either way.
 *
 * Read-only and local: it opens a file this app itself downloaded, spends
 * nothing, and reaches no network, so it needs no approval prompt.
 */

/** Matches the cap in flowTools.ts — a single oversized attachment can blow the turn's context. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const IMAGE_TOOL_NAMES = [
  'mcp__workers__view_saved_image',
  'mcp__workers__get_provider_usage',
]

export function createImageTools() {
  return [
    tool(
      'view_saved_image',
      'View an image FlowDesk saved locally, so you can actually SEE it instead of only holding its link. ' +
      'Use this after any tool returns a flowdesk-image:// reference (for example an image generated through ask_chatgpt) ' +
      'whenever what the image actually shows matters — before describing it to the user, or before deciding whether to regenerate it. ' +
      'Accepts the flowdesk-image:// URL, the whole markdown ![alt](flowdesk-image://...) link, or just the file name.',
      {
        image: z.string().describe('A flowdesk-image:// URL, the markdown image link containing one, or the saved file name.'),
      },
      async ({ image }) => {
        const found = await readSavedImage(image)
        if (!found.ok || !found.bytes || !found.mimeType) {
          return { content: [{ type: 'text' as const, text: `Could not open that image: ${found.error}` }], isError: true }
        }
        if (found.bytes.length > MAX_IMAGE_BYTES) {
          return {
            content: [{
              type: 'text' as const,
              text: `"${found.fileName}" is ${(found.bytes.length / 1024 / 1024).toFixed(1)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit for attaching an image to a tool result. It is saved and usable, just too large to view here.`,
            }],
            isError: true,
          }
        }
        return {
          content: [
            { type: 'text' as const, text: `${found.fileName} (${found.mimeType}, ${found.bytes.length} bytes)` },
            { type: 'image' as const, data: found.bytes.toString('base64'), mimeType: found.mimeType },
          ],
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'get_provider_usage',
      'Check how much quota is left on the signed-in account for a browser provider (ChatGPT, Claude, Gemini, Grok, Perplexity) - for example how many image generations remain and when the limit resets. ' +
      'Use this BEFORE starting expensive work on a provider, and when a provider refuses a request, to tell whether the account is out of quota or something else went wrong. ' +
      'Reports only what that provider volunteered during a call made in THIS session: if a provider has not been used yet, there is nothing to report and you should say so rather than assuming the quota is fine.',
      {
        provider: z.string().optional().describe("Which provider to check, e.g. 'chatgpt'. Omit to report every provider used so far this session."),
      },
      async ({ provider }) => {
        if (provider) {
          const key = provider.trim().toLowerCase()
          const snapshot = getProviderUsage(key)
          if (!snapshot) {
            return {
              content: [{
                type: 'text' as const,
                text: `No usage information for "${key}" yet. Providers only report their limits while answering, so this stays empty until ${key} has been used at least once in this session. This is NOT a sign the account is out of quota.`,
              }],
            }
          }
          return { content: [{ type: 'text' as const, text: formatUsage(snapshot) }] }
        }

        const all = getAllProviderUsage()
        if (all.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No provider has reported usage yet in this session. Limits are only learned while a provider answers, so nothing here means "not measured yet", not "no quota left".',
            }],
          }
        }
        return { content: [{ type: 'text' as const, text: all.map(s => formatUsage(s)).join('\n\n') }] }
      },
      { annotations: { readOnlyHint: true } }
    ),
  ]
}
