import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { flowGenerateImage, flowCreateProject, flowListProjects, flowUploadImage, flowDownloadImage, flowGenerateVideo, flowGetCredits, flowViewImage, flowRenameProject, flowListProjectMedia, flowVideoModels, flowMediaStatus } from '../flow'
import type { RequestApproval } from './approval'

/**
 * Agent capability layer for Google Flow (Studio page).
 *
 * Unlike every other bridge in this codebase, this one calls an internal
 * API Google does not publish for third-party use — there is no official
 * Google Flow API at all (confirmed by research, not assumed). Every call
 * spends the user's real Flow subscription credits on their real Google
 * account, with a real chance Google could flag or restrict that account
 * for it. Approval is required every time, and the approval dialog says so
 * plainly rather than presenting this as an ordinary write action.
 */

const MAX_AGENT_TOOL_TEXT = 12_000

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function result(value: unknown) {
  let out = text(value)
  if (out.length > MAX_AGENT_TOOL_TEXT) {
    out = out.slice(0, MAX_AGENT_TOOL_TEXT) + '\n\n[truncated — narrow the request with a smaller limit]'
  }
  return { content: [{ type: 'text' as const, text: out }] }
}

function denied(detail: string) {
  return { content: [{ type: 'text' as const, text: `The user denied this action. ${detail}` }], isError: true }
}

const MIME_BY_CONTENT_TYPE: Record<string, 'image/jpeg' | 'image/png' | 'image/webp'> = {
  'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp',
}

/**
 * Attaches the real image bytes to a tool result as an MCP image content
 * block, so the agent actually SEES the generated/uploaded image rather
 * than only reading a mediaId in text. Best-effort: if fetching the bytes
 * fails, the text result still goes through — a failed "also attach the
 * image" step should not make the whole tool call look like it failed.
 */
async function withImagePreview(mediaId: string, textValue: unknown) {
  let textBlockText = text(textValue)
  const fetched = await flowViewImage(mediaId)

  const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = []
  if (fetched.ok && fetched.bytes) {
    const mimeType = MIME_BY_CONTENT_TYPE[(fetched.contentType ?? '').split(';')[0].trim()] ?? 'image/jpeg'
    content.push({ type: 'image', data: fetched.bytes.toString('base64'), mimeType })
  } else {
    textBlockText += `\n\n[could not attach an image preview: ${fetched.error}]`
  }
  content.unshift({ type: 'text', text: textBlockText })
  return { content }
}

