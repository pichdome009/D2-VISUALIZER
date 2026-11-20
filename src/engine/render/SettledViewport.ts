import { isPanelResizing, subscribePanelResize } from './PanelResizeState'

export interface ViewportSize { width: number; height: number }

// Layout follows each observation; expensive pixel buffers wait until layout settles.
export function observeSettledViewport(
  element: HTMLElement,
  display: (size: ViewportSize) => void,
  settled: (size: ViewportSize) => void
): () => void {
  let latest: ViewportSize | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null } }
  const queue = () => {
    clear()
    if (isPanelResizing() || !latest) return
    timer = setTimeout(() => {
      timer = null
      if (!isPanelResizing() && latest) settled(latest)
    }, 100)
  }
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    if (width <= 0 || height <= 0) return
    latest = { width, height }
    display(latest)
    queue()
  })
  observer.observe(element)
  const unsubscribe = subscribePanelResize(queue)
  return () => { observer.disconnect(); clear(); unsubscribe() }
}
