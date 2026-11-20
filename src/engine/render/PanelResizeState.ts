let resizing = false
const listeners = new Set<() => void>()

export function isPanelResizing(): boolean { return resizing }

export function setPanelResizing(value: boolean): void {
  if (resizing === value) return
  resizing = value
  for (const listener of listeners) listener()
}

export function subscribePanelResize(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
