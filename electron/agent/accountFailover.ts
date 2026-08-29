export interface BrowserAccount {
  email: string
  partition: string
}

export type AccountFailure = 'quota_exhausted' | 'login_required'

export function orderBrowserAccounts(selectedEmail: string | null, accounts: BrowserAccount[]): BrowserAccount[] {
  const selected = selectedEmail
    ? accounts.find(account => account.email.toLowerCase() === selectedEmail.toLowerCase())
    : undefined
  return selected ? [selected, ...accounts.filter(account => account !== selected)] : [...accounts]
}

export function classifyAccountFailure(error: unknown): AccountFailure | null {
  const message = error instanceof Error ? error.message : String(error)
  if (/limit reached|usage limit|out of credits|quota exceeded/i.test(message)) return 'quota_exhausted'
  if (/sign in|log in|session expired|unauthorized/i.test(message)) return 'login_required'
  return null
}

export function maskAccountEmail(email: string): string {
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart.slice(0, 2)}***@${domain}`
}
