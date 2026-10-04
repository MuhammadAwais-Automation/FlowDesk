import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startProbeRunner } from './probeRunner'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('probe runner re-runs', () => {
  it('does not run a probe that was only touched, and runs it once its content changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fd-probes-'))
    const file = join(dir, 'side-effect.js')
    writeFileSync(file, '// @target example.com\nreturn 1\n')
    const ran: string[] = []
    const stop = await startProbeRunner({ dir, resolveView: () => null, onResult: name => { ran.push(name) } })
    try {
      // What happened on restart: the file's timestamps moved, its content did not.
      const later = new Date(Date.now() + 60_000)
      utimesSync(file, later, later)
      await wait(2500)
      expect(ran).toEqual([])

      writeFileSync(file, '// @target example.com\nreturn 2\n')
      await wait(2500)
      expect(ran).toEqual(['side-effect'])
    } finally {
      stop()
    }
  }, 15_000)
})
