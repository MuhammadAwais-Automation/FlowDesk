import type { z } from 'zod'

/**
 * A tool the gateway's tools.list / tools.call expose to the external MCP
 * server. Same shape the Claude Agent SDK's tool() produced, so the gateway
 * and the tool files did not change when the in-app agents were removed.
 */
export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string
  description: string
  inputSchema: Shape
  annotations?: Record<string, unknown>
  handler: (args: z.infer<z.ZodObject<Shape>>, extra: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
}

export function tool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Shape,
  handler: ToolDefinition<Shape>['handler'],
  extras?: { annotations?: Record<string, unknown> },
): ToolDefinition<Shape> {
  return { name, description, inputSchema, handler, ...(extras?.annotations ? { annotations: extras.annotations } : {}) }
}
