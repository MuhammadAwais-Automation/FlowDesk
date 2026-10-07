import { describe, expect, it } from 'vitest'
import {
  createProjectScript,
  renameProjectScript,
  listProjectMediaScript,
  generateImageScript,
  generateVideoScript,
  videoModelsScript,
  mediaStatusScript,
  getCreditsScript,
} from './flowBridge'

/**
 * These assert the wire format Flow's CURRENT frontend uses.
 *
 * The previous version of this file tested the labs.google tRPC API in detail
 * — endpoint paths, the json wrapper, aspect-ratio enums — and every one of
 * those tests passed while the feature was completely broken in the app,
 * because Google had replaced the API underneath. The tests were faithful to a
 * capture that had gone stale, which is the failure mode worth remembering
 * here: a test can only pin what was true when it was written.
 *
 * So these pin the things the 2026-09-17 capture actually showed, and each
 * assertion names the request it came from.
 */

/** The emitted script is a string; compiling it proves it is at least valid JS. */
function parses(script: string): boolean {
  try {
    new Function(`return ${script}`)
    return true
  } catch {
    return false
  }
}

describe('every script is syntactically valid', () => {
  // A template-literal escape resolved by TypeScript instead of the page once
  // shipped an unterminated string that surfaced only as "script error" at run
  // time. Parsing here is the cheap guard against that class of mistake.
  it('emits parseable JavaScript for each call', () => {
    expect(parses(createProjectScript('t'))).toBe(true)
    expect(parses(renameProjectScript('p', 't'))).toBe(true)
    expect(parses(listProjectMediaScript('p'))).toBe(true)
    expect(parses(generateImageScript('a boy in jungle', 'p', 'NANO_BANANA_2'))).toBe(true)
    expect(parses(generateVideoScript('kids playing', 'p', 'abra_t2v_8s'))).toBe(true)
    expect(parses(videoModelsScript())).toBe(true)
    expect(parses(mediaStatusScript('m'))).toBe(true)
    expect(parses(getCreditsScript())).toBe(true)
  })
})

describe('the batchexecute envelope', () => {
  it('goes to the Angular frontend endpoint, not the retired tRPC or aisandbox paths', () => {
    const script = createProjectScript('x')
    expect(script).toContain('/_/AiSandboxAngularFrontend/data/batchexecute')
    expect(script).not.toContain('/fx/api/trpc/')
    expect(script).not.toContain('aisandbox-pa.googleapis.com/v1/projects')
  })

  it('reads the per-session values from the page rather than hardcoding them', () => {
    // probes/flow-01-boq-params.js confirmed each key against the captured
    // request's own values; hardcoding any of them would work until the
    // session rolled over and then fail as if authentication had broken.
    const script = createProjectScript('x')
    expect(script).toContain('WIZ_global_data')
    expect(script).toContain('SNlM0e')
    expect(script).toContain('cfb2h')
    expect(script).toContain('FdrFJe')
  })

  it('finds the result row by rpcid instead of trusting its position', () => {
    // The number of framing rows varies per response.
    expect(createProjectScript('x')).toContain("row[0] === 'wrb.fr'")
  })
})

describe('createProjectScript', () => {
  it('uses the captured create rpc and argument shape', () => {
    const script = createProjectScript('FlowDeskProbeAlpha7')
    expect(script).toContain("callBatch('jHPbke'")
    expect(script).toContain("['projects/*', [null, [title]], [null, 22]]")
  })

  it('escapes the title rather than splicing it in raw', () => {
    expect(createProjectScript("it's \"quoted\"")).toContain(JSON.stringify('it\'s "quoted"'))
  })

  it('requires a project id back, not merely a 200', () => {
    expect(createProjectScript('x')).toContain('did not return a project id')
  })
})

describe('renameProjectScript', () => {
  it('sends the field mask the captured rename used', () => {
    const script = renameProjectScript('39baa7ee', 'FlowDeskProbeBeta7')
    expect(script).toContain("callBatch('o8DA4'")
    expect(script).toContain("[['project_title']]")
  })

  it('treats a title that does not come back as failure', () => {
    // The captured response echoes the new title; anything else is not a rename.
    expect(renameProjectScript('p', 't')).toContain('did not confirm the new title')
  })
})

