/**
 * Text extraction from a Gemini web app StreamGenerate response body.
 *
 * Confirmed via a live capture (see FD_CAPTURE_DEBUG) — this is Google's
 * classic "batchexecute" framing, NOT an SSE-style delta stream:
 *   )]}'
 *
 *   <byte-length>
 *   [["wrb.fr", null, "<json-encoded-string>"]]
 *   <byte-length>
 *   ...
 * The byte-length prefixes are ignored here rather than used to slice the
 * buffer — they're UTF-8 byte counts, but the buffer we hold is a decoded
 * JS (UTF-16) string, so slicing by that count would misalign on any
 * non-ASCII response (which is most of them, given Roman Urdu/emoji use).
 * Scanning line-by-line for whatever parses as JSON sidesteps that.
 *
 * Each "wrb.fr" entry's 3rd element is itself a JSON string (double-encoded)
 * that decodes to:
 *   [null, [convId, responseId], null, null,
 *     [ [candidateId, ["response text"], ...], [countryContext, ...] ],
 *     null, 2]
 * Unlike ChatGPT/Claude, Gemini resends the FULL candidate text with each
 * update rather than incremental deltas — so the latest non-empty extraction
 * replaces the running text rather than appending to it.
 */
export function extractLatestGeminiText(raw: string): string | null {
  let latest: string | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '[') continue

    let outer: unknown
    try {
      outer = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!Array.isArray(outer)) continue

    for (const entry of outer) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr') continue
      const inner = entry[2]
      if (typeof inner !== 'string') continue

      let payload: unknown
      try {
        payload = JSON.parse(inner)
      } catch {
        continue
      }

      const text = extractCandidateText(payload)
      if (text) latest = text
    }
  }

  return latest
}

export interface GeminiTurnMeta {
  conversationId?: string
  responseId?: string
  candidateId?: string
  model?: string
  detectedCountry?: string
}

/**
 * Pulls conversation/response/candidate IDs, the model display name (e.g.
 * "3.6 Flash"), and a device-based country guess out of the same "wrb.fr"
 * payload extractCandidateText reads — confirmed via a live capture, but
 * unlike ChatGPT/Claude these fields aren't named keys in a JSON object,
 * they're bare positions in a long array with many unused `null` slots (this
 * is Google's undocumented internal batchexecute wire format, not a public
 * API), so the indices below could shift on Google's end without warning.
 * Each read is guarded by a type/shape check so a shifted index just yields
 * `undefined` for that field instead of picking up garbage.
 */
function extractTurnMeta(payload: unknown): GeminiTurnMeta | null {
  if (!Array.isArray(payload)) return null
  const meta: GeminiTurnMeta = {}

  const ids = payload[1]
  if (Array.isArray(ids)) {
    if (typeof ids[0] === 'string') meta.conversationId = ids[0]
    if (typeof ids[1] === 'string') meta.responseId = ids[1]
  }

  const candidates = payload[4]
  if (Array.isArray(candidates) && Array.isArray(candidates[0]) && typeof candidates[0][0] === 'string') {
    meta.candidateId = candidates[0][0]
  }

  // [countryName, "SWML_DESCRIPTION_FROM_YOUR_DEVICE", ...] — the marker
  // string is the anchor that confirms index 5 really is this field.
  const location = payload[5]
  if (Array.isArray(location) && location[1] === 'SWML_DESCRIPTION_FROM_YOUR_DEVICE' && typeof location[0] === 'string') {
    meta.detectedCountry = location[0]
  }

  // Model display name is immediately followed by a lone `true` in every
  // capture seen so far — used as a cheap sanity check against index drift.
  if (typeof payload[42] === 'string' && payload[43] === true) {
    meta.model = payload[42] as string
  }

  return Object.keys(meta).length > 0 ? meta : null
}

/** Same line/JSON scanning as extractLatestGeminiText, but for turn metadata — later entries' fields win when the same key appears more than once across the buffer. */
export function extractTurnMetaFromRaw(raw: string): GeminiTurnMeta | null {
  let merged: GeminiTurnMeta | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '[') continue

    let outer: unknown
    try {
      outer = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!Array.isArray(outer)) continue

    for (const entry of outer) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr') continue
      const inner = entry[2]
      if (typeof inner !== 'string') continue

      let payload: unknown
      try {
        payload = JSON.parse(inner)
      } catch {
        continue
      }

      const meta = extractTurnMeta(payload)
      if (meta) merged = { ...(merged ?? {}), ...meta }
    }
  }

  return merged
}

/**
 * Finds real, directly-loadable generated-image URLs in a "wrb.fr" payload.
 * Confirmed via a live capture: the candidate's text part carries a fake
 * placeholder like "http://googleusercontent.com/image_generation_content/449"
 * (Gemini's own web app swaps this for the real image internally — it is
 * NOT a loadable URL, note it's http:// not https:// and the domain has no
 * "lh3." subdomain), while the ACTUAL image lives many levels deeper in the
 * same candidate array as a "https://lh3.googleusercontent.com/gg-dl/..."
 * URL. Rather than hardcode the exact nesting (it's 6+ levels deep and
 * fragile), this just recursively scans every string in the candidate
 * subtree for that domain — simpler and more resilient to Google shifting
 * the exact array shape than an index-based reader would be.
 */
function collectImageUrls(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    if (/^https:\/\/lh3\.googleusercontent\.com\//.test(node)) out.push(node)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) collectImageUrls(item, out)
  }
}

export function extractImageUrlsFromRaw(raw: string): string[] {
  const urls: string[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '[') continue

    let outer: unknown
    try {
      outer = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!Array.isArray(outer)) continue

    for (const entry of outer) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr') continue
      const inner = entry[2]
      if (typeof inner !== 'string') continue

      let payload: unknown
      try {
        payload = JSON.parse(inner)
      } catch {
        continue
      }
      if (Array.isArray(payload)) collectImageUrls(payload[4], urls)
    }
  }

  // De-dupe — the same image URL can appear in more than one "wrb.fr" entry
  // as Gemini resends the full candidate on each update, same as text.
  return [...new Set(urls)]
}

function extractCandidateText(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null
  const candidates = payload[4]
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const firstCandidate = candidates[0]
  if (!Array.isArray(firstCandidate)) return null
  const parts = firstCandidate[1]
  if (!Array.isArray(parts) || typeof parts[0] !== 'string') return null
  return parts[0]
}
