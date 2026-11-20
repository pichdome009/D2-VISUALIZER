import React from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePanelResize } from '@/components/ui/usePanelResize'
import { useUIStore } from '@/stores/uiStore'
import { SidebarNav } from './SidebarNav'
import { MediaPanel } from './panels/MediaPanel'
import { VisualizersPanel } from './panels/VisualizersPanel'
import { BackgroundsPanel } from './panels/BackgroundsPanel'
import { TextPanel } from './panels/TextPanel'
import { EffectsPanel } from './panels/EffectsPanel'
import { TemplatesPanel } from './panels/TemplatesPanel'

export const SidebarContainer: React.FC = () => {
  const { activeTab, isSidebarCollapsed, sidebarWidth, setSidebarWidth } = useUIStore(useShallow(s => ({
    activeTab: s.activeTab, isSidebarCollapsed: s.isSidebarCollapsed, sidebarWidth: s.sidebarWidth, setSidebarWidth: s.setSidebarWidth,
  })))
  const { panelRef, onPointerDown, onKeyDown } = usePanelResize({
    value: sidebarWidth, min: 240, max: 420, axis: 'x', direction: 1, commit: setSidebarWidth,
  }, isSidebarCollapsed)

  const renderActivePanel = () => {
    switch (activeTab) {
      case 'media':
        return <MediaPanel />
      case 'visualizers':
        return <VisualizersPanel />
      case 'backgrounds':
        return <BackgroundsPanel />
      case 'text':
        return <TextPanel />
      case 'effects':
        return <EffectsPanel />
      case 'templates':
        return <TemplatesPanel />
      default:
        return <VisualizersPanel />
    }
  }

  return (
    <div className="flex h-full select-none shrink-0 z-20 border-r border-d2-border relative">
      {/* Icon Tab Strip */}
      <SidebarNav />

      {/* Expandable Content Drawer */}
      <div data-sidebar-panel
        style={{ '--panel-size': `${sidebarWidth}px`, width: isSidebarCollapsed ? 0 : 'calc(var(--panel-size) + 4px)' } as React.CSSProperties}
        className="panel-size-transition h-full shrink-0 overflow-hidden"
        aria-hidden={isSidebarCollapsed} ref={node => { panelRef.current = node; if (node) node.inert = isSidebarCollapsed }}>
        <div style={{ width: 'calc(var(--panel-size) + 4px)' }}
          className={`panel-fade flex h-full ${isSidebarCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div
            style={{ width: 'var(--panel-size)' }}
            className="h-full bg-d2-surface flex flex-col overflow-hidden"
          >
            {renderActivePanel()}
          </div>
          {/* Vertical Resize Splitter */}
          <div
            onPointerDown={onPointerDown} onKeyDown={onKeyDown}
            role="separator" tabIndex={isSidebarCollapsed ? -1 : 0} aria-label="Resize sidebar"
            aria-orientation="vertical" aria-valuemin={240} aria-valuemax={420} aria-valuenow={sidebarWidth}
            className="w-1 h-full shrink-0 touch-none cursor-col-resize z-30 bg-d2-border hover:bg-d2-accent active:bg-d2-accent transition-colors"
            title="Drag to resize panel"
          />
        </div>
      </div>
    </div>
  )
}
