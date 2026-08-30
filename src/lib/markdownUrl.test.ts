import { describe, expect, it } from 'vitest'
import { flowdeskUrlTransform } from './markdownUrl'

/**
 * react-markdown sanitizes every URL through defaultUrlTransform, whose
 * allowlist is /^(https?|ircs?|mailto|xmpp)$/i — anything else is rewritten to
 * an empty string. FlowDesk serves generated images over its OWN registered
 * protocols, so every generated image was being silently deleted before it
 * could render: the markdown was correct, the img renderer was correct, and
 * the src arrived as ''. Confirmed on a real run where the agent emitted
 * ![Cheerful Duck Mascot Badge](flowdesk-image://2a6500b4-....png) and the
 * user saw nothing at all.
 */
describe('flowdeskUrlTransform', () => {
  it('keeps flowdesk-image:// URLs, which the default transform would blank', () => {
    const url = 'flowdesk-image://2a6500b4-f888-463d-a173-b7b4c41b716c.png'
    expect(flowdeskUrlTransform(url)).toBe(url)
  })

  it('keeps studio-asset:// URLs, used by images copied into a Studio document', () => {
    const url = 'studio-asset://doc-1/cover.png'
    expect(flowdeskUrlTransform(url)).toBe(url)
  })

  it('still allows ordinary web URLs', () => {
    expect(flowdeskUrlTransform('https://example.com/a.png')).toBe('https://example.com/a.png')
  })

  it('still strips javascript: — widening the allowlist must not disable it', () => {
    expect(flowdeskUrlTransform('javascript:alert(1)')).toBe('')
  })

  it('still strips other unknown schemes', () => {
    expect(flowdeskUrlTransform('file:///etc/passwd')).toBe('')
  })

  it('does not match a scheme-like prefix appearing later in the URL', () => {
    expect(flowdeskUrlTransform('https://evil.test/x?u=flowdesk-image://y.png'))
      .toBe('https://evil.test/x?u=flowdesk-image://y.png')
  })
})
