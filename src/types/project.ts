export interface ProjectSession {
  id: string
  title: string
  rootPath: string
  createdAt: string
  lastOpenedAt: string
}

export interface ProjectSessionSnapshot {
  projects: ProjectSession[]
  activeProjectId: string | null
}
