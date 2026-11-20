import { subscribeFrames } from './FrameScheduler'
import { useExportStore } from '@/stores/exportStore'
import { isPanelResizing, subscribePanelResize } from './PanelResizeState'
import { getTimelineScrubTime, subscribeTimelineScrub } from '../timeline/TimelineScrubState'

// Bounded, renderer-local snapshots; no image decoding or WebGL contexts.
const snapshots = new Map<string, HTMLCanvasElement>()
const MAX_SNAPSHOTS = 128

function remember(key: string, canvas: HTMLCanvasElement): void {
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const ctx = copy.getContext('2d')
  if (!ctx) return
  ctx.drawImage(canvas, 0, 0)
  snapshots.delete(key)
  snapshots.set(key, copy)
  while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!)
}

export function observeThumbnailPreview(
  canvas: HTMLCanvasElement,
  render: (timestamp: number, animated: boolean) => void,
  key: string
): () => void {
  const snapshotKey = `${canvas.width}x${canvas.height}:${key}`
  const cached = snapshots.get(snapshotKey)
  let painted = false
  if (cached) {
    canvas.getContext('2d')?.drawImage(cached, 0, 0)
    snapshots.delete(snapshotKey)
    snapshots.set(snapshotKey, cached)
    painted = true
  }
  const card = canvas.closest<HTMLElement>('[data-preset-id], [data-camera-preset-id]') ?? canvas.parentElement!
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let visible = false
  let hovered = false
  let focused = card.contains(document.activeElement)
  let stop: (() => void) | null = null
  let animating = false
  const sync = () => {
    const animate = !motion.matches && (hovered || focused)
    const needed = visible && getTimelineScrubTime() === null && !isPanelResizing() && !useExportStore.getState().isExporting && (!painted || animate)
    if (stop && (!needed || animating !== animate)) { stop(); stop = null }
    if (!needed || stop) return
    animating = animate
    stop = subscribeFrames(timestamp => {
      if (getTimelineScrubTime() !== null || isPanelResizing() || useExportStore.getState().isExporting) return
      // Static cards use one stable frame, independent of playback and pagination.
      render(animate ? timestamp : 1500, animate)
      if (!painted) { painted = true; remember(snapshotKey, canvas) }
      if (!animate) { stop?.(); stop = null }
    }, animate ? 12 : 60, { background: true })
  }
  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    sync()
  }, { threshold: 0.05 })
  observer.observe(canvas)
  const enter = () => { hovered = true; sync() }
  const leave = () => { hovered = false; sync() }
  const focus = () => { focused = true; sync() }
  const blur = (event: FocusEvent) => { focused = !!event.relatedTarget && card.contains(event.relatedTarget as Node); sync() }
  card.addEventListener('pointerenter', enter)
  card.addEventListener('pointerleave', leave)
  card.addEventListener('focusin', focus)
  card.addEventListener('focusout', blur)
  motion.addEventListener('change', sync)
  const unsubscribeExport = useExportStore.subscribe((state, previous) => {
    if (state.isExporting !== previous.isExporting) sync()
  })
  const unsubscribeResize = subscribePanelResize(sync)
  let scrubbing = getTimelineScrubTime() !== null
  const unsubscribeScrub = subscribeTimelineScrub(() => {
    const active = getTimelineScrubTime() !== null
    if (active !== scrubbing) { scrubbing = active; sync() }
  })
  return () => {
    observer.disconnect()
    stop?.()
    unsubscribeExport()
    unsubscribeResize()
    unsubscribeScrub()
    card.removeEventListener('pointerenter', enter)
    card.removeEventListener('pointerleave', leave)
    card.removeEventListener('focusin', focus)
    card.removeEventListener('focusout', blur)
    motion.removeEventListener('change', sync)
  }
}
