export type SkillDomain = 'flow' | 'tiktok' | 'linkedin' | 'whatsapp' | 'brain' | 'general'

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
}

export interface WorkflowStep {
  id: string
  title: string
  skillId: string
  actionTool?: string
  params?: Record<string, any>
  dependsOn?: string[]
  condition?: string
}

export interface Workflow {
  id: string
  name: string
  version: string
  description: string
  domains: string[]
  skills: string[]
  steps: WorkflowStep[]
  createdAt: string
  updatedAt: string
}

export interface StepRunResult {
  status: string
  result?: any
  error?: string
  durationMs: number
}

export interface WorkflowRun {
  id: string
  workflowId: string
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
