import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))

const {
  liCommentOnPost,
  OPEN_BOX_SCRIPT,
  FOCUS_EDITOR_SCRIPT,
  verifyAndSubmitScript,
  INSIDE_COMMENT_FN,
  FIND_EDITOR_FN,
  MAX_COMMENT_LENGTH,
} = await import('./linkedinComment')

/**
 * A comment is published, attributed, and visible immediately. The failures
 * worth pinning are the ones that would not be loud: replying to a stranger's
 * comment instead of the post, submitting text nobody approved, or reporting
 * success when the words only ever reached the screen.
 */

describe('input validation', () => {
  it('refuses anything that is not a numeric activity id', async () => {
    for (const bad of ['urn:li:activity:123', 'https://x', '', '12a']) {
      const out = await liCommentOnPost(bad, 'hello')
      expect(out.ok).toBe(false)
      expect(String(out.error)).toContain('must be the numeric id')
    }
  })

  it('refuses an empty comment', async () => {
    for (const blank of ['', '   ', '\n\t']) {
      const out = await liCommentOnPost('123', blank)
      expect(out.ok).toBe(false)
      expect(String(out.error)).toContain('empty comment')
    }
  })

  it('refuses a comment past the LinkedIn limit rather than letting it be truncated', async () => {
    const out = await liCommentOnPost('123', 'x'.repeat(MAX_COMMENT_LENGTH + 1))
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain(String(MAX_COMMENT_LENGTH))
  })

  it('reports LinkedIn not being open as a result rather than throwing', async () => {
    const out = await liCommentOnPost('123', 'hello')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('LinkedIn is not open')
  })
})

describe('commenting on the post, not on somebody else comment', () => {
  interface FakeNode {
    attrs: Record<string, string>
    parentElement: FakeNode | null
    getAttribute(name: string): string | null
  }

  function node(attrs: Record<string, string>, parent: FakeNode | null = null): FakeNode {
    return {
      attrs,
      parentElement: parent,
      getAttribute(name) { return name in attrs ? attrs[name] : null },
    }
  }

  function isInsideComment(target: FakeNode) {
    const body = node({})
    let n: FakeNode = target
    while (n.parentElement) n = n.parentElement
    n.parentElement = body
    const fn = new Function('document', `${INSIDE_COMMENT_FN}\nreturn insideAComment`)({ body })
    return fn(target) as boolean
  }

  it.each([
    ['a replaceableComment wrapper', { componentkey: 'replaceableComment_urn:li:comment:(x,y)' }],
    ['a comment-container', { 'data-view-name': 'comment-container' }],
    ['a comment-body', { 'data-view-name': 'comment-body' }],
  ])('treats a control under %s as belonging to a comment', (_name, wrapperAttrs) => {
    const wrapper = node(wrapperAttrs as Record<string, string>)
    expect(isInsideComment(node({ 'data-view-name': 'feed-comment-button' }, wrapper))).toBe(true)
  })

  it('does not treat the post subtree as a comment', () => {
    const wrapper = node({ 'data-view-name': 'feed-full-update' })
    expect(isInsideComment(node({ 'data-view-name': 'feed-comment-button' }, wrapper))).toBe(false)
  })

  it('skips comment-owned controls when opening the box and focusing it', () => {
    for (const script of [OPEN_BOX_SCRIPT, FOCUS_EDITOR_SCRIPT]) {
      expect(script).toContain('if (insideAComment(')
    }
  })
})

