import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile, unlink, mkdir, rm } from 'node:fs/promises'
import { join, dirname, basename, extname, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { AtomicSkill, Workflow, SkillFilter, WorkflowFilter } from './types'

let cachedSkills = new Map<string, AtomicSkill>()
let cachedWorkflows = new Map<string, Workflow>()
let activeUserSkillsDir: string | null = null
let activeBuiltinsDir: string | null = null

const skillIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function assertValidSkillId(id: string): void {
  if (!skillIdPattern.test(id)) {
    throw new Error(`Invalid skill id "${id}": expected kebab-case with at most 64 characters`)
  }
}

function stripYamlComment(line: string): string {
  let singleQuoted = false
  let doubleQuoted = false
  let escaped = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (doubleQuoted && char === '\\' && !escaped) {
      escaped = true
      continue
    }
    if (char === '"' && !singleQuoted && !escaped) {
      doubleQuoted = !doubleQuoted
    } else if (char === '\'' && !doubleQuoted) {
      singleQuoted = !singleQuoted
    } else if (char === '#' && !singleQuoted && !doubleQuoted && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i)
    }
    escaped = false
  }

  return line
}

export function getDefaultBuiltinsDir(): string {
  const currentDir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(process.cwd(), 'electron', 'skills', 'builtins'),
    join(currentDir, 'builtins'),
    join(currentDir, 'skills', 'builtins'),
    join(currentDir, '..', '..', 'electron', 'skills', 'builtins'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return join(process.cwd(), 'electron', 'skills', 'builtins')
}

export function getDefaultUserSkillsDir(): string {
  if (process.env.FLOWDESK_USER_SKILLS_DIR) {
    return process.env.FLOWDESK_USER_SKILLS_DIR
  }
  if (process.env.APPDATA) {
    return join(process.env.APPDATA, 'FlowDesk', 'skills')
  }
  return join(homedir(), '.flowdesk', 'skills')
}

export function parseYamlValue(raw: string): any {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null' || trimmed === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith('\'') && trimmed.endsWith('\'')) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map(s => parseYamlValue(s.trim()))
        .filter(s => s !== '')
    }
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

export function parseSimpleYaml(yamlStr: string): Record<string, any> {
  const rawLines = yamlStr.split('\n')
  const lines: { indent: number; text: string; lineNo: number }[] = []

  for (let i = 0; i < rawLines.length; i++) {
    const original = rawLines[i]
    const withoutComment = stripYamlComment(original)
    if (!withoutComment.trim()) continue
    const indent = withoutComment.search(/\S/)
    lines.push({ indent, text: withoutComment.trim(), lineNo: i })
  }

  function parseBlock(startIdx: number, currentIndent: number): { data: any; nextIdx: number } {
    if (startIdx >= lines.length) return { data: {}, nextIdx: startIdx }

    const isList = lines[startIdx].text.startsWith('- ')
    if (isList) {
      const arr: any[] = []
      let idx = startIdx
      while (idx < lines.length) {
        const item = lines[idx]
        if (item.indent < currentIndent) break
        if (item.indent > currentIndent) {
          idx++
          continue
        }
        if (!item.text.startsWith('- ')) break

        const content = item.text.slice(2).trim()
        if (content.includes(': ') || content.endsWith(':')) {
          const colonPos = content.indexOf(':')
          const key = content.slice(0, colonPos).trim()
          const valPart = content.slice(colonPos + 1).trim()
          const obj: Record<string, any> = {}

          if (valPart.length > 0) {
            obj[key] = parseYamlValue(valPart)
            idx++
          } else {
            const child = parseBlock(idx + 1, item.indent + 2)
            obj[key] = child.data
            idx = child.nextIdx
          }

          while (idx < lines.length && lines[idx].indent > item.indent && !lines[idx].text.startsWith('- ')) {
            const nextItem = lines[idx]
            const nextColon = nextItem.text.indexOf(':')
            if (nextColon !== -1) {
              const subKey = nextItem.text.slice(0, nextColon).trim()
              const subVal = nextItem.text.slice(nextColon + 1).trim()
              if (subVal.length > 0) {
                obj[subKey] = parseYamlValue(subVal)
                idx++
              } else {
                const subChild = parseBlock(idx + 1, nextItem.indent + 2)
                obj[subKey] = subChild.data
                idx = subChild.nextIdx
              }
            } else {
              idx++
            }
          }
          arr.push(obj)
        } else {
          arr.push(parseYamlValue(content))
          idx++
        }
      }
      return { data: arr, nextIdx: idx }
    }

    const obj: Record<string, any> = {}
    let idx = startIdx
    while (idx < lines.length) {
      const item = lines[idx]
      if (item.indent < currentIndent) break
      if (item.indent > currentIndent) {
        idx++
        continue
      }

      const colonIdx = item.text.indexOf(':')
      if (colonIdx === -1) {
        idx++
        continue
      }

      const key = item.text.slice(0, colonIdx).trim()
      const valStr = item.text.slice(colonIdx + 1).trim()

      if (valStr.length > 0) {
        obj[key] = parseYamlValue(valStr)
        idx++
      } else {
        if (idx + 1 < lines.length && lines[idx + 1].indent > item.indent) {
          const childIndent = lines[idx + 1].indent
          const child = parseBlock(idx + 1, childIndent)
          obj[key] = child.data
          idx = child.nextIdx
        } else {
          obj[key] = null
          idx++
        }
      }
    }

    return { data: obj, nextIdx: idx }
  }

  const result = parseBlock(0, lines[0]?.indent ?? 0)
  return result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : {}
}

