import React, { useRef } from 'react'
import { usePreviewStore } from '@/stores/previewStore'
import { useTimelineStore } from '@/stores/timelineStore'
import { useTimelineScrub } from './useTimelineScrub'
import { useTimelineClock } from './useTimelineClock'
import { TimecodeUtils } from '@/engine/timeline/TimecodeUtils'

export const Playhead: React.FC = () => {
  const playheadRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const { onPointerDown, onKeyDown } = useTimelineScrub(true)
  useTimelineClock(time => {
    const playhead = playheadRef.current, handle = handleRef.current
    if (!playhead || !handle) return
    const { zoom, fps } = useTimelineStore.getState()
    const transform = `translate3d(${Math.max(0, time * zoom)}px, 0, 0)`
    if (playhead.style.transform !== transform) playhead.style.transform = transform
    handle.setAttribute('aria-valuenow', String(time))
    handle.setAttribute('aria-valuemax', String(usePreviewStore.getState().duration))
    handle.setAttribute('aria-valuetext', TimecodeUtils.secondsToTimecode(time, fps))
  })

  return (
    <div ref={playheadRef} data-playhead
      className="absolute top-0 bottom-0 left-0 pointer-events-none z-30 will-change-transform">
      <div ref={handleRef} onPointerDown={onPointerDown} onKeyDown={onKeyDown}
        role="slider" aria-label="Timeline playhead" aria-valuemin={0} aria-orientation="horizontal" tabIndex={0}
        className="relative -left-2.5 top-0 w-5 h-6 flex items-center justify-center pointer-events-auto touch-none cursor-ew-resize group">
        <div className="w-3.5 h-3.5 bg-d2-accent border border-white rotate-45 rounded-sm shadow-md group-hover:brightness-125" />
      </div>
      <div className="w-0.5 h-full bg-d2-accent shadow-md opacity-90 -translate-x-1/2 pointer-events-none" />
    </div>
  )
}
