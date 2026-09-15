import { describe, expect, it } from 'vitest'
import { PREAMBLE_HEADING, splitSections } from './sectioning'

describe('splitSections', () => {
  it('returns nothing for an empty or whitespace-only body', () => {
    expect(splitSections('')).toEqual([])
    expect(splitSections('   \n\n  ')).toEqual([])
  })

  it('returns one section for a document with no headings', () => {
    const sections = splitSections('Yasir coordinates the cobalt launch.\nSecond line.')

    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({
      ordinal: 0,
      level: 0,
      heading: PREAMBLE_HEADING,
      headingPath: PREAMBLE_HEADING,
      startLine: 1,
      endLine: 2,
    })
  })

  it('keeps text before the first heading as a preamble section', () => {
    const sections = splitSections('Intro line.\n\n# Clients\nYasir Bhai.')

    expect(sections.map(section => section.heading)).toEqual([PREAMBLE_HEADING, 'Clients'])
    expect(sections[0].text).toBe('Intro line.')
    expect(sections[0].endLine).toBe(2)
    expect(sections[1].startLine).toBe(3)
  })

  it('builds the h1 > h2 > h3 chain and resets it when a shallower heading arrives', () => {
    const body = [
      '# FlowDesk',
      'Top.',
      '## Brain',
      'Middle.',
      '### Retrieval',
      'Deep.',
      '## Studio',
      'Sibling.',
      '# Codveon',
      'Another root.',
    ].join('\n')

    expect(splitSections(body).map(section => section.headingPath)).toEqual([
      'FlowDesk',
      'FlowDesk > Brain',
      'FlowDesk > Brain > Retrieval',
      'FlowDesk > Studio',
      'Codveon',
    ])
  })

  it('does not treat a comment inside a fenced code block as a heading', () => {
    const body = ['# Setup', 'Run it:', '```bash', '# install first', 'npm install', '```', 'Done.'].join('\n')
    const sections = splitSections(body)

    expect(sections).toHaveLength(1)
    expect(sections[0].heading).toBe('Setup')
    expect(sections[0].text).toContain('# install first')
  })

  it('leaves h4 and deeper inside their parent section', () => {
    const sections = splitSections('### Retrieval\nLadder.\n#### Rung one\nKeywords.')

    expect(sections).toHaveLength(1)
    expect(sections[0].text).toContain('#### Rung one')
  })

  it('drops a heading that has no content under it', () => {
    const sections = splitSections('# Empty\n\n# Real\nContent.')

    expect(sections.map(section => section.heading)).toEqual(['Real'])
    expect(sections[0].ordinal).toBe(0)
  })

  it('numbers sections consecutively and records inclusive line ranges', () => {
    const sections = splitSections('# One\nA.\n# Two\nB.')

    expect(sections.map(section => [section.ordinal, section.startLine, section.endLine]))
      .toEqual([[0, 1, 2], [1, 3, 4]])
  })
})
