export interface AgentBrainMode {
  use: boolean
  learn: boolean
  temporary: boolean
}

export const DEFAULT_AGENT_BRAIN_MODE: AgentBrainMode = {
  use: true,
  learn: true,
  temporary: false,
}

export function normalizeAgentBrainMode(value: unknown): AgentBrainMode {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AGENT_BRAIN_MODE }
  const input = value as Partial<AgentBrainMode>
  return {
    use: input.use !== false,
    learn: input.learn !== false,
    temporary: input.temporary === true,
  }
}

export function brainModePolicy(mode: AgentBrainMode) {
  return {
    automaticContext: mode.use && !mode.temporary,
    durableWrites: mode.learn && !mode.temporary,
    explicitRead: true,
  }
}
