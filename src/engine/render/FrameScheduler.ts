type FrameCallback = (timestamp: number) => void

interface FrameSubscription {
  callback: FrameCallback
  interval: number
  lastFrame: number
  background: boolean
  interactive: boolean
}

const subscriptions = new Set<FrameSubscription>()
let animationId: number | null = null
let lastBackgroundFrame = -Infinity

function schedule(): void {
  if (animationId === null && subscriptions.size > 0 && !document.hidden) {
    animationId = requestAnimationFrame(tick)
  }
}

function tick(timestamp: number): void {
  animationId = null
  for (const subscription of subscriptions) {
    if (subscription.interactive) runSubscription(subscription, timestamp)
  }
  const start = performance.now()
  for (const subscription of subscriptions) {
    if (subscription.background || subscription.interactive) continue
    runSubscription(subscription, timestamp)
  }
  // Raster-heavy cards must not run together or delay the composition preview.
  if (performance.now() - start < 8 || timestamp - lastBackgroundFrame >= 250) {
    let next: FrameSubscription | undefined
    for (const subscription of subscriptions) {
      if (!subscription.background || timestamp - subscription.lastFrame + 0.5 < subscription.interval) continue
      if (!next || subscription.lastFrame < next.lastFrame) next = subscription
    }
    if (next) { lastBackgroundFrame = timestamp; runSubscription(next, timestamp) }
  }
  schedule()
}

function runSubscription(subscription: FrameSubscription, timestamp: number): void {
  if (!subscriptions.has(subscription)) return
  const elapsed = timestamp - subscription.lastFrame
  if (elapsed + 0.5 < subscription.interval) return
  subscription.lastFrame = Number.isFinite(subscription.lastFrame)
    ? subscription.lastFrame + Math.max(1, Math.floor((elapsed + 0.5) / subscription.interval)) * subscription.interval
    : timestamp
  try {
    subscription.callback(timestamp)
  } catch (error) {
    console.error('[FRAME SCHEDULER]', error)
  }
}

function onVisibilityChange(): void {
  if (document.hidden) {
    if (animationId !== null) cancelAnimationFrame(animationId)
    animationId = null
  } else {
    for (const subscription of subscriptions) subscription.lastFrame = -Infinity
    schedule()
  }
}

export function subscribeFrames(callback: FrameCallback, fps: number, options?: { background?: boolean; interactive?: boolean }): () => void {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('FPS must be positive')
  const subscription = { callback, interval: 1000 / fps, lastFrame: -Infinity,
    background: options?.background === true && options?.interactive !== true, interactive: options?.interactive === true }
  if (subscriptions.size === 0) {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  subscriptions.add(subscription)
  schedule()
  return () => {
    subscriptions.delete(subscription)
    if (subscriptions.size === 0) {
      if (animationId !== null) cancelAnimationFrame(animationId)
      animationId = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

export function observeCanvasFrames(
  canvas: HTMLCanvasElement,
  callback: FrameCallback,
  fps: number
): () => void {
  let unsubscribe: (() => void) | null = null
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.some(entry => entry.isIntersecting)
    if (visible && !unsubscribe) unsubscribe = subscribeFrames(callback, fps)
    if (!visible && unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }, { threshold: 0.05 })
  observer.observe(canvas)
  return () => {
    observer.disconnect()
    unsubscribe?.()
    unsubscribe = null
  }
}
