/**
 * FlowDesk's stable NotebookLM capability contract.  Callers use product
 * concepts rather than notebooklm-py command syntax, allowing the transport
 * to move from the CLI to its optional local REST server later.
 */
import {
  notebooklmAddSource, notebooklmAsk, notebooklmCreateNotebook,
  notebooklmDownloadArtifact, notebooklmGenerateArtifact, notebooklmListArtifacts,
  notebooklmListNotebooks, notebooklmListSources, notebooklmGetSourceCounts, notebooklmManage,
  notebooklmResearchStatus, notebooklmStartResearch, type NotebookLMArtifactKind,
  type NotebookLMArtifactRequest, type NotebookLMResult, type NotebookLMSourceInput,
} from './notebooklm'
import { notebooklmServiceRequest } from './notebooklmService'

export type ResearchMode = 'fast' | 'deep'
export type ArtifactKind = NotebookLMArtifactKind
export type CapabilityResult = NotebookLMResult

export interface CreateNotebookInput { title: string }
export interface AddNotebookSourceInput { notebookId: string; content: string; type: 'text' | 'url'; title?: string }
export interface StartResearchInput { notebookId: string; query: string; mode?: ResearchMode }
export interface AskNotebookInput { notebookId: string; question: string }
export interface GenerateArtifactInput { notebookId: string; kind: ArtifactKind; instructions?: string; sourceIds?: string[]; options?: Record<string, string | number | boolean | undefined> }
export interface DownloadArtifactInput { notebookId: string; kind: ArtifactKind; artifactId?: string }

export interface NotebookCapabilities {
  listNotebooks(): Promise<CapabilityResult>
  createNotebook(input: CreateNotebookInput): Promise<CapabilityResult>
  addSource(input: AddNotebookSourceInput): Promise<CapabilityResult>
  listSources(notebookId: string): Promise<CapabilityResult>
  getSourceCounts(notebookIds: string[]): Promise<Record<string, number>>
  startResearch(input: StartResearchInput): Promise<CapabilityResult>
  researchStatus(notebookId: string): Promise<CapabilityResult>
  ask(input: AskNotebookInput): Promise<CapabilityResult>
  listArtifacts(notebookId: string): Promise<CapabilityResult>
  generateArtifact(input: GenerateArtifactInput): Promise<CapabilityResult>
  downloadArtifact(input: DownloadArtifactInput): Promise<CapabilityResult>
  manage(action: string, input?: { notebookId?: string; args?: string[] }): Promise<CapabilityResult>
}

export const notebookCapabilities: NotebookCapabilities = {
  listNotebooks: async () => (await notebooklmServiceRequest('/notebooks')) ?? notebooklmListNotebooks(),
  createNotebook: async ({ title }) => (await notebooklmServiceRequest('/notebooks', jsonRequest('POST', { title }))) ?? notebooklmCreateNotebook(title),
  addSource: async (input) => (await notebooklmServiceRequest(`/notebooks/${encodeURIComponent(input.notebookId)}/sources/${input.type}`, jsonRequest('POST', input.type === 'url' ? { url: input.content } : { text: input.content, title: input.title }))) ?? notebooklmAddSource(input satisfies NotebookLMSourceInput),
  listSources: async (notebookId) => (await notebooklmServiceRequest(`/notebooks/${encodeURIComponent(notebookId)}/sources`)) ?? notebooklmListSources(notebookId),
  getSourceCounts: (notebookIds) => notebooklmGetSourceCounts(notebookIds),
  startResearch: async ({ notebookId, query, mode = 'deep' }) => (await notebooklmServiceRequest(`/notebooks/${encodeURIComponent(notebookId)}/research`, jsonRequest('POST', { query, mode, source: 'web' }))) ?? notebooklmStartResearch(notebookId, query, mode),
  researchStatus: (notebookId) => notebooklmResearchStatus(notebookId),
  ask: async ({ notebookId, question }) => (await notebooklmServiceRequest(`/notebooks/${encodeURIComponent(notebookId)}/chat`, jsonRequest('POST', { question }))) ?? notebooklmAsk(notebookId, question),
  listArtifacts: async (notebookId) => (await notebooklmServiceRequest(`/notebooks/${encodeURIComponent(notebookId)}/artifacts`)) ?? notebooklmListArtifacts(notebookId),
  generateArtifact: async (input) => (await notebooklmServiceRequest(`/notebooks/${encodeURIComponent(input.notebookId)}/artifacts`, jsonRequest('POST', {
    type: input.kind, prompt: input.instructions, source_ids: input.sourceIds, ...input.options,
  }))) ?? notebooklmGenerateArtifact(input satisfies NotebookLMArtifactRequest),
  downloadArtifact: ({ notebookId, kind, artifactId }) => notebooklmDownloadArtifact(notebookId, kind, artifactId),
  manage: (action, input) => notebooklmManage(action, input),
}

function jsonRequest(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
