import { useState, useEffect, useRef } from 'react'
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Settings,
  Trash2,
  Send,
  Sparkles,
  ArrowRight,
  Loader2,
  PhoneCall,
  PhoneOff,
  UserCheck,
  StopCircle,
} from 'lucide-react'
import { useJarvisStore } from '@/store/useJarvisStore'
import { JarvisOrb } from '@/components/jarvis/JarvisOrb'
import { JarvisSettingsModal } from '@/components/jarvis/JarvisSettingsModal'
import { JarvisHeavyTaskCard } from '@/components/jarvis/JarvisHeavyTaskCard'
import { pcmAudioPlayer } from '@/lib/pcmAudioPlayer'
import type { JarvisStreamEvent } from '@/types/electron'

export default function Jarvis() {
  const {
    settings,
    init,
    updateSettings,
    voiceState,
    messages,
    activeHeavyTask,
    isSpeakerMuted,
    audioLevel,
    setVoiceState,
    setAudioLevel,
    toggleSpeakerMute,
    addMessage,
    updateMessageText,
    clearMessages,
    failHeavyTask,
  } = useJarvisStore()

  const [inputPrompt, setInputPrompt] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isVoiceActive, setIsVoiceActive] = useState(false)

  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const speechRecognitionRef = useRef<any>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Initialize store settings on mount
  useEffect(() => {
    init()
  }, [init])

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeHeavyTask])

  // Subscribe to Jarvis electron IPC stream events ONCE on mount
  useEffect(() => {
    if (!window.electronAPI?.onJarvisEvent) return

    const unsubscribe = window.electronAPI.onJarvisEvent((event: JarvisStreamEvent) => {
      const state = useJarvisStore.getState()

      if (event.type === 'text_chunk') {
        const lastMsg = state.messages.slice(-1)[0]
        if (lastMsg && lastMsg.role === 'assistant') {
          state.updateMessageText(lastMsg.id, lastMsg.text + event.text, true)
        }
      } else if (event.type === 'tool_call') {
        state.setVoiceState('executing_tool')
        const taskId = state.startHeavyTask(event.toolPrompt || 'Lead agent task')
        if (event.progressMessage) {
          state.updateHeavyTaskProgress(taskId, event.progressMessage)
        }
      } else if (event.type === 'heavy_progress') {
        const currentTask = state.activeHeavyTask
        if (currentTask) {
          state.updateHeavyTaskProgress(currentTask.taskId, event.progressMessage)
        }
      } else if (event.type === 'done') {
        const lastMsg = state.messages.slice(-1)[0]
        if (lastMsg && lastMsg.role === 'assistant') {
          state.updateMessageText(lastMsg.id, event.text || lastMsg.text, false)
        }
        const currentTask = state.activeHeavyTask
        if (currentTask) {
          state.finishHeavyTask(currentTask.taskId, 'Task completed')
        }
      } else if (event.type === 'audio_chunk') {
        if (!state.isSpeakerMuted && event.base64Audio) {
          state.setVoiceState('speaking')
          pcmAudioPlayer.playBase64PCM(event.base64Audio, () => {
            useJarvisStore.getState().setVoiceState('idle')
          })
        }
      } else if (event.type === 'error') {
        const currentTask = state.activeHeavyTask
        if (currentTask) {
          state.failHeavyTask(currentTask.taskId, event.error)
        }
        state.setVoiceState('idle')
      }
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  // Audio level analyzer loop for visualizer orb
  const startAudioAnalyzer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioContextRef.current = audioCtx

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      analyserRef.current = analyser

      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const checkAudio = () => {
        // If audio is playing from speaker, feed AI speech to orb
        const speakerAnalyser = pcmAudioPlayer.getAnalyser()
        const activeAnalyser = pcmAudioPlayer.getIsPlaying() && speakerAnalyser ? speakerAnalyser : analyserRef.current

        if (activeAnalyser) {
          activeAnalyser.getByteFrequencyData(dataArray)
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i]
          }
          const avg = sum / dataArray.length
          const normalized = Math.min(1, avg / 90)
          setAudioLevel(normalized)
        }

        animationFrameRef.current = requestAnimationFrame(checkAudio)
      }
      checkAudio()
    } catch (err) {
      console.warn('Microphone stream access error:', err)
    }
  }

  const stopAudioAnalyzer = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
    setAudioLevel(0)
  }

  // Voice recognition toggle
  const toggleVoiceSession = async () => {
    if (isVoiceActive) {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop()
      }
      stopAudioAnalyzer()
      pcmAudioPlayer.stop()
      setIsVoiceActive(false)
      setVoiceState('idle')
    } else {
      if (!settings.geminiApiKey) {
        setIsSettingsOpen(true)
        return
      }

      setIsVoiceActive(true)
      setVoiceState('listening')
      await startAudioAnalyzer()

      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = false
        recognition.lang = 'en-US'

        recognition.onresult = (event: any) => {
          const transcript = event.results[event.results.length - 1][0].transcript.trim()
          if (transcript) {
            handleSendMessage(transcript)
          }
        }

        recognition.onerror = (e: any) => {
          console.warn('Speech recognition error:', e)
        }

        recognition.onend = () => {
          if (isVoiceActive) {
            try {
              recognition.start()
            } catch {}
          }
        }

        speechRecognitionRef.current = recognition
        try {
          recognition.start()
        } catch {}
      }
    }
  }

  // Send message to Jarvis
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputPrompt).trim()
    if (!text) return

    if (!settings.geminiApiKey) {
      setIsSettingsOpen(true)
      return
    }

    pcmAudioPlayer.stop()
    setInputPrompt('')
    setVoiceState('thinking')

    // Add user message to UI
    addMessage({ role: 'user', text })

    // Add placeholder assistant message for streaming
    addMessage({ role: 'assistant', text: '' })

    const currentMessages = useJarvisStore.getState().messages
    const formattedHistory = currentMessages.map(m => ({
      role: m.role,
      content: m.text,
    }))

    try {
      if (window.electronAPI?.jarvisSendMessage) {
        await window.electronAPI.jarvisSendMessage({
          messages: formattedHistory,
        })
      }
    } catch (err: any) {
      console.error('Failed to send Jarvis message:', err)
      const lastMsg = useJarvisStore.getState().messages.slice(-1)[0]
      if (lastMsg && lastMsg.role === 'assistant') {
        updateMessageText(lastMsg.id, `Error: ${err.message || String(err)}`, false)
      }
      setVoiceState('idle')
    }
  }

  const handleAbort = async () => {
    pcmAudioPlayer.stop()
    if (window.electronAPI?.jarvisAbort) {
      await window.electronAPI.jarvisAbort()
    }
    if (activeHeavyTask) {
      failHeavyTask(activeHeavyTask.taskId, 'User cancelled')
    }
    setVoiceState('idle')
  }

  const handleVoiceChange = (newVoice: 'Puck' | 'Charon' | 'Kore' | 'Aoede' | 'Fenrir') => {
    updateSettings({ voiceName: newVoice })
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#FAF7F0] dark:bg-stone-950 font-retro-sans select-none overflow-hidden">
      {/* ── Top Header Bar ────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-200 dark:border-stone-800 bg-white/80 dark:bg-stone-900/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FEF3C7] border border-[#F59E0B] text-[#B45309] shadow-sm">
            <Sparkles size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-retro-mono text-sm font-bold tracking-tight text-stone-900 dark:text-stone-100">
                JARVIS
              </h1>
              <span className="rounded-full bg-[#FEF3C7] border border-[#F59E0B]/40 px-2 py-0.5 font-retro-mono text-[10px] font-bold uppercase tracking-wider text-[#B45309]">
                Live Studio Voice
              </span>
            </div>
            <p className="text-[11px] text-stone-500">Real-Time Natural AI Voice & Workstation Orchestrator</p>
          </div>
        </div>

        {/* Right Controls: Voice Selector & Settings */}
        <div className="flex items-center gap-2.5">
          {/* Quick Voice Selector */}
          <div className="flex items-center gap-1.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/60 px-2.5 py-1">
            <UserCheck size={13} className="text-[#F59E0B]" />
            <select
              value={settings.voiceName || 'Puck'}
              onChange={e => handleVoiceChange(e.target.value as any)}
              className="bg-transparent font-retro-mono text-xs font-bold text-stone-700 dark:text-stone-200 focus:outline-none cursor-pointer"
            >
              <option value="Puck">Voice: Puck (Natural Male)</option>
              <option value="Charon">Voice: Charon (Deep Male)</option>
              <option value="Kore">Voice: Kore (Warm Female)</option>
              <option value="Aoede">Voice: Aoede (Studio Female)</option>
              <option value="Fenrir">Voice: Fenrir (Assertive Male)</option>
            </select>
          </div>

          {/* Stop Audio Button (if playing) */}
          <button
            onClick={() => {
              pcmAudioPlayer.stop()
              setVoiceState('idle')
            }}
            className="flex h-8 items-center gap-1 px-2.5 rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-50 transition-all font-retro-mono text-xs"
            title="Stop Speech"
          >
            <StopCircle size={14} className="text-red-500" />
            <span>Stop</span>
          </button>

          {/* Mute Speaker */}
          <button
            onClick={toggleSpeakerMute}
            className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-all ${
              isSpeakerMuted
                ? 'border-red-300 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400'
                : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-50'
            }`}
            title={isSpeakerMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isSpeakerMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>

          {/* Clear Chat */}
          <button
            onClick={clearMessages}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-50 transition-all"
            title="Clear Chat"
          >
            <Trash2 size={15} />
          </button>

          {/* Settings */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-1.5 font-retro-mono text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 shadow-sm transition-all"
          >
            <Settings size={14} className="text-[#F59E0B]" />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {/* ── Main Content Area ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side: Glowing Orb & Live Voice Hero Section */}
        <div className="flex w-96 shrink-0 flex-col items-center justify-between border-r border-stone-200 dark:border-stone-800 bg-gradient-to-b from-[#FAF7F0] to-[#F5EFE6] dark:from-stone-950 dark:to-stone-900 p-6">
          {/* Status Pill */}
          <div className="flex items-center gap-2 rounded-full border border-stone-300/80 dark:border-stone-700 bg-white/80 dark:bg-stone-900/80 px-3.5 py-1 backdrop-blur-sm shadow-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                voiceState === 'listening'
                  ? 'bg-emerald-500 animate-ping'
                  : voiceState === 'thinking'
                  ? 'bg-purple-500 animate-pulse'
                  : voiceState === 'speaking'
                  ? 'bg-blue-500 animate-bounce'
                  : voiceState === 'executing_tool'
                  ? 'bg-pink-500 animate-spin'
                  : 'bg-amber-500'
              }`}
            />
            <span className="font-retro-mono text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300">
              {voiceState === 'listening'
                ? 'Listening to you...'
                : voiceState === 'thinking'
                ? 'Thinking...'
                : voiceState === 'speaking'
                ? `Speaking (${settings.voiceName || 'Puck'})...`
                : voiceState === 'executing_tool'
                ? 'Delegating Heavy Task...'
                : 'Jarvis Ready'}
            </span>
          </div>

          {/* Glowing Animated Visualizer Orb */}
          <div className="my-auto flex flex-col items-center">
            <JarvisOrb
              voiceState={voiceState}
              audioLevel={audioLevel}
              size={190}
              onClick={toggleVoiceSession}
            />

            <p className="mt-4 text-center font-retro-mono text-xs text-stone-500 dark:text-stone-400">
              {isVoiceActive
                ? 'Live Voice Active • Speak or Click Orb to Pause'
                : 'Click Orb or "Start Voice" to talk to Jarvis'}
            </p>
          </div>

          {/* Voice Controls */}
          <div className="flex w-full flex-col gap-2.5">
            <button
              onClick={toggleVoiceSession}
              className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-retro-mono text-xs font-bold transition-all shadow-md ${
                isVoiceActive
                  ? 'bg-red-500 hover:bg-red-600 text-white shadow-[2px_2px_0px_0px_rgba(220,38,38,0.4)]'
                  : 'bg-[#F59E0B] hover:bg-[#D97706] text-white shadow-[2px_2px_0px_0px_rgba(180,83,9,0.4)] -translate-y-0.5'
              }`}
            >
              {isVoiceActive ? (
                <>
                  <PhoneOff size={16} />
                  <span>End Voice Session</span>
                </>
              ) : (
                <>
                  <PhoneCall size={16} />
                  <span>Start Natural Voice Session</span>
                </>
              )}
            </button>

            {/* Quick Action Suggestion Chips */}
            <div className="space-y-1.5 pt-2">
              <span className="block text-[11px] font-bold font-retro-mono uppercase tracking-wider text-stone-400">
                Quick Workstation Actions
              </span>
              <button
                onClick={() => handleSendMessage('Check my WhatsApp unread messages and give me a brief 1-sentence spoken summary.')}
                className="w-full text-left rounded-lg border border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/60 px-2.5 py-1.5 text-xs text-stone-700 dark:text-stone-300 hover:border-[#F59E0B] transition-all flex items-center justify-between group"
              >
                <span>💬 Check WhatsApp Chats</span>
                <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#F59E0B]" />
              </button>
              <button
                onClick={() => handleSendMessage('List all files in the current active project directory with a short summary.')}
                className="w-full text-left rounded-lg border border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/60 px-2.5 py-1.5 text-xs text-stone-700 dark:text-stone-300 hover:border-[#F59E0B] transition-all flex items-center justify-between group"
              >
                <span>📂 Inspect Project Files</span>
                <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#F59E0B]" />
              </button>
              <button
                onClick={() => handleSendMessage('Search NotebookLM and list all available research notebooks.')}
                className="w-full text-left rounded-lg border border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-900/60 px-2.5 py-1.5 text-xs text-stone-700 dark:text-stone-300 hover:border-[#F59E0B] transition-all flex items-center justify-between group"
              >
                <span>🔍 Research in NotebookLM</span>
                <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#F59E0B]" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Conversation Transcript & Heavy Task Deck */}
        <div className="flex flex-1 flex-col overflow-hidden bg-white/60 dark:bg-stone-900/40">
          {/* Active Heavy Task Banner (if running) */}
          {activeHeavyTask && (
            <div className="border-b border-stone-200 dark:border-stone-800 p-4">
              <JarvisHeavyTaskCard task={activeHeavyTask} onAbort={handleAbort} />
            </div>
          )}

          {/* Transcript List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role !== 'user' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FEF3C7] border border-[#F59E0B] text-[#B45309] shadow-sm">
                    <Sparkles size={15} />
                  </div>
                )}

                <div
                  className={`max-w-[78%] rounded-2xl p-4 text-xs leading-relaxed shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-[#F59E0B] text-white font-medium rounded-tr-none'
                      : 'bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 text-stone-800 dark:text-stone-200 rounded-tl-none'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text || (msg.isStreaming ? '...' : '')}</p>
                  <div
                    className={`mt-1.5 flex items-center justify-between text-[10px] ${
                      msg.role === 'user' ? 'text-amber-100' : 'text-stone-400'
                    }`}
                  >
                    <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {msg.isStreaming && <Loader2 size={10} className="animate-spin ml-2" />}
                  </div>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Bottom Chat Input Bar */}
          <div className="border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
            <form
              onSubmit={e => {
                e.preventDefault()
                handleSendMessage()
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                placeholder="Talk or type to Jarvis... (e.g. 'Check WhatsApp' or 'Hello')"
                className="flex-1 rounded-xl border border-stone-300 dark:border-stone-700 bg-[#FAF7F0] dark:bg-stone-950 px-4 py-2.5 text-xs text-stone-800 dark:text-stone-200 placeholder-stone-400 focus:border-[#F59E0B] focus:outline-none"
              />

              <button
                type="button"
                onClick={toggleVoiceSession}
                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                  isVoiceActive
                    ? 'border-red-400 bg-red-500 text-white animate-pulse'
                    : 'border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200'
                }`}
                title={isVoiceActive ? 'Mute/Pause Mic' : 'Start Voice Input'}
              >
                {isVoiceActive ? <MicOff size={16} /> : <Mic size={16} />}
              </button>

              <button
                type="submit"
                disabled={!inputPrompt.trim()}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F59E0B] text-white hover:bg-[#D97706] disabled:opacity-40 transition-all shadow-sm"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <JarvisSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  )
}
