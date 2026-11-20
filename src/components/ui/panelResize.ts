import { isPanelResizing, setPanelResizing } from '@/engine/render/PanelResizeState'

export interface PanelResizeOptions {
  value: number
  min: number
  max: number
  axis: 'x' | 'y'
  direction: 1 | -1
  commit: (value: number) => void
}

export function clampPanelSize(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)))
}

// Pointer samples change only one inherited CSS variable. React/store changes once on release.
export function beginPanelResize(
  event: PointerEvent,
  panel: HTMLElement,
  options: PanelResizeOptions
): (() => void) | null {
  if (event.button !== 0 || !event.isPrimary || isPanelResizing()) return null
  event.preventDefault()
  const start = options.axis === 'x' ? event.clientX : event.clientY
  const pointerId = event.pointerId
  let value = options.value
  let frame: number | null = null
  let finished = false
  const cursor = document.body.style.cursor
  const selection = document.body.style.userSelect
  panel.dataset.resizing = 'true'
  document.body.style.cursor = options.axis === 'x' ? 'col-resize' : 'ns-resize'
  document.body.style.userSelect = 'none'
  setPanelResizing(true)

  const paint = () => {
    frame = null
    panel.style.setProperty('--panel-size', `${value}px`)
  }
  const sample = (next: PointerEvent) => {
    const coordinate = options.axis === 'x' ? next.clientX : next.clientY
    if (Number.isFinite(coordinate)) value = clampPanelSize(options.value + (coordinate - start) * options.direction, options.min, options.max)
  }
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return
    sample(next)
    if (frame === null) frame = requestAnimationFrame(paint)
  }
  const finish = (commit: boolean) => {
    if (finished) return
    finished = true
    if (frame !== null) cancelAnimationFrame(frame)
    panel.style.setProperty('--panel-size', `${commit ? value : options.value}px`)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', pointerCancel)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('keydown', key)
    document.body.style.cursor = cursor
    document.body.style.userSelect = selection
    try {
      if (commit && value !== options.value) options.commit(value)
    } finally {
      panel.dataset.resizing = 'false'
      setPanelResizing(false)
    }
  }
  const up = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return
    sample(next)
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
  return cancel
}
