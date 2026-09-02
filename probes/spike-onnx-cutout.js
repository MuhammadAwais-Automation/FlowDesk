// @target flowdesk
// Second half of the runtime spike. spike-runtime-gpu.js proved WebGPU exists;
// this proves onnxruntime-web can actually *use* it for the cutout model, and
// measures WebGPU against WASM on this machine rather than trusting published
// numbers.
//
// Both files are served by the renderer's own dev server (vite root is the
// project root), so no packaging decision is being made here yet.

const out = { steps: [] }
const t0 = performance.now()
const mark = (name, extra) => out.steps.push(Object.assign({ name, atMs: Math.round(performance.now() - t0) }, extra || {}))

let ort
try {
  ort = await import('/node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs')
  out.ortVersion = String(ort.env && ort.env.versions && ort.env.versions.common || '')
  mark('imported ort')
} catch (e) {
  return { fatal: 'import failed', error: String(e && e.message || e) }
}

// The bundle fetches its own .wasm siblings; point it at the served directory.
ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/'
ort.env.logLevel = 'error'

const MODEL = '/models/isnet-general-use.onnx'

// Confirm the weights are actually reachable before blaming the runtime for a
// failure that is really a 404.
try {
  const head = await fetch(MODEL, { method: 'HEAD' })
  out.model = { status: head.status, bytes: Number(head.headers.get('content-length') || 0) }
  mark('model reachable')
} catch (e) {
  return { fatal: 'model fetch failed', error: String(e && e.message || e) }
}
if (out.model.status !== 200) return Object.assign(out, { fatal: 'model not served' })

// ISNet takes 1x3x1024x1024 and returns a stack of masks; the first is the one
// that matters. A synthetic tensor is enough to measure the runtime — image
// quality is a separate experiment with a real photograph.
const SIDE = 1024
const pixels = SIDE * SIDE
const input = new Float32Array(3 * pixels)
for (let i = 0; i < input.length; i++) input[i] = (i % 255) / 255

async function tryProvider(ep) {
  const r = { ep }
  try {
    const tLoad = performance.now()
    const session = await ort.InferenceSession.create(MODEL, {
      executionProviders: [ep],
      graphOptimizationLevel: 'all',
    })
    r.loadMs = Math.round(performance.now() - tLoad)
    r.inputNames = session.inputNames.slice(0, 4)
    r.outputNames = session.outputNames.slice(0, 4)

    const feeds = {}
    feeds[session.inputNames[0]] = new ort.Tensor('float32', input, [1, 3, SIDE, SIDE])

    // First run includes shader compilation and buffer allocation, so it is
    // not representative — measure it, then measure a warm run separately.
    const tCold = performance.now()
    const first = await session.run(feeds)
    r.coldRunMs = Math.round(performance.now() - tCold)

    const firstOut = first[session.outputNames[0]]
    r.outputDims = Array.isArray(firstOut.dims) ? firstOut.dims.slice() : null
    r.outputType = String(firstOut.type)
    // Sanity: a real mask has varying values. All-zeros means it ran but did
    // nothing useful, which looks identical to success from the outside.
    const d = firstOut.data
    let min = Infinity, max = -Infinity
    for (let i = 0; i < d.length; i += 997) { const v = d[i]; if (v < min) min = v; if (v > max) max = v }
    r.maskMin = Number(min.toFixed(4))
    r.maskMax = Number(max.toFixed(4))
    r.maskVaries = (max - min) > 0.01

    const tWarm = performance.now()
    await session.run(feeds)
    r.warmRunMs = Math.round(performance.now() - tWarm)

    await session.release()
    r.ok = true
  } catch (e) {
    r.ok = false
    r.error = String(e && e.message || e).slice(0, 400)
  }
  return r
}

out.webgpu = await tryProvider('webgpu')
mark('webgpu done', { ok: out.webgpu.ok })

out.wasm = await tryProvider('wasm')
mark('wasm done', { ok: out.wasm.ok })

if (out.webgpu.ok && out.wasm.ok && out.webgpu.warmRunMs > 0) {
  out.speedup = Number((out.wasm.warmRunMs / out.webgpu.warmRunMs).toFixed(2))
}

out.totalMs = Math.round(performance.now() - t0)
return out


