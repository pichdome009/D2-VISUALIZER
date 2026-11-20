import React, { useRef, useEffect } from 'react'
import { VisualizerRegistry } from '@/engine/visualizers/VisualizerRegistry'
import { AudioEngine } from '@/engine/audio/AudioEngine'
import { AudioFrameData } from '@/engine/audio/FrequencyExtractor'
import { VisualizerConfig } from '@/stores/compositionStore'
import { IVisualizerPlugin } from '@/engine/visualizers/types'
import { observeThumbnailPreview } from '@/engine/render/ThumbnailPreview'
import { useExportStore } from '@/stores/exportStore'
import { BassEnvelopeFollower } from '@/engine/audio/BassReactivity'

interface VisualizerThumbCanvasProps {
  pluginId: string
  renderType?: '2d' | '3d'
  presetConfig?: Partial<VisualizerConfig>
  isActive?: boolean
  className?: string
}

export const VisualizerThumbCanvas: React.FC<VisualizerThumbCanvasProps> = ({
  pluginId,
  renderType = '2d',
  presetConfig,
  isActive = false,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const registry = VisualizerRegistry.getInstance()
    let plugin: IVisualizerPlugin | undefined

    // Cards display at 64x44 CSS pixels, not the logical visualization size.
    const dpr = Math.min(1, (canvas.getBoundingClientRect().width / 240) * (window.devicePixelRatio || 1)) || 1
    const cssWidth = 240
    const cssHeight = 110

    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)

    const dummyFreqs = new Float32Array(512)
    const dummyTime = new Float32Array(512)
    const dummyRaw = new Uint8Array(512)
    const dummyTimeBytes = new Uint8Array(512)
    const bassFollower = new BassEnvelopeFollower()

    const primaryColor = presetConfig?.primaryColor || '#6366f1'
    const accentColor = presetConfig?.accentColor || '#06b6d4'
    const barCount = presetConfig?.barCount || 40
    const thickness = presetConfig?.thickness || 4
    const spacing = presetConfig?.spacing || 2
    const glow = Math.min(6, presetConfig?.glow ?? 16)
    const sensitivity = presetConfig?.sensitivity || 1.2
    const smoothing = presetConfig?.smoothing || 0.8

    // Internal simulation angle for 3D procedural previews
    let sphereRot = 0

    const render = (frameTimestamp: number, animated: boolean) => {
      if (useExportStore.getState().isExporting) return
      if (!plugin && renderType !== '3d') {
        // Thumbnail state must not resize or advance the main preview's plugin.
        plugin = registry.createVisualizer(pluginId) || registry.createVisualizer('spectrum-bars')
      }

      const now = frameTimestamp / 1000
      const audioEngine = AudioEngine.getInstance()
      let audioFrame: AudioFrameData

      if (animated && audioEngine.getStatus() === 'playing') {
        audioFrame = audioEngine.getLiveFrameData(frameTimestamp)
      } else {
        // High-fidelity procedural wave simulation for idle preview
        const bassPulse = Math.sin(now * 3.8) * 0.35 + 0.65
        const midPulse = Math.cos(now * 4.5) * 0.3 + 0.5

        for (let i = 0; i < dummyFreqs.length; i++) {
          const norm = i / dummyFreqs.length
          const harmonic = Math.sin(now * 4 - norm * 10) * 0.4 + 0.6
          dummyFreqs[i] = Math.max(0.04, Math.pow(1 - norm, 0.65) * harmonic * bassPulse)
          dummyTime[i] = Math.sin(now * 7 + norm * 18) * 0.5 * midPulse
          dummyRaw[i] = Math.round(dummyFreqs[i] * 255)
        }

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

      audioFrame = bassFollower.apply(audioFrame, presetConfig?.bassReactivity, now)
      const bassResponse = bassFollower.getResponse().envelope
      const bassConfig = bassFollower.getConfig()

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, cssWidth, cssHeight)

      // Background subtle vignette on thumbnail canvas
      const bgGrad = ctx.createRadialGradient(
        cssWidth / 2,
        cssHeight / 2,
        cssHeight * 0.1,
        cssWidth / 2,
        cssHeight / 2,
        cssWidth * 0.7
      )
      bgGrad.addColorStop(0, 'rgba(18, 18, 28, 0.4)')
      bgGrad.addColorStop(1, 'rgba(6, 6, 12, 0.8)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, cssWidth, cssHeight)

      if (renderType === '3d' || pluginId === '3d-sphere' || pluginId === '3d-landscape') {
        // High-performance procedural 2D wireframe preview for 3D visualizers to prevent WebGL context contention
        if (pluginId === '3d-sphere') {
          sphereRot = now * 1.2
          const cx = cssWidth / 2
          const cy = cssHeight / 2
          const r = Math.min(cssWidth, cssHeight) * 0.28 * (1 + audioFrame.bassEnergy * 0.2)

          ctx.save()
          ctx.translate(cx, cy)
          ctx.strokeStyle = primaryColor
          ctx.lineWidth = 1.5
          ctx.shadowColor = primaryColor
          ctx.shadowBlur = glow * 0.6

          // Latitude and Longitude wireframe projection
          for (let a = 0; a < 5; a++) {
            const latRadius = r * Math.cos(((a - 2) * Math.PI) / 6)
            const yOffset = r * Math.sin(((a - 2) * Math.PI) / 6) * 0.6
            ctx.beginPath()
            ctx.ellipse(0, yOffset, latRadius, latRadius * 0.35, 0, 0, Math.PI * 2)
            ctx.stroke()
          }

          // Rotating longitude loops
          for (let l = 0; l < 4; l++) {
            const rotAngle = sphereRot + (l * Math.PI) / 4
            ctx.beginPath()
            ctx.ellipse(0, 0, r * Math.abs(Math.cos(rotAngle)), r, 0, 0, Math.PI * 2)
            ctx.stroke()
          }

          // Outer particles
          ctx.fillStyle = accentColor
          ctx.shadowColor = accentColor
          for (let p = 0; p < 18; p++) {
            const pa = sphereRot * 1.5 + (p * Math.PI * 2) / 18
            const pr = r * 1.35 + Math.sin(p * 2 + now * 4) * 8
            const px = Math.cos(pa) * pr
            const py = Math.sin(pa) * pr * 0.65
            ctx.beginPath()
            ctx.arc(px, py, 1.8, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.restore()
        } else if (pluginId === '3d-landscape') {
          // 3D wireframe perspective terrain grid preview
          const cx = cssWidth / 2
          const cy = cssHeight * 0.45
          ctx.save()
          ctx.translate(cx, cy)
          ctx.strokeStyle = primaryColor
          ctx.lineWidth = 1.2
          ctx.shadowColor = primaryColor
          ctx.shadowBlur = glow * 0.5

          const rows = 10
          const cols = 14
          const colSpacing = cssWidth * 0.065

          for (let r = 0; r < rows; r++) {
            const zNorm = r / rows
            const y = r * 6
            const scale = 0.5 + zNorm * 0.65
            ctx.beginPath()

            for (let c = 0; c < cols; c++) {
              const xNorm = (c - cols / 2) / (cols / 2)
              const bin = Math.min(127, Math.floor(c * 8))
              const mag = (audioFrame.normalizedFrequencies[bin] || 0) * sensitivity * 18 * (1 - zNorm * 0.4)
              const x = xNorm * colSpacing * (cols / 2) * scale
              const waveY = y - mag

              if (c === 0) ctx.moveTo(x, waveY)
              else ctx.lineTo(x, waveY)
            }
            ctx.stroke()
          }
          ctx.restore()
        }
      } else if (plugin) {
        // Standard 2D visualizer render
        plugin.render({
          canvas,
          ctx2d: ctx,
          audioFrame,
          config: {
            type: pluginId,
            barCount,
            thickness,
            spacing,
            sensitivity,
            smoothing,
            glow: Math.min(8, glow + bassResponse * bassConfig.glowBoost),
            primaryColor,
            accentColor,
            positionX: 0,
            positionY: 0,
            scale: 0.68 * (presetConfig?.scale ?? 1) * (1 + bassResponse * bassConfig.pulseScale),
            rotation: presetConfig?.rotation ?? 0,
            opacity: 1,
          },
          effects: {
            glow: 8,
            bloom: 0,
            vignette: 0,
            grain: 0,
            brightness: 1,
            contrast: 1,
            saturation: 1,
            colorTint: '#000',
            colorTintOpacity: 0,
            chromaticAberration: 0,
            lightLeaks: 0,
            softLensGlow: 0,
            beatPulse: 15,
          },
          time: now,
          width: cssWidth,
          height: cssHeight,
          dpr,
        })
      }

      ctx.restore()
    }

    const stop = observeThumbnailPreview(canvas, render, JSON.stringify({ pluginId, renderType, presetConfig }))

    return () => {
      stop()
      plugin?.dispose()
    }
  }, [pluginId, renderType, presetConfig])

  return (
    <canvas
      ref={canvasRef}
      data-thumbnail-active={isActive || undefined}
      className={`w-full h-full block rounded pointer-events-none ${className}`}
    />
  )
}
