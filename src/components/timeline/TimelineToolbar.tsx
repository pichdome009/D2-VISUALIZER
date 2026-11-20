import React, { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  MousePointer, Scissors, Magnet, ZoomIn, ZoomOut, Maximize2,
  Undo2, Redo2, Copy, Trash2, Bookmark, ChevronLeft, ChevronRight, Split,
} from 'lucide-react'
import { useTimelineStore } from '@/stores/timelineStore'
import { usePreviewStore } from '@/stores/previewStore'
import { useAudioStore } from '@/stores/audioStore'
import { TimelineEngine } from '@/engine/timeline/TimelineEngine'
import { TimecodeUtils } from '@/engine/timeline/TimecodeUtils'
import { TrackType } from '@/engine/timeline/types'
import { Select } from '@/components/ui/Select'
import { useTimelineClock } from './useTimelineClock'

interface ToolButtonProps {
  label: string
  icon: React.ElementType
  onClick: () => void
  active?: boolean
  disabled?: boolean
}

const ToolButton: React.FC<ToolButtonProps> = ({ label, icon: Icon, onClick, active, disabled }) => (
  <button type="button" title={label} aria-label={label} aria-pressed={active}
    onClick={onClick} disabled={disabled}
    className={`w-7 h-7 rounded flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
      active ? 'bg-d2-surfaceActive text-d2-accent' : 'text-d2-textMuted hover:text-white hover:bg-d2-surfaceElevated'
    }`}>
    <Icon className="w-3.5 h-3.5" />
  </button>
)

// Readouts follow the transient scrub/playback clock without rerendering toolbar buttons.
const FrameNavigation: React.FC = () => {
  const timecodeRef = useRef<HTMLSpanElement>(null)
  useTimelineClock(time => {
    const text = TimecodeUtils.secondsToTimecode(time, useTimelineStore.getState().fps)
    if (timecodeRef.current && timecodeRef.current.textContent !== text) timecodeRef.current.textContent = text
  })
  const fps = useTimelineStore((s) => s.fps)
  const stepFrame = (direction: 1 | -1) => {
    const { currentTime: time, duration } = usePreviewStore.getState()
    useAudioStore.getState().seek(TimelineEngine.getInstance().stepFrame(time, direction, duration, fps))
  }
  const jumpMarker = (direction: 1 | -1) => {
    const currentTime = usePreviewStore.getState().currentTime
    const { markers } = useTimelineStore.getState()
    const engine = TimelineEngine.getInstance()
    const time = direction > 0 ? engine.getNextMarkerTime(currentTime, markers)
      : engine.getPrevMarkerTime(currentTime, markers)
    if (time !== null) useAudioStore.getState().seek(time)
  }
  return (
    <div className="flex items-center gap-0.5" data-timeline-timecode>
      <ToolButton label="Previous marker" icon={Bookmark} onClick={() => jumpMarker(-1)} />
      <ToolButton label={`Previous frame (1/${fps}s)`} icon={ChevronLeft} onClick={() => stepFrame(-1)} />
      <span ref={timecodeRef} className="font-mono text-2xs text-d2-text tabular-nums px-1 min-w-[84px] text-center">
        {TimecodeUtils.secondsToTimecode(usePreviewStore.getState().currentTime, fps)}
      </span>
      <ToolButton label={`Next frame (1/${fps}s)`} icon={ChevronRight} onClick={() => stepFrame(1)} />
      <ToolButton label="Next marker" icon={Bookmark} onClick={() => jumpMarker(1)} />
    </div>
  )
}

const trackOptions: { type: TrackType; label: string }[] = [
  { type: 'audio-master', label: 'Audio' },
  { type: 'visualizer', label: 'Visualizer' },
  { type: 'background', label: 'Background' },
  { type: 'typography', label: 'Typography' },
  { type: 'artwork', label: 'Artwork' },
  { type: 'logo', label: 'Logo / watermark' },
  { type: 'particles', label: 'Particles' },
  { type: 'effects', label: 'Effects' },
]

