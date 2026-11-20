import React, { useEffect, useRef } from 'react'
import { AudioEngine } from '@/engine/audio/AudioEngine'
import { BassEnvelopeFollower } from '@/engine/audio/BassReactivity'
import { observeCanvasFrames } from '@/engine/render/FrameScheduler'
import { useCompositionStore } from '@/stores/compositionStore'
import { useExportStore } from '@/stores/exportStore'
import { isPanelResizing } from '@/engine/render/PanelResizeState'
import { getTimelineScrubTime } from '@/engine/timeline/TimelineScrubState'

export const BassMeter: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const follower = new BassEnvelopeFollower()
    const history = new Float32Array(120)
    let cursor = 0
    return observeCanvasFrames(canvas, frameTimestamp => {
      if (getTimelineScrubTime() !== null || isPanelResizing() || useExportStore.getState().isExporting) return
      const engine = AudioEngine.getInstance()
      const config = useCompositionStore.getState().visualizer.bassReactivity
      const frame = engine.getLiveFrameData(frameTimestamp)
      const time = engine.getCurrentTime() || frameTimestamp / 1000
      const response = follower.process(frame, config, time)
      history[cursor] = response.envelope
      cursor = (cursor + 1) % history.length
      const width = canvas.width, height = canvas.height
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#151820'
      ctx.fillRect(0, 0, width, height)
      ctx.strokeStyle = '#303541'
      ctx.lineWidth = 1
      for (let line = 1; line < 4; line++) {
        ctx.beginPath(); ctx.moveTo(0, line * height / 4); ctx.lineTo(width, line * height / 4); ctx.stroke()
      }
      ctx.strokeStyle = '#b5a1df'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let index = 0; index < history.length; index++) {
        const x = index * (width - 1) / (history.length - 1)
        const y = height - 4 - history[(cursor + index) % history.length] * (height - 12)
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.fillStyle = '#e3e6ec'
      ctx.font = '10px monospace'
      ctx.fillText(`ENV ${Math.round(response.envelope * 100)}%`, 8, 14)
      ctx.fillStyle = response.kick > 0.05 ? '#b5a1df' : '#737c90'
      ctx.fillText(config?.enabled ? 'KICK' : 'BYPASS', width - 48, 14)
    }, 24)
  }, [])
  return <canvas ref={canvasRef} width={248} height={64} role="img" aria-label="Live bass envelope and kick meter"
    className="w-full h-16 rounded border border-d2-borderSubtle" />
}
