import { useEffect, useRef, type PointerEvent, type KeyboardEvent } from 'react'
import { AudioEngine } from '@/engine/audio/AudioEngine'
import { TimelineEngine } from '@/engine/timeline/TimelineEngine'
import { beginTimelineScrub } from '@/engine/timeline/TimelineScrubber'
import { getTimelineScrubTime } from '@/engine/timeline/TimelineScrubState'
import { isPanelResizing } from '@/engine/render/PanelResizeState'
import { usePreviewStore } from '@/stores/previewStore'
import { useTimelineStore } from '@/stores/timelineStore'
import { useExportStore } from '@/stores/exportStore'

export function useTimelineScrub(preserveOffset: boolean) {
  const cancel = useRef<(() => void) | null>(null)
  useEffect(() => () => { cancel.current?.() }, [])
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (useExportStore.getState().isExporting || isPanelResizing()) return
    const viewport = document.getElementById('d2-timeline-scroll-container')
    if (!viewport) return
    const audio = AudioEngine.getInstance()
    const timeline = TimelineEngine.getInstance()
    const playing = audio.getStatus() === 'playing'
    const cleanup = beginTimelineScrub(event.nativeEvent, viewport, {
      getTime: () => playing ? audio.getCurrentTime() : usePreviewStore.getState().currentTime,
      getZoom: () => useTimelineStore.getState().zoom,
      getDuration: () => usePreviewStore.getState().duration,
      preserveOffset,
      start: () => { timeline.setScrubbing(true); if (playing) audio.pause() },
      preview: time => {
        if (audio.getIsSeeking()) return false
        audio.seek(time)
        return true
      },
      finish: time => {
        timeline.setScrubbing(false)
        audio.seek(time)
        if (playing) void audio.play()
      },
    })
    if (cleanup) { cancel.current = cleanup; event.stopPropagation() }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || getTimelineScrubTime() !== null || useExportStore.getState().isExporting) return
    const { currentTime, duration } = usePreviewStore.getState()
    const { fps } = useTimelineStore.getState()
    let time: number
    if (event.key === 'Home') time = 0
    else if (event.key === 'End') time = duration
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      time = currentTime + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1) / fps
    } else return
    event.preventDefault()
    AudioEngine.getInstance().seek(Math.max(0, Math.min(duration, time)))
  }
  return { onPointerDown, onKeyDown }
}
