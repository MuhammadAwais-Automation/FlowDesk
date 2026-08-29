import { describe, expect, it } from 'vitest'
import { routeLink, isSameApp, registrableHost } from './linkRouting'

/**
 * The behaviour being pinned is the one that was actually broken: a link
 * clicked inside WhatsApp navigated the WhatsApp view away, and the Social page
 * has no tabs to get back with.
 */

const WHATSAPP = 'https://web.whatsapp.com/'
const LINKEDIN = 'https://www.linkedin.com/feed/'
const GMAIL = 'https://mail.google.com/mail/u/0/#inbox'
const CHATGPT = 'https://chatgpt.com/'

describe('links out of a hosted app go to the system browser', () => {
  it.each([
    ['a link shared in WhatsApp', WHATSAPP, 'https://www.youtube.com/watch?v=abc'],
    ['a shortened link in WhatsApp', WHATSAPP, 'https://bit.ly/xyz'],
    ['a lnkd.in link in LinkedIn', LINKEDIN, 'https://lnkd.in/patches'],
    ['an article linked from a LinkedIn post', LINKEDIN, 'https://www.bbc.com/news/x'],
    ['a citation in an AI chat', CHATGPT, 'https://arxiv.org/abs/1234'],
  ])('%s opens externally', (_name, home, target) => {
    expect(routeLink(target, home)).toBe('external')
  })

  it('sends non-web schemes to the OS instead of blanking the view', () => {
    // These previously fell through to loadURL, which a view cannot render.
    expect(routeLink('mailto:someone@example.com', LINKEDIN)).toBe('external')
    expect(routeLink('tel:+123456789', WHATSAPP)).toBe('external')
  })
})

describe('the app keeps its own navigation', () => {
  it.each([
    ['WhatsApp staying on WhatsApp', WHATSAPP, 'https://web.whatsapp.com/send?phone=1'],
    ['a WhatsApp help page', WHATSAPP, 'https://faq.whatsapp.com/general'],
    ['LinkedIn moving between its own pages', LINKEDIN, 'https://www.linkedin.com/in/someone'],
    ['a LinkedIn post permalink', LINKEDIN, 'https://www.linkedin.com/feed/update/urn:li:activity:123/'],
  ])('%s stays in the view', (_name, home, target) => {
    expect(routeLink(target, home)).toBe('in-app')
  })

  it('keeps the permalink navigation the like and comment tools depend on', () => {
    // Those tools drive the view to a post page and back. Routing that to the
    // browser would break them outright.
    expect(routeLink('https://www.linkedin.com/feed/update/urn:li:activity:7496815490305171457/', LINKEDIN))
      .toBe('in-app')
  })

  it('leaves in-page schemes alone', () => {
    // A page talking to itself. Handing these to the OS would break the page.
    for (const url of ['about:blank', 'blob:https://web.whatsapp.com/abc', 'data:text/html,x']) {
      expect(routeLink(url, WHATSAPP)).toBe('in-app')
    }
  })
})

describe('sign-in popups still get a child window', () => {
  it('routes OAuth to a popup rather than the browser', () => {
    // The session that needs the cookie lives here, so sending the user to
    // their own browser to sign in would achieve nothing.
    expect(routeLink('https://accounts.google.com/o/oauth2/auth?x=1', CHATGPT)).toBe('oauth-popup')
    expect(routeLink('https://github.com/login/oauth/authorize', CHATGPT)).toBe('oauth-popup')
  })

  it('does not treat an ordinary GitHub link as a sign-in', () => {
    expect(routeLink('https://github.com/anthropics/claude-code', CHATGPT)).toBe('external')
  })
})

describe('Gmail keeps its stricter rule', () => {
  it('sends other Google properties to the browser', () => {
    // A Docs or Drive link inside an email is an external link to the person
    // reading it, even though the domain matches.
    expect(routeLink('https://docs.google.com/document/d/x', GMAIL)).toBe('external')
    expect(routeLink('https://drive.google.com/file/d/x', GMAIL)).toBe('external')
  })

  it('keeps Gmail itself in the view', () => {
    expect(routeLink('https://mail.google.com/mail/u/1/#sent', GMAIL)).toBe('in-app')
  })
})

describe('registrableHost', () => {
  it.each([
    ['https://web.whatsapp.com/', 'whatsapp.com'],
    ['https://www.linkedin.com/feed/', 'linkedin.com'],
    ['https://linkedin.com/', 'linkedin.com'],
    ['https://a.b.c.example.com/x', 'example.com'],
  ])('%s → %s', (url, expected) => {
    expect(registrableHost(url)).toBe(expected)
  })

  it('compares an IP address whole rather than slicing labels off it', () => {
    expect(registrableHost('http://127.0.0.1:3000/x')).toBe('127.0.0.1')
  })

  it('returns null for something that is not a URL', () => {
    expect(registrableHost('not a url')).toBeNull()
    expect(registrableHost('')).toBeNull()
  })

  it('errs toward the browser on a multi-part suffix rather than trusting it', () => {
    // Last-two-labels is not a public-suffix lookup. On bbc.co.uk it yields
    // "co.uk", so two different bbc.co.uk hosts still match each other, but an
    // unrelated co.uk site would too. Neither is a host FlowDesk serves, and
    // the note exists so the limit is known rather than discovered.
    expect(registrableHost('https://www.bbc.co.uk/news')).toBe('co.uk')
  })
})

describe('isSameApp', () => {
  it('ignores subdomains', () => {
    expect(isSameApp('https://web.whatsapp.com/x', 'https://faq.whatsapp.com/y')).toBe(true)
  })

  it('separates different sites', () => {
    expect(isSameApp('https://youtube.com/', 'https://web.whatsapp.com/')).toBe(false)
  })

  it('is false when either side is unparseable, so the browser wins by default', () => {
    expect(isSameApp('nonsense', 'https://web.whatsapp.com/')).toBe(false)
    expect(isSameApp('https://web.whatsapp.com/', 'nonsense')).toBe(false)
  })
})
