import type { WebContents } from 'electron'

/**
 * Tells a page it is focused and visible. A view that is not on screen (the user
 * is in another FlowDesk section, or the window is minimised) stops painting, so
 * clicks and menus on it silently do nothing. The debugger stays attached until
 * the returned function runs, because the emulation ends with the session.
 * Calls may nest: only the call that attached the debugger detaches it.
 */
export async function keepAwake(wc: WebContents): Promise<() => void> {
  if (wc.isDestroyed()) return () => {}
  wc.setBackgroundThrottling(false)
  const attachedHere = !wc.debugger.isAttached()
  try {
    if (attachedHere) wc.debugger.attach('1.3')
    await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' }).catch(() => {})
  } catch { /* best effort */ }
  return () => {
    if (wc.isDestroyed()) return
    if (attachedHere) {
      wc.setBackgroundThrottling(true)
      try { wc.debugger.detach() } catch { /* already gone */ }
    }
  }
}

/** Runs `fn` with the page kept awake, whatever FlowDesk section is open. */
export async function whileAwake<T>(wc: WebContents, fn: () => Promise<T>): Promise<T> {
  const release = await keepAwake(wc)
  try { return await fn() } finally { release() }
}
