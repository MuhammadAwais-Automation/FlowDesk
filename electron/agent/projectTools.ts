import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { spawn } from 'child_process'
import { relative, resolve } from 'path'
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'

export interface ProjectToolRuntime {
  rootPath: string
  confirm: (title: string, detail: string) => Promise<boolean>
}

const readLimit = 80_000
const outputLimit = 16_000

function asProjectPath(rootPath: string, requestedPath: string): string {
  const target = resolve(rootPath, requestedPath || '.')
  const pathRelative = relative(rootPath, target)
  if (pathRelative.startsWith('..') || pathRelative === '..') throw new Error('Path is outside the active project boundary.')
  return target
}

async function collectFiles(rootPath: string, currentPath: string, results: string[], limit: number): Promise<void> {
  if (results.length >= limit) return
  const entries = await readdir(currentPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue
    const nextPath = resolve(currentPath, entry.name)
    if (entry.isDirectory()) await collectFiles(rootPath, nextPath, results, limit)
    else if (entry.isFile()) results.push(relative(rootPath, nextPath))
    if (results.length >= limit) return
  }
}

function response(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

export function createProjectTools(runtime: ProjectToolRuntime) {
  const listFiles = tool('project_list_files', 'List files within the active FlowDesk project. It cannot read outside the selected project boundary.', { path: z.string().default('.') }, async ({ path }) => {
    try {
      const target = asProjectPath(runtime.rootPath, path)
      if (!(await stat(target)).isDirectory()) return response('The requested project path is not a folder.', true)
      const files: string[] = []
      await collectFiles(runtime.rootPath, target, files, 300)
      return response(JSON.stringify({ root: runtime.rootPath, files }))
    } catch (error) {
      return response(error instanceof Error ? error.message : 'Could not list project files.', true)
    }
  }, { annotations: { readOnlyHint: true } })

  const readProjectFile = tool('project_read_file', 'Read a text file within the active FlowDesk project. It cannot read outside the selected project boundary.', { path: z.string() }, async ({ path }) => {
    try {
      const target = asProjectPath(runtime.rootPath, path)
      if (!(await stat(target)).isFile()) return response('The requested project path is not a file.', true)
      return response((await readFile(target, 'utf8')).slice(0, readLimit))
    } catch (error) {
      return response(error instanceof Error ? error.message : 'Could not read project file.', true)
    }
  }, { annotations: { readOnlyHint: true } })

  const searchProject = tool('project_search', 'Search text in files within the active FlowDesk project. It cannot search outside the selected project boundary.', { query: z.string().min(1), path: z.string().default('.') }, async ({ query, path }) => {
    try {
      const target = asProjectPath(runtime.rootPath, path)
      const files: string[] = []
      await collectFiles(runtime.rootPath, target, files, 500)
      const matches: Array<{ path: string; line: number; text: string }> = []
      for (const file of files) {
        const text = await readFile(asProjectPath(runtime.rootPath, file), 'utf8').catch(() => '')
        for (const [index, line] of text.split(/\r?\n/).entries()) {
          if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) matches.push({ path: file, line: index + 1, text: line.slice(0, 500) })
          if (matches.length >= 100) return response(JSON.stringify(matches))
        }
      }
      return response(JSON.stringify(matches))
    } catch (error) {
      return response(error instanceof Error ? error.message : 'Could not search project files.', true)
    }
  }, { annotations: { readOnlyHint: true } })

  const writeProjectFile = tool('project_write_file', 'Write a text file within the active FlowDesk project. A native approval dialog is always shown before writing.', { path: z.string(), content: z.string() }, async ({ path, content }) => {
    try {
      const target = asProjectPath(runtime.rootPath, path)
      const approved = await runtime.confirm('Allow project file write?', `${relative(runtime.rootPath, target)}\n\n${content.slice(0, 1200)}`)
      if (!approved) return response('The user denied this file write.', true)
      await writeFile(target, content, 'utf8')
      return response(`Wrote ${relative(runtime.rootPath, target)}.`)
    } catch (error) {
      return response(error instanceof Error ? error.message : 'Could not write project file.', true)
    }
  })

  const runProjectCommand = tool('project_run_command', 'Run a terminal command in the active FlowDesk project root. A native approval dialog is always shown before execution.', { command: z.string().min(1) }, async ({ command }) => {
    const approved = await runtime.confirm('Allow project terminal command?', `${runtime.rootPath}\n\n${command}`)
    if (!approved) return response('The user denied this terminal command.', true)
    return await new Promise(resolveCommand => {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: runtime.rootPath, windowsHide: true })
      let stdout = ''
      let stderr = ''
      const finish = (text: string, isError = false) => resolveCommand(response(text, isError))
      child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-outputLimit) })
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-outputLimit) })
      child.on('error', error => finish(error.message, true))
      child.on('close', code => finish(JSON.stringify({ exitCode: code, stdout, stderr }), code !== 0))
    })
  })

  return [listFiles, readProjectFile, searchProject, writeProjectFile, runProjectCommand]
}

export const PROJECT_TOOL_NAMES = [
  'mcp__workers__project_list_files',
  'mcp__workers__project_read_file',
  'mcp__workers__project_search',
  'mcp__workers__project_write_file',
  'mcp__workers__project_run_command',
]
