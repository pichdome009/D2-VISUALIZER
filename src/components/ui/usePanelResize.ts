import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { beginPanelResize, clampPanelSize, type PanelResizeOptions } from './panelResize'

export function usePanelResize(options: PanelResizeOptions, collapsed: boolean) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const cancel = useRef<(() => void) | null>(null)
  useEffect(() => () => { cancel.current?.() }, [])
  useEffect(() => { if (collapsed) cancel.current?.() }, [collapsed])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (collapsed || !panelRef.current) return
    const cleanup = beginPanelResize(event.nativeEvent, panelRef.current, options)
    if (cleanup) cancel.current = cleanup
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const backward = options.axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const forward = options.axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    let value: number
    if (event.key === 'Home') value = options.min
    else if (event.key === 'End') value = options.max
    else if (event.key === backward || event.key === forward) {
      value = options.value + (event.key === forward ? 1 : -1) * options.direction * (event.shiftKey ? 32 : 8)
    } else return
    event.preventDefault()
    options.commit(clampPanelSize(value, options.min, options.max))
  }
  return { panelRef, onPointerDown, onKeyDown }
}
