import React, { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePanelResize } from '@/components/ui/usePanelResize'
import {
  Move,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Eye,
} from 'lucide-react'
import { useUIStore, LayerId } from '@/stores/uiStore'
import { useCompositionStore, BackgroundSizing } from '@/stores/compositionStore'
import { TextOverlay } from '@/engine/overlay/types'
import { Slider } from '@/components/ui/Slider'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { Tooltip } from '@/components/ui/Tooltip'
import { BassReactivitySection } from './BassReactivitySection'

export const InspectorPanel: React.FC = () => {
  const {
    isInspectorCollapsed,
    toggleInspector,
    inspectorWidth,
    setInspectorWidth,
    selectedLayer,
    setSelectedLayer,
  } = useUIStore(useShallow(s => ({
    isInspectorCollapsed: s.isInspectorCollapsed, toggleInspector: s.toggleInspector,
    inspectorWidth: s.inspectorWidth, setInspectorWidth: s.setInspectorWidth,
    selectedLayer: s.selectedLayer, setSelectedLayer: s.setSelectedLayer,
  })))
  const { panelRef, onPointerDown, onKeyDown } = usePanelResize({
    value: inspectorWidth, min: 260, max: 400, axis: 'x', direction: -1, commit: setInspectorWidth,
  }, isInspectorCollapsed)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const collapseButtonRef = useRef<HTMLButtonElement>(null)
  const handleToggleInspector = () => {
    toggleInspector()
    requestAnimationFrame(() => {
      (isInspectorCollapsed ? collapseButtonRef : expandButtonRef).current?.focus()
    })
  }

  const {
    visualizer,
    updateVisualizer,
    background,
    updateBackground,
    text,
    updateText,
    overlays,
    activeOverlayId,
    updateOverlay,
    effects,
    updateEffects,
    ambientParticles,
    updateAmbientParticles,
    resetVisualizerSection,
    resetTransform,
    resetBackground,
    resetEffects,
  } = useCompositionStore()

  const layerTabs: { id: LayerId; label: string }[] = [
    { id: 'visualizer', label: 'Visualizer' },
    { id: 'background', label: 'Background' },
    { id: 'text', label: 'Text' },
    { id: 'overlay', label: 'Overlays' },
  ]

  return (
    <div data-inspector-panel ref={panelRef}
      style={{ '--panel-size': `${inspectorWidth}px`, width: isInspectorCollapsed ? 40 : 'calc(var(--panel-size) + 4px)' } as React.CSSProperties}
      className="panel-size-transition h-full select-none shrink-0 z-20 border-l border-d2-border relative overflow-hidden bg-d2-surface">
      <aside aria-hidden={!isInspectorCollapsed} ref={node => { if (node) node.inert = !isInspectorCollapsed }}
        className={`panel-fade absolute inset-0 w-10 h-full flex flex-col items-center py-2 ${isInspectorCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <Tooltip content="Expand Properties Inspector" side="left">
          <button
            ref={expandButtonRef}
            onClick={handleToggleInspector}
            aria-label="Expand Inspector"
            aria-expanded={false}
            className="w-8 h-8 rounded flex items-center justify-center text-d2-textSubtle hover:text-white hover:bg-d2-surfaceElevated transition-colors"
          >
            <PanelRightOpen className="w-4 h-4 text-d2-accent" />
          </button>
        </Tooltip>
        <div className="mt-8 [writing-mode:vertical-rl] text-2xs font-semibold tracking-wider text-d2-textSubtle uppercase">
          Inspector
        </div>
      </aside>
      <div aria-hidden={isInspectorCollapsed} ref={node => { if (node) node.inert = isInspectorCollapsed }}
        style={{ width: 'calc(var(--panel-size) + 4px)' }}
        className={`panel-fade flex h-full ${isInspectorCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      {/* Vertical Resize Splitter */}
      <div
        onPointerDown={onPointerDown} onKeyDown={onKeyDown}
        role="separator" tabIndex={isInspectorCollapsed ? -1 : 0} aria-label="Resize inspector"
        aria-orientation="vertical" aria-valuemin={260} aria-valuemax={400} aria-valuenow={inspectorWidth}
        className="w-1 h-full shrink-0 touch-none cursor-col-resize z-30 bg-d2-border hover:bg-d2-accent active:bg-d2-accent transition-colors"
        title="Drag to resize inspector"
      />
      <aside
        style={{ width: 'var(--panel-size)' }}
        className="h-full bg-d2-surface flex flex-col select-none overflow-hidden"
      >
      {/* Header */}
      <div className="h-10 px-3 border-b border-d2-border flex items-center justify-between bg-d2-surfaceElevated/30">
        <div className="flex items-center">
          <h2 className="text-xs font-medium text-d2-text">
            Properties
          </h2>
        </div>

        <Tooltip content="Collapse Inspector" side="left">
          <button
            ref={collapseButtonRef}
            onClick={handleToggleInspector}
            aria-label="Collapse Inspector"
            aria-expanded={true}
            className="p-1 rounded text-d2-textSubtle hover:text-white hover:bg-d2-surfaceElevated transition-colors"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Layer Target Selector */}
       <div className="px-3 border-b border-d2-borderSubtle">
         <div className="grid grid-cols-4 gap-2" role="tablist" aria-label="Inspector layer">
          {layerTabs.map((tab) => {
            const isSelected = selectedLayer === tab.id
            return (
              <button
                key={tab.id}
                 onClick={() => setSelectedLayer(tab.id)}
                 role="tab"
                 aria-selected={isSelected}
                 tabIndex={isSelected ? 0 : -1}
                 onKeyDown={event => {
                   const index = layerTabs.findIndex(layer => layer.id === tab.id)
                   const next = event.key === 'ArrowRight' ? (index + 1) % layerTabs.length
                     : event.key === 'ArrowLeft' ? (index - 1 + layerTabs.length) % layerTabs.length
                     : event.key === 'Home' ? 0 : event.key === 'End' ? layerTabs.length - 1 : -1
                   if (next < 0) return
                   event.preventDefault()
                   setSelectedLayer(layerTabs[next].id)
                   const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                   buttons?.[next].focus()
                 }}
                 className={`h-10 border-b-2 flex items-center justify-center text-2xs transition-colors ${
                  isSelected
                     ? 'text-d2-text font-medium border-d2-accent'
                     : 'border-transparent text-d2-textSubtle hover:text-d2-text'
                }`}
                title={tab.label}
              >
                 <span className="truncate max-w-full">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Inspector Scrollable Body */}
      <div className="flex-1 overflow-y-auto divide-y divide-d2-borderSubtle">
        {/* ========================================================
            TARGET 1: VISUALIZER LAYER
        ======================================================== */}
        {selectedLayer === 'visualizer' && (
          <>
            <CollapsibleSection title="Transform" onReset={resetTransform}>
              <div className="flex items-center gap-2 text-2xs text-d2-textSubtle mb-1">
                <Move className="w-3 h-3 text-d2-accent" />
                <span>Position, Scale & Orientation</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Slider
                  label="Position X"
                  value={visualizer.positionX}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  defaultValue={0}
                  onChange={(v) => updateVisualizer({ positionX: v })}
                  onReset={() => updateVisualizer({ positionX: 0 })}
                />
                <Slider
                  label="Position Y"
                  value={visualizer.positionY}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  defaultValue={15}
                  onChange={(v) => updateVisualizer({ positionY: v })}
                  onReset={() => updateVisualizer({ positionY: 15 })}
                />
              </div>

              <Slider
                label="Scale"
                value={visualizer.scale}
                min={0.2}
                max={3.0}
                step={0.05}
                unit="x"
                defaultValue={1}
                onChange={(v) => updateVisualizer({ scale: v })}
                onReset={() => updateVisualizer({ scale: 1 })}
              />

              <div className="grid grid-cols-2 gap-2">
                <Slider
                  label="Rotation"
                  value={visualizer.rotation}
                  min={-180}
                  max={180}
                  step={5}
                  unit="°"
                  defaultValue={0}
                  onChange={(v) => updateVisualizer({ rotation: v })}
                  onReset={() => updateVisualizer({ rotation: 0 })}
                />

                <Slider
                  label="Opacity"
                  value={Math.round(visualizer.opacity * 100)}
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                  defaultValue={100}
                  onChange={(v) => updateVisualizer({ opacity: v / 100 })}
                  onReset={() => updateVisualizer({ opacity: 1 })}
                />
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Visualizer Geometry & DSP"
              onReset={resetVisualizerSection}
            >
              <div className="space-y-1">
                <Slider
                  label="Bar Count / Points"
                  value={visualizer.barCount}
                  min={16}
                  max={96}
                  step={4}
                  defaultValue={48}
                  onChange={(v) => updateVisualizer({ barCount: v })}
                  onReset={() => updateVisualizer({ barCount: 48 })}
                />

                <div className="grid grid-cols-2 gap-2">
                  <Slider
                    label="Thickness"
                    value={visualizer.thickness}
                    min={2}
                    max={24}
                    step={1}
                    unit="px"
                    defaultValue={8}
                    onChange={(v) => updateVisualizer({ thickness: v })}
                    onReset={() => updateVisualizer({ thickness: 8 })}
                  />
                  <Slider
                    label="Spacing"
                    value={visualizer.spacing}
                    min={0}
                    max={16}
                    step={1}
                    unit="px"
                    defaultValue={4}
                    onChange={(v) => updateVisualizer({ spacing: v })}
                    onReset={() => updateVisualizer({ spacing: 4 })}
                  />
                </div>

                <Slider
                  label="Audio Sensitivity"
                  value={visualizer.sensitivity}
                  min={0.2}
                  max={3.0}
                  step={0.1}
                  unit="x"
                  defaultValue={1.2}
                  onChange={(v) => updateVisualizer({ sensitivity: v })}
                  onReset={() => updateVisualizer({ sensitivity: 1.2 })}
                />

                <Slider
                  label="Frequency Smoothing"
                  value={Math.round(visualizer.smoothing * 100)}
                  min={20}
                  max={95}
                  step={5}
                  unit="%"
                  defaultValue={80}
                  onChange={(v) => updateVisualizer({ smoothing: v / 100 })}
                  onReset={() => updateVisualizer({ smoothing: 0.8 })}
                />
              </div>
            </CollapsibleSection>

            <BassReactivitySection />

            <CollapsibleSection title="Appearance & Shading">
              <div className="flex items-center gap-2 text-2xs text-d2-textSubtle mb-1">
                <Palette className="w-3 h-3 text-d2-accent" />
                <span>Color Harmonies & Glow</span>
              </div>

              <ColorPicker
                label="Primary Color"
                value={visualizer.primaryColor}
                onChange={(c) => updateVisualizer({ primaryColor: c })}
              />

              <ColorPicker
                label="Accent / Gradient"
                value={visualizer.accentColor}
                onChange={(c) => updateVisualizer({ accentColor: c })}
              />

              <Slider
                label="Bloom / Glow"
                value={visualizer.glow}
                min={0}
                max={40}
                step={2}
                unit="px"
                defaultValue={15}
                onChange={(v) => updateVisualizer({ glow: v })}
                onReset={() => updateVisualizer({ glow: 15 })}
              />
            </CollapsibleSection>
          </>
        )}

        {/* ========================================================
            TARGET 2: BACKGROUND LAYER
        ======================================================== */}
        {selectedLayer === 'background' && (
          <CollapsibleSection title="Background Media & Tone" onReset={resetBackground}>
            <div className="space-y-3">
              {(background.type === 'image' || background.type === 'video') && (
                <div className="space-y-1">
                  <span className="text-3xs text-d2-textSubtle font-semibold uppercase tracking-wider">
                    Sizing Mode
                  </span>
                  <div className="grid grid-cols-4 gap-1 p-0.5 rounded bg-d2-canvas border border-d2-borderSubtle">
                    {(['fill', 'fit', 'stretch', 'crop'] as BackgroundSizing[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateBackground({ sizing: mode })}
                        className={`py-1 rounded text-3xs font-mono uppercase transition-colors ${
                          background.sizing === mode
                            ? 'bg-d2-accent text-white font-bold'
                            : 'text-d2-textSubtle hover:text-white'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Slider
                label="Background Blur"
                value={background.blur}
                min={0}
                max={30}
                step={1}
                unit="px"
                defaultValue={0}
                onChange={(v) => updateBackground({ blur: v })}
                onReset={() => updateBackground({ blur: 0 })}
              />

              <Slider
                label="Brightness"
                value={Math.round(background.brightness * 100)}
                min={20}
                max={180}
                step={5}
                unit="%"
                defaultValue={100}
                onChange={(v) => updateBackground({ brightness: v / 100 })}
                onReset={() => updateBackground({ brightness: 1 })}
              />

              <Slider
                label="Contrast"
                value={Math.round(background.contrast * 100)}
                min={50}
                max={200}
                step={5}
                unit="%"
                defaultValue={100}
                onChange={(v) => updateBackground({ contrast: v / 100 })}
                onReset={() => updateBackground({ contrast: 1 })}
              />

              <Slider
                label="Saturation"
                value={Math.round(background.saturation * 100)}
                min={0}
                max={200}
                step={5}
                unit="%"
                defaultValue={100}
                onChange={(v) => updateBackground({ saturation: v / 100 })}
                onReset={() => updateBackground({ saturation: 1 })}
              />

              <Slider
                label="Opacity"
                value={Math.round(background.opacity * 100)}
                min={10}
                max={100}
                step={5}
                unit="%"
                defaultValue={100}
                onChange={(v) => updateBackground({ opacity: v / 100 })}
                onReset={() => updateBackground({ opacity: 1 })}
              />
            </div>
          </CollapsibleSection>
        )}

        {/* ========================================================
            TARGET 3: TEXT LAYER
        ======================================================== */}
        {selectedLayer === 'text' && (() => {
          const activeTextOverlay = overlays.find((o) => o.id === activeOverlayId && o.type === 'text') as TextOverlay | undefined
          return (
            <CollapsibleSection title="Typography Bounds & Transform">
              <div className="space-y-3">
                <Slider
                  label="Horizontal Offset"
                  value={activeTextOverlay ? activeTextOverlay.positionX : text.positionX}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  defaultValue={0}
                  onChange={(v) => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { positionX: v })
                    updateText({ positionX: v })
                  }}
                  onReset={() => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { positionX: 0 })
                    updateText({ positionX: 0 })
                  }}
                />
                <Slider
                  label="Vertical Offset"
                  value={activeTextOverlay ? activeTextOverlay.positionY : text.positionY}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  defaultValue={-20}
                  onChange={(v) => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { positionY: v })
                    updateText({ positionY: v })
                  }}
                  onReset={() => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { positionY: -20 })
                    updateText({ positionY: -20 })
                  }}
                />
                <Slider
                  label="Text Scale"
                  value={Math.round((activeTextOverlay ? activeTextOverlay.scale : 1) * 100)}
                  min={30}
                  max={200}
                  step={5}
                  unit="%"
                  defaultValue={100}
                  onChange={(v) => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { scale: v / 100 })
                  }}
                  onReset={() => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { scale: 1 })
                  }}
                />
                <Slider
                  label="Letter Spacing"
                  value={activeTextOverlay ? activeTextOverlay.letterSpacing : 4}
                  min={-2}
                  max={20}
                  step={1}
                  unit="px"
                  defaultValue={4}
                  onChange={(v) => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { letterSpacing: v })
                  }}
                  onReset={() => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { letterSpacing: 4 })
                  }}
                />
                <Slider
                  label="Text Opacity"
                  value={Math.round((activeTextOverlay ? activeTextOverlay.opacity : text.opacity) * 100)}
                  min={10}
                  max={100}
                  step={5}
                  unit="%"
                  defaultValue={100}
                  onChange={(v) => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { opacity: v / 100 })
                    updateText({ opacity: v / 100 })
                  }}
                  onReset={() => {
                    if (activeTextOverlay) updateOverlay(activeTextOverlay.id, { opacity: 1 })
                    updateText({ opacity: 1 })
                  }}
                />
              </div>
            </CollapsibleSection>
          )
        })()}

        {/* ========================================================
            TARGET 4: OVERLAYS & CINEMATIC EFFECTS
        ======================================================== */}
        {selectedLayer === 'overlay' && (
          <CollapsibleSection title="Cinematic Lens & Atmosphere" onReset={resetEffects}>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-2xs text-d2-textSubtle mb-1">
                <Eye className="w-3 h-3 text-cyan-400" />
                <span>Lens Effects & Grain</span>
              </div>

              <Slider
                label="Vignette Falloff"
                value={effects.vignette}
                min={0}
                max={100}
                step={5}
                unit="%"
                defaultValue={40}
                onChange={(v) => updateEffects({ vignette: v })}
                onReset={() => updateEffects({ vignette: 40 })}
              />

              <Slider
                label="Film Grain"
                value={effects.grain}
                min={0}
                max={50}
                step={2}
                unit="%"
                defaultValue={12}
                onChange={(v) => updateEffects({ grain: v })}
                onReset={() => updateEffects({ grain: 12 })}
              />

              <Slider
                label="Optic Bloom & Glow"
                value={effects.bloom}
                min={0}
                max={100}
                step={5}
                unit="%"
                defaultValue={20}
                onChange={(v) => updateEffects({ bloom: v })}
                onReset={() => updateEffects({ bloom: 20 })}
              />

              <Slider
                label="RGB Chromatic Split"
                value={effects.chromaticAberration}
                min={0}
                max={20}
                step={1}
                unit="px"
                defaultValue={0}
                onChange={(v) => updateEffects({ chromaticAberration: v })}
                onReset={() => updateEffects({ chromaticAberration: 0 })}
              />

              <Slider
                label="Anamorphic Light Leaks"
                value={effects.lightLeaks}
                min={0}
                max={100}
                step={5}
                unit="%"
                defaultValue={0}
                onChange={(v) => updateEffects({ lightLeaks: v })}
                onReset={() => updateEffects({ lightLeaks: 0 })}
              />

              <div className="pt-2 border-t border-d2-borderSubtle space-y-1">
                <div className="flex items-center justify-between text-2xs font-semibold text-white">
                  <span>Ambient Particles</span>
                  <button
                    onClick={() => updateAmbientParticles({ enabled: !ambientParticles.enabled })}
                    className="text-3xs font-mono text-d2-accent"
                  >
                    {ambientParticles.enabled ? 'ACTIVE' : 'OFF'}
                  </button>
                </div>
                {ambientParticles.enabled && (
                  <Slider
                    label="Particle Count"
                    value={ambientParticles.particleCount}
                    min={30}
                    max={250}
                    step={10}
                    defaultValue={120}
                    onChange={(v) => updateAmbientParticles({ particleCount: v })}
                    onReset={() => updateAmbientParticles({ particleCount: 120 })}
                  />
                )}
              </div>
            </div>
          </CollapsibleSection>
        )}
      </div>
     </aside>
     </div>
   </div>
  )
}
