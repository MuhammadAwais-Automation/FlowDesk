import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getProfileScript,
  updateProfileIntroScript,
  updateProfileAboutScript,
  uploadPhotoScript,
  uploadCoverScript,
  liUpdateProfile,
  liUploadProfilePhoto,
  liUploadCoverImage,
  profileUpdateFields,
} from './linkedinProfile'
import { call, getLinkedInView } from './linkedin'

vi.mock('./linkedin', () => ({
  call: vi.fn(),
  getLinkedInView: vi.fn(),
  linkedInAccountError: (account?: string) =>
    account && !['1', '2'].includes(account) ? `unknown linkedin account "${account}"` : null,
}))

describe('LinkedIn Profile Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getProfileScript', () => {
    it('generates a valid async script with selfUrn and voyager endpoints', () => {
      const script = getProfileScript()
      expect(script).toContain('selfUrn')
      expect(script).toContain('/voyager/api/identity/dash/profiles')
      expect(script).toContain('application/vnd.linkedin.normalized+json+2.1')
      expect(script).toContain('voyagerOnboardingDashMemberHandles')
      expect(script).toContain('profileContactInfo')
      expect(script).toContain('publicIdentifier')
      expect(script).toContain('education')
      expect(script).toContain('experience')
      expect(script).toContain('profilePicture')
      expect(script).toContain('backgroundPicture')
    })
  })

  describe('updateProfileIntroScript', () => {
    it('generates an intro update script with specified fields', () => {
      const script = updateProfileIntroScript({
        firstName: 'Jane',
        lastName: 'Doe',
        headline: 'VP of Engineering',
        location: 'San Francisco, CA',
      })
      expect(script).toContain('"firstName":"Jane"')
      expect(script).toContain('"lastName":"Doe"')
      expect(script).toContain('"headline":"VP of Engineering"')
      expect(script).toContain('"location":"San Francisco, CA"')
      expect(script).toContain('tiptap.ProseMirror')
      expect(script).toContain('Save')
    })

    it('generates a script handling partial fields safely', () => {
      const script = updateProfileIntroScript({ headline: 'Solo Founder' })
      expect(script).toContain('"headline":"Solo Founder"')
      expect(script).toContain('tiptap.ProseMirror')
    })
  })

  describe('updateProfileAboutScript', () => {
    it('generates an about section update script targeting textarea', () => {
      const script = updateProfileAboutScript('Passionate builder of AI-first desktop applications.')
      expect(script).toContain('Passionate builder of AI-first desktop applications.')
      expect(script).toContain('textarea')
      expect(script).toContain('Save')
    })
  })

  describe('uploadPhotoScript', () => {
    it('generates avatar injection script using DataTransfer and File API', () => {
      const script = uploadPhotoScript('iVBORw0KGgoAAAANSUhEUg==', 'image/png', 'avatar.png')
      expect(script).toContain('DataTransfer')
      expect(script).toContain('File([blob]')
      expect(script).toContain('iVBORw0KGgoAAAANSUhEUg==')
      expect(script).toContain('image/png')
      expect(script).toContain('avatar.png')
      expect(script).toContain('save photo')
    })
  })

  describe('uploadCoverScript', () => {
    it('generates cover banner injection script targeting background image trigger', () => {
      const script = uploadCoverScript('AQIDBAU=', 'image/jpeg', 'banner.jpg')
      expect(script).toContain('DataTransfer')
      expect(script).toContain('background image')
      expect(script).toContain('AQIDBAU=')
      expect(script).toContain('image/jpeg')
      expect(script).toContain('banner.jpg')
      expect(script).toContain('apply')
    })
  })

  describe('Input validation', () => {
    it('liUpdateProfile rejects empty update payload without invoking browser', async () => {
      const res = await liUpdateProfile({})
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/no profile fields/i)
    })

    it('liUploadProfilePhoto rejects non-existent file path immediately', async () => {
      const res = await liUploadProfilePhoto('/non/existent/path/avatar.png')
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/image file not found/i)
    })

    it('liUploadCoverImage rejects non-existent file path immediately', async () => {
      const res = await liUploadCoverImage('/non/existent/path/cover.jpg')
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/image file not found/i)
    })
  })

  describe('account routing and write guards', () => {
    it('an update whose fields are all undefined is refused without touching the page', async () => {
      const res = await liUpdateProfile({ firstName: undefined, lastName: undefined, headline: undefined, location: undefined, summary: undefined })
      expect(res).toEqual({ ok: false, error: 'No profile fields specified to update' })
      expect(call).not.toHaveBeenCalled()
    })

    it('blank intro fields are dropped, set ones are trimmed and kept', () => {
      expect(profileUpdateFields({ headline: '  Builder ', firstName: '   ', summary: '' })).toEqual({ headline: 'Builder', summary: '' })
    })

    it.each([
      ['update', () => liUpdateProfile({ headline: 'x' }, 'ghost')],
      ['photo', () => liUploadProfilePhoto('/non/existent.png', 'ghost')],
      ['cover', () => liUploadCoverImage('/non/existent.png', 'ghost')],
    ])('%s refuses an unknown account before reading files or opening a page', async (_name, run) => {
      const res = await run()
      expect(res).toEqual({ ok: false, error: 'unknown linkedin account "ghost"' })
      expect(call).not.toHaveBeenCalled()
      expect(getLinkedInView).not.toHaveBeenCalled()
    })
  })
})
