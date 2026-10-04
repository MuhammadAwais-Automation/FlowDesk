import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  initSkillsRegistry,
  listSkills,
  getSkill,
  saveSkill,
  deleteSkill,
  readSkillReference,
  listWorkflows,
  getWorkflow,
  saveWorkflow,
  deleteWorkflow,
  parseFrontmatter,
  parseSimpleYaml,
  resetRegistry,
} from './skillRegistry'
import type { AtomicSkill, Workflow } from './types'

describe('skillRegistry', () => {
  let tempUserDir: string

  beforeEach(async () => {
    tempUserDir = await mkdtemp(join(tmpdir(), 'flowdesk-skills-test-'))
    await initSkillsRegistry({ userSkillsDir: tempUserDir })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    resetRegistry()
    try {
      await rm(tempUserDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  async function writeFolderSkill(
    root: string,
    id: string,
    frontmatter: string,
    body = '# Playbook\nFollow the procedure.',
  ): Promise<string> {
    const skillDir = join(root, id)
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}\n`, 'utf8')
    return skillDir
  }

  async function writeLegacySkill(root: string, id: string, description = 'Legacy description'): Promise<void> {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, `${id}.json`), JSON.stringify({
      id,
      name: 'Legacy display name',
      version: '1.0.0',
      domain: 'general',
      description,
      tools: ['legacy_tool'],
      inputs: {},
    }), 'utf8')
    await writeFile(join(root, `${id}.md`), '# Legacy playbook', 'utf8')
  }

  it('scans built-in skills and attaches markdown playbooks', () => {
    const skills = listSkills()
    expect(skills.length).toBeGreaterThanOrEqual(4)

    const flowSkill = getSkill('google-flow')
    expect(flowSkill).toBeDefined()
    expect(flowSkill?.domain).toBe('flow')
    expect(flowSkill?.tools).toContain('flow_generate_video')
    expect(flowSkill?.playbook).toContain('## When to use')
    expect(flowSkill?.playbook).toContain('abra_t2v_8s')
    expect(flowSkill?.source).toBe('builtin')
    expect(flowSkill?.references).toEqual([])

    const tiktokSkill = getSkill('tiktok-publisher')
    expect(tiktokSkill).toBeDefined()
    expect(tiktokSkill?.domain).toBe('tiktok')
    expect(tiktokSkill?.playbook).toContain('tiktok_api_upload_video')

    const linkedinSkill = getSkill('linkedin-post-writer')
    expect(linkedinSkill).toBeDefined()
    expect(linkedinSkill?.domain).toBe('linkedin')
    expect(linkedinSkill?.playbook).toContain('linkedin_create_post')

    const whatsappSkill = getSkill('whatsapp-crm')
    expect(whatsappSkill).toBeDefined()
    expect(whatsappSkill?.domain).toBe('whatsapp')
    expect(whatsappSkill?.playbook).toContain('whatsapp_status')
  })

  it('scans built-in workflows properly', () => {
    const workflows = listWorkflows()
    expect(workflows.length).toBeGreaterThanOrEqual(1)

    const autoShortWf = getWorkflow('alpha-paws-auto-short')
    expect(autoShortWf).toBeDefined()
    expect(autoShortWf?.domains).toContain('flow')
    expect(autoShortWf?.domains).toContain('tiktok')
    expect(autoShortWf?.steps.length).toBe(4)
    expect(autoShortWf?.steps[0].id).toBe('step1_brain_persona')
    expect(autoShortWf?.steps[3].id).toBe('step4_tiktok_publish')
  })

  it('filters skills by domain and search query', () => {
    const flowSkills = listSkills({ domain: 'flow' })
    expect(flowSkills.every(s => s.domain === 'flow')).toBe(true)
    expect(flowSkills.some(s => s.id === 'google-flow')).toBe(true)

    const searchResults = listSkills({ search: 'post-writer' })
    expect(searchResults.length).toBeGreaterThanOrEqual(1)
    expect(searchResults[0].id).toBe('linkedin-post-writer')

    const noResults = listSkills({ search: 'nonexistent-query-xyz' })
    expect(noResults.length).toBe(0)
  })

  it('filters workflows by domain', () => {
    const flowWorkflows = listWorkflows({ domain: 'flow' })
    expect(flowWorkflows.some(w => w.id === 'alpha-paws-auto-short')).toBe(true)

    const nonExistentDomain = listWorkflows({ domain: 'unrelated_domain' })
    expect(nonExistentDomain.length).toBe(0)
  })

  it('saves, retrieves, and deletes user-authored skills', async () => {
    const customSkill: AtomicSkill = {
      id: 'custom-reddit-curator',
      name: 'Custom Reddit Curator',
      version: '1.0.0',
      domain: 'general',
      description: 'Finds trending discussion threads on Reddit',
      tools: ['reddit_search', 'reddit_feed'],
      inputs: {
        subreddit: { type: 'string', required: true, description: 'Target subreddit' }
      },
      playbook: '# Reddit Curator Playbook\nFilter hot posts by upvote velocity.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    await saveSkill(customSkill)

    const retrieved = getSkill('custom-reddit-curator')
    expect(retrieved).toBeDefined()
    expect(retrieved?.name).toBe('Custom Reddit Curator')
    expect(retrieved?.playbook).toContain('Reddit Curator Playbook')

    const saved = await readFile(join(tempUserDir, 'custom-reddit-curator', 'SKILL.md'), 'utf8')
    expect(saved).toContain('name: custom-reddit-curator')
    expect(saved).toContain('title: "Custom Reddit Curator"')
    expect(saved).toContain('description: "Finds trending discussion threads on Reddit"')

    // Re-initialize to verify disk persistence
    await initSkillsRegistry({ userSkillsDir: tempUserDir })
    const reloaded = getSkill('custom-reddit-curator')
    expect(reloaded).toBeDefined()
    expect(reloaded?.tools).toContain('reddit_search')

    // Delete skill
    const deleted = await deleteSkill('custom-reddit-curator')
    expect(deleted).toBe(true)
    expect(getSkill('custom-reddit-curator')).toBeUndefined()
  })

  it('loads SKILL.md folders and exposes references progressively', async () => {
    const builtinsDir = join(tempUserDir, 'folder-builtins')
    const userSkillsDir = join(tempUserDir, 'folder-users')
    const skillDir = await writeFolderSkill(builtinsDir, 'research-helper', [
      'name: research-helper',
      'title: "Research Helper"',
      'description: "Finds evidence. Use when claims need verification."',
      'version: 2.0.0',
      'domain: general',
      'tools:',
      '  - web_search',
      'inputs:',
      '  query:',
      '    type: string',
      '    required: true',
      '    description: "A topic #tag stays intact"',
    ].join('\n'), '# Research Helper\nUse references only when needed.')
    await mkdir(join(skillDir, 'references'), { recursive: true })
    await writeFile(join(skillDir, 'references', 'details.md'), 'deep detail', 'utf8')

    await initSkillsRegistry({ builtinsDir, userSkillsDir })

    expect(getSkill('research-helper')).toMatchObject({
      id: 'research-helper',
      name: 'Research Helper',
      description: 'Finds evidence. Use when claims need verification.',
      version: '2.0.0',
      domain: 'general',
      tools: ['web_search'],
      inputs: {
        query: {
          type: 'string',
          required: true,
          description: 'A topic #tag stays intact',
        },
      },
      playbook: '# Research Helper\nUse references only when needed.',
      references: ['details.md'],
      source: 'builtin',
      dir: skillDir,
    })
    await expect(readSkillReference('research-helper', 'details.md')).resolves.toBe('deep detail')
  })

  it('rejects reference path traversal and unknown skills', async () => {
    const builtinsDir = join(tempUserDir, 'safe-builtins')
    const userSkillsDir = join(tempUserDir, 'safe-users')
    await writeFolderSkill(builtinsDir, 'safe-skill', [
      'name: safe-skill',
      'description: "Safe skill. Use for tests."',
      'version: 1.0.0',
      'domain: general',
      'tools: []',
      'inputs: {}',
    ].join('\n'))
    await initSkillsRegistry({ builtinsDir, userSkillsDir })

    for (const file of ['..', '../secret.md', 'nested/file.md', 'nested\\file.md', join(tempUserDir, 'secret.md')]) {
      await expect(readSkillReference('safe-skill', file)).rejects.toThrow(/reference/i)
    }
    await expect(readSkillReference('missing-skill', 'details.md')).rejects.toThrow(/skill/i)
  })

  it('uses user skills over built-ins and folders over legacy pairs', async () => {
    const builtinsDir = join(tempUserDir, 'precedence-builtins')
    const userSkillsDir = join(tempUserDir, 'precedence-users')
    await writeFolderSkill(builtinsDir, 'shared-skill', [
      'name: shared-skill',
      'title: "Built-in folder"',
      'description: "Built-in folder description. Use for tests."',
      'version: 2.0.0',
      'domain: general',
      'tools: []',
      'inputs: {}',
    ].join('\n'))
    await writeLegacySkill(builtinsDir, 'shared-skill', 'Built-in legacy description')
    await writeLegacySkill(userSkillsDir, 'shared-skill', 'User legacy description')

    await initSkillsRegistry({ builtinsDir, userSkillsDir })

    expect(getSkill('shared-skill')).toMatchObject({
      name: 'Legacy display name',
      description: 'User legacy description',
      source: 'user',
    })

    await writeFolderSkill(userSkillsDir, 'shared-skill', [
      'name: shared-skill',
      'title: "User folder"',
      'description: "User folder description. Use for tests."',
      'version: 3.0.0',
      'domain: general',
      'tools: []',
      'inputs: {}',
    ].join('\n'))
    await initSkillsRegistry({ builtinsDir, userSkillsDir })

    expect(getSkill('shared-skill')).toMatchObject({
      name: 'User folder',
      description: 'User folder description. Use for tests.',
      source: 'user',
    })
  })

  it('still loads a legacy JSON and Markdown pair', async () => {
    const builtinsDir = join(tempUserDir, 'legacy-builtins')
    const userSkillsDir = join(tempUserDir, 'legacy-users')
    await writeLegacySkill(builtinsDir, 'legacy-only')

    await initSkillsRegistry({ builtinsDir, userSkillsDir })

    expect(getSkill('legacy-only')).toMatchObject({
      id: 'legacy-only',
      name: 'Legacy display name',
      playbook: '# Legacy playbook',
      source: 'builtin',
    })
  })

  it('never deletes a built-in skill', async () => {
    const builtinsDir = join(tempUserDir, 'delete-builtins')
    const userSkillsDir = join(tempUserDir, 'delete-users')
    await writeFolderSkill(builtinsDir, 'built-in-only', [
      'name: built-in-only',
      'description: "Built-in example. Use for tests."',
      'version: 1.0.0',
      'domain: general',
      'tools: []',
      'inputs: {}',
    ].join('\n'))
    await initSkillsRegistry({ builtinsDir, userSkillsDir })

    await expect(deleteSkill('built-in-only')).resolves.toBe(false)
    expect(getSkill('built-in-only')).toBeDefined()
    await expect(readFile(join(builtinsDir, 'built-in-only', 'SKILL.md'), 'utf8')).resolves.toContain('name: built-in-only')
  })

  it('warns and uses the folder id when frontmatter name differs', async () => {
    const builtinsDir = join(tempUserDir, 'mismatch-builtins')
    const userSkillsDir = join(tempUserDir, 'mismatch-users')
    await writeFolderSkill(builtinsDir, 'folder-id', [
      'name: wrong-id',
      'description: "Mismatch example. Use for tests."',
      'version: 1.0.0',
      'domain: general',
      'tools: []',
      'inputs: {}',
    ].join('\n'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await initSkillsRegistry({ builtinsDir, userSkillsDir })

    expect(getSkill('folder-id')?.name).toBe('folder-id')
    expect(getSkill('wrong-id')).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('folder-id'))
    warn.mockRestore()
  })

  it('round-trips saved skills through SKILL.md and validates ids before filesystem writes', async () => {
    const skill: AtomicSkill = {
      id: 'round-trip',
      name: 'Round "Trip" #1',
      version: '2.1.0',
      domain: 'general',
      description: 'Keeps #tags and "quotes". Use when serialization matters.',
      tools: ['tool_one', 'tool_two'],
      inputs: {
        prompt: { type: 'string', required: true, default: 'a #tag', description: 'Prompt with #tag and "quotes"' },
      },
      playbook: '# Round trip\nBody #tags remain.',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    await saveSkill(skill)
    await initSkillsRegistry({ userSkillsDir: tempUserDir, builtinsDir: join(tempUserDir, 'empty-builtins') })

    expect(getSkill('round-trip')).toMatchObject({
      id: skill.id,
      name: skill.name,
      version: skill.version,
      domain: skill.domain,
      description: skill.description,
      tools: skill.tools,
      inputs: skill.inputs,
      playbook: skill.playbook,
      source: 'user',
    })

    const invalidRoot = join(tempUserDir, 'invalid-write')
    await initSkillsRegistry({ userSkillsDir: invalidRoot, builtinsDir: join(tempUserDir, 'empty-builtins') })
    await expect(saveSkill({ ...skill, id: '../escape' })).rejects.toThrow(/id/i)
    await expect(readFile(join(tempUserDir, 'escape', 'SKILL.md'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(tempUserDir, 'escape.json'), 'utf8')).rejects.toThrow()
  })

  it('saves, retrieves, and deletes user-authored workflows', async () => {
    const customWf: Workflow = {
      id: 'custom-daily-triage',
      name: 'Custom Daily Triage',
      version: '1.0.0',
      description: 'Daily triage across WhatsApp and LinkedIn',
      domains: ['whatsapp', 'linkedin'],
      skills: ['whatsapp-crm', 'linkedin-post-writer'],
      steps: [
        {
          id: 's1',
          title: 'Check WhatsApp unread',
          skillId: 'whatsapp-crm',
          actionTool: 'whatsapp_unread'
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    await saveWorkflow(customWf)

    const retrieved = getWorkflow('custom-daily-triage')
    expect(retrieved).toBeDefined()
    expect(retrieved?.steps.length).toBe(1)

    // Re-initialize to verify persistence
    await initSkillsRegistry({ userSkillsDir: tempUserDir })
    expect(getWorkflow('custom-daily-triage')).toBeDefined()

    const deleted = await deleteWorkflow('custom-daily-triage')
    expect(deleted).toBe(true)
    expect(getWorkflow('custom-daily-triage')).toBeUndefined()
  })

  it('gracefully handles missing user directory without throwing', async () => {
    const nonExistentDir = join(tempUserDir, 'non_existent_sub_path')
    await expect(initSkillsRegistry({ userSkillsDir: nonExistentDir })).resolves.not.toThrow()
  })

  it('parses frontmatter and markdown body correctly', () => {
    const sample = `---
id: sample-skill
name: Sample Skill
domain: general
tools:
  - tool_a
  - tool_b
---
# Main Header
This is the sample markdown playbook body.
`
    const { attributes, body } = parseFrontmatter(sample)
    expect(attributes.id).toBe('sample-skill')
    expect(attributes.name).toBe('Sample Skill')
    expect(attributes.domain).toBe('general')
    expect(attributes.tools).toEqual(['tool_a', 'tool_b'])
    expect(body).toContain('# Main Header')
    expect(body).toContain('This is the sample markdown playbook body.')
  })

  it('parses plain markdown without frontmatter cleanly', () => {
    const plain = '# Pure Markdown\nJust instructions without YAML header.'
    const { attributes, body } = parseFrontmatter(plain)
    expect(Object.keys(attributes).length).toBe(0)
    expect(body).toBe(plain)
  })

  it('parses nested YAML fields correctly', () => {
    const yaml = `
name: Test Config
active: true
count: 42
items:
  - first
  - second
inputs:
  prompt:
    type: string
    required: true
`
    const parsed = parseSimpleYaml(yaml)
    expect(parsed.name).toBe('Test Config')
    expect(parsed.active).toBe(true)
    expect(parsed.count).toBe(42)
    expect(parsed.items).toEqual(['first', 'second'])
    expect(parsed.inputs?.prompt?.type).toBe('string')
    expect(parsed.inputs?.prompt?.required).toBe(true)
  })

  it('only strips YAML comments outside quoted values', () => {
    const parsed = parseSimpleYaml([
      '# full-line comment',
      'description: "Keep #hashtags here" # trailing comment',
      "single: 'Keep #this too' # trailing comment",
      'plain: keep#literal',
      'commented: keep # remove this',
    ].join('\n'))

    expect(parsed).toEqual({
      description: 'Keep #hashtags here',
      single: 'Keep #this too',
      plain: 'keep#literal',
      commented: 'keep',
    })
  })
})
