import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { flowGenerateImage, flowCreateProject, flowListProjects, flowUploadImage, flowDownloadImage, flowGenerateVideo, flowGetVideoStatus, flowGetCredits, flowViewImage } from '../flow'
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
        projectId: z.string().min(1).describe('The project id from an already-open Google Flow project URL.'),
        aspectRatio: z.enum(['LANDSCAPE', 'LANDSCAPE_4_3', 'SQUARE', 'PORTRAIT_3_4', 'PORTRAIT']).optional()
          .describe('16:9, 4:3, 1:1, 3:4, or 9:16. Defaults to LANDSCAPE (16:9).'),
        imageModel: z.enum(['NANO_BANANA_PRO', 'NANO_BANANA_2']).optional()
          .describe('Which Flow image model to use. Defaults to NANO_BANANA_PRO. "Nano Banana 2 Lite" is not available yet.'),
        referenceMediaIds: z.array(z.string()).optional()
          .describe('mediaIds (from a prior studio_flow_generate_image or studio_flow_upload_image result) to use as visual references for this generation.'),
      },
      async ({ prompt, projectId, aspectRatio, imageModel, referenceMediaIds }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_generate_image',
          title: 'Generate an image in Google Flow',
          detail: `${prompt}\n\n— this calls an internal Google API that is not officially published, and spends real Flow credits on this Google account. Google could flag or restrict the account for automated use. —`,
          input: { prompt, projectId, aspectRatio, imageModel, referenceMediaIds },
        })
        if (!approved) return denied('The image was not generated.')
        const generated = await flowGenerateImage(prompt, projectId, aspectRatio, imageModel, referenceMediaIds)
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
      'Generate a short Portrait video in Google Flow, using an internal API Google does not officially publish. Spends real Flow subscription credits and carries real account-risk. Two modes: INGREDIENTS (compose from one or more reference images) or FRAMES (animate a single start image — no end frame support: Omni Flash rejects one outright, and Veo 3.1 Lite + FRAMES has no confirmed model key). Only 3 model+mode combinations are confirmed: Veo 3.1 Lite+INGREDIENTS, Omni Flash+INGREDIENTS, Omni Flash+FRAMES (6 seconds). mediaIds come from prior studio_flow_generate_image or studio_flow_upload_image results — for FRAMES only the first id is used. Submits the request only — poll with studio_flow_get_video_status for the finished video. Always requires approval.',
      {
        mode: z.enum(['INGREDIENTS', 'FRAMES']).describe('INGREDIENTS composes from reference images; FRAMES animates a single start image.'),
        model: z.enum(['VEO_3_1_LITE', 'OMNI_FLASH']).describe('Which video model. Omni Flash generates 6-second clips; Veo 3.1 Lite only supports INGREDIENTS mode so far.'),
        mediaIds: z.array(z.string().min(1)).min(1)
          .describe('mediaId(s) from prior generate/upload results. For FRAMES mode, only the first is used as the start image.'),
        prompt: z.string().min(1).max(4000).describe('The exact motion/scene prompt for the video.'),
        projectId: z.string().min(1).describe('The project id from an already-open Google Flow project URL.'),
      },
      async ({ mode, model, mediaIds, prompt, projectId }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_generate_video',
          title: 'Generate a video in Google Flow',
          detail: `${prompt}\n\nModel: ${model} · Mode: ${mode}\n\n— calls an internal Google API that is not officially published, and spends real Flow credits. Google could flag or restrict the account for automated use. —`,
          input: { mode, model, mediaIds, prompt, projectId },
        })
        if (!approved) return denied('The video was not generated.')
        return result(await flowGenerateVideo(mode, model, mediaIds, prompt, projectId))
      },
    ),
    tool(
      'studio_flow_get_video_status',
      'Check whether a Google Flow video submitted by studio_flow_generate_video has finished rendering. Read-only against the account (no credits spent), but still uses the unofficial API, so approval is still required.',
      {
        mediaId: z.string().min(1).describe('The mediaId returned by studio_flow_generate_video.'),
        projectId: z.string().min(1).describe('The project id from an already-open Google Flow project URL.'),
      },
      async ({ mediaId, projectId }) => {
        const approved = await requestApproval({
          tool: 'studio_flow_get_video_status',
          title: 'Check a Google Flow video status',
          detail: `mediaId: ${mediaId}\n\n— this calls an internal Google API that is not officially published. —`,
          input: { mediaId, projectId },
        })
        if (!approved) return denied('The status was not checked.')
        return result(await flowGetVideoStatus(mediaId, projectId))
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
  'studio_flow_generate_image',
  'studio_flow_upload_image',
  'studio_flow_view_image',
  'studio_flow_download_image',
  'studio_flow_generate_video',
  'studio_flow_get_video_status',
  'studio_flow_get_credits',
] as const
export const FLOW_TOOL_NAMES = FLOW_TOOL_BASE_NAMES.map(name => `mcp__workers__${name}`)
