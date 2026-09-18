import { describe, expect, it } from 'vitest'
import { buildPathIndex, extractWikiLinkTargets, extractWikiLinks, resolveWikiLink } from './wikilinks'

const VAULT = [
  'index.md',
  'wiki/me/profile.md',
  'wiki/me/positioning.md',
  'wiki/ai-tooling/index.md',
  'wiki/ai-tooling/tool-routing-map.md',
  'wiki/ai-tooling/agents/ai-workflow.md',
  'wiki/clients/yasir-bhai.md',
  'toolkits/nextjs/index.md',
]

describe('extractWikiLinkTargets', () => {
  it('keeps references and drops aliases, anchors and embeds', () => {
    const body = 'see [[me/profile|my profile]] and [[wiki/me/positioning#Stack]], not ![[diagram.png]]'
    expect(extractWikiLinkTargets(body)).toEqual(['me/profile', 'wiki/me/positioning#Stack'])
  })
})

describe('resolveWikiLink', () => {
  const index = buildPathIndex(VAULT)

  // The bug this file exists for: a vault writes `[[me/profile]]` for a file
  // that lives at `wiki/me/profile.md`, which is how Obsidian itself resolves.
  // Indexing only the full path, the path without its extension and the bare
  // filename left every such link unresolved -- 1,033 of 1,104 in the real
  // store -- and an unresolved link is an edge the graph never draws.
  it('resolves a partial path against any file ending in those segments', () => {
    expect(resolveWikiLink('me/profile', 'wiki/ai-tooling/agents/ai-workflow.md', index))
      .toBe('wiki/me/profile.md')
  })

  it('still resolves the forms that already worked', () => {
    expect(resolveWikiLink('wiki/me/profile.md', 'index.md', index)).toBe('wiki/me/profile.md')
    expect(resolveWikiLink('wiki/me/profile', 'index.md', index)).toBe('wiki/me/profile.md')
    expect(resolveWikiLink('yasir-bhai', 'index.md', index)).toBe('wiki/clients/yasir-bhai.md')
  })

  it('strips the anchor before matching', () => {
    expect(resolveWikiLink('me/positioning#Stack', 'index.md', index)).toBe('wiki/me/positioning.md')
  })

  it('refuses an ambiguous suffix rather than guessing', () => {
    // `index` matches three files, so it stays raw and shows up in Review.
    expect(resolveWikiLink('index', 'wiki/me/profile.md', index)).toBe('index')
    // One more segment makes it unique.
    expect(resolveWikiLink('ai-tooling/index', 'wiki/me/profile.md', index)).toBe('wiki/ai-tooling/index.md')
  })

  it('prefers a sibling over a same-named file elsewhere', () => {
    const siblings = buildPathIndex(['a/notes.md', 'b/notes.md'])
    expect(resolveWikiLink('notes', 'a/index.md', siblings)).toBe('a/notes.md')
  })

  it('leaves a target with no file as written', () => {
    expect(resolveWikiLink('does/not/exist', 'index.md', index)).toBe('does/not/exist')
  })
})

describe('extractWikiLinks', () => {
  it('resolves every target in a body', () => {
    const index = buildPathIndex(VAULT)
    const body = 'see [[me/profile]] and [[ai-tooling/tool-routing-map]] and [[nowhere]]'
    expect(extractWikiLinks(body, 'wiki/ai-tooling/agents/ai-workflow.md', index)).toEqual([
      'wiki/me/profile.md',
      'wiki/ai-tooling/tool-routing-map.md',
      'nowhere',
    ])
  })
})
