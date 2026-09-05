import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { BrainDatabase } from './database'
import { normalizeCapture } from './intelligence'

interface IngestBatchInput {
  source: 'whatsapp' | 'linkedin' | 'reddit'
  jobId: string
  stepId: string
  scopeId: string
  accountId: string | null
  connectorVersion: string
  records: Array<Record<string, unknown>>
  retentionDays?: number
}

function stringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof record[key] === 'string' && record[key]) return String(record[key])
  return null
}

export class ArtifactStore {
  constructor(private readonly database: BrainDatabase, private readonly root: string) {
    mkdirSync(root, { recursive: true })
  }

  ingestBatch(input: IngestBatchInput) {
    const jobRoot = resolve(this.root, input.jobId)
    const rawDir = join(jobRoot, 'raw')
    const normalizedDir = join(jobRoot, 'normalized')
    const reportDir = join(jobRoot, 'reports')
    mkdirSync(rawDir, { recursive: true })
    mkdirSync(normalizedDir, { recursive: true })
    mkdirSync(reportDir, { recursive: true })
    const rawPath = join(rawDir, `${input.stepId}.jsonl.gz`)
    const normalizedPath = join(normalizedDir, `${input.stepId}.jsonl.gz`)
    const reportPath = join(reportDir, 'manifest.md')
    const rawLines = input.records.map(record => JSON.stringify(record)).join('\n')
    writeFileSync(rawPath, gzipSync(rawLines))

    const normalized = input.records.map((record, index) => {
      const item = normalizeCapture({
        source: input.source,
        externalId: stringField(record, ['id', 'externalId', 'urn', 'messageId', 'chatId']) ?? `${input.stepId}-${index}`,
        parentExternalId: stringField(record, ['parentId', 'conversationUrn', 'threadId']),
        canonicalUrl: stringField(record, ['url', 'canonicalUrl', 'permalink']),
        text: stringField(record, ['text', 'body', 'title', 'lastMessage']) ?? '[structured record without text]',
        observedAt: stringField(record, ['createdAt', 'observedAt', 'timestamp']),
      }, {
        scopeId: input.scopeId,
        jobId: input.jobId,
        stepId: input.stepId,
        accountId: input.accountId,
        connectorVersion: input.connectorVersion,
      })
      item.envelope.rawPayloadRef = `artifact://${input.jobId}/raw/${input.stepId}.jsonl.gz`
      this.database.storeCaptureEnvelope(item.envelope, input.retentionDays ?? 30)
      return item
    })
    const normalizedLines = normalized.map(item => JSON.stringify(item)).join('\n')
    writeFileSync(normalizedPath, gzipSync(normalizedLines))
    const rawHash = createHash('sha256').update(rawLines).digest('hex')
    const normalizedHash = createHash('sha256').update(normalizedLines).digest('hex')
    const artifactRefs = [`file://${rawPath}`, `file://${normalizedPath}`, `file://${reportPath}`]
    const manifest = {
      version: 1,
      jobId: input.jobId,
      source: input.source,
      recordCount: input.records.length,
      capturedAt: new Date().toISOString(),
      coverage: { received: input.records.length, normalized: normalized.length },
      warnings: [],
      failures: [],
      schemas: [`${input.source}.capture.v1`],
      hashes: { raw: rawHash, normalized: normalizedHash },
      citations: normalized.map(item => item.evidence.sourceRef),
      artifactRefs,
    }
    writeFileSync(reportPath, `# ${input.source} capture\n\n- Records: ${input.records.length}\n- Raw hash: ${rawHash}\n- Normalized hash: ${normalizedHash}\n`, 'utf8')
    writeFileSync(join(jobRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    if (this.database.getJob(input.jobId)) {
      this.database.registerJobArtifact({ jobId: input.jobId, kind: 'raw', uri: artifactRefs[0], contentHash: rawHash, manifest })
      this.database.registerJobArtifact({ jobId: input.jobId, kind: 'normalized', uri: artifactRefs[1], contentHash: normalizedHash, manifest })
      this.database.registerJobArtifact({ jobId: input.jobId, kind: 'report', uri: artifactRefs[2], contentHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), manifest })
    }
    return manifest
  }
}
