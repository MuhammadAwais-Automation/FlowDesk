export function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{([^}]+)\}\}/g) || []
  return [...new Set(matches.map(m => m.slice(2, -2).trim()))]
}

export function fillVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    return values[key.trim()] ?? `{{${key}}}`
  })
}
