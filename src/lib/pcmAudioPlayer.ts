/**
 * Web Audio player for Google Gemini 24kHz 16-bit Linear PCM Audio.
 * Plays studio-quality native AI voices directly in the browser/renderer.
 */
export class PCMAudioPlayer {
  private audioCtx: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private gainNode: GainNode | null = null
  private isPlaying = false

  constructor() {
    // Lazy initialized on first user interaction
  }

  private initContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      })
      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 64

      this.gainNode = this.audioCtx.createGain()
      this.gainNode.connect(this.analyser)
      this.analyser.connect(this.audioCtx.destination)
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {})
    }

    return this.audioCtx
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  /**
   * Decodes base64 16-bit PCM (little-endian) into Float32 AudioBuffer and plays it.
   */
  public async playBase64PCM(base64Data: string, onEnded?: () => void): Promise<void> {
    this.stop()

    const ctx = this.initContext()
    if (!base64Data) return

    // Decode base64 to binary byte array
    const binaryString = window.atob(base64Data)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    // Convert Int16 PCM samples to Float32 [-1.0, 1.0]
    const numSamples = Math.floor(len / 2)
    const float32Samples = new Float32Array(numSamples)
    const dataView = new DataView(bytes.buffer)

    for (let i = 0; i < numSamples; i++) {
      const int16 = dataView.getInt16(i * 2, true) // true for little-endian
      float32Samples[i] = int16 / 32768.0
    }

    // Create 24kHz mono audio buffer
    const audioBuffer = ctx.createBuffer(1, numSamples, 24000)
    audioBuffer.getChannelData(0).set(float32Samples)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.gainNode!)

    this.currentSource = source
    this.isPlaying = true

    source.onended = () => {
      this.isPlaying = false
      this.currentSource = null
      onEnded?.()
    }

    source.start(0)
  }

  public stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop()
        this.currentSource.disconnect()
      } catch {}
      this.currentSource = null
    }
    this.isPlaying = false
  }

  public getIsPlaying(): boolean {
    return this.isPlaying
  }
}

export const pcmAudioPlayer = new PCMAudioPlayer()
