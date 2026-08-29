import { describe, expect, it } from 'vitest'
import {
  formatPayloadDate,
  getPayloadPreviewSummary,
  parsePayload,
} from './workerPayload'

describe('workerPayload', () => {
  const sampleNotebookLMOutput = JSON.stringify({
    ok: true,
    exitCode: 0,
    data: {
      notebooks: [
        {
          index: 1,
          id: '114c8e04-9e42-47dc-825b-e67a4380cf15',
          title: '',
          is_owner: true,
          created_at: '2026-07-31T18:53:09+00:00',
          modified_at: '2026-08-20T12:07:35+00:00',
        },
        {
          index: 2,
          id: 'c8f54e00-2c80-4ecf-926e-5f55c6573e4e',
          title: 'Flow desk',
          is_owner: true,
          created_at: '2026-04-15T18:54:46+00:00',
          modified_at: '2026-08-20T12:07:12+00:00',
        },
      ],
      count: 2,
    },
  })

  it('correctly detects notebooklm json payload', () => {
    const parsed = parsePayload(sampleNotebookLMOutput)
    expect(parsed.isJson).toBe(true)
    expect(parsed.kind).toBe('notebooks')
  })

  it('generates friendly preview summary for small card preview', () => {
    const summary = getPayloadPreviewSummary(sampleNotebookLMOutput)
    expect(summary.title).toBe('2 Notebooks Loaded')
    expect(summary.count).toBe(2)
    expect(summary.badge).toBe('NotebookLM')
  })

  it('handles plain text non-json output gracefully', () => {
    const plainText = 'This is a regular answer from Claude.'
    const parsed = parsePayload(plainText)
    expect(parsed.isJson).toBe(false)
    expect(parsed.kind).toBe('plain_text')

    const summary = getPayloadPreviewSummary(plainText)
    expect(summary.title).toContain('This is a regular answer')
  })

  it('handles command results schema', () => {
    const commandOutput = JSON.stringify({
      exitCode: 0,
      stdout: 'build succeeded\n',
      stderr: '',
    })
    const parsed = parsePayload(commandOutput)
    expect(parsed.isJson).toBe(true)
    expect(parsed.kind).toBe('command_result')

    const summary = getPayloadPreviewSummary(commandOutput)
    expect(summary.title).toContain('Exit Code 0')
  })

  it('formats dates cleanly', () => {
    const formatted = formatPayloadDate('2026-08-20T12:07:35+00:00')
    expect(formatted).toContain('2026')
    expect(formatPayloadDate(undefined)).toBe('\u2014')
  })
})
