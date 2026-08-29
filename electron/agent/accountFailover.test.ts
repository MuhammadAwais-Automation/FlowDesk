import { describe, expect, it } from 'vitest'
import { classifyAccountFailure, maskAccountEmail, orderBrowserAccounts } from './accountFailover'

describe('agent account failover policy', () => {
  it('puts the manually selected account before other connected accounts', () => {
    expect(orderBrowserAccounts('b@example.com', [
      { email: 'a@example.com', partition: 'gmail-a' },
      { email: 'b@example.com', partition: 'gmail-b' },
    ])).toEqual([
      { email: 'b@example.com', partition: 'gmail-b' },
      { email: 'a@example.com', partition: 'gmail-a' },
    ])
  })

  it.each([
    ['You have reached your usage limit', 'quota_exhausted'],
    ['Session expired. Please sign in again.', 'login_required'],
    ['Could not submit the message to chatgpt', null],
  ])('classifies only explicit fallback failures', (message, expected) => {
    expect(classifyAccountFailure(new Error(message))).toBe(expected)
  })

  it('masks account email for progress events', () => {
    expect(maskAccountEmail('person@example.com')).toBe('pe***@example.com')
  })
})
