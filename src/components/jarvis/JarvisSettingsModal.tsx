import React, { useState } from 'react'
import { X, Key, Radio, Sparkles, Check, ExternalLink, ShieldCheck } from 'lucide-react'
import { useJarvisStore } from '@/store/useJarvisStore'

interface JarvisSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export const JarvisSettingsModal: React.FC<JarvisSettingsModalProps> = ({ isOpen, onClose }) => {
  const { settings, updateSettings } = useJarvisStore()

  const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey)
  const [livekitUrl, setLivekitUrl] = useState(settings.livekitUrl)
  const [livekitApiKey, setLivekitApiKey] = useState(settings.livekitApiKey)
  const [livekitApiSecret, setLivekitApiSecret] = useState(settings.livekitApiSecret)
  const [model, setModel] = useState(settings.model || 'gemini-2.5-flash')
  const [voiceName, setVoiceName] = useState(settings.voiceName || 'Puck')
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt)
  const [savedSuccess, setSavedSuccess] = useState(false)

  if (!isOpen) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateSettings({
      geminiApiKey: geminiApiKey.trim(),
      livekitUrl: livekitUrl.trim(),
      livekitApiKey: livekitApiKey.trim(),
      livekitApiSecret: livekitApiSecret.trim(),
      model,
      voiceName,
      systemPrompt,
    })
    setSavedSuccess(true)
    setTimeout(() => {
      setSavedSuccess(false)
      onClose()
    }, 900)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl rounded-2xl border-2 border-stone-300 dark:border-stone-700 bg-[#FAF7F0] dark:bg-stone-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FEF3C7] border border-[#F59E0B] text-[#B45309]">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="font-retro-mono text-base font-bold text-stone-900 dark:text-stone-100">
                Jarvis Voice & API Settings
              </h2>
              <p className="text-xs text-stone-500">Configure Google Gemini & LiveKit Cloud for real-time voice</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-800 hover:text-stone-700"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* 1. Google Gemini API Key */}
          <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-950/60 p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-xs font-bold font-retro-mono text-stone-800 dark:text-stone-200">
                <Key size={14} className="text-[#F59E0B]" />
                <span>Google Gemini API Key (100% Free)</span>
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:underline"
              >
                <span>Get Free Key</span>
                <ExternalLink size={10} />
              </a>
            </div>
            <input
              type="password"
              value={geminiApiKey}
              onChange={e => setGeminiApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-mono text-stone-800 dark:text-stone-200 focus:border-[#F59E0B] focus:outline-none"
            />
            <p className="mt-1.5 text-[11px] text-stone-500">
              Powers instant sub-second text and voice responses via Gemini 2.0 Flash.
            </p>
          </div>

          {/* 2. LiveKit Cloud Credentials */}
          <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-bold font-retro-mono text-stone-800 dark:text-stone-200">
                <Radio size={14} className="text-[#F59E0B]" />
                <span>LiveKit Cloud Credentials (WebRTC Voice)</span>
              </label>
              <a
                href="https://cloud.livekit.io"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:underline"
              >
                <span>LiveKit Cloud</span>
                <ExternalLink size={10} />
              </a>
            </div>

            <div>
              <span className="block text-[11px] font-medium text-stone-600 dark:text-stone-400 mb-1">
                WebSocket URL
              </span>
              <input
                type="text"
                value={livekitUrl}
                onChange={e => setLivekitUrl(e.target.value)}
                placeholder="wss://your-project.livekit.cloud"
                className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-mono text-stone-800 dark:text-stone-200 focus:border-[#F59E0B] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="block text-[11px] font-medium text-stone-600 dark:text-stone-400 mb-1">
                  API Key
                </span>
                <input
                  type="password"
                  value={livekitApiKey}
                  onChange={e => setLivekitApiKey(e.target.value)}
                  placeholder="APIxxxxxxxx..."
                  className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-mono text-stone-800 dark:text-stone-200 focus:border-[#F59E0B] focus:outline-none"
                />
              </div>
              <div>
                <span className="block text-[11px] font-medium text-stone-600 dark:text-stone-400 mb-1">
                  API Secret
                </span>
                <input
                  type="password"
                  value={livekitApiSecret}
                  onChange={e => setLivekitApiSecret(e.target.value)}
                  placeholder="Secretxxxxxxxx..."
                  className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-mono text-stone-800 dark:text-stone-200 focus:border-[#F59E0B] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* 3. Model & Persona */}
          <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white/70 dark:bg-stone-950/60 p-4 space-y-3">
            <div>
              <label className="block text-xs font-bold font-retro-mono text-stone-800 dark:text-stone-200 mb-1">
                Fast Voice Model
              </label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs text-stone-800 dark:text-stone-200 focus:border-[#F59E0B] focus:outline-none font-retro-mono"
              >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended - Ultra Fast)</option>
                <option value="gemini-flash-latest">Gemini Flash Latest</option>
                <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold font-retro-mono text-stone-800 dark:text-stone-200 mb-1">
                Natural AI Voice Character (Studio Quality)
              </label>
              <select
                value={voiceName}
                onChange={e => setVoiceName(e.target.value as any)}
                className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs text-stone-800 dark:text-stone-200 focus:border-[#F59E0B] focus:outline-none font-retro-mono"
              >
                <option value="Puck">🎙️ Puck (Energetic, Natural & Friendly - Male)</option>
                <option value="Charon">🎙️ Charon (Deep, Calm & Executive - Male)</option>
                <option value="Kore">🎙️ Kore (Warm, Clear & Natural - Female)</option>
                <option value="Aoede">🎙️ Aoede (Expressive & Studio Quality - Female)</option>
                <option value="Fenrir">🎙️ Fenrir (Authoritative & Confident - Male)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold font-retro-mono text-stone-800 dark:text-stone-200 mb-1">
                Jarvis Voice Persona & System Prompt
              </label>
              <textarea
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs text-stone-800 dark:text-stone-200 focus:border-[#F59E0B] focus:outline-none font-sans"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
              <ShieldCheck size={14} className="text-emerald-500" />
              <span>Keys are saved locally in your machine's secure store.</span>
            </div>
            <button
              type="submit"
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 font-retro-mono text-xs font-bold transition-all shadow-md ${
                savedSuccess
                  ? 'bg-emerald-500 text-white'
                  : 'bg-[#F59E0B] hover:bg-[#D97706] text-white shadow-[2px_2px_0px_0px_rgba(180,83,9,0.4)]'
              }`}
            >
              {savedSuccess ? (
                <>
                  <Check size={16} />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Configuration</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
