import { GoogleGenAI } from '@google/genai'
import { runAgentTurn } from '../agent/leadAgent'
import type { ProjectToolRuntime } from '../agent/tools'
import type { RequestApproval } from '../agent/approval'

export interface JarvisChatTurnParams {
  apiKey: string
  model?: string
  voiceName?: 'Puck' | 'Charon' | 'Kore' | 'Aoede' | 'Fenrir'
  systemPrompt?: string
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
  }>
  abortController: AbortController
  projectRuntime?: ProjectToolRuntime
  leadAgentProvider?: 'claude' | 'codex' | 'antigravity'
  requestApproval?: RequestApproval
  onProgress?: (event: {
    type: 'text_chunk' | 'tool_call' | 'heavy_progress' | 'done' | 'error' | 'audio_chunk'
    text?: string
    toolName?: string
    toolPrompt?: string
    progressMessage?: string
    base64Audio?: string
    error?: string
  }) => void
}

const ASK_HEAVY_AGENT_TOOL = {
  functionDeclarations: [
    {
      name: 'ask_heavy_agent',
      description:
        'Delegate a heavy workstation action (checking or sending WhatsApp messages, reading/editing code files, searching workspace, running terminal commands, or researching NotebookLM) to FlowDesk’s lead agent SDK.',
      parameters: {
        type: 'OBJECT',
        properties: {
          task_prompt: {
            type: 'STRING',
            description: 'Precise and complete instruction for the lead agent to execute on the workstation or web.',
          },
        },
        required: ['task_prompt'],
      },
    },
  ],
}

/**
 * Generates natural Google Studio AI Voice (24kHz PCM) using the selected voice character.
 */
export async function generateGeminiSpeech(
  text: string,
  voiceName: string = 'Puck',
  apiKey: string,
): Promise<string | null> {
  const spokenText = text
    .replace(/```[\s\S]*?```/g, 'Code block omitted.')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~]/g, '')
    .slice(0, 450)
    .trim()

  if (!spokenText) return null

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey.trim(),
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: spokenText }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voiceName || 'Puck',
                },
              },
            },
          },
        }),
      },
    )

    if (!res.ok) {
      console.warn('[Jarvis TTS] Status error:', res.status)
      return null
    }

    const data = (await res.json()) as any
    const base64Audio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    return base64Audio || null
  } catch (err) {
    console.warn('[Jarvis TTS] Error generating speech:', err)
    return null
  }
}

/**
 * Executes a fast Jarvis conversation turn using Google Gemini 2.5 Flash API.
 * Delegates heavy workstation actions via ask_heavy_agent and generates studio voice audio.
 */
