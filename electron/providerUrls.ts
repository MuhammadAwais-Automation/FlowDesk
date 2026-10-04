/** Shared provider → URL map — used by Universal Chat and the Agent
 *  orchestrator's browser worker queue, so the two never drift apart. */
export const PROVIDER_URLS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com',
  grok: 'https://grok.com',
  perplexity: 'https://www.perplexity.ai',
  deepseek: 'https://chat.deepseek.com',
}