describe('generateImageScript', () => {
  it('uses the captured image rpc and mints a fresh reCAPTCHA token in-page', () => {
    const script = generateImageScript('a boy in jungle', 'proj', 'NANO_BANANA_2')
    expect(script).toContain("callBatch('ogiZ0b'")
    expect(script).toContain("getRecaptchaToken('IMAGE_GENERATION')")
  })

  it('carries the client context at both levels, as the captured request did', () => {
    // Two occurrences of `ctx` in the argument: inside the per-request block
    // and again at the top level. Dropping either is the hand-picked-subset
    // mistake this project's findings already record.
    const script = generateImageScript('p', 'proj', 'NANO_BANANA_2')
    const argument = script.slice(script.indexOf('var arg = ['), script.indexOf("var out = await callBatch('ogiZ0b'"))
    expect(argument.match(/\bctx\b/g)?.length).toBe(2)
  })

  it('resolves the model to its real key', () => {
    expect(generateImageScript('p', 'proj', 'NANO_BANANA_2')).toContain('NARWHAL')
  })
})

describe('generateVideoScript', () => {
  it('uses the captured video rpc and the model key verbatim', () => {
    const script = generateVideoScript('kids playing', 'proj', 'abra_t2v_8s')
    expect(script).toContain("callBatch('YhhmEf'")
    expect(script).toContain('"abra_t2v_8s"')
    expect(script).toContain("getRecaptchaToken('VIDEO_GENERATION')")
  })

  it('does not name the trailing number "credits"', () => {
    // It behaved like a balance in one capture. One capture is not a meaning.
    const script = generateVideoScript('p', 'proj', 'abra')
    expect(script).toContain('creditsAfterIfThatIsWhatItIs')
  })
})

describe('getCreditsScript', () => {
  it('returns the numbers unlabelled, with the reason stated', () => {
    const script = getCreditsScript()
    expect(script).toContain("callBatch('nzlxg'")
    expect(script).toContain('has not been verified')
  })
})

describe('videoModelsScript', () => {
  it('asks Flow which models it accepts instead of hardcoding a table', () => {
    // The reference kit's model table was already caught being wrong once.
    expect(videoModelsScript()).toContain("callBatch('yBhWQ'")
  })
})

describe('mediaStatusScript', () => {
  it('looks a media id up with the captured argument shape', () => {
    expect(mediaStatusScript('8136473e')).toContain("callBatch('jwpduf'")
    expect(mediaStatusScript('8136473e')).toContain('var id = "8136473e"')
    expect(mediaStatusScript('8136473e')).toContain('[null, null, [[id]]]')
  })
})

describe('batchexecute rpc ids follow the service method, not a pinned code', () => {
  // Runs the real in-page callBatch against a fake Flow page whose loaded
  // bundle declares CreateProject under a NEW id.
  async function run(bundle: string) {
    const { __testing } = await import('./flowBridge')
    const sentIds: string[] = []
    const window = { WIZ_global_data: { SNlM0e: 'at-token', cfb2h: 'boq_x_20261007.01_p0' } } as Record<string, unknown>
    const performance = { getEntriesByType: () => [{ name: 'https://www.gstatic.com/_/mss/boq-labs-ai-sandbox/_/js/k=main.js' }] }
    const fetch = async (url: string) => {
      if (url.includes('gstatic')) return { text: async () => bundle }
      const id = new URL('https://flow.google.com' + url).searchParams.get('rpcids') ?? ''
      sentIds.push(id)
      return { status: 200, text: async () => `)]}'\n\n123\n[["wrb.fr","${id}","[\\"ok\\"]",null,null,null,"generic"]]\n` }
    }
    const script = __testing.buildScript(`
      var r = await callBatch('jHPbke', ['projects/*', [null, ['t']], [null, 22]])
      return { ok: r.ok, rpcId: r.rpcId, from: r.rpcIdFrom }
    `)
    const out = await new Function('window', 'performance', 'fetch', `return ${script}`)(window, performance, fetch)
    return { out, sentIds }
  }

  it('uses the id the page declares for /AiSandbox.CreateProject', async () => {
    const bundle = 'x;ETa=new _.Nx("Abc123",_.WK,_.XK,[_.hm,!1,_.em,"/AiSandbox.CreateProject"]);FTa=class{}'
    const { out, sentIds } = await run(bundle)
    expect(sentIds).toEqual(['Abc123'])
    expect(out).toEqual({ ok: true, rpcId: 'Abc123', from: 'page' })
  })

  it('keeps the pinned id when the method is not in the loaded code', async () => {
    const { out, sentIds } = await run('nothing relevant here')
    expect(sentIds).toEqual(['jHPbke'])
    expect(out).toMatchObject({ from: 'pinned' })
  })

  it('does not pair an id with the next declaration\'s method', async () => {
    const bundle = 'a=new _.Nx("Zzz111",_.A,_.B,[_.hm]);b=new _.Nx("jHPbke",_.C,_.D,[_.hm,!1,_.em,"/AiSandbox.CreateProject"])'
    const { sentIds } = await run(bundle)
    expect(sentIds).toEqual(['jHPbke'])
  })
})
