export type NotebookLMStudioToolType =
  | 'audio_overview'
  | 'study_guide'
  | 'briefing_doc'
  | 'faq'
  | 'timeline'

export interface NotebookLMMediaAsset {
  id: string
  type: 'audio' | 'image' | 'video'
  title: string
  url: string
  durationSeconds?: number
  transcript?: string
}

export interface NotebookLMCitation {
  index: number
  sourceTitle: string
  quoteSnippet: string
  pageNumber?: number
}

export interface NotebookLMStudioResult {
  toolType: NotebookLMStudioToolType
  title: string
  content: string
  mediaAsset?: NotebookLMMediaAsset
}

export interface NotebookLMResearchTask {
  taskId: string
  notebookId: string
  prompt: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: number
  updatedAt: number
  result?: {
    answer: string
    citations: NotebookLMCitation[]
    studioOutputs?: NotebookLMStudioResult[]
    mediaAssets?: NotebookLMMediaAsset[]
  }
}

export interface NotebookLMNotebook {
  id: string
  title: string
  sourceCount: number
  lastModified?: string
}

export interface NotebookLMSource {
  id: string
  title: string
  type: 'pdf' | 'doc' | 'url' | 'youtube' | 'text'
}

export interface NotebookLMQueryResult {
  answer: string
  notebookId: string
  notebookTitle: string
  citations: NotebookLMCitation[]
  mediaAssets?: NotebookLMMediaAsset[]
}

export interface NotebookLMStreamChunk {
  queryId: string
  chunk: string
  isDone: boolean
}
