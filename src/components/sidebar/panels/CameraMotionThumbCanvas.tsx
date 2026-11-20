import React, { useRef, useEffect } from 'react'
import { CinematicEffects } from '@/engine/effects/CinematicEffects'
import { CinematicMotionConfig } from '@/stores/compositionStore'
import { AudioEngine } from '@/engine/audio/AudioEngine'
import { AudioFrameData } from '@/engine/audio/FrequencyExtractor'
import { observeThumbnailPreview } from '@/engine/render/ThumbnailPreview'
import { useExportStore } from '@/stores/exportStore'

interface CameraMotionThumbCanvasProps {
  motionConfig: CinematicMotionConfig
  isActive?: boolean
  className?: string
}

export const CameraMotionThumbCanvas: React.FC<CameraMotionThumbCanvasProps> = ({
  motionConfig,
  isActive = false,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const effects = CinematicEffects.getInstance()
    const dpr = Math.min(1, (canvas.getBoundingClientRect().width / 220) * (window.devicePixelRatio || 1)) || 1
    const cssWidth = 220
    const cssHeight = 96

    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)

    const dummyFreqs = new Float32Array(512)
    const dummyTime = new Float32Array(512)
    const dummyRaw = new Uint8Array(512)
    const dummyTimeBytes = new Uint8Array(512)

    const render = (frameTimestamp: number, animated: boolean) => {
      if (useExportStore.getState().isExporting) return

      const now = frameTimestamp / 1000
      const audioEngine = AudioEngine.getInstance()
      let audioFrame: AudioFrameData

      if (animated && audioEngine.getStatus() === 'playing') {
        audioFrame = audioEngine.getLiveFrameData(frameTimestamp)
      } else {
        const bassPulse = Math.sin(now * 3.8) * 0.35 + 0.65
        const midPulse = Math.cos(now * 4.5) * 0.3 + 0.5
        audioFrame = {
          rawFrequencies: dummyRaw,
          normalizedFrequencies: dummyFreqs,
          timeDomainData: dummyTimeBytes,
          normalizedTimeDomain: dummyTime,
          bands: {
            subBass: bassPulse,
            bass: bassPulse * 0.85,
            lowMid: midPulse,
            mid: 0.45,
            highMid: 0.4,
            treble: 0.35,
          },
          overallEnergy: bassPulse * 0.65,
          rms: bassPulse * 0.55,
          bassEnergy: bassPulse,
          midEnergy: midPulse,
          trebleEnergy: 0.35,
        }
      }

      // Compute camera motion for this preset
      const cam = effects.getCameraMotion(motionConfig, audioFrame, now, cssWidth, cssHeight)

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, cssWidth, cssHeight)

      // 1. Blueprint Grid Background
      const bgGrad = ctx.createRadialGradient(
        cssWidth / 2,
        cssHeight / 2,
        10,
        cssWidth / 2,
        cssHeight / 2,
        cssWidth * 0.65
      )
      bgGrad.addColorStop(0, 'rgba(15, 23, 42, 0.6)')
      bgGrad.addColorStop(1, 'rgba(2, 6, 23, 0.95)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, cssWidth, cssHeight)

      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
      ctx.lineWidth = 1
      const gridSize = 16
      for (let x = 0; x < cssWidth; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, cssHeight)
        ctx.stroke()
      }
      for (let y = 0; y < cssHeight; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(cssWidth, y)
        ctx.stroke()
      }

      // 2. Fixed Center Marker
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cssWidth / 2, cssHeight / 2, 3, 0, Math.PI * 2)
      ctx.stroke()

      // 3. Camera Viewfinder Frame with Motion Applied
      ctx.save()
      ctx.translate(cssWidth / 2, cssHeight / 2)

      // Scale down translation to fit mini viewport
      const visualPanScale = 0.5
      ctx.translate(cam.translateX * visualPanScale, cam.translateY * visualPanScale)
      ctx.rotate((cam.rotation * Math.PI) / 180)
      ctx.scale(cam.scale, cam.scale)

      const frameW = 86
      const frameH = 48
      const halfW = frameW / 2
      const halfH = frameH / 2

      // Viewfinder tint fill
      ctx.fillStyle = isActive ? 'rgba(6, 182, 212, 0.12)' : 'rgba(99, 102, 241, 0.08)'
      ctx.fillRect(-halfW, -halfH, frameW, frameH)

      // Viewfinder border
      ctx.strokeStyle = isActive ? '#d4d4d8' : '#a1a1aa'
      ctx.lineWidth = 1.2
      ctx.shadowColor = '#71717a'
      ctx.shadowBlur = isActive ? 8 : 4
      ctx.strokeRect(-halfW, -halfH, frameW, frameH)

      // Corner Brackets `[ ]`
      const bracketLen = 8
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.8
      ctx.shadowBlur = 0

      // Top-Left
      ctx.beginPath()
      ctx.moveTo(-halfW + bracketLen, -halfH)
      ctx.lineTo(-halfW, -halfH)
      ctx.lineTo(-halfW, -halfH + bracketLen)
      ctx.stroke()

      // Top-Right
      ctx.beginPath()
      ctx.moveTo(halfW - bracketLen, -halfH)
      ctx.lineTo(halfW, -halfH)
      ctx.lineTo(halfW, -halfH + bracketLen)
      ctx.stroke()

      // Bottom-Left
      ctx.beginPath()
      ctx.moveTo(-halfW + bracketLen, halfH)
      ctx.lineTo(-halfW, halfH)
      ctx.lineTo(-halfW, halfH - bracketLen)
      ctx.stroke()

      // Bottom-Right
      ctx.beginPath()
      ctx.moveTo(halfW - bracketLen, halfH)
      ctx.lineTo(halfW, halfH)
      ctx.lineTo(halfW, halfH - bracketLen)
      ctx.stroke()

      // Center Viewfinder Crosshair
      ctx.strokeStyle = isActive ? '#d4d4d8' : '#a1a1aa'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(-4, 0)
      ctx.lineTo(4, 0)
      ctx.moveTo(0, -4)
      ctx.lineTo(0, 4)
      ctx.stroke()

      ctx.restore()

      // 4. Live Telemetry Data Badge (Scale, Pan, Rotation)
      ctx.font = '8px JetBrains Mono, monospace'
      ctx.fillStyle = isActive ? '#d4d4d8' : '#a1a1aa'
      const zoomText = `${cam.scale.toFixed(2)}x`
      const panText = `${Math.round(cam.translateX)}px`
      ctx.fillText(`CAM Z:${zoomText}`, 6, 12)
      ctx.fillText(`PAN:${panText}`, 6, cssHeight - 6)

      ctx.restore()
    }

    const stop = observeThumbnailPreview(canvas, render, JSON.stringify({ motionConfig, isActive }))

    return () => {
      stop()
    }
  }, [motionConfig, isActive])

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full block rounded pointer-events-none ${className}`}
    />
  )
}
