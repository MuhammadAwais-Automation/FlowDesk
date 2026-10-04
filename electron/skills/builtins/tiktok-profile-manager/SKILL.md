---
name: tiktok-profile-manager
title: "TikTok Profile Manager"
description: "Inspects connected TikTok accounts, switches active profiles, reads bio and follower statistics, safely updates bios, and warms up account browsing. Use when managing TikTok account identity or warming up sessions."
version: 2.0.0
domain: tiktok
tools:
  - tiktok_accounts
  - tiktok_switch_account
  - tiktok_get_profile
  - tiktok_update_profile
  - tiktok_status
  - tiktok_warmup_scroll
inputs:
  account:
    type: string
    required: false
    description: "Target account ID or partition: 1, 2, 3, or social-tiktok-2"
  action:
    type: string
    required: false
    default: read
    description: "Action to perform: read, update_bio, switch, or warmup"
  bio:
    type: string
    required: false
    description: "New bio text for update_bio action. Maximum 80 characters by TikTok count (emojis count 2)"
  warmupDuration:
    type: number
    required: false
    default: 60
    description: "Warmup browsing duration in seconds: 10 to 600"
  warmupNiche:
    type: string
    required: false
    description: "Optional niche keyword to search and warm on during warmup scroll"
---

## When to use
- Checking whether TikTok account partitions (Account 1, 2, 3) are authenticated or need login.
- Switching the active displayed TikTok account in FlowDesk.
- Reading account profile details, including follower counts, likes, video counts, and public/private status.
- Updating an account bio with client-side length validation and poll verification.
- Testing bio updates using the safe read-modify-verify-revert pattern.
- Running autonomous organic warmup browsing (warmup scroll) on FYP or niche feeds to build session trust.

## When not to use
- Uploading or scheduling videos (use `tiktok-publisher`).
- Scanning viral trends or competitor outliers (use `tiktok-trend-research`).
- Writing captions or hashtag copy (use `caption-hashtag-writer`).
- Changing username or account credentials (requires direct user login).
- Updating a bio without explicit user confirmation in chat.

## Tools

### tiktok_accounts
Lists all connected TikTok accounts in FlowDesk with authentication status and active state.
- **Parameters**: None.
- **Success shape**:
  ```json
  {
    "ok": true,
    "accounts": [
      {
        "id": "1",
        "label": "Account 1 (@alphapaws6)",
        "partition": "social-tiktok",
        "authenticated": true,
        "username": "alphapaws6",
        "active": true,
        "currentUrl": "https://www.tiktok.com/tiktokstudio/content"
      },
      {
        "id": "2",
        "label": "Account 2",
        "partition": "social-tiktok-2",
        "authenticated": false,
        "username": null,
        "active": false,
        "currentUrl": ""
      }
    ]
  }
  ```

### tiktok_switch_account
Switches the currently active displayed TikTok account profile in FlowDesk.
- **Parameters**:
  - `account` (string, required): Target account ID or partition (e.g. `'1'`, `'2'`, `'social-tiktok-2'`).
- **Success shape**:
  ```json
  {
    "ok": true,
    "account": "social-tiktok-2",
    "message": "Switched active TikTok account to social-tiktok-2"
  }
  ```

### tiktok_get_profile
Reads the signed-in TikTok profile over the in-session API (Studio user API + profile page rehydration metadata).
- **Parameters**:
  - `account` (string, optional): Target account ID (`'1'`, `'2'`, `'3'`). Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "via": "api",
    "profile": {
      "uid": "7481234567890123456",
      "uniqueId": "alphapaws6",
      "nickname": "Alpha Paws",
      "bio": "Daily gym motivation for athletic pets",
      "avatar": "https://p16-sign.tiktokcdn.com/...",
      "secUid": "MS4wLjABAAAA...",
      "followers": 1250,
      "following": 84,
      "likes": 18400,
      "videoCount": 16,
      "privateAccount": false,
      "studioIsPrivate": false
    }
  }
  ```
- **Known failure shapes**:
  - Unauthenticated: `{ "ok": false, "error": "not signed in to TikTok (no username from studio or passport)" }`

### tiktok_update_profile
Changes the signed-in TikTok bio over the web API using ticket-guard signed headers. Validates length (emoji = 2, max 80) and polls until confirmed.
- **Parameters**:
  - `bio` (string, required): New bio text. Use `\n` for line breaks. Maximum 80 by TikTok count.
  - `account` (string, optional): Target account ID. Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "updated": true,
    "via": "api",
    "bio": "Alpha Paws | Athletic Pet Community"
  }
  ```
- **Known failure shapes**:
  - Length exceeded: `{ "ok": false, "error": "bio is 84 by TikTok's count (emoji count 2); the limit is 80" }`
  - Client missing: `{ "ok": false, "error": "TikTok page client not found — is a www.tiktok.com page loaded?" }`
  - Poll timeout: `{ "ok": false, "error": "TikTok accepted the update (status_code 0) but the new bio did not read back within 12s" }`

### tiktok_status
Checks TikTok connection status in FlowDesk, returning authentication state and current partition.
- **Parameters**:
  - `account` (string, optional): Target account ID. Defaults to active account.
