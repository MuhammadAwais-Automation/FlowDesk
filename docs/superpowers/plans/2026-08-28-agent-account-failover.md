# Agent Account Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retry an Agent browser-provider request on another connected Google account only after a confirmed quota or login failure.

**Architecture:** A pure policy module orders saved accounts and classifies safe retry errors. The browser-worker queue attempts accounts in that order and emits masked retry progress; `main.ts` supplies sessions and publishes the progress through its existing Agent event stream.

**Tech Stack:** Electron, TypeScript, Vitest, Electron persistent partitions, EventEmitter.

**Spec:** `docs/superpowers/specs/2026-08-28-agent-account-failover-design.md`

## Global Constraints

- Selected account is always first and is never rewritten by failover.
- Retry only explicit quota or login/session errors; all other errors stop.
- Do not pre-check quota or add fallback to Universal Chat, NotebookLM, social, Flow, or project tools.
- Mask account email in progress; do not log prompts, cookies, or raw provider traffic.

---

## File Structure

- Create `electron/agent/accountFailover.ts`: account ordering, failure classifier, email masker.
- Create `electron/agent/accountFailover.test.ts`: policy unit tests.
- Modify `electron/agent/browserWorkerQueue.ts` and its test: retry loop and progress events.
- Modify `electron/main.ts`: saved-session provider and Agent event bridge.

### Task 1: Safe policy module

**Files:**
- Create: `electron/agent/accountFailover.ts`
- Create: `electron/agent/accountFailover.test.ts`

**Interfaces:** Produces `BrowserAccount`, `AccountFailure`, `orderBrowserAccounts`, `classifyAccountFailure`, and `maskAccountEmail` for Task 2.

- [ ] **Step 1: Write failing policy tests**

```ts
expect(orderBrowserAccounts('b@example.com', [
  { email: 'a@example.com', partition: 'gmail-a' },
  { email: 'b@example.com', partition: 'gmail-b' },
])).toEqual([
  { email: 'b@example.com', partition: 'gmail-b' },
  { email: 'a@example.com', partition: 'gmail-a' },
])
expect(classifyAccountFailure(new Error('usage limit reached'))).toBe('quota_exhausted')
expect(classifyAccountFailure(new Error('session expired; sign in'))).toBe('login_required')
expect(classifyAccountFailure(new Error('Could not submit the message'))).toBeNull()
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- electron/agent/accountFailover.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the minimal policy**

```ts
export type BrowserAccount = { email: string; partition: string }
export type AccountFailure = 'quota_exhausted' | 'login_required'

export function orderBrowserAccounts(selectedEmail: string | null, accounts: BrowserAccount[]) {
  const selected = accounts.find(account => account.email === selectedEmail)
  return selected ? [selected, ...accounts.filter(account => account !== selected)] : [...accounts]
}

export function classifyAccountFailure(error: unknown): AccountFailure | null {
  const message = error instanceof Error ? error.message : String(error)
  if (/limit reached|usage limit|out of credits|quota exceeded/i.test(message)) return 'quota_exhausted'
  if (/sign in|log in|session expired|unauthorized/i.test(message)) return 'login_required'
  return null
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/agent/accountFailover.test.ts`

Expected: PASS.

### Task 2: Account-aware browser retry

**Files:**
- Modify: `electron/agent/browserWorkerQueue.ts:104-266`
- Modify: `electron/agent/browserWorkerQueue.test.ts:1-90`

**Interfaces:** Consumes Task 1 policy. Replaces `configureBrowserWorkerQueue({ getPartition })` with `configureBrowserWorkerQueue({ getAccounts })`, where `getAccounts(): BrowserAccount[]` returns ordered candidates.

- [ ] **Step 1: Write failing retry tests**

```ts
it('retries the next account after a quota failure', async () => {
  configureBrowserWorkerQueue({ getAccounts: () => [
    { email: 'first@example.com', partition: 'gmail-first' },
    { email: 'second@example.com', partition: 'gmail-second' },
  ] })
  await expect(askBrowserProvider('chatgpt' as never, 'hello')).resolves.toBe('second reply')
})

it('does not try another account after an unknown error', async () => {
  await expect(askBrowserProvider('chatgpt' as never, 'hello')).rejects.toThrow('Could not submit')
  expect(ensureBackgroundView).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- electron/agent/browserWorkerQueue.test.ts`

Expected: FAIL because the queue has one attempt only.

- [ ] **Step 3: Implement sequential retries**

```ts
for (const account of getAccountsImpl()) {
  try { return await runOne(tool, prompt, account) } catch (error) {
    const reason = classifyAccountFailure(error)
    if (!reason || account === accounts.at(-1)) throw error
    workerProgress.emit('progress', { type: 'account_retry', tool, reason,
      accountEmailMasked: maskAccountEmail(nextAccount.email) })
  }
}
```

Keep per-provider serialization and capture waiting unchanged. `runOne` receives a concrete account and its tab ID includes `account.partition`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/agent/browserWorkerQueue.test.ts`

Expected: PASS, including the existing account-specific-tab regression.

### Task 3: Agent-only main-process wiring

**Files:**
- Modify: `electron/main.ts:280-291, 1650-1655`

**Interfaces:** Supplies Task 2 `getAccounts` from existing `agentBrowserAccountEmail` and `gmailSessions`; produces existing `tool_progress` stream events with retry text.

- [ ] **Step 1: Wire ordered saved sessions**

```ts
configureBrowserWorkerQueue({
  getAccounts: () => orderBrowserAccounts(
    store.get('agentBrowserAccountEmail'),
    store.get('gmailSessions').map(({ email, partition }) => ({ email, partition })),
  ),
})
```

- [ ] **Step 2: Forward retry progress**

```ts
const onWorkerProgress = (data: WorkerProgress) => publishAgentEvent(runId, sessionId, {
  type: 'tool_progress', toolUseId: data.tool, tool: data.tool,
  elapsedSeconds: data.elapsedSeconds,
  text: data.type === 'account_retry'
    ? `${data.reason === 'quota_exhausted' ? 'Limit reached' : 'Login required'}; trying ${data.accountEmailMasked}.`
    : undefined,
})
```

- [ ] **Step 3: Run focused verification**

Run: `npm test -- electron/agent/accountFailover.test.ts electron/agent/browserWorkerQueue.test.ts && npm run typecheck`

Expected: all focused tests and TypeScript checks pass.

### Task 4: Full verification

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: all Vitest tests pass.

- [ ] **Step 2: Build production output**

Run: `npm run build`

Expected: Electron main, preload, and renderer builds exit with code 0.

- [ ] **Step 3: Review scoped diff**

Run: `git diff -- electron/agent/accountFailover.ts electron/agent/accountFailover.test.ts electron/agent/browserWorkerQueue.ts electron/agent/browserWorkerQueue.test.ts electron/main.ts`

Expected: only policy, retry, progress, and test changes.

## Self-review

- Tasks 1-3 cover selected-first ordering, known-only retry, unchanged manual preference, masked progress, and truthful exhaustion.
- The plan excludes pre-checking, automatic login, Universal Chat, and all non-Agent tool families.
- `BrowserAccount`, `AccountFailure`, and `getAccounts` names are consistent across tasks.
