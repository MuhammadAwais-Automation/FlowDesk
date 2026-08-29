import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))

const { liLikePost, __testing } = await import('./linkedinUiActions')
const { permalinkFor, READY_SCRIPT, clickScript, FIND_BUTTON_FN } = __testing

/**
 * These scripts run inside LinkedIn's page and drive a real, irreversible,
 * outward-facing action. The properties pinned here are the ones whose failure
 * would not be loud: liking the wrong thing, removing a reaction the user
 * meant to keep, or reporting success from an optimistic UI update the server
 * later rejected.
 */

describe('addressing the post', () => {
  it('builds the permalink from the id, which is what removes the ambiguity', () => {
    // Only 2 of 28 rendered feed posts carry an activity id in their DOM, so a
    // post cannot be reliably matched on screen. Addressing the page by id is
    // the whole reason this route navigates at all.
    expect(permalinkFor('7496815490305171457'))
      .toBe('https://www.linkedin.com/feed/update/urn:li:activity:7496815490305171457/')
  })

  it('refuses a non-numeric id rather than navigating somewhere unintended', async () => {
    for (const bad of ['urn:li:activity:123', 'https://linkedin.com/x', '', '12a']) {
      const out = await liLikePost(bad)
      expect(out.ok).toBe(false)
      expect(String(out.error)).toContain('must be the numeric id')
    }
  })

  it('reports LinkedIn not being open as a normal result, not a throw', async () => {
    const out = await liLikePost('123')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('LinkedIn is not open')
  })
})

describe('picking the right control', () => {
  /**
   * A stand-in for the two DOM features the finder uses: querySelectorAll and
   * getAttribute. No DOM library is installed, and the finder no longer walks
   * the tree at all — the permalink page separates the post's control from its
   * comments' controls in the aria-label itself, so there is nothing to walk.
   */
  interface FakeNode {
    getAttribute(name: string): string | null
  }

  function button(label: string): FakeNode {
    return { getAttribute: (name: string) => (name === 'aria-label' ? label : null) }
  }

  function findButton(buttons: FakeNode[]) {
    const fakeDocument = { body: {}, querySelectorAll: () => buttons }
    const fn = new Function('document', `${FIND_BUTTON_FN}
return mainReactionButton()`)
    return fn(fakeDocument) as FakeNode | null
  }

  function labelOf(n: FakeNode | null) {
    return n ? n.getAttribute('aria-label') : null
  }

  it('ignores reaction controls that belong to comments', () => {
    // Verified wording from the live permalink page (probe li-24): a comment's
    // control names its author, the post's does not. Taking "the first one"
    // would react to a stranger's comment.
    expect(labelOf(findButton([
      button('React Like to Ralph Kleinschmidt\u2019s comment'),
      button('React Like'),
    ]))).toBe('React Like')
  })

  it('ignores reaction counts, which are labelled but are not controls', () => {
    // "32 reactions" and "See 26 more reactions" are both buttons on that page.
    // Matching the word anywhere in the label would pick one of them.
    expect(findButton([button('32 reactions'), button('See 26 more reactions')])).toBeNull()
  })

  it('still finds the control once a reaction exists, so the result can be verified', () => {
    // LinkedIn rewords the label after reacting. Matching only the un-reacted
    // wording would lose the control at exactly the moment the outcome has to
    // be read back.
    expect(labelOf(findButton([button('Unreact Like')]))).toBe('Unreact Like')
  })

  it('returns null when every control belongs to a comment', () => {
    // Returning nothing is correct. Falling back to "the first one anyway"
    // would react to a stranger's comment.
    expect(findButton([button('React Like to Zahidul Haque\u2019s comment')])).toBeNull()
  })

  it('does not look for data-view-name, which the permalink page does not have', () => {
    // The bug this pins: reaction-button was read off /feed/ and pointed at
    // /feed/update/<id>/, where probe li-24 found it absent along with every
    // other tagged control. The tool then reported "the page did not render"
    // for a page that had returned 200 with 180KB.
    expect(FIND_BUTTON_FN).not.toContain('data-view-name')
    expect(FIND_BUTTON_FN).toContain('aria-label')
  })

  it('anchors on aria-label, not on class names', () => {
    // LinkedIn regenerates class names every deploy; aria-label describes
    // purpose and survives.
    expect(FIND_BUTTON_FN).not.toMatch(/class(Name)?\s*[=.]/)
  })
})

describe('the scripts are valid and self-contained', () => {
  it.each([
    ['READY_SCRIPT', READY_SCRIPT],
    ['clickScript', clickScript()],
  ])('%s is syntactically valid JavaScript', (_name, script) => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('the click script converts failure into a result rather than throwing', () => {
    expect(clickScript()).toContain('return { ok: false, error:')
  })
})

describe('refusing to do the opposite of what was asked', () => {
  it('stops when clicking would remove a reaction rather than add one', () => {
    const script = clickScript()
    expect(script).toContain('alreadyReacted: true')
    expect(script).toContain('nothing was done')
  })

  it('acts only on a label that plainly offers to add a reaction', () => {
    // Anchored to the start of the label, so an unrecognised state stops the
    // action instead of being guessed through. Refusing on an unknown label is
    // the safe direction: the failure mode on the other side is silently
    // removing a reaction the user meant to keep.
    expect(clickScript()).toContain('addsReaction(before)')
    expect(FIND_BUTTON_FN).toContain('/^react /i')
  })
})

describe('not reporting success from an optimistic update', () => {
  it('waits before reading the final state', () => {
    // React flips the control before the server answers. Reading immediately
    // would report every click as a success, including rejected ones.
    expect(clickScript()).toContain('setTimeout(r, 3000)')
  })

  it('re-queries the control instead of re-reading a possibly stale node', () => {
    // React can replace the node when the label changes, and a detached node
    // keeps its old attributes — which would report success for a click that
    // achieved nothing.
    expect(clickScript()).toContain('var afterButton = mainReactionButton()')
  })

  it('treats a control that still offers to react as a failure, and says so', () => {
    const script = clickScript()
    expect(script).toContain('which means the reaction did not stick')
    expect(script).toContain('ok: !stillAdds')
  })
})
