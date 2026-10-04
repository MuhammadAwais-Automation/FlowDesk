---
name: account-safety
title: "Account Safety & Action Policy"
description: "Enforces security guardrails, action authorization policies, rate-limiting thresholds, and anti-ban safeguards across all connected platform sessions. Use when evaluating operational risks, approval policies, or safe automation thresholds."
version: 2.0.0
domain: general
tools: []
inputs:
  platform:
    type: string
    required: false
    default: all
    description: "Target platform to inspect safety policies for: all, tiktok, linkedin, flow, whatsapp, facebook, or chatgpt"
  action:
    type: string
    required: false
    description: "Canonical action name to inspect against security policy (e.g. tiktok_delete_all_videos or whatsapp_send)"
---

## When to use
- Checking whether a proposed agent action requires user approval or is blocked by policy before dispatch.
- Reviewing anti-ban operational limits, rate limits, and delay requirements across social and AI providers.
- Applying private-first upload rules, account warming procedures, or credit consumption ceilings.
- Auditing recorded actions in FlowDesk's security audit log (`action-log.jsonl`).

## When not to use
- Executing platform-specific read or write operations (use the designated provider skill instead).
- Storing or retrieving knowledge graph memories (use `brain-memory` instead).

## Tools

### Policy Interceptor Architecture
`account-safety` is a universal governance skill. It exposes `tools: []` directly because it governs all MCP tools and workflow steps through FlowDesk's gateway action guard (`electron/gateway/actionPolicy.ts`).

Every RPC call and workflow tool step passes through `guard(method, params)`:
1. **Canonical Action Normalization**: Translates names into a unified snake_case identifier (e.g. `tiktok.deleteAllVideos` and `tiktok_delete_all_videos` both map to `tiktok_delete_all_videos`).
2. **Blocked Action Gate**: Rejects blocked actions immediately with an error.
3. **Approval Request Gate**: Triggers an in-app approval popup in FlowDesk. Times out and rejects after 60 seconds (`APPROVAL_TIMEOUT_MS = 60000`).
4. **Audit Logging**: Logs every write action to `%APPDATA%\flowdesk\action-log.jsonl`.

### Default Action Policy (`%APPDATA%\flowdesk\action-policy.json`)
```json
{
  "blocked": [],
  "requireApproval": [
    "tiktok_delete_all_videos",
    "tiktok_update_profile",
    "linkedin_send_connection_request"
  ]
}
```

## Procedure

1. **Pre-Action Risk Evaluation**:
   Before initiating any outbound write action (posting, commenting, messaging, deleting, editing profile), check if the action is categorized as a write operation:
   `/(^|_)(send|create|delete|remove|like|unlike|comment|reply|react|share|follow|hide|update|upload|submit|vote|subscribe|mark_read|connection|edit|switch_account|generate|extend|remember|decide|save|run)(_|$)/`.

2. **Verify Standing Approval Rules**:
   - Outbound actions (messaging, posting, deleting) require explicit human confirmation in chat.
   - For `tiktok_delete_all_videos`, `tiktok_update_profile`, and `linkedin_send_connection_request`, warn the user that an approval popup will appear in the FlowDesk desktop app.

3. **Apply Platform-Specific Safety Rules**:
   - **TikTok**:
     - Always set `privacy: "private"` for initial video uploads.
     - Public or scheduled uploads require explicit user confirmation.
     - For new or cold accounts, run `tiktok_warmup_scroll` (4-10s watch time) before publishing.
   - **WhatsApp**:
     - Confirm recipient phone number/JID before sending.
     - Verify that `whatsapp_send` returns `acked: true` (`ack >= 1`).
     - Never send unprompted mass broadcasts.
   - **LinkedIn**:
     - Commenting and connection requests must respect human pacing (minimum 30-60s interval).
   - **Google Flow**:
     - Check credit balance (`flow_credits`) before triggering video generations (costs ~22 credits).
   - **ChatGPT Images**:
     - Check `chatgpt_image_accounts` for available quota to avoid unnecessary account parking.

4. **Handle Approval Timeouts**:
   If an action fails with `"<action> needs approval in the FlowDesk app and was not approved"`, notify the user that the 60-second approval modal timed out and wait for instructions.

## Limits and safety
- **Approval Window**: Interactive approval dialogs timeout after 60 seconds (`APPROVAL_TIMEOUT_MS = 60_000` in `electron/gateway/actionPolicy.ts:32`).
- **Privacy First Uploads**: TikTok videos uploaded via `tiktok_api_upload_video` default to `private` ("Only you") (`bin/flowdesk-mcp.mjs:780`).
- **Scheduling Constraints**: TikTok scheduled posts must be set between 15 minutes and 10 days into the future, and cannot use `private` visibility (`bin/flowdesk-mcp.mjs:781`).
- **Audit Sanitization**: FlowDesk's `action-log.jsonl` summarizes parameters and truncates messages to 40 characters, ensuring prompt texts, session cookies, and authentication headers are never written to disk (`electron/gateway/actionPolicy.ts:51-64`).
- **Session Sandboxing**: All web sessions run in isolated Electron partitions (`persist:<name>`) with `nodeIntegration: false` and `contextIsolation: true`.

## Verified facts
- Action policy configuration is stored at `%APPDATA%\flowdesk\action-policy.json` and re-read on every request without requiring an application restart (`electron/gateway/actionPolicy.ts:16-18, 109-112`).
- Default policy mandates approval for `tiktok_delete_all_videos`, `tiktok_update_profile`, and `linkedin_send_connection_request` (`electron/gateway/actionPolicy.ts:27-30`).
- Audit logs are persisted at `%APPDATA%\flowdesk\action-log.jsonl` with ISO timestamps, outcome status, and sanitized parameter summaries (`electron/gateway/actionPolicy.ts:102-106, 140`).
- Approval timeout is hardcoded to 60,000ms (`APPROVAL_TIMEOUT_MS = 60000` in `electron/gateway/actionPolicy.ts:32`).
- Canonicalization normalizes dots, hyphens, camelCase, and spaces to lower snake_case (`electron/gateway/actionPolicy.ts:35-37`).

## Not verified
- Dynamic custom rate-limiting rules defined by external reverse proxy gateways outside FlowDesk.
