import { describe, expect, it } from 'vitest'
import { extractImageAssetsFromSSEEvent, extractTextFromSSEEvent, isLikelyImageEvent } from './chatgptParser'

/**
 * Real captured event (probes/out/_chatgpt-image-debug.log) from an actual
 * ChatGPT image-generation turn — not synthesized. This is the event that
 * previously produced ZERO extracted text (author role "tool", parts hold
 * an object not a string) and made the whole turn look like an incidental
 * empty completion to browserWorkerQueue.ts, timing out at 60s instead of
 * resolving.
 */
const REAL_IMAGE_EVENT = `event: delta
data: {"p":"","o":"add","v":{"message":{"id":"67c0e2ae-ba42-4f9e-9ac4-3ad739c0753f","author":{"role":"tool","name":"t2uay3k.sj1i4kz","metadata":{}},"create_time":1787741186.055194,"update_time":null,"content":{"content_type":"multimodal_text","parts":[{"content_type":"image_asset_pointer","asset_pointer":"sediment://file_000000000d888208ab9c0426384a860b","mime_type":"image/png","size_bytes":2000961,"width":1402,"height":1122,"fovea":null,"metadata":{}}]},"status":"finished_successfully","end_turn":null,"weight":0.0,"metadata":{"image_gen_title":"Interstellar Gunship Blueprint","turn_exchange_id":"ac78b949-c1b6-4280-9206-22a9b8391054","working_turn_id":"ac78b949-c1b6-4280-9206-22a9b8391054"},"recipient":"all","channel":null},"conversation_id":"6a8ec3cb-73e8-83ee-b078-5e1cf2cfe65a","error":null,"error_code":null},"c":2}`

describe('isLikelyImageEvent', () => {
  it('flags the real captured image event', () => {
    expect(isLikelyImageEvent(REAL_IMAGE_EVENT)).toBe(true)
  })

  it('does not flag an ordinary text event', () => {
    const textEvent = `event: delta\ndata: {"p":"/message/content/parts/0","o":"append","v":"hello"}`
    expect(isLikelyImageEvent(textEvent)).toBe(false)
  })
})

describe('extractTextFromSSEEvent on a real image event', () => {
  it('confirms the actual bug: text extraction finds nothing at all', () => {
    // This is the root cause, pinned as a real fact rather than an
    // assumption: the author role is "tool", not "assistant", so the
    // existing text collector's assistant-only check skips the whole
    // message — an image-generation turn produces zero extracted text.
    expect(extractTextFromSSEEvent(REAL_IMAGE_EVENT)).toEqual([])
  })
})

describe('extractImageAssetsFromSSEEvent', () => {
  const assets = extractImageAssetsFromSSEEvent(REAL_IMAGE_EVENT)

  it('finds the real image asset despite the author role not being assistant', () => {
    expect(assets).toHaveLength(1)
  })

  it('strips the sediment:// prefix to get the real fileId, confirmed against the live /backend-api/files/download/{fileId} call', () => {
    expect(assets[0].assetPointer).toBe('sediment://file_000000000d888208ab9c0426384a860b')
    expect(assets[0].fileId).toBe('file_000000000d888208ab9c0426384a860b')
  })

  it('carries the real mime type, dimensions, title, and conversation id', () => {
    expect(assets[0].mimeType).toBe('image/png')
    expect(assets[0].width).toBe(1402)
    expect(assets[0].height).toBe(1122)
    expect(assets[0].title).toBe('Interstellar Gunship Blueprint')
    expect(assets[0].conversationId).toBe('6a8ec3cb-73e8-83ee-b078-5e1cf2cfe65a')
  })

  it('finds nothing in an ordinary text event', () => {
    const textEvent = `event: delta\ndata: {"p":"/message/content/parts/0","o":"append","v":"hello"}`
    expect(extractImageAssetsFromSSEEvent(textEvent)).toEqual([])
  })
})

/**
 * Real captured ops from probes/out/_chatgpt-image-compare-debug.log during a
 * live image-generation turn. The assistant's call to the image tool is its
 * own message with recipient "t2uay3k.sj1i4kz" and content_type "code";
 * its arguments stream to /message/content/text, NOT to /content/parts/.
 * Collecting that path handed the agent
 * {"size":"1024x1024","n":1,...} in place of the generated image.
 */
describe('tool-call arguments are not the answer', () => {
  const TOOL_CALL_OPEN = `event: delta
data: {"v":{"message":{"id":"f39bc4bb","author":{"role":"assistant","name":null},"content":{"content_type":"code","language":"python3","text":""},"recipient":"t2uay3k.sj1i4kz","channel":null},"conversation_id":"6a903f65"},"c":1}`

  const ARGS_APPEND = `event: delta
data: {"p":"/message/content/text","o":"append","v":"{\\"size\\":\\"1024x1024\\",\\"n\\":1}"}`

  const ARGS_CONTINUATION = `event: delta
data: {"v":",\\"prompt\\":null}"}`

  const REAL_ANSWER_APPEND = `event: delta
data: {"p":"/message/content/parts/0","o":"append","v":"Here is your blueprint."}`

  it('drops arguments appended to /message/content/text', () => {
    const state = { path: '' }
    extractTextFromSSEEvent(TOOL_CALL_OPEN, state)
    expect(extractTextFromSSEEvent(ARGS_APPEND, state)).toEqual([])
  })

  it('drops a continuation of those arguments arriving in a later chunk', () => {
    const state = { path: '' }
    extractTextFromSSEEvent(TOOL_CALL_OPEN, state)
    extractTextFromSSEEvent(ARGS_APPEND, state)
    // No path of its own — only the carried state says this is still the
    // tool call, which is why the state must outlive a single event.
    expect(extractTextFromSSEEvent(ARGS_CONTINUATION, state)).toEqual([])
  })

  it('still collects the real answer on /content/parts/, and its continuation', () => {
    const state = { path: '' }
    expect(extractTextFromSSEEvent(REAL_ANSWER_APPEND, state)).toEqual(['Here is your blueprint.'])
    const more = `event: delta\ndata: {"v":" Enjoy."}`
    expect(extractTextFromSSEEvent(more, state)).toEqual([' Enjoy.'])
  })

  it('still ignores a status replace, which carries a string but is metadata', () => {
    const state = { path: '' }
    const statusReplace = `event: delta\ndata: {"p":"/message/status","o":"replace","v":"finished_successfully"}`
    expect(extractTextFromSSEEvent(statusReplace, state)).toEqual([])
  })

  it('does not leak arguments into a following real answer', () => {
    const state = { path: '' }
    extractTextFromSSEEvent(TOOL_CALL_OPEN, state)
    extractTextFromSSEEvent(ARGS_APPEND, state)
    extractTextFromSSEEvent(ARGS_CONTINUATION, state)
    expect(extractTextFromSSEEvent(REAL_ANSWER_APPEND, state)).toEqual(['Here is your blueprint.'])
  })
})
