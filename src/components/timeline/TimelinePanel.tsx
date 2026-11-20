import React, { useRef, useEffect, useState, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useTimelineStore } from '@/stores/timelineStore'
import { useUIStore } from '@/stores/uiStore'
import { usePreviewStore } from '@/stores/previewStore'
import { TimeRuler } from './TimeRuler'
import { Playhead } from './Playhead'
import { TrackHeader, TrackLane } from './TrackRow'
import { TimelineToolbar } from './TimelineToolbar'
import { TimelineRenderer } from '@/engine/timeline/TimelineRenderer'
import { Tooltip } from '@/components/ui/Tooltip'
import { usePanelResize } from '@/components/ui/usePanelResize'

export const TimelinePanel: React.FC = () => {
  const { zoom, tracks, setScrollLeft } = useTimelineStore(useShallow((s) => ({
    zoom: s.zoom, tracks: s.tracks, setScrollLeft: s.setScrollLeft,
  })))
  const { isTimelineCollapsed, toggleTimeline, timelineHeight, setTimelineHeight } = useUIStore(useShallow(s => ({
    isTimelineCollapsed: s.isTimelineCollapsed, toggleTimeline: s.toggleTimeline, timelineHeight: s.timelineHeight, setTimelineHeight: s.setTimelineHeight,
  })))
  const { panelRef, onPointerDown, onKeyDown } = usePanelResize({
    value: timelineHeight, min: 160, max: 480, axis: 'y', direction: -1, commit: setTimelineHeight,
  }, isTimelineCollapsed)
  const duration = usePreviewStore((s) => s.duration)
  const [filterActiveOnly, setFilterActiveOnly] = useState(false)

  const displayedTracks = useMemo(() => {
    if (!filterActiveOnly) return tracks
    return tracks.filter(
      (t) => t.clips.length > 0 || t.type === 'audio-master' || t.type === 'visualizer'
    )
  }, [tracks, filterActiveOnly])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const headerContainerRef = useRef<HTMLDivElement>(null)

  const totalWidth = TimelineRenderer.calculateTotalWidth(duration, zoom)

  // Keyboard shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'v' || e.key === 'V') {
        useTimelineStore.getState().setActiveTool('select')
      } else if (e.key === 'c' || e.key === 'C') {
        useTimelineStore.getState().setActiveTool('blade')
      } else if (e.key === 'n' || e.key === 'N') {
        useTimelineStore.getState().toggleSnap()
      } else if (e.key === 'm' || e.key === 'M') {
        const cur = usePreviewStore.getState().currentTime
        useTimelineStore.getState().addMarker(cur)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = useTimelineStore.getState().selectedClipId
        if (sel) useTimelineStore.getState().deleteClip(sel)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        const sel = useTimelineStore.getState().selectedClipId
        if (sel) useTimelineStore.getState().duplicateClip(sel)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        const cur = usePreviewStore.getState().currentTime
        useTimelineStore.getState().splitAtPlayhead(cur)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) {
          useTimelineStore.getState().redo()
        } else {
          useTimelineStore.getState().undo()
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        useTimelineStore.getState().redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Sync horizontal scroll state with store
  const handleScroll = () => {
    if (scrollContainerRef.current) {
      setScrollLeft(scrollContainerRef.current.scrollLeft)
      // Sync vertical scroll with track headers
      if (headerContainerRef.current) {
        headerContainerRef.current.scrollTop = scrollContainerRef.current.scrollTop
      }
    }
  }

  return (
    <div data-timeline-panel ref={panelRef}
      style={{ '--panel-size': `${timelineHeight}px`, height: isTimelineCollapsed ? 32 : 'var(--panel-size)' } as React.CSSProperties}
      className="panel-size-transition w-full bg-d2-surface border-t border-d2-border select-none z-20 shrink-0 overflow-hidden relative">
      <div aria-hidden={!isTimelineCollapsed} ref={node => { if (node) node.inert = !isTimelineCollapsed }}
        className={`panel-fade absolute top-0 inset-x-0 h-8 px-3 flex items-center justify-between ${isTimelineCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-d2-accent" />
          <span className="text-2xs font-semibold uppercase tracking-wider text-d2-textSubtle">
            Sequence Timeline ({tracks.length} Multi-Tracks)
          </span>
        </div>
        <button
          onClick={toggleTimeline}
          aria-label="Expand Timeline"
          aria-expanded={false}
          className="flex items-center gap-1 text-2xs text-d2-textSubtle hover:text-white"
        >
          <span>Expand Timeline</span>
          <ChevronUp className="w-3.5 h-3.5 text-d2-accent" />
        </button>
      </div>
    <div
      style={{ height: 'var(--panel-size)' }}
      aria-hidden={isTimelineCollapsed} ref={node => { if (node) node.inert = isTimelineCollapsed }}
      className={`panel-fade w-full flex flex-col overflow-hidden relative ${isTimelineCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      {/* Top Resize Handle */}
      <div
        onPointerDown={onPointerDown} onKeyDown={onKeyDown}
        role="separator" tabIndex={isTimelineCollapsed ? -1 : 0} aria-label="Resize timeline"
        aria-orientation="horizontal" aria-valuemin={160} aria-valuemax={480} aria-valuenow={timelineHeight}
        className="absolute top-0 left-0 right-0 h-1 touch-none cursor-ns-resize hover:bg-d2-accent/60 z-40 transition-colors"
      />

      {/* Timeline Professional Toolbar */}
      <div className="flex items-center justify-between border-b border-d2-border bg-d2-surfaceElevated/40">
        <div className="flex-1 min-w-0">
          <TimelineToolbar />
        </div>
        <div className="px-2">
          <Tooltip content="Collapse Timeline" side="top">
            <button
              onClick={toggleTimeline}
              aria-label="Collapse Timeline"
              aria-expanded={true}
              className="p-1 rounded text-d2-textSubtle hover:text-white hover:bg-d2-surface transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Main Track Grid & Ruler */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Fixed Column: Channels / Headers */}
        <div className="w-56 h-full bg-d2-surface border-r border-d2-border flex flex-col shrink-0 z-20">
          <div className="h-10 bg-d2-surface border-b border-d2-border px-3 flex items-center justify-between text-3xs font-medium text-d2-textSubtle shrink-0 whitespace-nowrap overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="text-d2-text font-medium">Tracks <span className="text-d2-textSubtle ml-1">{displayedTracks.length}</span></span>
              <button
                onClick={() => setFilterActiveOnly(!filterActiveOnly)}
                className={`px-1.5 py-0.2 rounded text-4xs font-mono font-semibold transition-colors ${
                  filterActiveOnly
                    ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40'
                    : 'bg-d2-canvas text-d2-textSubtle hover:text-white border border-d2-borderSubtle'
                }`}
                title="Toggle showing only tracks with active clips"
              >
                {filterActiveOnly ? 'ACTIVE' : 'ALL'}
              </button>
            </div>
            <span className="text-4xs text-d2-textSubtle">Controls</span>
          </div>

          <div
            ref={headerContainerRef}
            className="flex-1 overflow-hidden"
          >
            {displayedTracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
          </div>
        </div>

        {/* Right Scrollable Column: Ruler & Clip Lanes */}
        <div
          id="d2-timeline-scroll-container"
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 h-full overflow-x-auto overflow-y-auto relative bg-d2-canvas/60"
        >
          <div style={{ width: `${totalWidth}px` }} className="relative min-h-full">
            {/* Top Seconds & Frame Time Ruler */}
            <TimeRuler />

            {/* Playhead Vertical Guide Needle */}
            <Playhead />

            {/* Track Clip Lanes */}
            <div className="divide-y divide-d2-borderSubtle">
              {displayedTracks.map((track) => (
                <TrackLane key={track.id} track={track} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
