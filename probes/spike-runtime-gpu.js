// @target flowdesk
// Runtime spike for the design ecosystem. Settles three questions that two
// architecture decisions depend on (see docs/superpowers/specs/
// 2026-09-02-design-ecosystem-research-round2.md):
//
//   1. Is WebGPU actually available in this Electron renderer? If yes, ONNX
//      cutout belongs in a hidden renderer window, not in the main process.
//   2. Does one OffscreenCanvas WebGL context really feed many display
//      canvases with *different* content? That is the whole shader
//      architecture — Chromium caps active contexts at 16 and a carousel is 8
//      artboards.
//   3. What is the real context ceiling on this machine?

const out = { href: location.href, ua: navigator.userAgent.slice(0, 160) }

// ---------------------------------------------------------------- 1. WebGPU
out.webgpu = { present: typeof navigator.gpu !== 'undefined' }
if (out.webgpu.present) {
  try {
    const adapter = await navigator.gpu.requestAdapter()
    out.webgpu.adapter = !!adapter
    if (adapter) {
      const info = adapter.info || {}
      out.webgpu.vendor = String(info.vendor || '')
      out.webgpu.architecture = String(info.architecture || '')
      out.webgpu.device_desc = String(info.device || '')
      out.webgpu.features = Array.from(adapter.features || []).slice(0, 40)
      out.webgpu.maxTextureDimension2D = adapter.limits && adapter.limits.maxTextureDimension2D
      out.webgpu.maxBufferSize = adapter.limits && String(adapter.limits.maxBufferSize)
      // Requesting the device is the real test — an adapter can exist and
      // still fail here.
      const device = await adapter.requestDevice()
      out.webgpu.device = !!device
      if (device) device.destroy()
    }
  } catch (e) {
    out.webgpu.error = String(e && e.message ? e.message : e)
  }
}

// ------------------------------------- 2. One context, many display canvases
// The architecture claim: render N different frames from ONE WebGL context and
// hand each to its own cheap bitmaprenderer canvas. If this works, artboard
// count stops mattering.
out.shared = {}
try {
  const W = 64, H = 64
  const off = new OffscreenCanvas(W, H)
  const gl = off.getContext('webgl2')
  out.shared.contextType = gl ? 'webgl2' : 'none'
  if (gl) {
    const colours = [
      [1, 0, 0], // red
      [0, 1, 0], // green
      [0, 0, 1], // blue
      [1, 1, 0], // yellow
    ]
    const readback = []
    // One 2d canvas reused to sample what actually landed on each display
    // canvas — proves pixels, not just "no exception thrown".
    const sampler = document.createElement('canvas')
    sampler.width = W; sampler.height = H
    const sctx = sampler.getContext('2d', { willReadFrequently: true })

    for (let i = 0; i < colours.length; i++) {
      const c = colours[i]
      gl.viewport(0, 0, W, H)
      gl.clearColor(c[0], c[1], c[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      // Tear the finished frame off the shared context...
      const bitmap = off.transferToImageBitmap()

      // ...and hand it to a display canvas that owns no WebGL context at all.
      const display = document.createElement('canvas')
      display.width = W; display.height = H
      const brc = display.getContext('bitmaprenderer')
      if (!brc) { readback.push({ i, error: 'no bitmaprenderer context' }); continue }
      brc.transferFromImageBitmap(bitmap)

      sctx.clearRect(0, 0, W, H)
      sctx.drawImage(display, 0, 0)
      const px = sctx.getImageData(W >> 1, H >> 1, 1, 1).data
      readback.push({
        i,
        expected: [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)],
        got: [px[0], px[1], px[2], px[3]],
      })
    }
    out.shared.readback = readback
    out.shared.allCorrect = readback.every(r =>
      r.got && r.expected &&
      Math.abs(r.got[0] - r.expected[0]) <= 2 &&
      Math.abs(r.got[1] - r.expected[1]) <= 2 &&
      Math.abs(r.got[2] - r.expected[2]) <= 2 &&
      r.got[3] === 255)
    // The exporter needs the same frame. If this is true, live preview and
    // bake-on-export are one code path rather than two.
    out.shared.contextsUsed = 1
    out.shared.displayCanvases = colours.length
  }
} catch (e) {
  out.shared.error = String(e && e.message ? e.message : e)
}

// -------------------------------------------- 3. The real context ceiling
// Published limit is 16 active contexts / 16M pixels. Measure it here rather
// than trusting the number, because it decides whether the shared-context
// design is a nicety or a necessity.
out.ceiling = {}
try {
  const held = []
  let created = 0
  let firstLost = -1
  for (let i = 0; i < 24; i++) {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 256
    const g = c.getContext('webgl2')
    if (!g) { firstLost = i; break }
    held.push({ canvas: c, gl: g })
    created++
  }
  // A context that was silently lost reports isContextLost() after the fact.
  let aliveNow = 0
  for (const h of held) if (!h.gl.isContextLost()) aliveNow++
  out.ceiling.requested = 24
  out.ceiling.created = created
  out.ceiling.firstNullAt = firstLost
  out.ceiling.stillAliveAfterAll = aliveNow
  // Release them so the spike does not leave the app starved.
  for (const h of held) {
    const ext = h.gl.getExtension('WEBGL_lose_context')
    if (ext) ext.loseContext()
  }
  out.ceiling.released = true
} catch (e) {
  out.ceiling.error = String(e && e.message ? e.message : e)
}

// ------------------------------------------------------ 4. What is installed
out.deps = {
  onnxruntimeWeb: false,
  transformers: false,
}
try { out.deps.onnxruntimeWeb = !!(await import('onnxruntime-web').then(m => m, () => null)) } catch (e) { out.deps.onnxErr = String(e).slice(0, 120) }

return out