export async function runJarvisTurn(params: JarvisChatTurnParams): Promise<string> {
  const {
    apiKey,
    model = 'gemini-2.5-flash',
    voiceName = 'Puck',
    systemPrompt = `You are Jarvis, FlowDesk's ultra-fast real-time AI workstation companion.
CRITICAL CONVERSATION RULE: Keep your spoken responses concise, friendly, and punchy (1 to 3 short sentences maximum). Never dump long code blocks, tables, or raw logs out loud unless explicitly requested.
When delegating a task to the workstation, immediately announce what you are doing in 1 brief sentence.`,
    messages,
    abortController,
    projectRuntime,
    leadAgentProvider = 'claude',
    requestApproval = async () => true,
    onProgress,
  } = params

  if (!apiKey || !apiKey.trim()) {
    const errorMsg = 'Google Gemini API key is missing. Please configure it in Jarvis Settings.'
    onProgress?.({ type: 'error', error: errorMsg })
    return errorMsg
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() })

  const formattedContents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  try {
    console.log('[Jarvis] Initiating Gemini turn with model:', model, 'voice:', voiceName)
    const responseStream = await ai.models.generateContentStream({
      model,
      contents: formattedContents,
      config: {
        systemInstruction: systemPrompt,
        tools: [ASK_HEAVY_AGENT_TOOL as any],
        temperature: 0.7,
      },
    })

    let accumulatedText = ''
    let toolCallFound: { name: string; args: Record<string, unknown> } | null = null

    for await (const chunk of responseStream) {
      if (abortController.signal.aborted) {
        throw new Error('Jarvis turn was cancelled.')
      }

      const text = chunk.text
      if (text) {
        accumulatedText += text
        onProgress?.({ type: 'text_chunk', text })
      }

      const functionCalls = chunk.functionCalls
      if (functionCalls && functionCalls.length > 0) {
        const fc = functionCalls[0]
        toolCallFound = {
          name: fc.name || 'ask_heavy_agent',
          args: (fc.args as Record<string, unknown>) || {},
        }
      }
    }

    // Direct reply (No tool call)
    if (!toolCallFound) {
      onProgress?.({ type: 'done', text: accumulatedText })

      // Generate natural studio voice audio
      const audio = await generateGeminiSpeech(accumulatedText, voiceName, apiKey)
      if (audio) {
        onProgress?.({ type: 'audio_chunk', base64Audio: audio })
      }

      return accumulatedText
    }

    // Handle ask_heavy_agent delegation
    const toolPrompt = String(toolCallFound.args.task_prompt || toolCallFound.args.prompt || '')
    const interimAnnouncement = `I'm on it. Delegating to Lead Agent: ${toolPrompt.slice(0, 60)}...`
    
    onProgress?.({
      type: 'tool_call',
      toolName: toolCallFound.name,
      toolPrompt,
      progressMessage: interimAnnouncement,
    })

    // Speak immediate acknowledgment so the user hears Jarvis working
    const acknowledgmentAudio = await generateGeminiSpeech(
      `I'm working on that right now. Checking your workstation tools.`,
      voiceName,
      apiKey,
    )
    if (acknowledgmentAudio) {
      onProgress?.({ type: 'audio_chunk', base64Audio: acknowledgmentAudio })
    }

    // Run Lead Agent SDK in background
    let heavyAgentOutput = ''
    for await (const agentEvent of runAgentTurn(
      toolPrompt,
      abortController,
      projectRuntime,
      leadAgentProvider,
      requestApproval,
      false,
    )) {
      if (agentEvent.type === 'tool_call') {
        onProgress?.({
          type: 'heavy_progress',
          progressMessage: `Running tool: ${agentEvent.tool}`,
        })
      } else if (agentEvent.type === 'tool_result') {
        onProgress?.({
          type: 'heavy_progress',
          progressMessage: `Completed ${agentEvent.tool}`,
        })
      } else if (agentEvent.type === 'text') {
        heavyAgentOutput += agentEvent.text
      } else if (agentEvent.type === 'error') {
        heavyAgentOutput += ` [Error: ${agentEvent.message}]`
      }
    }

    onProgress?.({
      type: 'heavy_progress',
      progressMessage: 'Lead Agent finished. Synthesizing concise summary...',
    })

    // Summarize the lead agent's output concisely for voice
    const toolFollowUpContents = [
      ...formattedContents,
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: toolCallFound.name,
              args: toolCallFound.args,
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: toolCallFound.name,
              response: { output: heavyAgentOutput || 'Task completed successfully.' },
            },
          },
        ],
      },
    ]

    const followUpStream = await ai.models.generateContentStream({
      model,
      contents: toolFollowUpContents as any,
      config: {
        systemInstruction: `${systemPrompt}\nIMPORTANT: Summarize the tool result in 1 to 2 clear, natural, spoken sentences.`,
      },
    })

    let finalSynthesis = ''
    for await (const chunk of followUpStream) {
      if (abortController.signal.aborted) throw new Error('Jarvis turn was cancelled.')
      const text = chunk.text
      if (text) {
        finalSynthesis += text
        onProgress?.({ type: 'text_chunk', text })
      }
    }

    onProgress?.({ type: 'done', text: finalSynthesis })

    // Generate natural studio audio for the final summary
    const finalAudio = await generateGeminiSpeech(finalSynthesis, voiceName, apiKey)
    if (finalAudio) {
      onProgress?.({ type: 'audio_chunk', base64Audio: finalAudio })
    }

    return finalSynthesis
  } catch (err: any) {
    const message = err?.message || String(err)
    console.error('[Jarvis] Error in runJarvisTurn:', message)
    onProgress?.({ type: 'error', error: message })
    return `Error: ${message}`
  }
}
