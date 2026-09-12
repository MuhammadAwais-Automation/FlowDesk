import { describe, expect, it } from 'vitest'
import { citationHref } from './shellLinkDecision'

/**
 * Citation refs come out of captured social content and are never scheme-checked
 * on write (electron/brain/database.ts takes `sourceRef: string`), so these are
 * the strings an attacker controls. They reach a renderer holding
 * `window.electronAPI`.
 */
describe('citationHref', () => {
  it.each([
    'javascript:window.electronAPI.brainImportBackup()',
    'JavaScript:alert(1)',
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ms-msdt:/id',
    'not a url at all',
    '',
  ])('refuses %s', ref => {
    expect(citationHref(ref)).toBeNull()
  })

  it.each([null, undefined])('refuses %s', ref => {
    expect(citationHref(ref)).toBeNull()
  })

  it.each([
    'https://www.linkedin.com/feed/update/urn:li:activity:7497172606358437888/',
    'http://example.test/post/1',
    'mailto:someone@example.test',
  ])('allows %s', ref => {
    expect(citationHref(ref)).toBe(ref)
  })

  it('never resolves a citation against the shell origin', () => {
    // A citation always points outward; "the app's own page" is never a valid
    // answer for one, so there is no shellUrl parameter to get wrong.
    expect(citationHref('file:///C:/Program%20Files/FlowDesk/renderer/index.html')).toBeNull()
  })
})
