import { useEffect, useLayoutEffect, useRef } from 'react'
import { AudioEngine } from '@/engine/audio/AudioEngine'
import { subscribeFrames } from '@/engine/render/FrameScheduler'
import { getTimelineScrubTime, subscribeTimelineScrub } from '@/engine/timeline/TimelineScrubState'
import { usePreviewStore } from '@/stores/previewStore'
import { useTimelineStore } from '@/stores/timelineStore'

// Small DOM readouts share the playback clock; no React updates on pointer samples.
export function useTimelineClock(render: (time: number) => void): void {
  const callback = useRef(render)
  callback.current = render
  const paint = () => {
    const state = usePreviewStore.getState()
    callback.current(getTimelineScrubTime() ?? (state.isPlaying ? AudioEngine.getInstance().getCurrentTime() : state.currentTime))
  }
  useLayoutEffect(paint, [render])
  useEffect(() => {
    let stop: (() => void) | null = null
    const sync = () => {
      const playing = usePreviewStore.getState().isPlaying
      if (playing && !stop) stop = subscribeFrames(paint, 60, { interactive: true })
      else if (!playing && stop) { stop(); stop = null }
      paint()
    }
    const preview = usePreviewStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime || state.isPlaying !== previous.isPlaying || state.duration !== previous.duration) sync()
    })
    const timeline = useTimelineStore.subscribe((state, previous) => {
      if (state.zoom !== previous.zoom || state.fps !== previous.fps) paint()
    })
    const scrub = subscribeTimelineScrub(paint)
    sync()
    return () => { stop?.(); preview(); timeline(); scrub() }
  }, [])
}
