import { describe, it, expect } from 'vitest'
import { isMailHost, isOAuthPopup } from './oauthRouting'

describe('isMailHost', () => {
  it('returns true for mail.google.com', () => {
    expect(isMailHost('https://mail.google.com/mail/u/0/#inbox')).toBe(true)
  })

  it('returns true for subdomain of mail.google.com', () => {
    expect(isMailHost('https://x.mail.google.com/')).toBe(true)
  })

  it('returns false for accounts.google.com', () => {
    expect(isMailHost('https://accounts.google.com/signin')).toBe(false)
  })

  it('returns false for non-Google host', () => {
    expect(isMailHost('https://claude.ai/login')).toBe(false)
  })

  it('returns false for malformed URL', () => {
    expect(isMailHost('not a url')).toBe(false)
  })
})

describe('isOAuthPopup', () => {
  it('returns true for accounts.google.com root', () => {
    expect(isOAuthPopup('https://accounts.google.com/o/oauth2/v2/auth?client_id=abc')).toBe(true)
  })

  it('returns true for accounts.google.com signin', () => {
    expect(isOAuthPopup('https://accounts.google.com/signin/oauth')).toBe(true)
  })

  it('returns true for github oauth login', () => {
    expect(isOAuthPopup('https://github.com/login/oauth/authorize?client_id=abc')).toBe(true)
  })

  it('returns false for chatgpt.com root', () => {
    expect(isOAuthPopup('https://chatgpt.com/')).toBe(false)
  })

  it('returns false for claude.ai/chat/123', () => {
    expect(isOAuthPopup('https://claude.ai/chat/123')).toBe(false)
  })

  it('returns false for github.com root', () => {
    expect(isOAuthPopup('https://github.com/')).toBe(false)
  })

  it('returns false for malformed URL', () => {
    expect(isOAuthPopup('not a url')).toBe(false)
  })
})
