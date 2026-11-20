import React from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTimelineStore } from '@/stores/timelineStore'
import { usePreviewStore } from '@/stores/previewStore'
import { useAudioStore } from '@/stores/audioStore'
import { TimelineRenderer } from '@/engine/timeline/TimelineRenderer'
import { TimecodeUtils } from '@/engine/timeline/TimecodeUtils'
import { useTimelineScrub } from './useTimelineScrub'

export const TimeRuler: React.FC = () => {
  const { zoom, markers, fps, deleteMarker } = useTimelineStore(useShallow((s) => ({
    zoom: s.zoom, markers: s.markers, fps: s.fps, deleteMarker: s.deleteMarker,
  })))
  const duration = usePreviewStore((s) => s.duration)
  const audioSeek = useAudioStore((s) => s.seek)

  const { onPointerDown, onKeyDown } = useTimelineScrub(false)

  const totalWidth = TimelineRenderer.calculateTotalWidth(duration, zoom)
  const totalSeconds = Math.ceil(Math.max(10, duration))
  const interval = TimelineRenderer.getRulerInterval(zoom)

  const renderTicks = () => {
    const ticks: React.ReactNode[] = []
    const step = interval.minor
    const majorStep = interval.major

    for (let s = 0; s <= totalSeconds; s += step) {
      const isMajor = Math.abs(s % majorStep) < 0.001 || Math.abs((s % majorStep) - majorStep) < 0.001
      const x = s * zoom

      ticks.push(
        <div
          key={s}
          className="absolute top-0 flex flex-col items-center pointer-events-none"
          style={{ left: `${x}px` }}
        >
          <div
            className={`w-px ${
              isMajor ? 'h-4 bg-d2-textSubtle' : 'h-2 bg-d2-borderSubtle'
            }`}
          />
          {isMajor && (
            <span className="text-3xs font-mono text-d2-textSubtle mt-1 select-none -translate-x-1/2">
              {TimecodeUtils.secondsToCompactTimecode(s, fps)}
            </span>
          )}
        </div>
      )
    }
    return ticks
  }

  return (
    <div
      data-timeline-ruler onPointerDown={onPointerDown} onKeyDown={onKeyDown}
      role="group" aria-label="Timeline ruler" tabIndex={0}
      style={{ width: `${totalWidth}px` }}
      className="h-10 bg-d2-surface border-b border-d2-border relative cursor-pointer select-none touch-none"
    >
      {/* Ticks and Timecode Labels */}
      {renderTicks()}

      {/* Timeline Markers */}
      {markers.map((m) => {
        const x = m.time * zoom
        return (
          <div
             key={m.id}
             data-timeline-marker={m.id}
             role="button" tabIndex={0} aria-label={`Go to marker ${m.name}`}
             onPointerDown={e => e.stopPropagation()}
             onKeyDown={e => {
               if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); audioSeek(m.time) }
             }}
            onClick={(e) => {
              e.stopPropagation()
              audioSeek(m.time)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              deleteMarker(m.id)
            }}
            style={{ left: `${x}px` }}
            title={`${m.name} (${TimecodeUtils.secondsToTimecode(m.time, fps)})\nRight-click to delete`}
            className="absolute top-0 -translate-x-1/2 flex flex-col items-center cursor-pointer group z-20"
          >
            <div
              style={{
                backgroundColor: 'var(--color-surface-active)',
              }}
              className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold text-white tracking-wide shadow-xs flex items-center gap-1 group-hover:brightness-125 transition-all"
            >
              <span>{m.name}</span>
            </div>
            <div
              style={{
                backgroundColor: 'var(--color-accent)',
                borderColor: 'var(--color-accent-cyan)',
              }}
              className="w-2 h-2 rotate-45 border-[1px] -mt-1 shadow-xs"
            />
          </div>
        )
      })}
    </div>
  )
}
