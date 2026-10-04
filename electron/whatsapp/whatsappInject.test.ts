import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { WHATSAPP_BRIDGE_SRC } from './whatsappInject'

/**
 * The bridge is a JavaScript program living inside a template literal, so the
 * TypeScript compiler never looks at it: it is a string as far as the build is
 * concerned. That blind spot is not theoretical — an edit once spliced ~10KB
 * of this file back into itself, leaving every helper and every window.__fdWa*
 * entry point defined twice. Both typechecks and the whole suite still passed,
 * and the only visible symptom was that a fix appeared to do nothing, because
 * the stale duplicate was defined last and quietly won.
 *
 * These tests are the cheap structural check that would have caught it.
 */

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('WHATSAPP_BRIDGE_SRC structure', () => {
  const entryPoints = [
    'window.__fdWaStatus =',
    'window.__fdWaListChats =',
    'window.__fdWaListMessages =',
    'window.__fdWaChats =',
    'window.__fdWaSend =',
    'window.__fdWaDiag =',
  ]

  it.each(entryPoints)('defines %s exactly once', entry => {
    expect(countOccurrences(WHATSAPP_BRIDGE_SRC, entry)).toBe(1)
  })

  const helpers = [
    'function nameFor(',
    'function serializeMsg(',
    'function serializeChat(',
    'function modelsOf(',
    'function tryHook(',
    'function tryAnnounce(',
  ]

  it.each(helpers)('defines %s exactly once', helper => {
    expect(countOccurrences(WHATSAPP_BRIDGE_SRC, helper)).toBe(1)
  })

  it('keeps the re-injection guard, so a reload cannot double-hook the message stream', () => {
    expect(countOccurrences(WHATSAPP_BRIDGE_SRC, 'if (window.__fdWa) return true')).toBe(1)
  })

  it('reads messages through the module the probe actually found, not a guessed name', () => {
    // The wire is encrypted, so this module is the only route to decrypted
    // data — a rename here means the bridge silently reads nothing.
    expect(WHATSAPP_BRIDGE_SRC).toContain("require('WAWebCollections')")
    expect(WHATSAPP_BRIDGE_SRC).toContain("require('WAWebChatLoadMessages')")
    expect(WHATSAPP_BRIDGE_SRC).toContain("require('WAWebSendTextMsgChatAction')")
  })

  it('pages history in rather than returning whatever happens to be resident', () => {
    // A real call returned 1 message for a chat with plenty, because WhatsApp
    // keeps only the open chat's messages in memory. Losing this loop would
    // regress to that silently — the call still succeeds, just nearly empty.
    expect(WHATSAPP_BRIDGE_SRC).toContain('loadRecentMsgs')
    expect(WHATSAPP_BRIDGE_SRC).toContain('loadEarlierMsgs')
  })

  it('never calls downloadMedia bare', () => {
    // Calling it with no argument failed with "Cannot read properties of
    // undefined (reading 'downloadEvenIfExpensive')" — it reads options off
    // an argument that has to be there. A bare call compiles, typechecks, and
    // fails only at runtime against a real message, so guard the call shape.
    expect(WHATSAPP_BRIDGE_SRC).not.toContain('m.downloadMedia()')
    expect(WHATSAPP_BRIDGE_SRC).toContain('downloadEvenIfExpensive')
  })

  it('does not abandon message paging when the first loader fails', () => {
    // loadRecentMsgs failed on a real chat and the old code stopped there,
    // never trying loadEarlierMsgs — the call then reported whatever few
    // messages were already resident as though that were the whole chat.
    expect(WHATSAPP_BRIDGE_SRC).toContain('onFailure')
    expect(WHATSAPP_BRIDGE_SRC).toContain('pickLoader')
  })

  it('sanitises everything it hands back across the page boundary', () => {
    // executeJavaScript structured-clones the result, so one un-cloneable
    // value (a function, a Blob) fails the WHOLE call with "An object could
    // not be cloned". That really happened: a failure report included
    // isDownloadable, which is a method rather than a value, and took the
    // report down with it — so the run that was meant to explain a bug
    // produced no information at all.
    expect(WHATSAPP_BRIDGE_SRC).toContain('rawResolve(safe(v))')
    expect(WHATSAPP_BRIDGE_SRC).not.toContain('? md2.isDownloadable :')
  })

  it('is syntactically valid JavaScript', () => {
    // The whole point: nothing else in the build parses this string.
    expect(() => new Function(WHATSAPP_BRIDGE_SRC)).not.toThrow()
  })
})

describe('__fdWaSend server ack', () => {
  type Msg = { id: { fromMe: boolean; _serialized: string }; body: string; ack: number }

  /** Run the bridge in a sandbox whose WhatsApp modules are fakes. */
  function bridgeWith(opts: { ackAfterPolls?: number; finalAck: number; resolveWith?: 'msg' | 'nothing' }) {
    const msg: Msg = { id: { fromMe: true, _serialized: 'true_1@c.us_ABC' }, body: 'hi', ack: 0 }
    const chat = { id: '1@c.us', msgs: { getModelsArray: () => [msg] } }
    let polls = 0
    const modules: Record<string, unknown> = {
      WAWebCollections: { Msg: { on() {} }, Chat: { get: () => chat, length: 0 }, Contact: { get: () => null, length: 0 } },
      WAWebSendTextMsgChatAction: {
        sendTextMsgToChat: async () => (opts.resolveWith === 'msg' ? [msg] : undefined),
      },
    }
    const sandbox: Record<string, unknown> = {
      postMessage() {},
      require(name: string) {
        if (name in modules) return modules[name]
        throw new Error('no module ' + name)
      },
      setInterval: () => 0,
      clearInterval() {},
      // Poll delays collapse to a macrotask; the 30s stats timer never fires.
      setTimeout: (fn: () => void, ms: number) => {
        if (ms >= 30000) return 0
        polls++
        if (opts.ackAfterPolls !== undefined && polls >= opts.ackAfterPolls) msg.ack = opts.finalAck
        return setTimeout(fn, 0)
      },
    }
    sandbox.window = sandbox
    vm.runInNewContext(WHATSAPP_BRIDGE_SRC, sandbox)
    return sandbox as { __fdWaSend: (id: string, text: string) => Promise<Record<string, unknown>> }
  }

  it('reports acked once the server acknowledges the message', async () => {
    const w = bridgeWith({ ackAfterPolls: 3, finalAck: 1 })
    const res = await w.__fdWaSend('1@c.us', 'hi')
    expect(res).toMatchObject({ ok: true, acked: true, ack: 1, chatId: '1@c.us', via: 'get', messageId: 'true_1@c.us_ABC' })
  })

  it('reads the ack off the message the send action resolved with', async () => {
    const w = bridgeWith({ ackAfterPolls: 1, finalAck: 2, resolveWith: 'msg' })
    const res = await w.__fdWaSend('1@c.us', 'hi')
    expect(res).toMatchObject({ ok: true, acked: true, ack: 2 })
  })

  it('stays ok but flags a missing server ack after the poll budget', async () => {
    const w = bridgeWith({ finalAck: 0 })
    const res = await w.__fdWaSend('1@c.us', 'hi')
    expect(res).toMatchObject({ ok: true, acked: false, note: 'client accepted, server ack not observed' })
  })

  it('fails when the server marks the message as an error', async () => {
    const w = bridgeWith({ ackAfterPolls: 1, finalAck: -1 })
    const res = await w.__fdWaSend('1@c.us', 'hi')
    expect(res).toMatchObject({ ok: false, step: 'ack', acked: false, ack: -1 })
  })
})