describe('submitting only what was approved', () => {
  const script = verifyAndSubmitScript('the approved words')

  it('compares the box against the approved text before clicking', () => {
    // Without this, anything that landed in the box — a stale draft, a partial
    // insertion — would be published as though the user had agreed to it.
    expect(script).toContain('the box holds different text than was approved')
    expect(script).toContain(JSON.stringify('the approved words'))
  })

  it('reports what was actually in the box when it disagrees', () => {
    expect(script).toContain('inBox:')
    expect(script).toContain('approved:')
  })

  it('escapes the approved text rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = verifyAndSubmitScript(nasty)
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('detecting text that never reached React', () => {
  it('treats a disabled submit as proof the insertion did not register', () => {
    // The contenteditable box has no value property. Assigning textContent
    // shows the words while React still believes the box is empty — and the
    // only visible symptom is a submit control that stays disabled.
    const script = verifyAndSubmitScript('x')
    expect(script).toContain('the text never registered with the page')
    expect(script).toContain('button.disabled === true')
  })
})

describe('finding the editor on either page', () => {
  /**
   * The bug this pins: the editor was required to be labelled "Text editor for
   * creating comment", which is the wording on /feed/. Probe li-26 read the
   * permalink page and found "Text editor for creating content" — so on the
   * page this tool actually navigates to, the editor was never recognised.
   */
  interface FakeNode {
    parentElement: FakeNode | null
    getAttribute(name: string): string | null
  }

  function node(attrs: Record<string, string>): FakeNode {
    return {
      parentElement: null,
      getAttribute(name: string) { return name in attrs ? attrs[name] : null },
    }
  }

  function isEditor(target: FakeNode) {
    const body = node({})
    target.parentElement = body
    const fn = new Function('document', `${FIND_EDITOR_FN}
return isCommentEditor`)({ body })
    return fn(target) as boolean
  }

  it.each([
    ['the feed wording', { 'aria-label': 'Text editor for creating comment' }],
    ['the permalink wording', { 'aria-label': 'Text editor for creating content' }],
    ['the placeholder alone', { 'data-placeholder': 'Add a comment\u2026' }],
  ])('recognises the comment box by %s', (_name, attrs) => {
    expect(isEditor(node(attrs as Record<string, string>))).toBe(true)
  })

  it('does not mistake an unrelated editor for the comment box', () => {
    expect(isEditor(node({ 'aria-label': 'Text editor for creating a post' }))).toBe(false)
  })

  it('does not open the box when one is already there', () => {
    // On a permalink the editor renders with nothing clicked, so the common
    // path clicks no control at all.
    expect(OPEN_BOX_SCRIPT).toContain('alreadyOpen: true')
  })
})

describe('telling the submit control from the one that opens the box', () => {
  const script = verifyAndSubmitScript('x')

  it('requires the submitting button to carry no aria-label', () => {
    // Both controls read "Comment". The action bar's has aria-label "Comment"
    // and merely opens the box; the submit has none (probe li-26). Matching on
    // the visible text alone would click the wrong one and post nothing while
    // reporting that it had.
    expect(script).toContain("(b.getAttribute('aria-label') || '').trim() !== ''")
    expect(script).toContain("=== 'Comment'")
  })

  it('waits for the submit control instead of reading the page once', () => {
    // The bug this pins, from a real run: the box was found and the text was
    // typed, then the submit was looked for immediately and was not there, so
    // the tool reported the anchor as wrong. The anchor was right — the control
    // does not exist while React considers the box empty, and li-26 only ever
    // saw it because it slept after typing.
    expect(script).toContain('submitDeadline')
    expect(script).toContain('never appeared')
  })

  it('reports the buttons around the box when the submit is missing', () => {
    // The tool restores the previous URL on its way out, so the page cannot be
    // inspected afterwards. A bare "not found" is a dead end; the surrounding
    // controls are what make the next attempt informed rather than another
    // guess.
    expect(script).toContain('buttonsNearTheBox')
    expect(script).toContain('textStillInBox')
  })

  it('no longer looks for data-view-name, which the permalink page lacks', () => {
    expect(script).not.toContain('data-view-name="comment-post"')
  })
})

describe('every script is valid and cannot throw across the boundary', () => {
  it.each([
    ['OPEN_BOX_SCRIPT', OPEN_BOX_SCRIPT],
    ['FOCUS_EDITOR_SCRIPT', FOCUS_EDITOR_SCRIPT],
    ['verifyAndSubmitScript', verifyAndSubmitScript('x')],
  ])('%s parses as JavaScript', (_name, script) => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('the submitting script converts failure into a result', () => {
    expect(verifyAndSubmitScript('x')).toContain('return { ok: false, error:')
  })
})
