import { subscribeFrames } from '../render/FrameScheduler'
import { getTimelineScrubTime, setTimelineScrubTime } from './TimelineScrubState'

interface TimelineScrubOptions {
  getTime: () => number
  getZoom: () => number
  getDuration: () => number
  preserveOffset: boolean
  start: () => void
  preview: (time: number) => boolean
  finish: (time: number) => void
}

export function pointerTimelineTime(
  clientX: number, left: number, scrollLeft: number, zoom: number, duration: number, grabOffset = 0
): number {
  if (![clientX, left, scrollLeft, zoom, duration, grabOffset].every(Number.isFinite) || zoom <= 0 || duration < 0) return 0
  return Math.max(0, Math.min(duration, (clientX - left + scrollLeft - grabOffset) / zoom))
}

// One clock drives the transient cursor; decoder seeks are serialized and capped at 10 Hz.
export function beginTimelineScrub(
  event: PointerEvent, viewport: HTMLElement, options: TimelineScrubOptions
): (() => void) | null {
  if (event.button !== 0 || !event.isPrimary || getTimelineScrubTime() !== null) return null
  event.preventDefault()
  const initial = options.getTime()
  const pointerId = event.pointerId
  let rect = viewport.getBoundingClientRect()
  let clientX = event.clientX
  const grabOffset = options.preserveOffset ? clientX - rect.left + viewport.scrollLeft - initial * options.getZoom() : 0
  const readTime = () => pointerTimelineTime(clientX, rect.left, viewport.scrollLeft, options.getZoom(), options.getDuration(), grabOffset)
  let target = readTime()
  let lastAttempt = -Infinity
  let lastPreview: number | null = null
  let lastTick: number | null = null
  let finished = false
  const cursor = document.body.style.cursor
  const selection = document.body.style.userSelect
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
  viewport.dataset.scrubbing = 'true'
  setTimelineScrubTime(target)
  options.start()

  const stop = subscribeFrames(timestamp => {
    const dt = lastTick === null ? 0 : Math.min(0.05, (timestamp - lastTick) / 1000)
    lastTick = timestamp
    // Reveal offscreen times only when the pointer leaves the viewport.
    const distance = clientX < rect.left ? clientX - rect.left : clientX > rect.right ? clientX - rect.right : 0
    if (distance) {
      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      viewport.scrollLeft = Math.max(0, Math.min(maxScroll, viewport.scrollLeft + Math.max(-600, Math.min(600, distance * 6)) * dt))
    }
    target = readTime()
    setTimelineScrubTime(target)
    if (target !== lastPreview && timestamp - lastAttempt >= 100) {
      lastAttempt = timestamp
      if (options.preview(target)) lastPreview = target
    }
  }, 60, { interactive: true })

  const move = (next: PointerEvent) => {
    if (next.pointerId === pointerId && Number.isFinite(next.clientX)) clientX = next.clientX
  }
  const resize = () => { rect = viewport.getBoundingClientRect() }
  const finish = (commit: boolean) => {
    if (finished) return
    finished = true
    stop()
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', pointerCancel)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('keydown', key)
    window.removeEventListener('resize', resize)
    document.body.style.cursor = cursor
    document.body.style.userSelect = selection
    viewport.dataset.scrubbing = 'false'
    setTimelineScrubTime(null)
    options.finish(commit ? target : initial)
  }
  const up = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return
    move(next)
    target = readTime()
    finish(true)
  }
  const cancel = () => finish(false)
  const pointerCancel = (next: PointerEvent) => { if (next.pointerId === pointerId) cancel() }
  const key = (next: KeyboardEvent) => {
    if (next.key === 'Escape') { next.preventDefault(); cancel() }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', pointerCancel)
  window.addEventListener('blur', cancel)
  window.addEventListener('keydown', key)
  window.addEventListener('resize', resize)
  return cancel
}
