import React, { useEffect, useRef } from 'react'
import type { VoiceState } from '@/store/useJarvisStore'

interface JarvisOrbProps {
  voiceState: VoiceState
  audioLevel?: number // 0 to 1
  size?: number
  onClick?: () => void
}

export const JarvisOrb: React.FC<JarvisOrbProps> = ({
  voiceState,
  audioLevel = 0,
  size = 180,
  onClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const stateRef = useRef({ voiceState, audioLevel, phase: 0 })

  useEffect(() => {
    stateRef.current.voiceState = voiceState
    stateRef.current.audioLevel = audioLevel
  }, [voiceState, audioLevel])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let phase = 0

    const render = () => {
      const { voiceState: currentVoiceState, audioLevel: currentLevel } = stateRef.current
      phase += 0.04
      stateRef.current.phase = phase

      const width = canvas.width
      const height = canvas.height
      const centerX = width / 2
      const centerY = height / 2

      ctx.clearRect(0, 0, width, height)

      // Base colors based on state
      let coreColor = '#F59E0B' // Amber / Gold default
      let glowColor = 'rgba(245, 158, 11, 0.4)'
      let outerColor = 'rgba(217, 119, 6, 0.2)'

      if (currentVoiceState === 'listening') {
        coreColor = '#10B981' // Green
        glowColor = 'rgba(16, 185, 129, 0.5)'
        outerColor = 'rgba(5, 150, 105, 0.25)'
      } else if (currentVoiceState === 'thinking') {
        coreColor = '#8B5CF6' // Purple
        glowColor = 'rgba(139, 92, 246, 0.5)'
        outerColor = 'rgba(124, 58, 237, 0.25)'
      } else if (currentVoiceState === 'speaking') {
        coreColor = '#3B82F6' // Blue
        glowColor = 'rgba(59, 130, 246, 0.6)'
        outerColor = 'rgba(37, 99, 235, 0.3)'
      } else if (currentVoiceState === 'executing_tool') {
        coreColor = '#EC4899' // Pink / Magenta
        glowColor = 'rgba(236, 72, 153, 0.5)'
        outerColor = 'rgba(219, 39, 119, 0.25)'
      }

      const pulseFactor = Math.sin(phase) * 0.08
      const dynamicBoost = currentLevel * 0.4
      const radius = (size / 3.4) * (1 + pulseFactor + dynamicBoost)

      // 1. Outer ambient glow ring
      const outerGradient = ctx.createRadialGradient(
        centerX,
        centerY,
        radius * 0.4,
        centerX,
        centerY,
        radius * 2.2,
      )
      outerGradient.addColorStop(0, glowColor)
      outerGradient.addColorStop(0.7, outerColor)
      outerGradient.addColorStop(1, 'rgba(0,0,0,0)')

      ctx.fillStyle = outerGradient
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius * 2.2, 0, Math.PI * 2)
      ctx.fill()

      // 2. Animated waveform / particles ring
      const numPoints = 24
      ctx.beginPath()
      for (let i = 0; i <= numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2
        const wave =
          Math.sin(angle * 4 + phase * 2) * (4 + currentLevel * 14) +
          Math.cos(angle * 2 - phase) * (3 + currentLevel * 8)
        const currentRadius = radius * 1.3 + wave
        const x = centerX + Math.cos(angle) * currentRadius
        const y = centerY + Math.sin(angle) * currentRadius
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.strokeStyle = coreColor
      ctx.lineWidth = 2.5
      ctx.shadowColor = coreColor
      ctx.shadowBlur = 12
      ctx.stroke()
      ctx.shadowBlur = 0

      // 3. Inner Orb Core
      const coreGradient = ctx.createRadialGradient(
        centerX - radius * 0.2,
        centerY - radius * 0.2,
        radius * 0.1,
        centerX,
        centerY,
        radius,
      )
      coreGradient.addColorStop(0, '#FFFFFF')
      coreGradient.addColorStop(0.35, coreColor)
      coreGradient.addColorStop(1, glowColor)

      ctx.fillStyle = coreGradient
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.fill()

      // 4. Subtle inner spinning ring
      ctx.save()
      ctx.translate(centerX, centerY)
      ctx.rotate(phase * 0.8)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 12])
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.75, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      animationFrameRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [size])

  return (
    <div
      onClick={onClick}
      className="relative flex items-center justify-center cursor-pointer transition-transform duration-300 hover:scale-105 active:scale-95"
      style={{ width: size, height: size }}
      title={
        voiceState === 'listening'
          ? 'Listening to you...'
          : voiceState === 'speaking'
          ? 'Jarvis speaking...'
          : voiceState === 'thinking'
          ? 'Jarvis thinking...'
          : voiceState === 'executing_tool'
          ? 'Executing heavy task...'
          : 'Jarvis on standby. Click to interact.'
      }
    >
      <canvas
        ref={canvasRef}
        width={size * 1.5}
        height={size * 1.5}
        style={{ width: size, height: size }}
        className="pointer-events-none"
      />
    </div>
  )
}