export const TimelineToolbar: React.FC = () => {
  const {
    zoom, setZoom, activeTool, setActiveTool, snapEnabled, toggleSnap,
    selectedClipId, splitAtPlayhead, duplicateClip, deleteClip, addMarker,
    addTrack, fitToProject, canUndo, canRedo, undo, redo,
  } = useTimelineStore(useShallow((s) => ({
    zoom: s.zoom, setZoom: s.setZoom, activeTool: s.activeTool, setActiveTool: s.setActiveTool,
    snapEnabled: s.snapEnabled, toggleSnap: s.toggleSnap, selectedClipId: s.selectedClipId,
    splitAtPlayhead: s.splitAtPlayhead, duplicateClip: s.duplicateClip, deleteClip: s.deleteClip,
    addMarker: s.addMarker, addTrack: s.addTrack, fitToProject: s.fitToProject,
    canUndo: s.canUndo, canRedo: s.canRedo, undo: s.undo, redo: s.redo,
  })))
  const fit = () => {
    const container = document.getElementById('d2-timeline-scroll-container')
    if (container) fitToProject(usePreviewStore.getState().duration, container.clientWidth)
  }
  return (
    <div className="min-h-11 w-full bg-d2-surface px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 select-none">
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-d2-text mr-2">Timeline</span>
        <ToolButton label="Selection tool (V)" icon={MousePointer} active={activeTool === 'select'} onClick={() => setActiveTool('select')} />
        <ToolButton label="Blade tool (C)" icon={Scissors} active={activeTool === 'blade'} onClick={() => setActiveTool('blade')} />
        <span className="h-4 w-px bg-d2-border mx-1" />
        <ToolButton label="Split clip at playhead (Ctrl+K)" icon={Split} disabled={!selectedClipId}
          onClick={() => splitAtPlayhead(usePreviewStore.getState().currentTime)} />
        <ToolButton label="Duplicate clip (Ctrl+D)" icon={Copy} disabled={!selectedClipId}
          onClick={() => { if (selectedClipId) duplicateClip(selectedClipId) }} />
        <ToolButton label="Delete clip (Delete)" icon={Trash2} disabled={!selectedClipId}
          onClick={() => { if (selectedClipId) deleteClip(selectedClipId) }} />
        <span className="h-4 w-px bg-d2-border mx-1" />
        <ToolButton label="Magnetic snapping (N)" icon={Magnet} active={snapEnabled} onClick={toggleSnap} />
        <ToolButton label="Add marker (M)" icon={Bookmark} onClick={() => addMarker(usePreviewStore.getState().currentTime)} />
        <Select ariaLabel="Add track" value="" placeholder="+ Track" compact className="w-[84px]"
          options={trackOptions.map(option => ({ value: option.type, label: option.label }))}
          onChange={value => {
          const option = trackOptions.find(track => track.type === value)
          if (option) addTrack(option.type, `${option.label} Track`)
        }} />
      </div>
      <FrameNavigation />
      <div className="flex items-center gap-1">
        <ToolButton label="Undo timeline action (Ctrl+Z)" icon={Undo2} disabled={!canUndo} onClick={undo} />
        <ToolButton label="Redo timeline action (Ctrl+Y)" icon={Redo2} disabled={!canRedo} onClick={redo} />
        <span className="h-4 w-px bg-d2-border mx-1" />
        <ToolButton label="Fit project to timeline" icon={Maximize2} onClick={fit} />
        <ToolButton label="Zoom out" icon={ZoomOut} onClick={() => setZoom(zoom - 3)} />
        <input type="range" aria-label="Timeline zoom" min={4} max={80} step={2} value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="w-16 h-1 bg-d2-surfaceActive rounded appearance-none cursor-pointer" />
        <ToolButton label="Zoom in" icon={ZoomIn} onClick={() => setZoom(zoom + 3)} />
      </div>
    </div>
  )
}
