import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  CheckCircle2,
  Search,
  Star,
  X,
  Sparkles,
  Clock,
  Layers,
} from 'lucide-react'
import { useCompositionStore } from '@/stores/compositionStore'
import {
  VISUALIZER_PRESETS,
  VisualizerPreset,
} from '@/engine/visualizers/VisualizerPresetCatalog'
import { VisualizerThumbCanvas } from './VisualizerThumbCanvas'
import { normalizeBassConfig } from '@/engine/audio/BassReactivity'
import { ScrollableCategoryStrip } from '@/components/ui/ScrollableCategoryStrip'

const PAGE_SIZE = 24

const ORDERED_CATEGORIES = [
  'All',
  'Favorites',
  'Recent',
  'Spectrum',
  'Waveform',
  'Circular',
  'Radial',
  'Geometric',
  'Minimal',
  'Cinematic',
  'Particle Reactive',
  'Neon',
  'Experimental',
] as const

export const VisualizersPanel: React.FC = () => {
  const visualizer = useCompositionStore(state => state.visualizer)
  const updateVisualizer = useCompositionStore(state => state.updateVisualizer)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('All')
  const [favorites, setFavorites] = useState<string[]>([])
  const [recents, setRecents] = useState<string[]>([])
  const [page, setPage] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Load favorites & recents from localStorage
  useEffect(() => {
    try {
      const favStr = localStorage.getItem('d2_visualizer_favorites')
      if (favStr) { const ids = JSON.parse(favStr); if (Array.isArray(ids)) setFavorites(ids.filter(id => typeof id === 'string' && VISUALIZER_PRESETS.some(p => p.id === id))) }
      const recStr = localStorage.getItem('d2_visualizer_recents')
      if (recStr) { const ids = JSON.parse(recStr); if (Array.isArray(ids)) setRecents(ids.filter(id => typeof id === 'string' && VISUALIZER_PRESETS.some(p => p.id === id)).slice(0, 12)) }
    } catch {
      // Ignore fallback
    }
  }, [])

  const toggleFavorite = (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = favorites.includes(presetId)
      ? favorites.filter((f) => f !== presetId)
      : [...favorites, presetId]
    setFavorites(updated)
    try {
      localStorage.setItem('d2_visualizer_favorites', JSON.stringify(updated))
    } catch {
      // Ignore fallback
    }
  }

  const handleApplyPreset = (preset: VisualizerPreset) => {
    // Apply engine type and full signature configuration to composition
    updateVisualizer({
      type: preset.engineType,
      ...preset.config,
      presetId: preset.id,
      bassReactivity: normalizeBassConfig(preset.config.bassReactivity),
    })

    // Track in Recents
    const updatedRecents = [preset.id, ...recents.filter((r) => r !== preset.id)].slice(0, 12)
    setRecents(updatedRecents)
    try {
      localStorage.setItem('d2_visualizer_recents', JSON.stringify(updatedRecents))
    } catch {
      // Ignore fallback
    }
  }

  // Filter presets based on search query and category
  const filteredPresets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()

    return VISUALIZER_PRESETS.filter((preset) => {
      // Category filter
      if (selectedCategory === 'Favorites') {
        if (!favorites.includes(preset.id)) return false
      } else if (selectedCategory === 'Recent') {
        if (!recents.includes(preset.id)) return false
      } else if (selectedCategory !== 'All') {
        if (preset.category.toLowerCase() !== selectedCategory.toLowerCase()) {
          return false
        }
      }

      // Search filter
      if (!q) return true

      const matchesName = preset.name.toLowerCase().includes(q)
      const matchesCategory = preset.category.toLowerCase().includes(q)
      const matchesEngine = preset.engineType.toLowerCase().includes(q)
      const matchesDescription = preset.description.toLowerCase().includes(q)
      const matchesTags = preset.tags.some((t) => t.toLowerCase().includes(q))

      return (
        matchesName ||
        matchesCategory ||
        matchesEngine ||
        matchesDescription ||
        matchesTags
      )
    })
  }, [searchQuery, selectedCategory, favorites, recents])

  const pageCount = Math.max(1, Math.ceil(filteredPresets.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visiblePresets = filteredPresets.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  useEffect(() => { setPage(0) }, [searchQuery, selectedCategory])
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }) }, [currentPage, searchQuery, selectedCategory])

  // Compute category count map for badge indicators
  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {
      All: VISUALIZER_PRESETS.length,
      Favorites: favorites.length,
      Recent: recents.length,
    }
    VISUALIZER_PRESETS.forEach((p) => {
      map[p.category] = (map[p.category] || 0) + 1
    })
    return map
  }, [favorites, recents])

  return (
    <div className="flex flex-col h-full select-none text-xs bg-d2-surface">
      {/* Top Header: Title, Preset Count & Version Badge */}
      <div className="p-3 border-b border-d2-border space-y-2.5 bg-d2-surfaceElevated/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-d2-accent" />
            <div>
              <h2 className="font-bold text-white uppercase tracking-wider text-2xs leading-none">
                Visualizer Browser
              </h2>
              <span className="text-3xs text-d2-textSubtle font-mono">
                {VISUALIZER_PRESETS.length} original presets
              </span>
            </div>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-d2-textSubtle pointer-events-none" />
          <input
            type="text"
            placeholder="Search styles, tags, neon, 3D..."
            aria-label="Search visualizer presets"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-7 pl-8 pr-7 rounded bg-d2-canvas border border-d2-border text-2xs text-white placeholder:text-d2-textSubtle focus:outline-none focus:border-d2-accent focus:ring-1 focus:ring-d2-accent/40 transition-all"
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

        {/* Category Navigation Pills */}
        <ScrollableCategoryStrip label="Visualizer categories">
          {ORDERED_CATEGORIES.map((cat) => {
            const isCatSelected = selectedCategory === cat
            const count = categoryCounts[cat] || 0

            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                aria-pressed={isCatSelected}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-2xs font-medium whitespace-nowrap transition-colors ${
                  isCatSelected
                    ? 'bg-d2-surfaceActive text-d2-accent'
                    : 'text-d2-textMuted hover:text-white hover:bg-d2-surfaceElevated/60'
                }`}
              >
                {cat === 'Favorites' && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />}
                {cat === 'Recent' && <Clock className="w-2.5 h-2.5 text-cyan-400" />}
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

      {/* Preset Cards List */}
      <div ref={listRef} data-preset-list className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {filteredPresets.length === 0 ? (
          <div className="py-14 text-center text-d2-textSubtle text-2xs space-y-2">
            <Layers className="w-8 h-8 mx-auto text-d2-textSubtle/40" />
            <p className="font-medium text-white/80">No visualizer styles found</p>
            {selectedCategory === 'Favorites' ? (
              <p className="text-3xs text-d2-textSubtle max-w-xs mx-auto">
                Click the star icon (★) on any visualizer preset to add it to your Favorites collection.
              </p>
            ) : selectedCategory === 'Recent' ? (
              <p className="text-3xs text-d2-textSubtle max-w-xs mx-auto">
                Applied styles will automatically appear here for quick access.
              </p>
            ) : (
              <p className="text-3xs text-d2-textSubtle">
                Try searching with different keywords like &quot;spectrum&quot;, &quot;wave&quot;, or &quot;glow&quot;.
              </p>
            )}
          </div>
        ) : (
          visiblePresets.map((preset) => {
            const isSelected =
              visualizer.presetId === preset.id ||
              (!visualizer.presetId && Object.entries(preset.config).every(([key, value]) => visualizer[key as keyof typeof visualizer] === value))
            const isFav = favorites.includes(preset.id)
            const is3D = preset.renderType === '3d'
            const primaryColor = preset.config.primaryColor || '#6366f1'
            const accentColor = preset.config.accentColor || '#06b6d4'

            return (
              <div
                key={preset.id}
                data-preset-id={preset.id}
                onClick={() => handleApplyPreset(preset)}
                role="button"
                tabIndex={0}
                aria-label={`Apply ${preset.name}`}
                aria-pressed={isSelected}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    handleApplyPreset(preset)
                  }
                }}
                className={`p-2 rounded border transition-colors cursor-pointer group flex items-center gap-3 relative overflow-hidden ${
                  isSelected
                    ? 'bg-d2-surfaceActive border-d2-accent/60'
                    : 'bg-d2-surface border-transparent hover:border-d2-border hover:bg-d2-surfaceElevated'
                }`}
              >
                {/* Active Indicator Left Strip */}
                {isSelected && (
                    <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-d2-accent" />
                )}

                {/* Animated Canvas Thumbnail Preview */}
                <div className="w-16 h-11 rounded bg-black border border-white/10 relative overflow-hidden shrink-0">
                  <VisualizerThumbCanvas
                    pluginId={preset.engineType}
                    renderType={preset.renderType}
                    presetConfig={preset.config}
                    isActive={isSelected}
                  />
                  {is3D && (
                    <span className="absolute bottom-0.5 right-0.5 text-[8px] font-mono font-bold px-1 rounded bg-black/90 text-cyan-300 border border-cyan-400/30">
                      3D
                    </span>
                  )}
                </div>

                {/* Preset Info */}
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-xs font-medium truncate ${
                        isSelected ? 'text-white' : 'text-d2-text group-hover:text-white'
                      }`}
                    >
                      {preset.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => toggleFavorite(preset.id, e)}
                      className={`p-0.5 rounded hover:bg-d2-surface transition-colors shrink-0 ${
                        isFav ? 'text-d2-text' : 'text-d2-textSubtle hover:text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                      }`}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      aria-label={`${isFav ? 'Remove' : 'Add'} ${preset.name} ${isFav ? 'from' : 'to'} favorites`}
                    >
                      <Star className={`w-3 h-3 ${isFav ? 'fill-current' : ''}`} />
                    </button>
                  </div>

                  {/* Category Pill & Color Dots */}
                  <div className="flex items-center justify-between gap-1 text-3xs text-d2-textSubtle font-mono">
                    <span className="text-d2-textSubtle text-2xs font-sans">
                      {preset.category}
                    </span>

                    {/* Color Swatch Dots */}
                    <div className="flex items-center -space-x-1">
                      <div
                        className="w-2 h-2 rounded-full ring-1 ring-black"
                        style={{ backgroundColor: primaryColor }}
                      />
                      <div
                        className="w-2 h-2 rounded-full ring-1 ring-black"
                        style={{ backgroundColor: accentColor }}
                      />
                    </div>
                  </div>
                </div>

                {/* Active Checkmark */}
                {isSelected && (
                  <div className="shrink-0 pr-1 text-d2-accent">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                )}

              </div>
            )
          })
        )}
      </div>
      <nav aria-label="Visualizer preset pages" className="shrink-0 flex items-center justify-between gap-2 p-2.5 border-t border-d2-border text-2xs">
        <button type="button" aria-label="Previous preset page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}
          className="px-2 py-1 rounded border border-d2-border text-d2-textMuted hover:bg-d2-surfaceElevated disabled:opacity-40">Previous</button>
        <span className="text-d2-textSubtle" aria-live="polite">{filteredPresets.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filteredPresets.length)} / {filteredPresets.length}</span>
        <button type="button" aria-label="Next preset page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}
          className="px-2 py-1 rounded border border-d2-border text-d2-textMuted hover:bg-d2-surfaceElevated disabled:opacity-40">Next</button>
      </nav>
    </div>
  )
}
