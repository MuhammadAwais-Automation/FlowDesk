import { describe, expect, it } from 'vitest'
import { shellLinkDecision } from './shellLinkPolicy'

/**
 * The bug these pin, observed live: the agent printed a LinkedIn post link in
 * chat, it was clicked, and Electron's default behaviour opened a popup window
 * inside FlowDesk — a sessionless LinkedIn page showing a sign-in wall, with no
 * address bar and no way back. Every link in the shell belongs in the user's
 * own browser, the way it does in WhatsApp Desktop or any other Electron app.
 */

const DEV_SHELL = 'http://localhost:5173/'
const PACKAGED_SHELL = 'file:///C:/Program%20Files/FlowDesk/renderer/index.html'

describe('links that came from somewhere else', () => {
  it.each([
    'https://www.linkedin.com/feed/update/urn:li:activity:7497172606358437888/',
    'http://example.com/page',
    'https://mail.google.com/mail/u/0/#inbox',
    'mailto:someone@example.com',
  ])('sends %s to the system browser', url => {
    expect(shellLinkDecision(url, DEV_SHELL)).toBe('external')
    expect(shellLinkDecision(url, PACKAGED_SHELL)).toBe('external')
  })

  it('does not treat a link sharing the dev server port as the app', () => {
    // localhost:5173 is the shell; localhost:3000 is somebody's other server.
    expect(shellLinkDecision('http://localhost:3000/admin', DEV_SHELL)).toBe('external')
  })
})

describe('the shell navigating within itself', () => {
  it('leaves its own origin alone, so app routes and dev reloads still work', () => {
    expect(shellLinkDecision('http://localhost:5173/settings', DEV_SHELL)).toBe('allow-in-shell')
  })

  it('leaves the packaged bundle alone, where every page shares a null origin', () => {
    expect(shellLinkDecision('file:///C:/Program%20Files/FlowDesk/renderer/other.html', PACKAGED_SHELL))
      .toBe('allow-in-shell')
  })
})

describe('refusing to hand dangerous URLs to the operating system', () => {
  // shell.openExternal launches whatever the OS has registered for a scheme,
  // and these links routinely originate in content written by strangers — a
  // LinkedIn comment, a WhatsApp message. The scheme list is therefore an
  // allowlist; anything unrecognised does nothing at all.
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['a local file from a message', 'file:///C:/Windows/System32/calc.exe'],
    ['an application protocol handler', 'ms-msdt:/id PCWDiagnostic'],
    ['smb', 'smb://attacker/share'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
  ])('blocks %s', (_name, url) => {
    expect(shellLinkDecision(url, DEV_SHELL)).toBe('block')
  })

  it('blocks a file: link even in a packaged build, unless it is the bundle itself', () => {
    // The packaged shell IS a file: page, so scheme alone cannot be the test —
    // otherwise a file: link pasted into a message would be handed straight to
    // Explorer. This is the case that makes the origin check insufficient on
    // its own, and it is why the shell URL is part of the decision.
    expect(shellLinkDecision('file:///C:/Windows/System32/calc.exe', DEV_SHELL)).toBe('block')
  })

  it('blocks something that is not a URL at all rather than throwing', () => {
    for (const junk of ['', 'not a url', '://', 'www.example.com']) {
      expect(shellLinkDecision(junk, DEV_SHELL)).toBe('block')
    }
  })
})

describe('before the shell has loaded anything', () => {
  it('still routes a real link outward rather than crashing on an empty shell URL', () => {
    expect(shellLinkDecision('https://example.com', '')).toBe('external')
  })
})
