/**
 * Manifest builder — renders the flat index an agent carries in every turn.
 *
 * STUB. Implemented by work package W1 — see docs/brain-v2/w1-manifest.md.
 * Flat by design: hierarchical disclosure measured worse than flat in the
 * controlled comparison this design comes from. Do not add a tree.
 */

import type { KnowledgeDocType, ManifestRender } from '../../../src/types/brainKnowledge'
import type { DocumentStorePort } from './ports'

export const MANIFEST_DEFAULT_TOKEN_BUDGET = 4000
export const MANIFEST_MAX_TOKEN_BUDGET = 8000

export interface BuildManifestInput {
  scopeId: string
  types?: KnowledgeDocType[]
  tokenBudget?: number
}

const NOT_IMPLEMENTED = 'ManifestBuilder is not implemented yet — see docs/brain-v2/w1-manifest.md'

export class ManifestBuilder {
  constructor(private readonly documents: DocumentStorePort) {}

  build(_input: BuildManifestInput): ManifestRender {
    // Touches the port so the held dependency survives typecheck until W1 uses it.
    void this.documents
    throw new Error(NOT_IMPLEMENTED)
  }
}
