---
name: linkedin-network-growth
title: "LinkedIn Network Growth"
description: "Discovers prospective industry peers, monitors connection limits, and sends verified connection invitations with safety checks. Use when expanding your professional network and tracking outreach allowances."
version: 2.1.0
domain: linkedin
tools:
  - linkedin_status
  - linkedin_search
  - linkedin_get_profile
  - linkedin_network_status
  - linkedin_invite_budget
  - linkedin_send_connection_request
  - linkedin_notifications
inputs:
  searchQuery:
    type: string
    required: false
    description: "Industry keywords, company names, or job titles to search"
  profileUrl:
    type: string
    required: false
    description: "Full LinkedIn profile URL of the recipient"
  expectedName:
    type: string
    required: false
    description: "Exact full name of the recipient as shown on their profile"
  why:
    type: string
    required: false
    description: "Reason for connecting shown in user approval dialog"
---

Every LinkedIn tool takes an optional `account` (id from `linkedin_accounts`); an unknown account is refused, never swapped. Tool choice, account routing and error meanings: the `linkedin` skill. Get the user's explicit approval for the exact content before any write.

## When to use
- Searching for relevant founders, engineers, creators, or leaders in your domain.
- Auditing your own profile positioning to optimize connection acceptance.
- Checking network connection counts and inspecting incoming invitations waiting for review.
- Checking local invite safety ceilings before scheduling or sending connection requests.
- Sending a 1-to-1 connection invitation to a specific individual with strict name verification.

## When not to use
- Mass scraping profiles or running automated cold connection blasts.
- Sending connection requests without verifying the person's exact name.
- Direct messaging existing connections (use `linkedin_send_message` or `linkedin_send`).
- Bypassing FlowDesk weekly invitation limits.

## Tools

### linkedin_status
Verifies active LinkedIn authentication in FlowDesk.
- **Parameters**: None `{}`.
- **Success shape**:
  ```json
  { "ok": true, "signedIn": true, "username": "alex-mercer", "headline": "Software Architect" }
  ```
- **Failure shape**: `{ "ok": false, "signedIn": false, "error": "Not signed in to LinkedIn..." }`.

### linkedin_search
Searches LinkedIn for profiles, companies, jobs, or content.
- **Parameters**:
  - `query`: string (required). E.g. `"distributed systems engineer"`.
  - `resultType`: enum `'ALL' | 'PEOPLE' | 'COMPANIES' | 'JOBS' | 'CONTENT' | 'GROUPS'` (optional, default `'ALL'`).
  - `limit`: integer (optional, 1-30, default 10).
- **Success shape**: Profile search items with member URNs, headlines, and profile URLs.

### linkedin_get_profile
Reads the current user's profile details (name, headline, summary, location).
- **Parameters**: None `{}`.
- **Success shape**:
  ```json
  {
    "ok": true,
    "firstName": "Alex",
    "lastName": "Mercer",
    "headline": "Systems Architect & Tech Lead",
    "summary": "Building scalable platforms...",
    "location": "Seattle, WA"
  }
  ```

### linkedin_network_status
Reads total connection counts and received invitations. Note: LinkedIn does NOT expose sent invitations or remaining allowance over API; those fields return null.
- **Parameters**:
  - `includeReceived`: boolean (optional, default false). If true, lists pending received invitations with sender names.
  - `limit`: integer (optional, 1-50, default 10).
- **Success shape**:
  ```json
  {
    "ok": true,
    "connections": 1420,
    "receivedInvitations": 3,
    "sentInvitations": null
  }
  ```

### linkedin_invite_budget
Inspects FlowDesk's internal rate-limiting budget for outbound invitations.
- **Parameters**: None `{}`.
- **Success shape**:
  ```json
  {
    "ok": true,
    "today": 3,
    "week": 14,
    "remainingToday": 12,
    "remainingWeek": 46,
    "note": "FlowDesk's own counts. LinkedIn's actual remaining weekly allowance is not readable from the client."
  }
  ```