export function createFlowTools(requestApproval: RequestApproval) {
  return [
    tool(
      'studio_flow_create_project',
      'Create a new project in Google Flow (Google AI image/video studio) using an internal API Google does not officially publish — not a documented integration, and using it carries real risk to the current user Google account. Does not spend generation credits by itself, just creates an empty project. Returns a projectId usable with studio_flow_generate_image. Always requires approval.',
      {
        projectTitle: z.string().min(1).max(200).optional()
          .describe('Title for the new project. Defaults to a timestamp if omitted.'),
      },
      async ({ projectTitle }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_create_project',
          title: 'Create a new Google Flow project',
          detail: `Title: ${projectTitle ?? '(timestamp)'}\n\n— this calls an internal Google API that is not officially published. —`,
          input: { projectTitle },
        })
        if (!approved) return denied('The project was not created.')
        return result(await flowCreateProject(projectTitle ?? ''))
      },
    ),
    tool(
      'studio_flow_generate_image',
      'Generate one image in Google Flow (Google AI image/video studio) using an internal API Google does not officially publish — not a documented integration, and using it carries real risk to the current user Google account. Spends real Flow subscription credits. Needs an existing project id — either from studio_flow_create_project, or from an open project own URL (labs.google/fx/tools/flow/project/<projectId>). Always requires approval; the approval dialog names the account-risk explicitly.',
      {
        prompt: z.string().min(1).max(4000).describe('The exact image prompt. Sent word for word.'),
        projectId: z.string().min(1).describe('Project id, from studio_flow_list_projects or studio_flow_create_project.'),
        imageModel: z.enum(['NANO_BANANA_PRO', 'NANO_BANANA_2']).optional()
          .describe('Which Flow image model. Defaults to NANO_BANANA_2, the model the captured request used.'),
      },
      async ({ prompt, projectId, imageModel }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_generate_image',
          title: 'Generate an image in Google Flow',
          detail: `${prompt}\n\n— this calls an internal Google API that is not officially published, and spends real Flow credits on this Google account. Google could flag or restrict the account for automated use. —`,
          input: { prompt, projectId, imageModel },
        })
        if (!approved) return denied('The image was not generated.')
        const generated = await flowGenerateImage(prompt, projectId, imageModel)
        if (!generated.ok || typeof generated.mediaId !== 'string') return result(generated)
        return withImagePreview(generated.mediaId, generated)
      },
    ),
    tool(
      'studio_flow_upload_image',
      'Upload a local image file to Google Flow using an internal API Google does not officially publish, so it can be used as a visual reference or as a video start frame. Carries the same account-risk as other Google Flow tools. Returns a mediaId usable with studio_flow_generate_image (referenceMediaIds) or studio_flow_generate_video. Always requires approval.',
      {
        localFilePath: z.string().min(1).describe('Absolute path to a local image file (jpg/png/webp).'),
        projectId: z.string().min(1).describe('The project id from an already-open Google Flow project URL.'),
      },
      async ({ localFilePath, projectId }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_upload_image',
          title: 'Upload an image to Google Flow',
          detail: `File: ${localFilePath}\n\n— this calls an internal Google API that is not officially published. —`,
          input: { localFilePath, projectId },
        })
        if (!approved) return denied('The image was not uploaded.')
        return result(await flowUploadImage(localFilePath, projectId))
      },
    ),
    tool(
      'studio_flow_view_image',
      'View a Google Flow image (generated or uploaded), attaching the real image so you can actually see it — not just its mediaId. Needs the mediaId from a prior studio_flow_generate_image or studio_flow_upload_image result. Read-only against the account (no credits spent), but still uses an internal API Google does not officially publish, so approval is still required.',
      {
        mediaId: z.string().min(1).describe('The mediaId from a prior generate/upload result.'),
      },
      async ({ mediaId }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_view_image',
          title: 'View a Google Flow image',
          detail: `mediaId: ${mediaId}\n\n— this calls an internal Google API that is not officially published. —`,
          input: { mediaId },
        })
        if (!approved) return denied('The image was not viewed.')
        return withImagePreview(mediaId, { ok: true, mediaId })
      },
    ),
    tool(
      'studio_flow_download_image',
      'Download a Google Flow-generated image to a local FlowDesk Studio downloads folder using an internal API Google does not officially publish. Needs the mediaId from a prior studio_flow_generate_image result. Read-only against the account (no credits spent), but still uses the unofficial API, so approval is still required.',
      {
        mediaId: z.string().min(1).describe('The mediaId from a studio_flow_generate_image result.'),
      },
      async ({ mediaId }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_download_image',
          title: 'Download an image from Google Flow',
          detail: `mediaId: ${mediaId}\n\n— this calls an internal Google API that is not officially published. —`,
          input: { mediaId },
        })
        if (!approved) return denied('The image was not downloaded.')
        return result(await flowDownloadImage(mediaId))
      },
    ),
    tool(
      'studio_flow_generate_video',
      'Generate a video from a text prompt in Google Flow, using an internal API Google does not officially publish. Spends real Flow subscription credits and carries real account-risk. Call studio_flow_video_models first to get a valid modelKey — the keys are read from Flow itself rather than hardcoded, because a hardcoded table has already been wrong once here. Submits the request; the result carries the media id. Always requires approval.',
      {
        prompt: z.string().min(1).max(4000).describe('The exact scene prompt for the video. Sent word for word.'),
        projectId: z.string().min(1).describe('Project id, from studio_flow_list_projects or studio_flow_create_project.'),
        modelKey: z.string().min(1).describe('A model key from studio_flow_video_models, for example abra_t2v_8s.'),
      },
      async ({ prompt, projectId, modelKey }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_generate_video',
          title: 'Generate a video in Google Flow',
          detail: `${prompt}

Model: ${modelKey}

— calls an internal Google API that is not officially published, and spends real Flow credits. Google could flag or restrict the account for automated use. —`,
          input: { prompt, projectId, modelKey },
        })
        if (!approved) return denied('The video was not generated.')
        return result(await flowGenerateVideo(prompt, projectId, modelKey))
      },
    ),
    tool(
      'studio_flow_video_models',
      'List the video model keys Google Flow currently accepts, read from Flow itself. Read-only, no credits. Call this before studio_flow_generate_video rather than guessing a model name.',
      {},
      async () => {
        const approved = await requestApproval({
          tool: 'studio_flow_video_models',
          title: 'List Google Flow video models',
          detail: '— this calls an internal Google API that is not officially published. Read-only. —',
          input: {},
        })
        if (!approved) return denied('Models were not listed.')
        return result(await flowVideoModels())
      },
    ),
    tool(
      'studio_flow_media_status',
      'Look up one Google Flow media item by the id a generation returned — use it to check on a video after studio_flow_generate_video. Read-only against the account, no credits spent.',
      {
        mediaId: z.string().min(1).describe('The media id from a generate result.'),
      },
      async ({ mediaId }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_media_status',
          title: 'Check a Google Flow media item',
          detail: `mediaId: ${mediaId}

— this calls an internal Google API that is not officially published. —`,
          input: { mediaId },
        })
        if (!approved) return denied('The media was not checked.')
        return result(await flowMediaStatus(mediaId))
      },
    ),
    tool(
      'studio_flow_rename_project',
      'Rename an existing Google Flow project. No credits spent. Uses an internal API Google does not officially publish, so it still requires approval.',
      {
        projectId: z.string().min(1).describe('Project id, from studio_flow_list_projects.'),
        projectTitle: z.string().min(1).max(200).describe('The new title.'),
      },
      async ({ projectId, projectTitle }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_rename_project',
          title: 'Rename a Google Flow project',
          detail: `New title: ${projectTitle}

— this calls an internal Google API that is not officially published. —`,
          input: { projectId, projectTitle },
        })
        if (!approved) return denied('The project was not renamed.')
        return result(await flowRenameProject(projectId, projectTitle))
      },
    ),
    tool(
      'studio_flow_list_project_media',
      'List the images and videos already inside one Google Flow project, with the prompt each was made from. Read-only, no credits spent.',
      {
        projectId: z.string().min(1).describe('Project id, from studio_flow_list_projects.'),
      },
      async ({ projectId }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_list_project_media',
          title: 'List media in a Google Flow project',
          detail: '— this calls an internal Google API that is not officially published. Read-only. —',
          input: { projectId },
        })
        if (!approved) return denied('Media was not listed.')
        return result(await flowListProjectMedia(projectId))
      },
    ),
    tool(
      'studio_flow_list_projects',
      'List the Google Flow projects on this account, newest first, each with its projectId, title and creation time. Read-only and spends no credits. Use this FIRST when a Flow task needs a project — it removes any need to ask the user to copy a project id out of a URL. Uses an internal API Google does not officially publish, so it still requires approval.',
      {},
      async () => {
        const approved = await requestApproval({
          tool: 'studio_flow_list_projects',
          title: 'List Google Flow projects',
          detail: '— this calls an internal Google API that is not officially published. Read-only. —',
          input: {},
        })
        if (!approved) return denied('Projects were not listed.')
        return result(await flowListProjects())
      },
    ),
    tool(
      'studio_flow_get_credits',
      'Check the Google Flow account real video-credit balance and paygate tier, using an internal API Google does not officially publish. Read-only, no credits spent. Note: this covers VIDEO credits only — image generation has a separate daily limit that is not exposed by any known endpoint, so this tool cannot report how many images are left today. Still requires approval since it uses the unofficial API.',
      {},
      async () => {
        const approved = await requestApproval({
          tool: 'studio_flow_get_credits',
          title: 'Check Google Flow credits',
          detail: '— this calls an internal Google API that is not officially published. —',
          input: {},
        })
        if (!approved) return denied('Credits were not checked.')
        return result(await flowGetCredits())
      },
    ),
  ]
}

export const FLOW_TOOL_BASE_NAMES = [
  'studio_flow_list_projects',
  'studio_flow_create_project',
  'studio_flow_rename_project',
  'studio_flow_list_project_media',
  'studio_flow_video_models',
  'studio_flow_media_status',
  'studio_flow_generate_image',
  'studio_flow_upload_image',
  'studio_flow_view_image',
  'studio_flow_download_image',
  'studio_flow_generate_video',
  'studio_flow_get_credits',
] as const
export const FLOW_TOOL_NAMES = FLOW_TOOL_BASE_NAMES.map(name => `mcp__workers__${name}`)
