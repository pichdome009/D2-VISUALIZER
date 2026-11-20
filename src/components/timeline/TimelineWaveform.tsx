import React, { useEffect, useRef } from 'react'
import { useAudioStore } from '@/stores/audioStore'
import { WaveformGenerator } from '@/engine/audio/WaveformGenerator'
import { useTimelineClock } from './useTimelineClock'

interface TimelineWaveformProps {
  width: number
  startTime: number
  duration: number
}

export const TimelineWaveform: React.FC<TimelineWaveformProps> = ({ width, startTime, duration }) => {
  const waveform = useAudioStore((s) => s.waveform)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const playedRef = useRef<HTMLCanvasElement>(null)
  useTimelineClock(time => {
    const canvas = playedRef.current
    if (!canvas) return
    const progress = duration > 0 ? Math.max(0, Math.min(1, (time - startTime) / duration)) : 0
    const clip = `inset(0 ${(1 - progress) * 100}% 0 0)`
    if (canvas.style.clipPath !== clip) canvas.style.clipPath = clip
  })

  useEffect(() => {
    if (!waveform) return
    for (const [canvas, color] of [[baseRef.current, '#6f718e'], [playedRef.current, '#c4b4e9']] as const) {
      if (!canvas) continue
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      // Cap allocation for long projects; CSS still fills the complete clip width.
      canvas.width = Math.max(10, Math.min(16384, Math.floor(width)))
      canvas.height = 34
      WaveformGenerator.drawWaveform(ctx, waveform, canvas.width, canvas.height, color, -1)
    }
  }, [waveform, width])

  if (!waveform) {
    return (
      <div className="w-full flex items-center justify-around opacity-40">
        {Array.from({ length: 48 }, (_, i) => (
          <div key={i} className="w-0.5 bg-indigo-300 rounded-full"
            style={{ height: `${Math.abs(Math.sin(i * 0.45)) * 75 + 15}%` }} />
        ))}
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <canvas ref={baseRef} className="absolute inset-0 w-full h-full" />
      <canvas ref={playedRef} data-waveform-progress className="absolute inset-0 w-full h-full"
        style={{ clipPath: 'inset(0 100% 0 0)' }} />
    </div>
  )
}