export function parseFrontmatter(rawContent: string): { attributes: Record<string, any>; body: string } {
  const normalized = rawContent.replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { attributes: {}, body: normalized.trim() }
  }

  const rawHeader = match[1].trim()
  const body = match[2].trim()

  if (rawHeader.startsWith('{') && rawHeader.endsWith('}')) {
    try {
      return { attributes: JSON.parse(rawHeader), body }
    } catch {
      // continue to yaml
    }
  }

  const attributes = parseSimpleYaml(rawHeader)
  return { attributes, body }
}

type SkillSource = 'builtin' | 'user'

async function listReferenceFiles(skillDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(skillDir, 'references'), { withFileTypes: true })
    return entries.filter(entry => entry.isFile()).map(entry => entry.name).sort()
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
}

function stringAttribute(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

async function loadFolderSkill(dirPath: string, folderName: string, source: SkillSource): Promise<AtomicSkill | undefined> {
  const skillDir = join(dirPath, folderName)
  let content: string
  try {
    content = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    return undefined
  }

  const { attributes, body } = parseFrontmatter(content)
  if (Object.keys(attributes).length === 0) return undefined

  const frontmatterName = stringAttribute(attributes.name, folderName)
  if (frontmatterName !== folderName) {
    console.warn(`[FlowDesk Skills] ${folderName}/SKILL.md name "${frontmatterName}" does not match folder; using "${folderName}"`)
  }
  const effectiveName = frontmatterName === folderName ? frontmatterName : folderName
  const now = new Date().toISOString()

  return {
    id: folderName,
    name: stringAttribute(attributes.title, effectiveName),
    version: stringAttribute(attributes.version, '1.0.0'),
    domain: stringAttribute(attributes.domain, 'general'),
    description: stringAttribute(attributes.description, ''),
    tools: Array.isArray(attributes.tools) ? attributes.tools.filter((tool): tool is string => typeof tool === 'string') : [],
    inputs: attributes.inputs && typeof attributes.inputs === 'object' && !Array.isArray(attributes.inputs) ? attributes.inputs : {},
    playbook: body,
    createdAt: stringAttribute(attributes.createdAt, now),
    updatedAt: stringAttribute(attributes.updatedAt, now),
    references: await listReferenceFiles(skillDir),
    source,
    dir: skillDir,
  }
}

async function scanDirectory(dirPath: string, source: SkillSource): Promise<void> {
  let entries: string[] = []
  try {
    entries = await readdir(dirPath)
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return
    }
    throw error
  }

  const jsonFiles = new Map<string, string>()
  const mdFiles = new Map<string, string>()
  const skillFolders: string[] = []

  for (const entry of entries) {
    const ext = extname(entry).toLowerCase()
    const fullPath = join(dirPath, entry)
    if (ext === '') {
      skillFolders.push(entry)
    } else if (ext === '.json') {
      try {
        const content = await readFile(fullPath, 'utf8')
        jsonFiles.set(entry, content)
      } catch {
        // skip unreadable
      }
    } else if (ext === '.md') {
      try {
        const content = await readFile(fullPath, 'utf8')
        mdFiles.set(entry, content)
      } catch {
        // skip unreadable
      }
    }
  }

  // Check subfolder workflows if present
  try {
    const subEntries = await readdir(join(dirPath, 'workflows'))
    for (const sub of subEntries) {
      if (sub.endsWith('.json')) {
        try {
          const content = await readFile(join(dirPath, 'workflows', sub), 'utf8')
          jsonFiles.set(`workflows/${sub}`, content)
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // no workflows subfolder
  }

  // 1. Process JSON files
  for (const [filename, content] of jsonFiles.entries()) {
    try {
      const parsed = JSON.parse(content)
      const base = basename(filename, '.json')
      const workflowBase = base.endsWith('.workflow') ? base.slice(0, -'.workflow'.length) : base

      // Is it a workflow?
      if (Array.isArray(parsed.steps) || filename.includes('.workflow.') || filename.startsWith('workflows/')) {
        const wf: Workflow = {
          id: parsed.id || workflowBase,
          name: parsed.name || workflowBase,
          version: parsed.version || '1.0.0',
          description: parsed.description || '',
          domains: Array.isArray(parsed.domains) ? parsed.domains : [],
          skills: Array.isArray(parsed.skills) ? parsed.skills : [],
          steps: Array.isArray(parsed.steps) ? parsed.steps : [],
          createdAt: parsed.createdAt || new Date().toISOString(),
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        }
        cachedWorkflows.set(wf.id, wf)
        continue
      }

      // Check if paired with a markdown file
      const matchingMdName = `${base}.md`
      let playbook = parsed.playbook || ''
      if (mdFiles.has(matchingMdName)) {
        const mdContent = mdFiles.get(matchingMdName)!
        const { body } = parseFrontmatter(mdContent)
        playbook = body || mdContent
      }

      const skill: AtomicSkill = {
        id: parsed.id || base,
        name: parsed.name || base,
        version: parsed.version || '1.0.0',
        domain: parsed.domain || 'general',
        description: parsed.description || '',
        tools: Array.isArray(parsed.tools) ? parsed.tools : [],
        inputs: parsed.inputs && typeof parsed.inputs === 'object' ? parsed.inputs : {},
        playbook,
        createdAt: parsed.createdAt || new Date().toISOString(),
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        source,
      }
      cachedSkills.set(skill.id, skill)
    } catch {
      // skip invalid JSON
    }
  }

  // 2. Process standalone Markdown files with frontmatter
  for (const [filename, content] of mdFiles.entries()) {
    const base = basename(filename, '.md')
    if (jsonFiles.has(`${base}.json`)) {
      // Already handled as a pair
      continue
    }

    try {
      const { attributes, body } = parseFrontmatter(content)
      if (Object.keys(attributes).length === 0) continue

      if (Array.isArray(attributes.steps) || filename.includes('.workflow.')) {
        const wf: Workflow = {
          id: attributes.id || base,
          name: attributes.name || base,
          version: attributes.version || '1.0.0',
          description: attributes.description || '',
          domains: Array.isArray(attributes.domains) ? attributes.domains : [],
          skills: Array.isArray(attributes.skills) ? attributes.skills : [],
          steps: Array.isArray(attributes.steps) ? attributes.steps : [],
          createdAt: attributes.createdAt || new Date().toISOString(),
          updatedAt: attributes.updatedAt || new Date().toISOString(),
        }
        cachedWorkflows.set(wf.id, wf)
      } else {
        const skill: AtomicSkill = {
          id: attributes.id || base,
          name: attributes.name || base,
          version: attributes.version || '1.0.0',
          domain: attributes.domain || 'general',
          description: attributes.description || '',
          tools: Array.isArray(attributes.tools) ? attributes.tools : [],
          inputs: attributes.inputs && typeof attributes.inputs === 'object' ? attributes.inputs : {},
          playbook: body,
          createdAt: attributes.createdAt || new Date().toISOString(),
          updatedAt: attributes.updatedAt || new Date().toISOString(),
          source,
        }
        cachedSkills.set(skill.id, skill)
      }
    } catch {
      // skip invalid frontmatter
    }
  }

  // 3. Process Agent Skills folders last so they win over legacy pairs.
  for (const folderName of skillFolders) {
    const skill = await loadFolderSkill(dirPath, folderName, source)
    if (skill) cachedSkills.set(folderName, skill)
  }
}

export async function initSkillsRegistry(options?: {
  userDataDir?: string
  userSkillsDir?: string
  builtinsDir?: string
  projectSkillsDir?: string
  projectWorkflowsDir?: string
}): Promise<void> {
  cachedSkills.clear()
  cachedWorkflows.clear()

  activeBuiltinsDir = options?.builtinsDir ?? getDefaultBuiltinsDir()
  activeUserSkillsDir = options?.userSkillsDir ?? (options?.userDataDir ? join(options.userDataDir, 'skills') : getDefaultUserSkillsDir())

  if (activeUserSkillsDir) {
    try {
      await mkdir(activeUserSkillsDir, { recursive: true })
    } catch {
      // ignore
    }
  }

  // 1. Scan official FlowDesk built-in skills & workflows
  await scanDirectory(activeBuiltinsDir, 'builtin')

  // 2. Scan official user custom skills (%APPDATA%/FlowDesk/skills)
  await scanDirectory(activeUserSkillsDir, 'user')

  // 3. Scan user custom workflows (%APPDATA%/FlowDesk/workflows)
  if (activeUserSkillsDir) {
    const userWorkflowsDir = join(activeUserSkillsDir, '..', 'workflows')
    try {
      await mkdir(userWorkflowsDir, { recursive: true })
      await scanDirectory(userWorkflowsDir, 'user')
    } catch {
      // ignore
    }
  }

  console.log(`[FlowDesk Skills] loaded ${cachedSkills.size} skills and ${cachedWorkflows.size} workflows`)
}

export function listSkills(filter?: SkillFilter): AtomicSkill[] {
  const skills = Array.from(cachedSkills.values())
  if (!filter) return skills

  return skills.filter(skill => {
    if (filter.domain && skill.domain !== filter.domain) {
      return false
    }
    if (filter.search) {
      const q = filter.search.toLowerCase()
      const inName = skill.name.toLowerCase().includes(q)
      const inDesc = skill.description.toLowerCase().includes(q)
      const inId = skill.id.toLowerCase().includes(q)
      if (!inName && !inDesc && !inId) return false
    }
    return true
  })
}

export function getSkill(id: string): AtomicSkill | undefined {
  return cachedSkills.get(id)
}

function serializeYamlScalar(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  return JSON.stringify(value)
}

function serializeSkill(skill: AtomicSkill): string {
  const lines = [
    '---',
    `name: ${skill.id}`,
    `title: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description)}`,
    `version: ${JSON.stringify(skill.version)}`,
    `domain: ${skill.domain}`,
  ]

  if (skill.tools.length === 0) {
    lines.push('tools: []')
  } else {
    lines.push('tools:')
    for (const tool of skill.tools) lines.push(`  - ${tool}`)
  }

  const inputs = Object.entries(skill.inputs)
  if (inputs.length === 0) {
    lines.push('inputs: {}')
  } else {
    lines.push('inputs:')
    for (const [inputName, input] of inputs) {
      lines.push(`  ${inputName}:`)
      lines.push(`    type: ${serializeYamlScalar(input.type)}`)
      if (input.required !== undefined) lines.push(`    required: ${input.required}`)
      if (input.default !== undefined) lines.push(`    default: ${serializeYamlScalar(input.default)}`)
      if (input.description !== undefined) lines.push(`    description: ${JSON.stringify(input.description)}`)
    }
  }

  return `${lines.join('\n')}\n---\n${skill.playbook.trim()}\n`
}

export async function saveSkill(skill: AtomicSkill): Promise<void> {
  assertValidSkillId(skill.id)
  const dir = activeUserSkillsDir ?? getDefaultUserSkillsDir()
  const skillDir = join(dir, skill.id)
  await mkdir(skillDir, { recursive: true })

  const skillWithTimestamps: AtomicSkill = {
    ...skill,
    tools: Array.isArray(skill.tools) ? skill.tools : [],
    inputs: skill.inputs && typeof skill.inputs === 'object' ? skill.inputs : {},
    updatedAt: new Date().toISOString(),
    createdAt: skill.createdAt || new Date().toISOString(),
    references: await listReferenceFiles(skillDir),
    source: 'user',
    dir: skillDir,
  }

  const filePath = join(skillDir, 'SKILL.md')
  await writeFile(filePath, serializeSkill(skillWithTimestamps), 'utf8')

  cachedSkills.set(skill.id, skillWithTimestamps)
}

export async function deleteSkill(id: string): Promise<boolean> {
  assertValidSkillId(id)
  const dir = activeUserSkillsDir ?? getDefaultUserSkillsDir()
  const skillDir = join(dir, id)
  const jsonPath = join(dir, `${id}.json`)
  const mdPath = join(dir, `${id}.md`)
  let existed = existsSync(skillDir) || existsSync(jsonPath) || existsSync(mdPath)

  if (existsSync(skillDir)) {
    await rm(skillDir, { recursive: true, force: true })
  }

  try {
    await unlink(jsonPath)
    existed = true
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }

  try {
    await unlink(mdPath)
    existed = true
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }

  if (existed) {
    await initSkillsRegistry({
      builtinsDir: activeBuiltinsDir ?? getDefaultBuiltinsDir(),
      userSkillsDir: dir,
    })
  }

  return existed
}

export async function readSkillReference(id: string, file: string): Promise<string> {
  if (!file || file === '..' || isAbsolute(file) || file.includes('/') || file.includes('\\')) {
    throw new Error('Invalid skill reference filename')
  }

  const skill = cachedSkills.get(id)
  if (!skill?.dir) throw new Error(`Skill "${id}" has no references directory`)
  if (!skill.references?.includes(file)) throw new Error(`Unknown reference "${file}" for skill "${id}"`)
  return readFile(join(skill.dir, 'references', file), 'utf8')
}

export function listWorkflows(filter?: WorkflowFilter): Workflow[] {
  const workflows = Array.from(cachedWorkflows.values())
  if (!filter || !filter.domain) return workflows

  return workflows.filter(wf => wf.domains.includes(filter.domain!))
}

export function getWorkflow(id: string): Workflow | undefined {
  return cachedWorkflows.get(id)
}

export async function saveWorkflow(wf: Workflow): Promise<void> {
  const dir = activeUserSkillsDir ?? getDefaultUserSkillsDir()
  await mkdir(dir, { recursive: true })

  const wfWithTimestamps: Workflow = {
    ...wf,
    updatedAt: new Date().toISOString(),
    createdAt: wf.createdAt || new Date().toISOString(),
  }

  const filePath = join(dir, `${wf.id}.workflow.json`)
  await writeFile(filePath, JSON.stringify(wfWithTimestamps, null, 2), 'utf8')

  cachedWorkflows.set(wf.id, wfWithTimestamps)
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  let existed = cachedWorkflows.delete(id)
  const dir = activeUserSkillsDir ?? getDefaultUserSkillsDir()

  const wfPath = join(dir, `${id}.workflow.json`)
  const jsonPath = join(dir, `${id}.json`)

  try {
    await unlink(wfPath)
    existed = true
  } catch {
    // ignore
  }

  try {
    await unlink(jsonPath)
    existed = true
  } catch {
    // ignore
  }

  return existed
}

export function resetRegistry(): void {
  cachedSkills.clear()
  cachedWorkflows.clear()
  activeUserSkillsDir = null
  activeBuiltinsDir = null
}
