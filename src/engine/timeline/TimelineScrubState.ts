let time: number | null = null
const listeners = new Set<() => void>()

export function getTimelineScrubTime(): number | null { return time }

export function setTimelineScrubTime(value: number | null): void {
  if (time === value) return
  time = value
  for (const listener of listeners) listener()
}

export function subscribeTimelineScrub(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
