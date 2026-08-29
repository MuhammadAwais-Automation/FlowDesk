export interface CatchUpTurn {
  role: 'user' | 'assistant'
  content: string
}

const DEFAULT_MAX_CHARACTERS_PER_TURN = 1500

function truncate(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text
  return `${text.slice(0, Math.max(0, maxCharacters - 12)).trimEnd()}\n...[truncated]`
}

/**
 * Text bringing one provider up to date on turns it never received.
 *
 * A session can move between providers, and each provider only holds the
 * turns it personally answered: after a morning on Claude and an afternoon
 * on Codex, Claude's own session has no idea the afternoon happened. The
 * watermark records how far each provider has been caught up, so a switch
 * back sends only the gap rather than the whole conversation again.
 *
 * Returns null when there is no gap, which is the normal case — the user
 * stayed on one provider, and that provider's own session already holds
 * everything.
 */
export function buildCatchUp(
  turns: CatchUpTurn[],
  syncedThroughTurn: number,
  maxCharactersPerTurn: number = DEFAULT_MAX_CHARACTERS_PER_TURN,
): string | null {
  const missing = turns.slice(Math.max(0, syncedThroughTurn))
  if (missing.length === 0) return null

  const body = missing
    .map(turn => `[${turn.role}]\n${truncate(turn.content, maxCharactersPerTurn)}`)
    .join('\n\n')

  return [
    'Context from this same conversation that you have not seen yet',
    '(it was handled by the other model while you were not active):',
    '',
    body,
    '',
    'Continue this conversation. The user\'s new message:',
  ].join('\n')
}
