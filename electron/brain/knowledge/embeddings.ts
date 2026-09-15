/**
 * Sentence embeddings, in-process and offline.
 *
 * Built because it was measured, not because it is fashionable: on 30 real
 * Roman-Urdu questions against the real vault, lexical retrieval put the right
 * document first 17% of the time and anywhere in the answer pack 33%, while
 * these vectors reach 50% at top-1 and 63% in the top three. See
 * `retrievalGate.test.ts` for the harness that produced those numbers.
 *
 * Everything here degrades rather than throws. The model is a 118MB download on
 * first use, and a packaging mistake, a missing native binary or a cold offline
 * start must leave the Brain working exactly as it did before — lexical-only —
 * instead of taking retrieval down with it.
 */

/**
 * Multilingual because the questions are Roman Urdu; `q8` because the int8 build
 * is ~118MB against ~470MB for fp32 and the measurement above used q8.
 *
 * Caveat worth keeping visible: no published benchmark covers Roman Urdu for any
 * small embedding model. The 50% figure is from this vault and this question
 * set, not from a paper.
 */
export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small'
export const EMBEDDING_DIMENSIONS = 384

/**
 * e5 models are trained with these prefixes and lose noticeable accuracy without
 * them — the asymmetry is the point: a short question and a long document are
 * encoded for different roles.
 */
const QUERY_PREFIX = 'query: '
const PASSAGE_PREFIX = 'passage: '

/** Enough of a document to characterise it; the whole body would mostly add noise. */
const PASSAGE_CHARACTER_LIMIT = 2000

type Extractor = (text: string, options: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>

let extractor: Extractor | null = null
let loadFailed = false
let loading: Promise<Extractor | null> | null = null

async function loadExtractor(): Promise<Extractor | null> {
  if (extractor) return extractor
  if (loadFailed) return null
  if (loading) return loading

  loading = (async () => {
    try {
      // Dynamic import for the same reason leadAgent.ts uses one: the package is
      // ESM-only, and this file must stay importable by CommonJS-shaped builds.
      const { pipeline } = await import('@huggingface/transformers')
      const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' })
      extractor = pipe as unknown as Extractor
      return extractor
    } catch (error) {
      loadFailed = true
      console.log(`[FlowDesk brain] embeddings unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      loading = null
    }
  })()
  return loading
}

/** True once the model has loaded; false before first use and after a failure. */
export function embeddingsReady(): boolean {
  return extractor !== null
}

export function embeddingsFailed(): boolean {
  return loadFailed
}

async function embed(text: string): Promise<Float32Array | null> {
  const pipe = await loadExtractor()
  if (!pipe) return null
  try {
    const output = await pipe(text, { pooling: 'mean', normalize: true })
    return Float32Array.from(output.data)
  } catch (error) {
    console.log(`[FlowDesk brain] embedding failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export function embedQuery(question: string): Promise<Float32Array | null> {
  return embed(`${QUERY_PREFIX}${question}`)
}

export function embedPassage(title: string, body: string): Promise<Float32Array | null> {
  return embed(`${PASSAGE_PREFIX}${title}\n${body.slice(0, PASSAGE_CHARACTER_LIMIT)}`)
}

/**
 * Both vectors are already L2-normalised by the pipeline, so the dot product is
 * the cosine and the square roots can go.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index]
  return dot
}

export function vectorToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(0) as ArrayBuffer)
}

export function blobToVector(blob: Uint8Array): Float32Array {
  // Copy rather than view: SQLite's buffer is not guaranteed to be aligned for
  // Float32Array, and an unaligned view throws.
  const copy = new Uint8Array(blob.length)
  copy.set(blob)
  return new Float32Array(copy.buffer)
}

/** Test seam: lets a test drive the vector path without loading a 118MB model. */
export function __setExtractorForTests(fake: Extractor | null): void {
  extractor = fake
  loadFailed = false
  loading = null
}
