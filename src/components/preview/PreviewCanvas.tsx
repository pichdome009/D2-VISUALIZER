import React, { useRef, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePreviewStore } from '@/stores/previewStore'
import { useCompositionStore } from '@/stores/compositionStore'
import { AudioEngine } from '@/engine/audio/AudioEngine'
import { LayerCompositor } from '@/engine/layers/LayerCompositor'
import { subscribeFrames } from '@/engine/render/FrameScheduler'
import { useExportStore } from '@/stores/exportStore'
import { getPreviewSize } from '@/engine/render/PreviewSizing'
import { observeSettledViewport } from '@/engine/render/SettledViewport'
import { isPanelResizing } from '@/engine/render/PanelResizeState'
import { getTimelineScrubTime } from '@/engine/timeline/TimelineScrubState'

export const PreviewCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)

  const { aspectRatio, zoom, fitMode, showSafeGuides, isPlaying, previewQuality, isFullscreenPreview, toggleFullscreenPreview, setIsFullscreenPreview } = usePreviewStore(useShallow((s) => ({
    aspectRatio: s.aspectRatio, zoom: s.zoom, fitMode: s.fitMode, showSafeGuides: s.showSafeGuides,
    isPlaying: s.isPlaying, previewQuality: s.previewQuality, isFullscreenPreview: s.isFullscreenPreview,
    toggleFullscreenPreview: s.toggleFullscreenPreview, setIsFullscreenPreview: s.setIsFullscreenPreview,
  })))

  // Fullscreen keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreenPreview) {
        setIsFullscreenPreview(false)
      } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        toggleFullscreenPreview()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreenPreview, setIsFullscreenPreview, toggleFullscreenPreview])

  // Native internal rendering dimensions
  const getNativeDimensions = () => {
    switch (aspectRatio) {
      case '9:16':
        return { width: 1080, height: 1920 }
      case '1:1':
        return { width: 1080, height: 1080 }
      case '4:5':
        return { width: 1080, height: 1350 }
      case '21:9':
        return { width: 2560, height: 1080 }
      case '16:9':
      default:
        return { width: 1920, height: 1080 }
    }
  }

  const { width: nativeWidth, height: nativeHeight } = getNativeDimensions()
  // Measure the workspace, not the canvas: pixel-buffer changes must not change layout.
  const { displayWidth, displayHeight, bufferWidth, bufferHeight, renderScale: qualityScale } = getPreviewSize({
    nativeWidth, nativeHeight,
    viewportWidth: viewport?.width ?? 640,
    viewportHeight: viewport?.height ?? 360,
    zoom, fullscreen: isFullscreenPreview, fill: fitMode === 'fill',
    quality: previewQuality, dpr: window.devicePixelRatio || 1,
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    return observeSettledViewport(container, size => {
      const display = displayRef.current
      if (!display) return
      const measured = getPreviewSize({
        nativeWidth, nativeHeight, viewportWidth: size.width, viewportHeight: size.height,
        zoom, fullscreen: isFullscreenPreview, fill: fitMode === 'fill',
        quality: previewQuality, dpr: window.devicePixelRatio || 1,
      })
      display.style.width = `${measured.displayWidth}px`
      display.style.height = `${measured.displayHeight}px`
    }, size => {
      setViewport(previous => previous?.width === size.width && previous?.height === size.height ? previous : size)
    })
  }, [nativeWidth, nativeHeight, zoom, isFullscreenPreview, fitMode, previewQuality])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const engine = AudioEngine.getInstance()
    const compositor = LayerCompositor.getInstance()
    let lastScrubRender = -Infinity

    const render = (frameTimestamp: number) => {
      // Keep the last frame on screen while dragging; audio continues uninterrupted.
      if (isPanelResizing() || useExportStore.getState().isExporting) return
      const scrubTime = getTimelineScrubTime()
      if (scrubTime !== null) {
        if (frameTimestamp - lastScrubRender < 100) return
        lastScrubRender = frameTimestamp
      } else lastScrubRender = -Infinity
      // Set canvas pixel buffer according to active performance mode
      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth
        canvas.height = bufferHeight
      }

      // Query real-time FFT audio frame and playhead
      const audioFrame = engine.getLiveFrameData(frameTimestamp)
      const audioTime = scrubTime ?? engine.getCurrentTime()
      const timestamp = scrubTime !== null || audioTime > 0 ? audioTime : performance.now() / 1000
      const state = useCompositionStore.getState()

      ctx.save()
      if (qualityScale !== 1) {
        ctx.scale(qualityScale, qualityScale)
      }

      // Delegate complete multi-layer rendering to LayerCompositor
      compositor.render({
        canvas,
        ctx,
        state,
        audioFrame,
        timestamp,
        width: nativeWidth,
        height: nativeHeight,
        dpr: window.devicePixelRatio || 1,
        renderScale: qualityScale,
        showSafeGuides,
        isPlaying: scrubTime === null && isPlaying,
        audioTime,
      })

      ctx.restore()

    }

    const fps = !isPlaying ? 15 : previewQuality === 'performance' ? 30 : 60
    return subscribeFrames(render, fps)
  }, [
    nativeWidth,
    nativeHeight,
    bufferWidth,
    bufferHeight,
    qualityScale,
    aspectRatio,
    isPlaying,
    previewQuality,
    showSafeGuides,
  ])

  return (
    <div
      ref={containerRef}
      className={`${
        isFullscreenPreview
          ? 'fixed inset-0 z-50 bg-black p-0'
          : 'flex-1 w-full min-h-0 bg-d2-canvas p-4 relative'
      } flex items-center justify-center overflow-hidden`}
    >
      {/* Floating Exit Button for Fullscreen */}
      {isFullscreenPreview && (
        <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
          <button
            onClick={() => setIsFullscreenPreview(false)}
            className="px-3 py-1.5 rounded-full bg-black/80 hover:bg-black text-white/80 hover:text-white border border-white/20 text-xs font-mono backdrop-blur-md transition-all shadow-xl flex items-center gap-2"
          >
            <span>Exit Fullscreen</span>
            <span className="text-3xs px-1.5 py-0.5 rounded bg-white/20 text-white font-bold">ESC</span>
          </button>
        </div>
      )}

      <div
        ref={displayRef}
        className="relative shrink-0 ring-1 ring-white/10 overflow-hidden bg-black"
        style={{ width: displayWidth, height: displayHeight }}
      >
        <canvas
          ref={canvasRef}
          aria-label="Composition preview"
          className="w-full h-full object-contain pointer-events-none"
        />
      </div>
    </div>
  )
}
