import React, { useState, useMemo } from 'react'
import {
  Video,
  Search,
  CheckCircle2,
  X,
  Sliders,
  Compass,
} from 'lucide-react'
import {
  useCompositionStore,
  CameraEasingType,
  CameraLoopMode,
} from '@/stores/compositionStore'
import {
  CAMERA_MOTION_PRESETS,
  CameraMotionPresetItem,
  CameraPresetCategory,
} from '@/engine/effects/CameraMotionCatalog'
import { CameraMotionThumbCanvas } from './CameraMotionThumbCanvas'
import { Slider } from '@/components/ui/Slider'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { ScrollableCategoryStrip } from '@/components/ui/ScrollableCategoryStrip'

const CATEGORIES: Array<'All' | CameraPresetCategory> = [
  'All',
  'Basic',
  'Cinematic',
  'Advanced',
  'Dynamic',
  'Audio Reactive',
]

const EASING_OPTIONS: { id: CameraEasingType; label: string }[] = [
  { id: 'ease-in-out', label: 'Ease In-Out (Smooth)' },
  { id: 'smooth-step', label: 'Smoothstep' },
  { id: 'sine', label: 'Sinusoidal' },
  { id: 'cubic', label: 'Cubic Acceleration' },
  { id: 'exponential', label: 'Exponential' },
  { id: 'linear', label: 'Linear' },
]

const LOOP_OPTIONS: { id: CameraLoopMode; label: string }[] = [
  { id: 'ping-pong', label: 'Ping-Pong (Smooth Reverse)' },
  { id: 'loop', label: 'Continuous Loop' },
  { id: 'once', label: 'Play Once' },
]

const BEAT_DIVISIONS: Array<'1/4' | '1/2' | '1' | '2' | '4'> = [
  '1/4',
  '1/2',
  '1',
  '2',
  '4',
]

