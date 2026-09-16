import { describe, expect, it } from 'vitest'
import { markdownOutline } from './markdownOutline'

const NL = String.fromCharCode(10)

describe('markdownOutline', () => {
  it('returns one entry per heading, with its level', () => {
    expect(markdownOutline(['# Top', 'body', '## Sub', 'more', '### Deep'].join(NL))).toEqual([
      { level: 1, text: 'Top', line: 0 },
      { level: 2, text: 'Sub', line: 2 },
      { level: 3, text: 'Deep', line: 4 },
    ])
  })

  it('returns nothing for a body with no headings', () => {
    expect(markdownOutline(['just a paragraph', 'and another'].join(NL))).toEqual([])
  })

  it('ignores headings deeper than three levels', () => {
    expect(markdownOutline('#### Too deep')).toEqual([])
  })

  it('requires a space after the hashes', () => {
    expect(markdownOutline('#nothashtag')).toEqual([])
  })

  // Documented limitation: this parser is not fence-aware, unlike the database
  // sectioner in electron/brain/knowledge/sectioning.ts. A '#' comment inside a
  // fenced block appears in the outline. Asserted so it is a known cost rather
  // than a surprise; see the spec's "assumes rather than knows" section.
  it('does not skip fenced code blocks', () => {
    expect(markdownOutline(['```bash', '# not a heading', '```'].join(NL))).toEqual([
      { level: 1, text: 'not a heading', line: 1 },
    ])
  })
})
