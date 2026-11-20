import React, { useRef, useEffect, useState } from 'react'
import {
  Activity,
  X,
  Volume2,
  Cpu,
  Sparkles,
  Zap,
} from 'lucide-react'
import { AudioEngine } from '@/engine/audio/AudioEngine'
import { AudioBands } from '@/engine/audio/FrequencyExtractor'
import { subscribeFrames } from '@/engine/render/FrameScheduler'
import { useExportStore } from '@/stores/exportStore'
import { isPanelResizing } from '@/engine/render/PanelResizeState'
import { getTimelineScrubTime } from '@/engine/timeline/TimelineScrubState'

interface LiveAudioMonitorProps {
  isOpen: boolean
  onClose: () => void
}

export const LiveAudioMonitor: React.FC<LiveAudioMonitorProps> = ({
  isOpen,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [bands, setBands] = useState<AudioBands>({
    subBass: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    highMid: 0,
    treble: 0,
  })
  const [bassEnergy, setBassEnergy] = useState(0)
  const [midEnergy, setMidEnergy] = useState(0)
  const [trebleEnergy, setTrebleEnergy] = useState(0)
  const [overallEnergy, setOverallEnergy] = useState(0)
  const [sampleRate, setSampleRate] = useState(48000)
  const [fftSize, setFftSize] = useState(2048)
  const [audioTime, setAudioTime] = useState(0)
  const [engineStatus, setEngineStatus] = useState('idle')

  useEffect(() => {
    if (!isOpen) return

    const engine = AudioEngine.getInstance()
    setSampleRate(engine.getSampleRate())
    setFftSize(engine.getFftSize())
    setEngineStatus(engine.getStatus())

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')

    const updateFrame = (frameTimestamp: number) => {
      if (getTimelineScrubTime() !== null || isPanelResizing() || useExportStore.getState().isExporting) return
      const frame = engine.getLiveFrameData(frameTimestamp)
      setBands(frame.bands)
      setBassEnergy(frame.bassEnergy)
      setMidEnergy(frame.midEnergy)
      setTrebleEnergy(frame.trebleEnergy)
      setOverallEnergy(frame.overallEnergy)
      setAudioTime(engine.getCurrentTime())
      setEngineStatus(engine.getStatus())

      // Draw real-time FFT Spectrum Analyzer Graph
      if (ctx && canvas) {
        const w = canvas.width
        const h = canvas.height
        ctx.clearRect(0, 0, w, h)

        // Draw frequency grid lines
        ctx.strokeStyle = '#2f3e52'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, h * 0.25)
        ctx.lineTo(w, h * 0.25)
        ctx.moveTo(0, h * 0.5)
        ctx.lineTo(w, h * 0.5)
        ctx.moveTo(0, h * 0.75)
        ctx.lineTo(w, h * 0.75)
        ctx.stroke()

        // Draw FFT Bars
        const raw = frame.rawFrequencies
        const barCount = Math.min(64, raw.length / 4)
        const barW = (w / barCount) - 1.5

        for (let i = 0; i < barCount; i++) {
          const rawVal = raw[i * 4] || 0
          const barH = (rawVal / 255) * (h - 8)
          const x = i * (barW + 1.5)
          const y = h - barH

          // Gradient color: Cyan for bass, Indigo for mid, Violet for treble
          const grad = ctx.createLinearGradient(0, h, 0, 0)
          grad.addColorStop(0, '#d0c5e9')
          grad.addColorStop(0.5, '#b5a1df')
          grad.addColorStop(1, '#75629f')

          ctx.fillStyle = grad
          ctx.fillRect(x, y, barW, barH)
        }
      }

    }

    return subscribeFrames(updateFrame, 15)
  }, [isOpen])

  if (!isOpen) return null

  const bandConfigs = [
    { label: 'Sub-Bass (20-60 Hz)', val: bands.subBass, color: 'bg-cyan-500' },
    { label: 'Bass (60-250 Hz)', val: bands.bass, color: 'bg-indigo-500' },
    { label: 'Low-Mid (250-500 Hz)', val: bands.lowMid, color: 'bg-blue-500' },
    { label: 'Mid (500-2k Hz)', val: bands.mid, color: 'bg-purple-500' },
    { label: 'High-Mid (2k-6k Hz)', val: bands.highMid, color: 'bg-pink-500' },
    { label: 'Treble (6k-20k Hz)', val: bands.treble, color: 'bg-amber-500' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in-0 select-none">
      <div className="w-full max-w-xl bg-d2-surface border border-d2-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="h-11 border-b border-d2-border px-4 flex items-center justify-between bg-d2-surfaceElevated/50">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              Live Audio Signal Monitor & FFT Diagnostics
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-d2-surfaceElevated text-d2-textMuted hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Real-Time FFT Graph */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-2xs text-d2-textSubtle">
              <span className="flex items-center gap-1 text-white font-medium">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                Real-Time FFT Spectrum Analyzer (64 Frequency Bins)
              </span>
              <span className="font-mono">
                {sampleRate} Hz • FFT {fftSize}
              </span>
            </div>
            <div className="h-28 bg-d2-canvas rounded-lg border border-d2-border p-2 flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={500}
                height={96}
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          {/* 6 Frequency Bands Meter Array */}
          <div className="space-y-2">
            <span className="text-2xs font-semibold text-d2-text uppercase tracking-wider block">
              6 Discrete Audio Frequency Bands
            </span>
            <div className="grid grid-cols-2 gap-2">
              {bandConfigs.map((b) => (
                <div
                  key={b.label}
                  className="p-2 rounded bg-d2-surfaceElevated/50 border border-d2-borderSubtle space-y-1"
                >
                  <div className="flex items-center justify-between text-2xs">
                    <span className="text-d2-textMuted">{b.label}</span>
                    <span className="font-mono text-white font-bold">
                      {Math.round(b.val * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-d2-canvas rounded-full overflow-hidden">
                    <div
                      className={`h-full ${b.color} transition-all duration-75`}
                      style={{ width: `${Math.min(100, b.val * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Energy Group Aggregates */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            <div className="p-2 rounded bg-d2-canvas border border-d2-border text-center">
              <span className="text-3xs text-d2-textSubtle uppercase block">
                Bass Energy
              </span>
              <span className="font-mono text-sm font-bold text-cyan-400">
                {Math.round(bassEnergy * 100)}%
              </span>
            </div>

            <div className="p-2 rounded bg-d2-canvas border border-d2-border text-center">
              <span className="text-3xs text-d2-textSubtle uppercase block">
                Mid Energy
              </span>
              <span className="font-mono text-sm font-bold text-indigo-400">
                {Math.round(midEnergy * 100)}%
              </span>
            </div>

            <div className="p-2 rounded bg-d2-canvas border border-d2-border text-center">
              <span className="text-3xs text-d2-textSubtle uppercase block">
                Treble Energy
              </span>
              <span className="font-mono text-sm font-bold text-pink-400">
                {Math.round(trebleEnergy * 100)}%
              </span>
            </div>

            <div className="p-2 rounded bg-d2-canvas border border-d2-border text-center">
              <span className="text-3xs text-d2-textSubtle uppercase block">
                Overall RMS
              </span>
              <span className="font-mono text-sm font-bold text-emerald-400">
                {Math.round(overallEnergy * 100)}%
              </span>
            </div>
          </div>

          {/* Engine Status Bar */}
          <div className="p-2 rounded bg-d2-surfaceElevated/30 border border-d2-border flex items-center justify-between text-2xs text-d2-textSubtle font-mono">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-d2-accent" />
              Status: <span className="text-white uppercase">{engineStatus}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-d2-accent" />
              Clock: <span className="text-white">{audioTime.toFixed(2)}s</span>
            </span>
            <button
              onClick={() => {
                const engine = AudioEngine.getInstance()
                if (engine.getStatus() === 'playing') {
                  engine.pause()
                } else {
                  engine.play()
                }
              }}
              className="px-2 py-0.5 rounded bg-d2-accent hover:bg-d2-accentHover text-white flex items-center gap-1 text-3xs font-sans font-semibold transition-colors"
            >
              <Zap className="w-2.5 h-2.5" />
              {engineStatus === 'playing' ? 'Pause Demo' : 'Play Test Signal'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="h-10 border-t border-d2-border px-4 flex items-center justify-end bg-d2-surfaceElevated/50">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-d2-surfaceElevated hover:bg-d2-surfaceActive border border-d2-border text-2xs font-medium text-white transition-colors"
          >
            Close Monitor
          </button>
        </div>
      </div>
    </div>
  )
}
