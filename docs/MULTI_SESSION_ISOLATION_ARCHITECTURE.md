# Multi-Session & Partition Isolation Architecture

This document documents the multi-account architecture and isolation guarantees for FlowDesk desktop app.

## Summary of Architecture Fixes Deployed

1. **Deterministic Partition Mapping**:
   - Every account (`1`, `2`, `3` ...) maps strictly to its own separate Electron persistent partition on disk:
     - `persist:social-tiktok`
     - `persist:social-tiktok-2`
     - `persist:social-tiktok-3`
   - Complete removal of `findAnyViewByUrl` to eliminate cross-account view hijacking.

2. **Single-Instance Concurrency Rule**:
   - A partition can only have ONE active Chromium instance at any moment (either visible `WebContentsView` or background hidden `BrowserWindow`).
   - If an interactive UI view is mounted in `viewCache`, background tasks reuse its `webContents` directly without spawning a competing window.
   - Prevents Windows Chromium SQLite database locks (`Access is denied 0x5`) and spontaneous cookie wipes.

3. **Bi-Directional IPC Synchronization**:
   - React UI informs main process when user changes account dropdown via `tiktok:setActiveAccount`.
   - Main process informs React UI when account is switched via CLI/MCP via `tiktok:accountSwitched`.

4. **GPU Cache Lock Prevention**:
   - `app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')` added to prevent shader lock collisions across multiple active WebContents partitions.