- **Success shape**:
  ```json
  {
    "ok": true,
    "authenticated": true,
    "username": "alphapaws6",
    "mode": "creator",
    "currentUrl": "https://www.tiktok.com/explore",
    "account": "social-tiktok"
  }
  ```

### tiktok_warmup_scroll
Simulates natural human browsing: scrolls FYP or niche feed, watches videos for 4-10 seconds, and optionally likes relevant posts.
- **Parameters**:
  - `account` (string, optional): Target account ID. Defaults to active account.
  - `durationSeconds` (number, optional): Duration in seconds (10 to 600, default 60).
  - `niche` (string, optional): Niche keyword to search and warm on (e.g. `'gym cats'`). Defaults to FYP feed.
  - `autoLike` (boolean, optional): Whether to organically like videos (~22% rate). Defaults to `false`.
- **Success shape**:
  ```json
  {
    "ok": true,
    "durationSeconds": 60,
    "videosWatched": 8,
    "likesGiven": 2,
    "message": "TikTok warmup and persona scroll session completed successfully.",
    "account": "social-tiktok",
    "mode": "human_warmup"
  }
  ```

## Procedure

### Reading Account Status and Profile
1. Call `tiktok_accounts` to review all partitions and identify the active or target account.
2. Call `tiktok_get_profile({ account })` to retrieve current bio, follower metrics, and profile metadata.
3. If switching account is required, call `tiktok_switch_account({ account })` and confirm active state.

### Bio Update & Revert Pattern
When updating a bio (especially during automated tasks or tests), follow the safe revert protocol:
1. **Snapshot original bio**:
   - Call `tiktok_get_profile({ account })`.
   - Store `originalBio = res.profile.bio || ''`.
2. **Calculate character length**:
   - Ensure the new bio does not exceed 80 characters under TikTok's counting rule (any emoji or code point > 0xFFFF counts as 2 characters).
3. **Obtain user approval**:
   - Present the proposed new bio and original bio to the user in chat before applying.
4. **Apply update**:
   - Call `tiktok_update_profile({ bio: newBio, account })`.
   - Ensure `res.ok === true` and `res.updated === true`. FlowDesk automatically polls up to 12s to verify the new bio read back.
5. **Revert (when test completes or if reverting)**:
   - Call `tiktok_update_profile({ bio: originalBio, account })`.
   - Confirm `res.ok === true` and verify `originalBio` reads back.

### Account Warmup Protocol
1. Call `tiktok_warmup_scroll` with `durationSeconds: 60` (or up to 180) and the target `niche` keyword (e.g. `'pet fitness'`).
2. Keep `autoLike: false` for passive warming, or set `autoLike: true` only if organic persona interaction is desired.
3. Confirm `res.ok === true` upon completion.

## Limits and safety
- **Bio length limit (80 characters)**: TikTok strictly limits bios to 80 characters. Emojis and extended unicode characters count as 2 characters (`tiktokBioLength`). Over-limit submissions return status_code 0 but are silently ignored by TikTok servers; FlowDesk blocks them client-side.
- **Outbound action approval**: Updating a bio is a real profile change. Never change a bio without explicit user confirmation.
- **Warmup duration boundaries**: `tiktok_warmup_scroll` clamps duration between 10 seconds minimum and 600 seconds (10 minutes) maximum.
- **Partition isolation**: Each account operates in its own isolated Electron session partition (`social-tiktok`, `social-tiktok-2`, `social-tiktok-3`). Actions on one account do not leak cookies or state into another.

## Verified facts
- TikTok bio character limit is 80 characters, where characters with `codePoint > 0xFFFF` count as 2 characters (`electron/tiktokProfile.ts:19-22`).
- `tkUpdateProfile` validates bio length client-side before sending because TikTok returns `status_code 0` on over-limit bios while silently retaining the old bio (`electron/tiktokProfile.ts:51-54`).
- Bio update sends `POST /api/update/profile/` with `signature` and `tt-csrf-token` using `tiktokClient()` to include `tt-ticket-guard` ECDSA signed headers (`electron/tiktokProfile.ts:25-35`, `electron/tiktok.ts:603-621`).
- Bio updates are eventually consistent: `tiktokUpdateBioScript` polls `/tiktokstudio/api/web/user` up to 8 times every 1.5s (12s total) to verify read-back (`electron/tiktokProfile.ts:37-42`, probe `tkp-22`).
- Profile reader combines `/tiktokstudio/api/web/user` with `/@<uniqueId>` `__UNIVERSAL_DATA_FOR_REHYDRATION__` script JSON to supply complete stats (`electron/tiktokProfile.ts:65-113`).
- `tiktok_warmup_scroll` clamps duration between 10s and 600s, watches videos for 4-10s, and likes with ~22% probability when `autoLike: true` (`electron/tiktok.ts:738`, `electron/tiktokBridge.ts:1251-1275`).
- Account partition names map to `social-tiktok`, `social-tiktok-2`, `social-tiktok-3` (`electron/tiktok.ts:46-55`).

## Not verified
- Rate limits on how many times per hour a TikTok account bio can be changed before triggering temporary security locks.
- Avatar photo upload via API (currently not supported in FlowDesk; photo changes must be performed manually in the browser UI).
