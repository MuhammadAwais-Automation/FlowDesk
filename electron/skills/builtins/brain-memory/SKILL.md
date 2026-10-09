---
name: brain-memory
title: "FlowDesk Brain Memory & Knowledge Vault"
description: "Maintains persistent knowledge, remembers user preferences and decisions, performs semantic searches, and manages candidate insights in the local Brain vault. Use when recalling past context, searching documents, or storing learned facts."
version: 2.0.0
domain: brain
tools:
  - brain_status
  - brain_overview
  - brain_search
  - brain_remember
  - brain_list_memories
  - brain_answer_pack
  - brain_read_document
  - brain_search_documents
  - brain_neighbors
  - brain_list_candidates
  - brain_decide_candidate
inputs:
  action:
    type: string
    required: false
    default: search
    description: "Intended operation: search, remember, answer_pack, document, or review"
  query:
    type: string
    required: false
    description: "Search query or natural-language question for knowledge retrieval"
  text:
    type: string
    required: false
    description: "Fact, preference, decision, or insight text to store into memory"
  kind:
    type: string
    required: false
    default: fact
    description: "Category: fact, preference, decision, goal, person, organization, opportunity, procedure, or note"
  path:
    type: string
    required: false
    description: "Vault-relative document path (e.g. projects/demo.md) for document reading or graph traversal"
---

## When to use
Session start and end, records, content life paths and learnings are in the `brain-protocol`, `content-life-path`, `background-jobs` and `weekly-review` skills; this skill covers the knowledge library and long-form memories.

- Storing durable facts, user directives, creative constraints, and operational decisions into FlowDesk Brain (`brain_remember`).
- Performing semantic and FTS5 full-text searches across indexed knowledge documents and memories (`brain_search`, `brain_search_documents`).
- Generating an evidence-backed answer pack with cited context passages for complex planning questions (`brain_answer_pack`).
- Navigating the semantic knowledge graph to find related concept documents (`brain_neighbors`).
- Reviewing, accepting, or rejecting autonomous knowledge candidates captured from session activity (`brain_list_candidates`, `brain_decide_candidate`).

## When not to use
- Short-lived, temporary session scratch data (store in temporary files or runtime variables instead).
- Storing passwords, API tokens, raw session cookies, or PII into persistent vector memory.
- Driving social media browsers or media synthesis models (use domain-specific skills instead).

## Tools

### brain_status
Inspects Brain database connectivity, FTS5 full-text indexing, and schema status.
- **Parameters**: None.
- **Success shape**:
  ```json
  {
    "ok": true,
    "result": {
      "ready": true,
      "degraded": false,
      "fts5": true,
      "schemaVersion": 8
    }
  }
  ```

### brain_overview
Provides counts of active memories, pending review candidates, and background indexing jobs.
- **Parameters**:
  - `scopeId`: string (optional).
- **Success shape**:
  ```json
  {
    "ok": true,
    "result": {
      "memories": 7,
      "candidates": 0,
      "jobs": 29,
      "activeJobs": 6
    }
  }
  ```

### brain_search & brain_search_documents
- `brain_search`: Semantic search across atomic memories and knowledge chunks.
  - Parameters: `query` (string, required), `scopeId` (string, optional), `limit` (number, 1 to 50, optional).
  - Returns ranked passages with similarity scores and source metadata.
- `brain_search_documents`: Search structured markdown documents in the Brain vault.
  - Parameters: `query` (string, required), `scopeId` (string, optional), `limit` (number, 1 to 50, optional).

### brain_remember
Persists a learned fact, user preference, decision, or procedural guideline into the Brain vault.
- **Parameters**:
  - `text`: string (required). The insight to store.
  - `kind`: enum string (optional, `'fact'` | `'preference'` | `'decision'` | `'goal'` | `'person'` | `'organization'` | `'opportunity'` | `'procedure'` | `'note'`, default `'fact'`).
  - `scopeId`: string (optional).
- **Success shape**: `{ "ok": true, "result": { "id": "uuid", "created": true } }`.

### brain_list_memories
Lists stored memories in chronological order.
- **Parameters**: `scopeId`: string (optional).
- **Success shape**:
  ```json
  {
    "ok": true,
    "result": [
      {
        "id": "mem-00000000-0000-0000-0000-000000000001",
        "scopeId": "scope-00000000-0000-0000-0000-000000000001",
        "kind": "procedure",
        "text": "Strict Prompt Rule for Video Models: NEVER mention platform names ('TikTok', 'Instagram', 'YouTube', 'Reels') inside generative video prompts..."
      }
    ]
  }
  ```

### brain_answer_pack
Synthesizes relevant knowledge passages into an assembled answer pack within a defined token budget.
- **Parameters**:
  - `question`: string (required). The prompt or question to answer.
  - `tokenBudget`: integer (optional, 200 to 4000). Max token budget for citations.
- **Success shape**: `{ "ok": true, "result": { "answer": "...", "citations": [...] } }`.

### brain_read_document & brain_neighbors
- `brain_read_document`: Reads markdown text from a relative vault path (`path`: string, required).
- `brain_neighbors`: Traverses semantic links from a document (`path`: string, required, `depth`: 1 or 2).

### brain_list_candidates & brain_decide_candidate
- `brain_list_candidates`: Lists candidate memories waiting for user review.
- `brain_decide_candidate`: Accepts or rejects a candidate (`id`: string, `decision`: `'accept'` | `'reject'`, `editedText`?: string).

## Procedure

1. **Check Brain Health**:
   Call `brain_status` to ensure `ready === true` and FTS5 is available.

2. **Recall Context Before Starting Tasks**:
   When working with a persona, channel, or prompt guideline, call `brain_search` with relevant keywords (e.g. `"video prompt rule"` or `"character lock"`).
   Alternatively, call `brain_answer_pack` with a question to receive direct citations.

3. **Store Learned Facts**:
   When the user gives a standing preference or a concrete constraint is discovered:
   Call `brain_remember` with `{ text, kind: "preference" }` or `{ text, kind: "procedure" }`.

4. **Document Inspection**:
   When deeper structural documents are referenced, use `brain_search_documents` and `brain_read_document` to inspect full markdown guides.

5. **Review Candidate Knowledge**:
   Periodically call `brain_list_candidates` to inspect inferred facts. Call `brain_decide_candidate` with `decision: "accept"` or `"reject"`.

## Limits and safety
- **Security & PII Boundary**: Do not store passwords, authentication tokens, session cookies, or sensitive PII into Brain memories.
- **Token Budget Discipline**: `brain_answer_pack` enforces a `tokenBudget` between 200 and 4,000 tokens to prevent context window overflow (`bin/flowdesk-mcp.mjs:1825`).
- **Graph Traversal Limits**: `brain_neighbors` caps traversal depth at 2 (`bin/flowdesk-mcp.mjs:1856`) to prevent cyclic graph explosion.
- **Atomic Memory Scope**: Keep stored memories atomic and single-topic. Long sprawling essays degrade vector search similarity precision.

## Verified facts
- Live RPC test on 2026-09-28 confirmed `brain.status` returns `{ ready: true, degraded: false, fts5: true, schemaVersion: 8 }`.
- Live RPC test on 2026-09-28 confirmed `brain.overview` returns active memory count, candidates, and job numbers.
- `brain.listMemories` returned real procedure memories including `"Strict Prompt Rule for Video Models: NEVER mention platform names...""`.
- All 11 `brain_*` tools are registered directly in `bin/flowdesk-mcp.mjs:1749-1877`.

## Not verified
- Vector re-indexing performance during massive bulk ingestion (>10,000 documents simultaneously).
