# TikTok Reverse-Engineering Findings

**Target:** `tiktok.com`  
**Captured In:** Live FlowDesk Electron session (`social-tiktok` partition).  
**Method:** Chrome DevTools Protocol (`electron/discovery/cdpRecorder.ts`) + Probe Runner (`probes/tk-*.js`).

---

## 1. Live Session Discovery Summary

| Metric | Result | Status |
| :--- | :--- | :--- |
| **Total Network Calls Captured** | **726 calls** (`probes/out/_network-tiktok-com.json`, 1.85 MB) | ✅ Verified Live |
| **Active Surface** | `https://www.tiktok.com/explore` | ✅ Verified Live |
| **Video Links Extracted** | **24 trending videos** per page fold | ✅ Extracted |
| **Video Views & Metrics** | Exact view counts (`156.8K`, `112.8K`, `36.1K`, `21.2K`) | ✅ Extracted |
| **Media Streams** | Real MP4 video files (`v16-webapp-prime.tiktok.com`) | ✅ Captured |

---

## 2. Trending & Explore Video Schema

Extracted live via `probes/tk-02-feed.js`:

```json
{
  "author": "harissct2qx",
  "videoId": "7676071601531538718",
  "url": "https://www.tiktok.com/@harissct2qx/video/7676071601531538718",
  "views": "156.8K",
  "coverImg": "https://p16-common-sign.tiktokcdn.com/tos-useast8-p-0068-tx2/oQZq4aiEGMJ5ECAywRhABFVoXBobInsyiBsaP~tplv-photomode-zoomcover:720:720.jpeg?..."
}
```

### Viral Content Samples Captured:
1. **`@harissct2qx`** — Video `7676071601531538718` (**156.8K views**)
2. **`@quacktok3`** — Video `7677896724018662658` (**112.8K views**)
3. **`@ai.toys.videos`** — Video `7683573342502194454` (**36.1K views**)
4. **`@vegetabletoontv`** — Video `7679122807703244040` (**21.2K views**)
5. **`@motupatlutoons17`** — Video `7678073388925095191` (**19.6K views**)
6. **`@alookedoniya`** — Video `7677741344370052383` (**16.0K views**)

---

## 3. Network Architecture & Endpoints

### 1. Explore Feed Endpoint
* **Path:** `GET /api/explore/item_list/?count=8&categoryType=120&device_platform=web_pc...`
* **Security:** Signed with client tokens (`X-Dynosaur`, `msToken`, `X-Bogus`, `X-Gnarly`).
* **Direct DOM Extraction:** Because TikTok signs requests on the client, reading the hydrated page DOM or using in-page `window` context yields 100% clean video URLs, view counts, and authors without triggering bot challenges.

### 2. Video CDN Streaming
* **Hosts:** `v16-webapp-prime.tiktok.com`, `v19-webapp-prime.tiktok.com`
* **Path:** `/video/tos/.../?mime_type=video_mp4`
* **Behavior:** Direct raw MP4 video streams loaded via media source extensions.

### 3. Thumbnails & Media Signatures
* **Hosts:** `p16-common-sign.tiktokcdn.com`, `p19-common-sign.tiktokcdn.com`
* **Format:** Signed JPEG/WebP with expiration timestamps.

---

## 4. Next Implementation Steps

1. **`tiktok_feed` Tool**: Exposes Explore / Trending videos with view counts, authors, video links, and covers.
2. **`tiktok_search` Tool**: Takes any keyword/niche query (e.g. "AI animation", "Quran learning", "kids comedy"), navigates to `/search?q=...`, and returns top videos sorted by views for instant SEO & competitor research.
3. **`tiktok_status` Tool**: Detects login status and active account handle via `document.cookie` (`sessionid`).
4. **`tiktok_upload_video` / `tiktok_delete_video`**: Automates Creator Center upload (`/creator-center/upload`).
