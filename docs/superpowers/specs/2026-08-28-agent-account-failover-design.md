# Agent Account Failover Design

## Purpose

Let the Agent continue a browser-provider request with another already-connected
Google account only when the current account is conclusively unavailable because
its quota is exhausted or its provider session needs login.

## User-visible behaviour

1. The manually selected AI Agent account is always the first attempt.
2. A confirmed quota-exhausted or login-required result retries the same
   provider against the next connected Gmail account.
3. A network failure, UI/injection failure, unknown provider error, or any
   unclassified failure stops immediately and shows the original error.
4. The manually selected account is never changed by a retry.
5. The Agent stream reports every fallback attempt with a masked account label.
6. When all connected accounts are unavailable, the Agent reports each known
   limit/login outcome. It never invents a numeric quota or treats unknown as
   zero.

## Non-goals

- Do not pre-check every account before a request.
- Do not rotate accounts for Universal Chat in this slice.
- Do not switch accounts for NotebookLM, social tools, Google Flow, or project
  tools.
- Do not retry after an unknown error.
- Do not initiate a login flow; an expired session is reported after all usable
  accounts are exhausted.

## Architecture

Add an account-aware browser-worker request API. It receives the ordered Gmail
sessions and the selected account email from `main.ts`, placing the selected
account first and every other connected account after it. Each attempt uses an
account-specific background tab ID and returns a structured result containing
the provider, account email, and either the response or an error.

A small pure failure classifier recognizes only explicit quota and
authentication/login patterns. The worker queue uses that classifier after an
attempt rejects: a known retryable condition advances to the next account; all
other errors return immediately. The queue continues to serialize calls per
provider, preserving existing capture-correlation safety.

`main.ts` maps fallback progress into the existing Agent event stream. No
renderer-to-main API changes are needed; `Agent.tsx` renders progress text using
the existing tool-progress cards.

## Data and security

- Account emails are supplied only by the existing local `gmailSessions` store.
- Background windows retain per-account Electron partitions; a fallback never
  copies cookies or tokens between accounts.
- Progress events mask account email addresses before they enter renderer logs.
- The manual `agentBrowserAccountEmail` preference remains unchanged.

## Error classification

Retry only on provider response text matching a narrow allowlist of examples:

- quota/usage: `limit reached`, `usage limit`, `out of credits`, `quota exceeded`
- authentication: `sign in`, `log in`, `session expired`, `unauthorized`

The classifier is deliberately conservative. Timeouts, empty answers,
injection failures, DOM changes, HTTP failures without an authentication signal,
and arbitrary text are non-retryable.

## Tests

- selected account succeeds without fallback
- selected account quota failure retries the next account
- selected account login failure retries the next account
- unknown error stops without using another account
- all accounts unavailable returns a truthful aggregate failure
- account-specific window identity remains intact
