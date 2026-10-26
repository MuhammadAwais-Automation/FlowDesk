import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.' }, session: { fromPartition: () => ({}) } }))
vi.mock('../socialAccounts', () => ({
  SOCIAL_HOME: { whatsapp: 'https://web.whatsapp.com' },
  resolveSocialAccount: (_p: string, ref?: string | number | null) =>
    ref === undefined || ref === null || ref === '' || ref === '1'
      ? { platform: 'whatsapp', id: '1', label: 'Account 1', partition: 'social-whatsapp' }
      : null,
}))
vi.mock('../sessions', () => ({ ensureBackgroundView: async () => { throw new Error('no window in tests') } }))

const { mimetypeFor, shouldSendAsDocument, waSendFile, sendTimeoutMs, MAX_ATTACHMENT_BYTES, MAX_DOCUMENT_BYTES } = await import('./whatsapp')

/**
 * The two decisions here change what the recipient SEES, and both were settled
 * by sending real files to a real chat (probes wa-06 and wa-08) rather than
 * from documentation:
 *
 *   with no flags        the outward type resolved to "image" for an image
 *                        blob — WhatsApp even transcoded PNG to JPEG itself
 *   with asDocument      it resolved to "document" and kept the filename
 *
 * A photo delivered as a file attachment is a visibly wrong result, not a
 * cosmetic one, which is why the rule is pinned rather than left implicit.
 */

describe('deciding how a file is presented', () => {
  it.each([
    ['photo.jpg', 'image/jpeg'],
    ['photo.JPG', 'image/jpeg'],
    ['clip.mp4', 'video/mp4'],
    ['note.ogg', 'audio/ogg'],
    ['report.pdf', 'application/pdf'],
    ['data.csv', 'text/csv'],
  ])('reads the type of %s from its extension', (name, expected) => {
    expect(mimetypeFor(`C:/files/${name}`)).toBe(expected)
  })

  it('falls back to a generic type for an unknown extension', () => {
    // Which then sends as a document — the outcome that cannot be wrong.
    expect(mimetypeFor('C:/files/thing.qqq')).toBe('application/octet-stream')
    expect(shouldSendAsDocument(mimetypeFor('C:/files/thing.qqq'))).toBe(true)
  })

  it.each([
    ['image/jpeg', false],
    ['video/mp4', false],
    ['audio/ogg', false],
  ])('sends %s inline as media by default', (mimetype, expected) => {
    expect(shouldSendAsDocument(mimetype)).toBe(expected)
  })

  it.each([
    ['application/pdf'],
    ['application/zip'],
    ['text/plain'],
  ])('always sends %s as a document', mimetype => {
    expect(shouldSendAsDocument(mimetype)).toBe(true)
  })

  it('lets a caller force a photo to travel as a file', () => {
    // Real use: sending an image so it keeps its original quality and filename
    // instead of being re-encoded.
    expect(shouldSendAsDocument('image/jpeg', true)).toBe(true)
  })

  it('ignores asDocument=false for something that cannot be rendered inline', () => {
    // There is no meaning to asking WhatsApp to render a .zip as a photo, so
    // the flag only ever forces one direction.
    expect(shouldSendAsDocument('application/zip', false)).toBe(true)
  })
})

describe('failing before anything is sent', () => {
  it('reports WhatsApp not being open as a result rather than throwing', async () => {
    const out = await waSendFile('123@lid', 'C:/files/whatever.pdf')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('WhatsApp is not open')
  })

  it('states a size limit a caller can act on', () => {
    // Every byte crosses into the page as base64 inside an evaluated script.
    // Without a stated ceiling, an oversized file becomes a hung renderer with
    // no explanation instead of a refusal with a number in it.
    expect(MAX_ATTACHMENT_BYTES).toBeGreaterThan(0)
  })
})

describe('large files as documents', () => {
  it('lets a document be far larger than inline media', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(1024 * 1024 * 1024)
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(MAX_ATTACHMENT_BYTES)
  })
  it('gives the send time in line with the size, within 30 minutes', () => {
    expect(sendTimeoutMs(1)).toBe(62_000)
    expect(sendTimeoutMs(200 * 1024 * 1024)).toBe(60_000 + 400_000)
    expect(sendTimeoutMs(MAX_DOCUMENT_BYTES)).toBe(30 * 60_000)
  })
})
