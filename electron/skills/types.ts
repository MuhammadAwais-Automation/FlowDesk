export type SkillDomain = 'flow' | 'tiktok' | 'linkedin' | 'whatsapp' | 'brain' | 'general' | (string & {})

export interface SkillInputDefinition {
  type: string
  required?: boolean
  default?: any
  description?: string
}

export interface AtomicSkill {
  id: string
  name: string
  version: string
  domain: SkillDomain
  description: string
  tools: string[]
  inputs: Record<string, SkillInputDefinition>
  playbook: string
  createdAt: string
  updatedAt: string
  references?: string[]
  source?: 'builtin' | 'user'
  dir?: string
}

export interface WorkflowStep {
  id: string
  title: string
  skillId: string
  actionTool?: string
  params?: Record<string, any>
  dependsOn?: string[]
  condition?: string
  /** Extra attempts after a failure (default 0). */
  retries?: number
  /** Wait before the first retry, doubled each time (default 5000). */
  retryDelayMs?: number
}

export interface Workflow {
  id: string
  name: string
  version: string
  description: string
  domains: string[]
  skills: string[]
  steps: WorkflowStep[]
  playbook?: string
  createdAt: string
  updatedAt: string
}

export interface StepRunResult {
  status: string
  result?: any
  error?: string
  durationMs: number
  attempts?: number
}

export interface WorkflowRun {
  id: string
  workflowId: string
  /** Kept so a failed run can be resumed with what it started with. */
  inputs?: Record<string, any>
  status: 'pending' | 'running' | 'completed' | 'failed'
  stepResults: Record<string, StepRunResult>
  startedAt: string
  completedAt?: string
  error?: string
}

export interface SkillFilter {
  domain?: string
  search?: string
}

export interface WorkflowFilter {
  domain?: string
}