export const CameraMotionBrowser: React.FC = () => {
  const { cinematicMotion, updateCinematicMotion } = useCompositionStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<'All' | CameraPresetCategory>('All')

  // Filter presets
  const filteredPresets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return CAMERA_MOTION_PRESETS.filter((preset) => {
      if (selectedCategory !== 'All' && preset.category !== selectedCategory) {
        return false
      }
      if (!q) return true
      const matchesName = preset.name.toLowerCase().includes(q)
      const matchesCategory = preset.category.toLowerCase().includes(q)
      const matchesDesc = preset.description.toLowerCase().includes(q)
      const matchesTags = preset.tags.some((t) => t.toLowerCase().includes(q))
      return matchesName || matchesCategory || matchesDesc || matchesTags
    })
  }, [searchQuery, selectedCategory])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: CAMERA_MOTION_PRESETS.length }
    CAMERA_MOTION_PRESETS.forEach((p) => {
      counts[p.category] = (counts[p.category] || 0) + 1
    })
    return counts
  }, [])

  const handleApplyPreset = (preset: CameraMotionPresetItem) => {
    updateCinematicMotion({
      preset: preset.id,
      ...preset.recommendedConfig,
    })
  }

  const handleResetMotionControls = () => {
    updateCinematicMotion({
      speed: 1.0,
      intensity: 1.0,
      zoomStrength: 40,
      panDistance: 35,
      rotationAmount: 2.0,
      smoothness: 80,
      easingType: 'ease-in-out',
      loopAnimation: true,
      loopMode: 'ping-pong',
      startZoom: 1.0,
      endZoom: 1.15,
      startPanX: 0,
      endPanX: 0,
      startPanY: 0,
      endPanY: 0,
      startRotation: 0,
      endRotation: 0,
      beatSync: false,
      beatSyncDivision: '1',
      beatZoom: 0,
      bassImpactZoom: 0,
      kickPulse: 0,
      energyMovement: 0,
    })
  }

  return (
    <div className="flex flex-col h-full select-none text-xs bg-d2-surface">
      {/* Header: Title & Info */}
      <div className="p-3 border-b border-d2-border space-y-2.5 bg-d2-surfaceElevated/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-cyan-400" />
            <div>
              <h2 className="font-bold text-white uppercase tracking-wider text-2xs leading-none">
                Camera Motion Studio
              </h2>
              <span className="text-3xs text-d2-textSubtle font-mono">
                {CAMERA_MOTION_PRESETS.length} Motion Presets & Optical Physics
              </span>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded text-3xs font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-800/40 shadow-xs">
            24+ PRESETS
          </span>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-d2-textSubtle pointer-events-none" />
          <input
            type="text"
            placeholder="Search camera motion, zoom, pan, orbit, dolly..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-7 pl-8 pr-7 rounded bg-d2-canvas border border-d2-border text-2xs text-white placeholder:text-d2-textSubtle focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-d2-textSubtle hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Filter Pills */}
        <ScrollableCategoryStrip label="Camera motion categories">
          {CATEGORIES.map((cat) => {
            const isCatSelected = selectedCategory === cat
            const count = categoryCounts[cat] || 0
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                aria-pressed={isCatSelected}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-3xs font-medium whitespace-nowrap transition-colors ${
                  isCatSelected
                    ? 'bg-d2-surfaceActive text-d2-accent font-semibold border border-d2-accent/40'
                    : 'bg-d2-surface border border-d2-borderSubtle text-d2-textSubtle hover:text-white hover:border-d2-border hover:bg-d2-surfaceElevated/60'
                }`}
              >
                <span>{cat}</span>
                <span
                  className={`text-4xs px-1 py-0.2 rounded-full font-mono ${
                    isCatSelected
                      ? 'bg-black/30 text-white'
                      : 'bg-d2-surfaceElevated text-d2-textSubtle'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </ScrollableCategoryStrip>
      </div>

      {/* Main Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Preset Cards Browser */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-3xs font-bold uppercase tracking-wider text-d2-textSubtle font-mono">
              Movement Presets ({filteredPresets.length})
            </span>
            <span className="text-4xs text-d2-textSubtle font-mono">
              Click preset to apply
            </span>
          </div>

          {filteredPresets.length === 0 ? (
            <div className="py-10 text-center text-d2-textSubtle text-2xs space-y-1.5">
              <Compass className="w-8 h-8 mx-auto text-d2-textSubtle/40" />
              <p className="font-medium text-white/80">No motion presets found</p>
              <p className="text-3xs">Try searching for &quot;zoom&quot;, &quot;pan&quot;, or &quot;orbit&quot;</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {filteredPresets.map((preset) => {
                const isSelected =
                  cinematicMotion.preset === preset.id ||
                  (preset.id === 'static' && cinematicMotion.preset === 'none') ||
                  (preset.id === 'pan-up' && cinematicMotion.preset === 'vertical-pan') ||
                  (preset.id === 'cinematic-drift' && cinematicMotion.preset === 'subtle-motion') ||
                  (preset.id === 'bass-pulse' && cinematicMotion.preset === 'beat-pulse')

                // Build a combined config for preview thumbnail
                const previewConfig = {
                  ...cinematicMotion,
                  preset: preset.id,
                  ...preset.recommendedConfig,
                }

                return (
                  <div
                    key={preset.id}
                    data-camera-preset-id={preset.id}
                    onClick={() => handleApplyPreset(preset)}
                    className={`p-1.5 rounded-lg border transition-all cursor-pointer group flex items-center gap-2.5 relative overflow-hidden ${
                      isSelected
                        ? 'bg-cyan-950/30 border-cyan-500 shadow-sm ring-1 ring-cyan-500/40'
                        : 'bg-d2-surfaceElevated/40 border-d2-borderSubtle hover:border-d2-border hover:bg-d2-surfaceElevated/80'
                    }`}
                  >
                    {/* Active Accent Left Indicator */}
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-cyan-400 via-indigo-400 to-cyan-400" />
                    )}

                    {/* Viewfinder Preview Canvas */}
                    <div className="w-16 h-11 rounded bg-black/80 border border-white/10 relative overflow-hidden shrink-0 group-hover:border-white/20 transition-all shadow-inner">
                      <CameraMotionThumbCanvas
                        motionConfig={previewConfig}
                        isActive={isSelected}
                      />
                    </div>

                    {/* Preset Info */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                      <span
                        className={`text-2xs font-semibold truncate tracking-tight ${
                          isSelected ? 'text-white' : 'text-d2-text group-hover:text-white'
                        }`}
                      >
                        {preset.name}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-d2-canvas/80 text-cyan-400 border border-cyan-900/40">
                          {preset.category}
                        </span>
                        <span className="text-[9px] text-d2-textSubtle truncate max-w-[120px]">
                          {preset.description}
                        </span>
                      </div>
                    </div>

                    {/* Active Checkmark */}
                    {isSelected && (
                      <div className="shrink-0 pr-1 text-cyan-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ========================================================
            ADVANCED MOTION CONTROLS SECTION
        ======================================================== */}
        <div className="pt-2 border-t border-d2-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-2xs font-bold text-white uppercase tracking-wider font-mono">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Advanced Motion Controls</span>
            </div>
            <button
              onClick={handleResetMotionControls}
              className="text-4xs font-mono text-d2-textSubtle hover:text-white hover:underline"
            >
              Reset All
            </button>
          </div>

          {/* Primary Sliders */}
          <div className="p-3 rounded-lg bg-d2-surfaceElevated/40 border border-d2-border space-y-2">
            <Slider
              label="Motion Speed"
              value={cinematicMotion.speed ?? 1.0}
              min={0.2}
              max={3.0}
              step={0.1}
              unit="x"
              defaultValue={1.0}
              onChange={(v) => updateCinematicMotion({ speed: v })}
              onReset={() => updateCinematicMotion({ speed: 1.0 })}
            />

            <Slider
              label="Motion Intensity"
              value={Math.round((cinematicMotion.intensity ?? 1.0) * 100)}
              min={20}
              max={200}
              step={5}
              unit="%"
              defaultValue={100}
              onChange={(v) => updateCinematicMotion({ intensity: v / 100 })}
              onReset={() => updateCinematicMotion({ intensity: 1.0 })}
            />

            <Slider
              label="Zoom Amount"
              value={cinematicMotion.zoomStrength ?? 40}
              min={0}
              max={100}
              step={5}
              unit="%"
              defaultValue={40}
              onChange={(v) => updateCinematicMotion({ zoomStrength: v })}
              onReset={() => updateCinematicMotion({ zoomStrength: 40 })}
            />

            <Slider
              label="Pan Amount"
              value={cinematicMotion.panDistance ?? 35}
              min={0}
              max={100}
              step={5}
              unit="px"
              defaultValue={35}
              onChange={(v) => updateCinematicMotion({ panDistance: v })}
              onReset={() => updateCinematicMotion({ panDistance: 35 })}
            />

            <Slider
              label="Rotation Tilt"
              value={cinematicMotion.rotationAmount ?? 2.0}
              min={0}
              max={15}
              step={0.5}
              unit="°"
              defaultValue={2.0}
              onChange={(v) => updateCinematicMotion({ rotationAmount: v })}
              onReset={() => updateCinematicMotion({ rotationAmount: 2.0 })}
            />

            <Slider
              label="Smoothness"
              value={cinematicMotion.smoothness ?? 80}
              min={0}
              max={100}
              step={5}
              unit="%"
              defaultValue={80}
              onChange={(v) => updateCinematicMotion({ smoothness: v })}
              onReset={() => updateCinematicMotion({ smoothness: 80 })}
            />
          </div>

          {/* Interpolation, Easing & Loop Mode */}
          <div className="p-3 rounded-lg bg-d2-surfaceElevated/40 border border-d2-border space-y-3">
            <div className="space-y-1">
              <label className="text-3xs font-semibold text-d2-textSubtle uppercase tracking-wider font-mono">
                Interpolation Easing
              </label>
              <select
                value={cinematicMotion.easingType ?? 'ease-in-out'}
                onChange={(e) =>
                  updateCinematicMotion({ easingType: e.target.value as CameraEasingType })
                }
                className="w-full h-7 px-2 rounded bg-d2-canvas border border-d2-border text-2xs text-white focus:outline-none focus:border-cyan-500"
              >
                {EASING_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-3xs font-semibold text-d2-textSubtle uppercase tracking-wider font-mono">
                Loop Mode
              </label>
              <select
                value={cinematicMotion.loopMode ?? 'ping-pong'}
                onChange={(e) =>
                  updateCinematicMotion({ loopMode: e.target.value as CameraLoopMode })
                }
                className="w-full h-7 px-2 rounded bg-d2-canvas border border-d2-border text-2xs text-white focus:outline-none focus:border-cyan-500"
              >
                {LOOP_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Beat Sync Toggle */}
            <div className="pt-2 border-t border-d2-borderSubtle flex items-center justify-between">
              <div>
                <span className="text-2xs font-semibold text-white block">Beat Synchronization</span>
                <span className="text-3xs text-d2-textSubtle">Lock camera motion phase to tempo</span>
              </div>
              <button
                onClick={() => updateCinematicMotion({ beatSync: !cinematicMotion.beatSync })}
                className={`px-2 py-0.5 rounded text-3xs font-mono font-bold transition-colors ${
                  cinematicMotion.beatSync
                    ? 'bg-cyan-500 text-white shadow-xs'
                    : 'bg-d2-surface border border-d2-border text-d2-textSubtle'
                }`}
              >
                {cinematicMotion.beatSync ? 'SYNCED' : 'FREE'}
              </button>
            </div>

            {cinematicMotion.beatSync && (
              <div className="space-y-1 pt-1">
                <span className="text-3xs text-d2-textSubtle font-semibold font-mono">
                  Beat Division / Measure
                </span>
                <div className="grid grid-cols-5 gap-1">
                  {BEAT_DIVISIONS.map((div) => {
                    const isSel = (cinematicMotion.beatSyncDivision ?? '1') === div
                    return (
                      <button
                        key={div}
                        onClick={() => updateCinematicMotion({ beatSyncDivision: div })}
                        className={`py-1 rounded text-3xs font-mono font-bold text-center transition-colors border ${
                          isSel
                            ? 'bg-cyan-500/25 border-cyan-500 text-cyan-300'
                            : 'bg-d2-canvas border-d2-borderSubtle text-d2-textSubtle hover:text-white'
                        }`}
                      >
                        {div}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Start and End Framing Collapsible */}
          <CollapsibleSection title="Start & End Framing" defaultOpen={false}>
            <div className="space-y-2 pt-1 text-2xs">
              <span className="text-3xs text-d2-textSubtle">
                Interpolate camera between custom start and end positions
              </span>

              <div className="grid grid-cols-2 gap-2">
                <Slider
                  label="Start Zoom"
                  value={Math.round((cinematicMotion.startZoom ?? 1.0) * 100)}
                  min={80}
                  max={150}
                  step={5}
                  unit="%"
                  defaultValue={100}
                  onChange={(v) => updateCinematicMotion({ startZoom: v / 100 })}
                  onReset={() => updateCinematicMotion({ startZoom: 1.0 })}
                />
                <Slider
                  label="End Zoom"
                  value={Math.round((cinematicMotion.endZoom ?? 1.15) * 100)}
                  min={80}
                  max={150}
                  step={5}
                  unit="%"
                  defaultValue={115}
                  onChange={(v) => updateCinematicMotion({ endZoom: v / 100 })}
                  onReset={() => updateCinematicMotion({ endZoom: 1.15 })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Slider
                  label="Start Pan X"
                  value={cinematicMotion.startPanX ?? 0}
                  min={-100}
                  max={100}
                  step={5}
                  unit="px"
                  defaultValue={0}
                  onChange={(v) => updateCinematicMotion({ startPanX: v })}
                  onReset={() => updateCinematicMotion({ startPanX: 0 })}
                />
                <Slider
                  label="End Pan X"
                  value={cinematicMotion.endPanX ?? 0}
                  min={-100}
                  max={100}
                  step={5}
                  unit="px"
                  defaultValue={0}
                  onChange={(v) => updateCinematicMotion({ endPanX: v })}
                  onReset={() => updateCinematicMotion({ endPanX: 0 })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Slider
                  label="Start Rotation"
                  value={cinematicMotion.startRotation ?? 0}
                  min={-15}
                  max={15}
                  step={0.5}
                  unit="°"
                  defaultValue={0}
                  onChange={(v) => updateCinematicMotion({ startRotation: v })}
                  onReset={() => updateCinematicMotion({ startRotation: 0 })}
                />
                <Slider
                  label="End Rotation"
                  value={cinematicMotion.endRotation ?? 0}
                  min={-15}
                  max={15}
                  step={0.5}
                  unit="°"
                  defaultValue={0}
                  onChange={(v) => updateCinematicMotion({ endRotation: v })}
                  onReset={() => updateCinematicMotion({ endRotation: 0 })}
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* Audio-Reactive Overdrive Collapsible */}
          <CollapsibleSection title="Audio-Reactive Camera Overdrive" defaultOpen={true}>
            <div className="space-y-2 pt-1">
              <Slider
                label="Beat Zoom Pulse"
                value={cinematicMotion.beatZoom ?? 0}
                min={0}
                max={100}
                step={5}
                unit="%"
                defaultValue={0}
                onChange={(v) => updateCinematicMotion({ beatZoom: v })}
                onReset={() => updateCinematicMotion({ beatZoom: 0 })}
              />

              <Slider
                label="Bass Impact Zoom"
                value={cinematicMotion.bassImpactZoom ?? 0}
                min={0}
                max={100}
                step={5}
                unit="%"
                defaultValue={0}
                onChange={(v) => updateCinematicMotion({ bassImpactZoom: v })}
                onReset={() => updateCinematicMotion({ bassImpactZoom: 0 })}
              />

              <Slider
                label="Kick Punch Pulse"
                value={cinematicMotion.kickPulse ?? 0}
                min={0}
                max={100}
                step={5}
                unit="%"
                defaultValue={0}
                onChange={(v) => updateCinematicMotion({ kickPulse: v })}
                onReset={() => updateCinematicMotion({ kickPulse: 0 })}
              />

              <Slider
                label="Energy Camera Drift"
                value={cinematicMotion.energyMovement ?? 0}
                min={0}
                max={100}
                step={5}
                unit="%"
                defaultValue={0}
                onChange={(v) => updateCinematicMotion({ energyMovement: v })}
                onReset={() => updateCinematicMotion({ energyMovement: 0 })}
              />
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  )
}