### linkedin_send_connection_request
Sends a connection request to a specific person by their profile URL.
- **Parameters**:
  - `profileUrl`: string (required). E.g. `"https://www.linkedin.com/in/taylor-dev/"`.
  - `expectedName`: string (required). Recipient full name as displayed on their profile. Checked against profile before sending to prevent misclicks.
  - `why`: string (optional). Rationale presented in the user approval prompt.
- **Success shape**:
  ```json
  { "ok": true, "sent": true, "profileUrl": "https://www.linkedin.com/in/taylor-dev/" }
  ```

### linkedin_notifications
Reads recent notifications (including connection acceptances and mentions).
- **Parameters**:
  - `limit`: integer (optional, 1-50, default 15).
  - `onlyUnread`: boolean (optional, default false).
- **Success shape**: Notification cards containing event types, timestamps, and activity IDs.

## Procedure

1. **Verify Session & Own Profile**:
   Call `linkedin_status`, then `linkedin_get_profile`. Ensure profile headline clearly articulates your professional value.
2. **Review Network Health & Budget**:
   - Call `linkedin_network_status` to see current connection count and received invitations.
   - Call `linkedin_invite_budget` to verify remaining daily and weekly invitation capacity. If `remainingToday <= 0` or `remainingWeek <= 0`, abort outreach.
3. **Discover Targeted Profiles**:
   Call `linkedin_search` with `{ query: "...", resultType: "PEOPLE", limit: 10 }`. Extract profile URLs and exact names.
4. **Obtain Explicit Human Confirmation**:
   Present the prospective connection's name, headline, and profile URL to the user in chat.
5. **Execute Connection Request**:
   Invoke `linkedin_send_connection_request` with `{ profileUrl, expectedName, why }`.
   The tool validates that the name matches the rendered profile before sending.
6. **Track Notifications**:
   Call `linkedin_notifications` to identify when sent invitations are accepted.

## Limits and safety
- **Strict Approval Policy**: In `electron/gateway/actionPolicy.ts:29`, `linkedin_send_connection_request` is explicitly included in `DEFAULT_POLICY.requireApproval`. Every external call through `/rpc` (`tools.call`) triggers an interactive confirmation modal in FlowDesk with a 60-second timeout.
- **Action Log Audit**: All connection invitations are treated as write actions and recorded in `action-log.jsonl`.
- **Local Rate Limits**: FlowDesk enforces an internal safety limit of **15 invites per day** (`MAX_INVITES_PER_DAY = 15`) and **60 invites per week** (`MAX_INVITES_PER_WEEK = 60`) in `electron/linkedinConnect.ts:58-59`.
- **Name Verification Guard**: `expectedName` is mandatory. The tool loads the target profile and verifies that the name on the page matches `expectedName` before clicking Connect, protecting against sidebar misclicks.
- **Never Loop**: Never send connection requests in an automated loop. Send at most one request per user turn.

## Verified facts
- `electron/agent/linkedinTools.ts:430-476`: Implements `linkedin_network_status`, `linkedin_invite_budget`, and `linkedin_send_connection_request` with Zod validation.
- `electron/gateway/actionPolicy.ts:29`: `linkedin_send_connection_request` is in `DEFAULT_POLICY.requireApproval`.
- `electron/linkedinConnect.ts:58-59, 126-250`: Connect request uses Voyager endpoint `verifyQuotaAndCreateV2`, enforces local caps (15/day, 60/week), and verifies member name via `identity/dash/profiles`.
- `electron/linkedinNetwork.ts:9-25`: `liNetworkStatus` queries Voyager endpoints `relationships/connectionsSummary` and `relationships/invitationsSummary`.

## Not verified
- LinkedIn's internal weekly invitation ceiling: LinkedIn does not disclose remaining weekly quota over API and dynamically fluctuates limits based on acceptance rates.
