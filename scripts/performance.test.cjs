const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadModule(relativePath, globals = {}, imports = {}) {
  const filename = path.join(__dirname, '..', relativePath)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(source, {
    exports, console, ...globals,
    require: name => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`)
      return imports[name]
    },
  }, { filename })
  return exports
}

function scheduler(clock = () => 0) {
  let sequence = 0
  const pending = new Map()
  const listeners = new Map()
  const observers = []
  const document = {
    hidden: false,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name) },
  }
  const api = loadModule('src/engine/render/FrameScheduler.ts', {
    document,
    performance: { now: clock },
    requestAnimationFrame: callback => { pending.set(++sequence, callback); return sequence },
    cancelAnimationFrame: id => pending.delete(id),
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe(canvas) { this.canvas = canvas }
      disconnect() { this.disconnected = true }
    },
  })
  return {
    ...api, pending, listeners, observers,
    frame(timestamp) {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach(callback => callback(timestamp))
    },
    visibility(hidden) { document.hidden = hidden; listeners.get('visibilitychange')?.() },
  }
}

test('all consumers share one RAF and cancellation releases the listener', () => {
  const frames = scheduler()
  const timestamps = []
  const stopMain = frames.subscribeFrames(time => timestamps.push(time), 60)
  const stopThumb = frames.subscribeFrames(time => timestamps.push(time), 12)
  assert.equal(frames.pending.size, 1)
  frames.frame(0)
  assert.deepEqual(timestamps, [0, 0])
  assert.equal(frames.pending.size, 1)
  stopMain()
  stopThumb()
  stopThumb()
  assert.equal(frames.pending.size, 0)
  assert.equal(frames.listeners.size, 0)
})

for (const refreshRate of [60, 144]) {
  for (const fps of [12, 15, 24, 30, 60]) {
    test(`${fps} FPS budget stays accurate on a ${refreshRate} Hz display`, () => {
      const frames = scheduler()
      let count = 0
      const stop = frames.subscribeFrames(() => count++, fps)
      for (let index = 0; index < refreshRate * 5; index++) frames.frame(index * 1000 / refreshRate)
      assert.ok(Math.abs(count - fps * 5) <= 1, `Expected ${fps * 5} frames, got ${count}`)
      stop()
    })
  }
}

test('hidden windows stop scheduling and resume without catch-up bursts', () => {
  const frames = scheduler()
  let count = 0
  const stop = frames.subscribeFrames(() => count++, 30)
  frames.frame(0)
  frames.visibility(true)
  assert.equal(frames.pending.size, 0)
  frames.frame(1000)
  assert.equal(count, 1)
  frames.visibility(false)
  frames.frame(2000)
  assert.equal(count, 2)
  assert.equal(frames.pending.size, 1)
  stop()
})

test('offscreen thumbnails allocate no RAF and clean up on unmount', () => {
  const frames = scheduler()
  let count = 0
  const stop = frames.observeCanvasFrames({}, () => count++, 12)
  const observer = frames.observers[0]
  assert.equal(frames.pending.size, 0)
  observer.callback([{ isIntersecting: true }])
  observer.callback([{ isIntersecting: true }])
  assert.equal(frames.pending.size, 1)
  frames.frame(0)
  assert.equal(count, 1)
  observer.callback([{ isIntersecting: false }])
  assert.equal(frames.pending.size, 0)
  observer.callback([{ isIntersecting: true }])
  stop()
  assert.equal(observer.disconnected, true)
  assert.equal(frames.pending.size, 0)
  assert.equal(frames.listeners.size, 0)
})

test('invalid FPS is rejected', () => {
  const frames = scheduler()
  for (const fps of [0, -1, NaN, Infinity]) {
    assert.throws(() => frames.subscribeFrames(() => {}, fps), /FPS must be positive/)
  }
})

test('foreground frames precede at most one fair background card per tick', () => {
  const frames = scheduler()
  const order = []
  const stops = ['a', 'b', 'c'].map(name => frames.subscribeFrames(() => order.push(name), 60, { background: true }))
  const main = frames.subscribeFrames(() => order.push('main'), 60)
  for (let index = 0; index < 3; index++) frames.frame(index * 17)
  assert.deepEqual(order, ['main', 'a', 'main', 'b', 'main', 'c'])
  stops.forEach(stop => stop()); main()
})

test('background cards defer expensive ticks but never starve', () => {
  let time = 0
  const frames = scheduler(() => time)
  let cards = 0
  const main = frames.subscribeFrames(() => { time += 12 }, 60)
  const card = frames.subscribeFrames(() => cards++, 60, { background: true })
  for (let index = 0; index < 60; index++) frames.frame(index * 1000 / 60)
  assert.equal(cards, 4)
  main(); card()
})

test('interactive cursor callbacks run before composition and thumbnail work', () => {
  const frames = scheduler(), order = []
  const main = frames.subscribeFrames(() => order.push('preview'), 60)
  const card = frames.subscribeFrames(() => order.push('card'), 12, { background: true })
  const cursor = frames.subscribeFrames(() => order.push('cursor'), 60, { interactive: true })
  frames.frame(0)
  assert.deepEqual(order, ['cursor', 'preview', 'card'])
  main(); card(); cursor()
})

function scrubHarness({ preserveOffset = false, scrollLeft = 0, ready = () => true } = {}) {
  const frames = scheduler(), listeners = new Map()
  const scrub = loadModule('src/engine/timeline/TimelineScrubState.ts')
  let rectReads = 0, time = 3, zoom = 10, duration = 30, starts = 0
  const previews = [], commits = []
  const viewport = { dataset: {}, scrollLeft, scrollWidth: 1400, clientWidth: 200,
    getBoundingClientRect() { rectReads++; return { left: 100, right: 300 } },
  }
  const body = { style: { cursor: 'default', userSelect: 'text' } }
  const api = loadModule('src/engine/timeline/TimelineScrubber.ts', {
    document: { body }, window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name) },
    },
  }, { '../render/FrameScheduler': frames, './TimelineScrubState': scrub })
  const event = (clientX, pointerId = 1) => ({ clientX, pointerId, button: 0, isPrimary: true, preventDefault() {} })
  return { ...api, frames, scrub, listeners, viewport, body, previews, commits, event,
    get rectReads() { return rectReads }, get starts() { return starts },
    begin(clientX = 120) { return api.beginTimelineScrub(event(clientX), viewport, {
      getTime: () => time, getZoom: () => zoom, getDuration: () => duration, preserveOffset,
      start: () => starts++, preview: target => { if (!ready()) return false; previews.push(target); return true },
      finish: target => { time = target; commits.push(target) },
    }) },
    emit(name, data) { listeners.get(name)?.(data) },
  }
}

test('pointer-to-time conversion accounts for scroll, zoom, grab offset and bounds', () => {
  const { pointerTimelineTime } = scrubHarness()
  assert.equal(pointerTimelineTime(150, 100, 200, 10, 30), 25)
  assert.equal(pointerTimelineTime(150, 100, 200, 80, 30), 3.125)
  assert.equal(pointerTimelineTime(150, 100, 200, 4, 30), 30)
  assert.equal(pointerTimelineTime(-500, 100, 0, 10, 30), 0)
  assert.equal(pointerTimelineTime(150, 100, 200, 10, 30, 10), 24)
  for (const invalid of [NaN, Infinity, -Infinity]) assert.equal(pointerTimelineTime(invalid, 100, 0, 10, 30), 0)
  assert.equal(pointerTimelineTime(150, 100, 0, 0, 30), 0)
})

for (const refreshRate of [60, 144]) {
  test(`timeline scrub coalesces pointer bursts at ${refreshRate} Hz and caps decoder seeks`, () => {
    const h = scrubHarness()
    const cancel = h.begin()
    for (let index = 0; index < 2000; index++) h.emit('pointermove', h.event(140))
    assert.equal(h.previews.length, 0)
    assert.equal(h.rectReads, 1)
    assert.equal(h.scrub.getTimelineScrubTime(), 2)
    assert.equal(h.frames.pending.size, 1)
    for (let index = 0; index < refreshRate; index++) {
      h.emit('pointermove', h.event(140 + index / refreshRate * 10))
      h.frames.frame(index * 1000 / refreshRate)
    }
    assert.ok(h.previews.length <= 10 && h.previews.length >= 8)
    assert.equal(h.rectReads, 1, 'Drag samples must not read layout')
    assert.equal(h.commits.length, 0)
    h.emit('pointerup', h.event(153.125))
    assert.deepEqual(h.commits, [5.3125])
    assert.equal(h.scrub.getTimelineScrubTime(), null)
    assert.equal(h.frames.pending.size, 0)
    assert.equal(h.listeners.size, 0)
    assert.equal(h.viewport.dataset.scrubbing, 'false')
    assert.equal(h.body.style.cursor, 'default')
    cancel(); assert.equal(h.commits.length, 1)
  })
}

test('scrub decoder backpressure keeps only the latest target and still commits exact release', () => {
  let ready = false
  const h = scrubHarness({ ready: () => ready })
  h.begin()
  for (let index = 0; index < 60; index++) {
    h.emit('pointermove', h.event(150 + index))
    h.frames.frame(index * 17)
  }
  assert.equal(h.previews.length, 0)
  assert.ok(h.scrub.getTimelineScrubTime() > 10)
  ready = true
  h.emit('pointermove', h.event(250))
  h.frames.frame(1200)
  assert.deepEqual(h.previews, [15])
  ready = false
  h.emit('pointerup', h.event(259.25))
  assert.deepEqual(h.commits, [15.925])
})

test('playhead grab preserves pointer offset and follows horizontal scrolling', () => {
  const h = scrubHarness({ preserveOffset: true, scrollLeft: 20 })
  h.begin(111)
  assert.equal(h.scrub.getTimelineScrubTime(), 3)
  h.emit('pointermove', h.event(151))
  h.frames.frame(0)
  assert.equal(h.scrub.getTimelineScrubTime(), 7)
  h.viewport.scrollLeft = 40
  h.frames.frame(17)
  assert.equal(h.scrub.getTimelineScrubTime(), 9)
  h.emit('pointerup', h.event(151))
  assert.deepEqual(h.commits, [9])
})

test('scrub cancellation restores original time and cleans up pointer, blur and unmount paths', () => {
  for (const reason of ['keydown', 'blur', 'pointercancel', 'unmount']) {
    const h = scrubHarness()
    const cancel = h.begin()
    h.emit('pointermove', h.event(200, 2))
    h.emit('pointerup', h.event(200, 2))
    h.emit('pointercancel', h.event(200, 2))
    h.frames.frame(0)
    assert.equal(h.scrub.getTimelineScrubTime(), 2)
    h.emit('pointermove', h.event(220))
    h.frames.frame(17)
    if (reason === 'unmount') cancel()
    else h.emit(reason, { key: 'Escape', pointerId: 1, preventDefault() {} })
    assert.deepEqual(h.commits, [3])
    assert.equal(h.scrub.getTimelineScrubTime(), null)
    assert.equal(h.listeners.size, 0)
    assert.equal(h.frames.pending.size, 0)
  }
})

test('offscreen scrubbing auto-scroll is bounded and stops on release', () => {
  const h = scrubHarness()
  h.begin()
  h.emit('pointermove', h.event(5000))
  h.frames.frame(0)
  h.frames.frame(1000)
  assert.equal(h.viewport.scrollLeft, 30, 'Large frame gaps must not cause scroll jumps')
  for (let index = 1; index < 100; index++) h.frames.frame(1000 + index * 17)
  assert.ok(h.viewport.scrollLeft <= 1200)
  h.emit('pointerup', h.event(5000))
  assert.equal(h.frames.pending.size, 0)
  assert.deepEqual(h.commits, [30])
})

test('audio clock ignores decoder notifications during scrubbing and deduplicates final updates', () => {
  const scrub = loadModule('src/engine/timeline/TimelineScrubState.ts')
  let state, listener, updates = 0, previewUpdates = 0
  const engine = { addListener: value => { listener = value } }
  loadModule('src/stores/audioStore.ts', {}, {
    zustand: { create: setup => {
      const set = value => { const next = typeof value === 'function' ? value(state) : value; if (next !== state) { state = { ...state, ...next }; updates++ } }
      state = setup(set, () => state)
      return state
    } },
    '@/engine/audio/AudioEngine': { AudioEngine: { getInstance: () => engine } },
    './timelineStore': {}, './previewStore': { usePreviewStore: { setState: () => previewUpdates++ } },
    '@/engine/timeline/TimelineScrubState': scrub,
  })
  scrub.setTimelineScrubTime(10)
  for (let index = 0; index < 2000; index++) listener.onTimeUpdate(index / 100, 30)
  assert.equal(updates, 0)
  assert.equal(previewUpdates, 0)
  scrub.setTimelineScrubTime(null)
  listener.onTimeUpdate(15.125, 30)
  listener.onTimeUpdate(15.125, 30)
  assert.equal(updates, 1)
  assert.equal(state.currentTime, 15.125)
})

function resizeHarness() {
  const listeners = new Map(), pending = new Map(), properties = new Map()
  let sequence = 0, paints = 0
  const state = loadModule('src/engine/render/PanelResizeState.ts')
  const body = { style: { cursor: 'default', userSelect: 'text' } }
  const api = loadModule('src/components/ui/panelResize.ts', {
    document: { body },
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name) },
    },
    requestAnimationFrame: callback => { pending.set(++sequence, callback); return sequence },
    cancelAnimationFrame: id => pending.delete(id),
  }, { '@/engine/render/PanelResizeState': state })
  const event = (x, y, pointerId = 1) => ({ button: 0, isPrimary: true, clientX: x, clientY: y, pointerId, preventDefault() {} })
  const panel = { dataset: {}, style: { setProperty: (key, value) => { properties.set(key, value); paints++ } } }
  return { ...api, state, body, panel, listeners, pending, properties, event, get paints() { return paints },
    emit(name, data) { listeners.get(name)?.(data) },
    frame() { const batch = [...pending.values()]; pending.clear(); batch.forEach(callback => callback()) },
  }
}

for (const [axis, direction, min, max] of [['x', 1, 240, 420], ['x', -1, 260, 400], ['y', -1, 160, 480]]) {
  test(`splitter ${axis}/${direction} coalesces 2000 pointer samples and commits once`, () => {
    const h = resizeHarness(), commits = []
    const value = min + 20
    const cancel = h.beginPanelResize(h.event(100, 100), h.panel, { axis, direction, value, min, max, commit: size => commits.push(size) })
    for (let index = 0; index < 2000; index++) h.emit('pointermove', h.event(125, 125))
    assert.equal(commits.length, 0)
    assert.equal(h.pending.size, 1)
    assert.equal(h.paints, 0)
    h.frame()
    assert.equal(h.paints, 1)
    assert.equal(h.state.isPanelResizing(), true)
    assert.equal(h.panel.dataset.resizing, 'true')
    h.emit('pointerup', h.event(150, 150))
    assert.deepEqual(commits, [h.clampPanelSize(value + 50 * direction, min, max)])
    assert.equal(h.state.isPanelResizing(), false)
    assert.equal(h.listeners.size, 0)
    assert.equal(h.pending.size, 0)
    assert.equal(h.body.style.cursor, 'default')
    assert.equal(h.body.style.userSelect, 'text')
    cancel()
    assert.equal(commits.length, 1)
  })
}

test('splitters cancel on Escape, blur, pointer cancellation and unmount, ignoring other pointers', () => {
  for (const reason of ['keydown', 'blur', 'pointercancel', 'unmount']) {
    const h = resizeHarness(), commits = []
    const cancel = h.beginPanelResize(h.event(100, 100), h.panel, { axis: 'x', direction: 1, value: 280, min: 240, max: 420, commit: size => commits.push(size) })
    h.emit('pointermove', h.event(160, 100, 2))
    h.emit('pointerup', h.event(160, 100, 2))
    h.emit('pointercancel', h.event(160, 100, 2))
    assert.equal(h.state.isPanelResizing(), true)
    assert.equal(h.pending.size, 0)
    h.emit('pointermove', h.event(2000, 100))
    h.frame()
    assert.equal(h.properties.get('--panel-size'), '420px')
    if (reason === 'unmount') cancel()
    else h.emit(reason, { key: 'Escape', pointerId: 1, preventDefault() {} })
    assert.deepEqual(commits, [])
    assert.equal(h.properties.get('--panel-size'), '280px')
    assert.equal(h.state.isPanelResizing(), false)
    assert.equal(h.listeners.size, 0)
    assert.equal(h.pending.size, 0)
  }
})

test('viewport updates layout while dragging and allocates buffers only after settling', () => {
  const state = loadModule('src/engine/render/PanelResizeState.ts')
  const timers = new Map(), observers = []
  let sequence = 0
  const { observeSettledViewport } = loadModule('src/engine/render/SettledViewport.ts', {
    setTimeout: callback => { timers.set(++sequence, callback); return sequence }, clearTimeout: id => timers.delete(id),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe() {} disconnect() { this.disconnected = true }
    },
  }, { './PanelResizeState': state })
  const layouts = [], buffers = []
  const stop = observeSettledViewport({}, size => layouts.push(size), size => buffers.push(size))
  const resize = (width, height) => observers[0].callback([{ contentRect: { width, height } }])
  state.setPanelResizing(true)
  for (let index = 0; index < 100; index++) resize(500 + index, 300)
  assert.equal(layouts.length, 100)
  assert.equal(timers.size, 0)
  assert.equal(buffers.length, 0)
  state.setPanelResizing(false)
  resize(610, 310)
  assert.equal(timers.size, 1)
  for (const callback of timers.values()) callback()
  timers.clear()
  assert.equal(buffers.length, 1)
  assert.equal(buffers[0].width, 610)
  resize(0, 0)
  assert.equal(layouts.length, 101)
  resize(700, 310)
  stop()
  assert.equal(timers.size, 0)
  assert.equal(observers[0].disconnected, true)
})

function thumbnailHarness() {
  const frames = scheduler()
  const resize = loadModule('src/engine/render/PanelResizeState.ts')
  const observers = [], subscriptions = new Set()
  const motion = { matches: false, addEventListener() {}, removeEventListener() {} }
  let exporting = false
  function target() {
    const handlers = new Map()
    return { handlers, contains: () => false,
      addEventListener: (name, listener) => handlers.set(name, listener),
      removeEventListener: (name, listener) => { if (handlers.get(name) === listener) handlers.delete(name) },
    }
  }
  const canvas = () => {
    const card = target()
    return { width: 64, height: 44, card, closest: () => card, getContext: () => ({ drawImage() {} }) }
  }
  const scrub = loadModule('src/engine/timeline/TimelineScrubState.ts')
  const api = loadModule('src/engine/render/ThumbnailPreview.ts', {
    document: { createElement: canvas, activeElement: null },
    window: { matchMedia: () => motion },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe() {} disconnect() { this.disconnected = true }
    },
  }, { './FrameScheduler': frames, './PanelResizeState': resize, '../timeline/TimelineScrubState': scrub,
    '@/stores/exportStore': { useExportStore: { getState: () => ({ isExporting: exporting }),
      subscribe: callback => { subscriptions.add(callback); return () => subscriptions.delete(callback) },
    } },
  })
  return { ...api, frames, resize, scrub, canvas, observers, subscriptions,
    exporting(value) { const previous = exporting; exporting = value; for (const callback of subscriptions) callback({ isExporting: value }, { isExporting: previous }) },
  }
}

test('thumbnail snapshots paint once, reuse cache, and animate only on hover/focus', () => {
  const h = thumbnailHarness(), renders = []
  const canvas = h.canvas()
  const stop = h.observeThumbnailPreview(canvas, (time, animated) => renders.push([time, animated]), 'original')
  assert.equal(h.frames.pending.size, 0)
  h.observers[0].callback([{ isIntersecting: true }])
  h.frames.frame(0)
  assert.deepEqual(renders, [[1500, false]])
  assert.equal(h.frames.pending.size, 0)
  canvas.card.handlers.get('pointerenter')()
  h.frames.frame(100); h.frames.frame(200)
  assert.deepEqual(renders.slice(1), [[100, true], [200, true]])
  h.resize.setPanelResizing(true)
  assert.equal(h.frames.pending.size, 0)
  h.resize.setPanelResizing(false)
  h.exporting(true)
  assert.equal(h.frames.pending.size, 0)
  h.exporting(false)
  canvas.card.handlers.get('pointerleave')()
  assert.equal(h.frames.pending.size, 0)
  stop()
  assert.equal(canvas.card.handlers.size, 0)
  assert.equal(h.subscriptions.size, 0)
  const second = h.observeThumbnailPreview(h.canvas(), () => { throw new Error('Cached card rendered again') }, 'original')
  h.observers[1].callback([{ isIntersecting: true }])
  assert.equal(h.frames.pending.size, 0)
  second()
})

test('thumbnail snapshot cache has bounded LRU eviction', () => {
  const h = thumbnailHarness()
  for (let index = 0; index < 129; index++) {
    const stop = h.observeThumbnailPreview(h.canvas(), () => {}, String(index))
    h.observers[index].callback([{ isIntersecting: true }])
    h.frames.frame(index * 17)
    stop()
  }
  let missing = 0
  const first = h.observeThumbnailPreview(h.canvas(), () => missing++, '0')
  h.observers[129].callback([{ isIntersecting: true }])
  h.frames.frame(2200)
  assert.equal(missing, 1)
  first()
  const last = h.observeThumbnailPreview(h.canvas(), () => { throw new Error('Most recent snapshot was evicted') }, '128')
  h.observers[130].callback([{ isIntersecting: true }])
  assert.equal(h.frames.pending.size, 0)
  last()
})

test('FFT data and smoothing are computed once per shared timestamp', () => {
  const { AudioEngine } = loadModule('src/engine/audio/AudioEngine.ts', {}, {
    './AudioDecoder': {}, './FrequencyExtractor': {}, './WaveformGenerator': {},
  })
  const engine = Object.create(AudioEngine.prototype)
  let reads = 0
  engine.extractor = { getFrameData: () => ({ sample: ++reads }) }
  const first = engine.getLiveFrameData(100)
  assert.equal(engine.getLiveFrameData(100), first)
  assert.equal(reads, 1)
  assert.notEqual(engine.getLiveFrameData(116), first)
  engine.getLiveFrameData()
  engine.getLiveFrameData()
  assert.equal(reads, 4)
})

test('preview sizing is viewport-aware and preserves all composition aspect ratios', () => {
  const { getPreviewSize } = loadModule('src/engine/render/PreviewSizing.ts')
  for (const [nativeWidth, nativeHeight] of [[1920, 1080], [1080, 1920], [1080, 1080], [1080, 1350], [2560, 1080]]) {
    const options = { nativeWidth, nativeHeight, viewportWidth: 640, viewportHeight: 360,
      zoom: 0, fullscreen: false, fill: false, quality: 'balanced', dpr: 1 }
    const size = getPreviewSize(options)
    assert.ok(size.displayWidth <= 640 && size.displayHeight <= 360)
    assert.ok(Math.abs(size.displayWidth / size.displayHeight - nativeWidth / nativeHeight) < 0.0001)
    assert.ok(Math.abs(size.bufferWidth - size.displayWidth) <= 1)
    assert.ok(Math.abs(size.bufferHeight - size.displayHeight) <= 1)
    const full = getPreviewSize({ ...options, quality: 'quality' })
    assert.equal(full.bufferWidth, nativeWidth)
    assert.equal(full.bufferHeight, nativeHeight)
    assert.equal(full.displayWidth, size.displayWidth)
    const tiny = getPreviewSize({ ...options, viewportWidth: 0, viewportHeight: 0 })
    assert.ok(tiny.bufferWidth > 0 && tiny.bufferHeight > 0)
  }
})

test('zoom, fullscreen and DPR adjust preview size without changing native export dimensions', () => {
  const { getPreviewSize } = loadModule('src/engine/render/PreviewSizing.ts')
  const options = { nativeWidth: 1920, nativeHeight: 1080, viewportWidth: 800, viewportHeight: 600,
    zoom: 1, fullscreen: false, fill: false, quality: 'performance', dpr: 2 }
  assert.equal(getPreviewSize(options).displayWidth, 1920)
  assert.equal(getPreviewSize(options).bufferWidth, 1152)
  const fullscreen = getPreviewSize({ ...options, fullscreen: true })
  assert.equal(fullscreen.displayWidth, 800)
  assert.equal(fullscreen.displayHeight, 450)
  assert.equal(getPreviewSize({ ...options, quality: 'quality' }).bufferWidth, 1920)
})

test('3D contexts allocate lazily, match preview scale, and retain full-resolution export', () => {
  let allocations = 0
  class Scene { constructor() { this.children = [] } traverse() {} remove() {} }
  class Camera { constructor() { this.position = {} } updateProjectionMatrix() {} }
  class Renderer {
    constructor() { allocations++; this.domElement = {} }
    setClearColor() {} setPixelRatio() {} render() {} dispose() {} forceContextLoss() {}
    setSize(width, height) { this.domElement.width = width; this.domElement.height = height }
  }
  const { Base3DVisualizer } = loadModule('src/engine/visualizers/base/Base3DVisualizer.ts', {}, {
    three: { Scene, PerspectiveCamera: Camera, WebGLRenderer: Renderer },
  })
  class Visualizer extends Base3DVisualizer { setupScene() {} update3D() {} }
  const visualizer = new Visualizer()
  assert.equal(allocations, 0)
  visualizer.render({ canvas: {}, width: 1920, height: 1080, renderScale: 0.3 })
  assert.equal(allocations, 1)
  assert.equal(visualizer.renderer.domElement.width, 576)
  assert.equal(visualizer.renderer.domElement.height, 324)
  visualizer.render({ canvas: {}, width: 1920, height: 1080 })
  assert.equal(visualizer.renderer.domElement.width, 1920)
  assert.equal(visualizer.renderer.domElement.height, 1080)
  visualizer.dispose()
  assert.equal(visualizer.renderer, null)
  visualizer.render({ canvas: {}, width: 640, height: 360 })
  assert.equal(allocations, 2)
})

test('hardware recommendation uses CPU, RAM and graphics capacity conservatively', () => {
  const { recommendPreviewMode } = loadModule('src/engine/performance/HardwareRecommendation.ts')
  const specs = { cpuName: 'Test CPU', logicalCores: 16, memoryGB: 32, gpuName: 'NVIDIA GPU', dedicatedGpu: true, gpuAccelerated: true }
  assert.equal(recommendPreviewMode(specs).mode, 'quality')
  assert.equal(recommendPreviewMode({ ...specs, dedicatedGpu: false }).mode, 'balanced')
  assert.equal(recommendPreviewMode({ ...specs, gpuAccelerated: false }).mode, 'performance')
  assert.equal(recommendPreviewMode({ ...specs, memoryGB: 4 }).mode, 'performance')
  assert.equal(recommendPreviewMode({ ...specs, logicalCores: 2 }).mode, 'performance')
  assert.equal(recommendPreviewMode({ ...specs, memoryGB: NaN }).mode, 'performance')
})

test('saved hardware profiles reject corrupted or unsupported data', () => {
  const { isHardwareProfile } = loadModule('src/engine/performance/HardwareRecommendation.ts')
  const profile = { version: 1, checkedAt: new Date().toISOString(), cpuName: 'Test', logicalCores: 8,
    memoryGB: 16, gpuName: 'Intel GPU', dedicatedGpu: false, gpuAccelerated: true,
    nvencSupported: false, recommendedMode: 'balanced', reason: 'Test' }
  assert.ok(isHardwareProfile(profile))
  for (const invalid of [null, {}, { ...profile, version: 2 }, { ...profile, memoryGB: Infinity },
    { ...profile, checkedAt: 'invalid' }, { ...profile, recommendedMode: 'unknown' }]) assert.equal(isHardwareProfile(invalid), false)
})

test('hardware checks run once, deduplicate requests, and reuse disk cache after restart', async () => {
  const { EventEmitter } = require('node:events')
  const files = new Map()
  let gpuQueries = 0
  let encoderProbes = 0
  const absent = () => Object.assign(new Error('Not found'), { code: 'ENOENT' })
  const imports = {
    electron: { app: { getPath: () => '/profile', getGPUFeatureStatus: () => ({ webgl: 'enabled' }),
      getGPUInfo: async () => { gpuQueries++; return { gpuDevice: [{ active: true, vendorId: 0x10de, deviceString: 'NVIDIA Test GPU' }] } } } },
    'node:os': { default: { cpus: () => Array.from({ length: 16 }, () => ({ model: 'Test CPU' })), totalmem: () => 32 * 1024 ** 3 } },
    'node:path': { default: path.posix },
    'node:fs/promises': { default: {
      stat: async filename => { if (!files.has(filename)) throw absent(); return { size: files.get(filename).length } },
      readFile: async filename => { if (!files.has(filename)) throw absent(); return files.get(filename) },
      mkdir: async () => {}, writeFile: async (filename, data) => files.set(filename, data),
      rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from) },
      unlink: async filename => { if (!files.delete(filename)) throw absent() },
    } },
    'node:child_process': { spawn: () => {
      encoderProbes++
      const process = new EventEmitter()
      process.kill = () => process.emit('close', 1)
      queueMicrotask(() => process.emit('close', 0))
      return process
    } },
    '../export/FFmpegPath': { FFmpegPath: { getFFmpegPath: () => 'ffmpeg' } },
    '../../src/engine/performance/HardwareRecommendation': loadModule('src/engine/performance/HardwareRecommendation.ts'),
  }
  const service = () => loadModule('electron/hardware/HardwareProfileService.ts', { process: { pid: 1 }, setTimeout, clearTimeout }, imports).HardwareProfileService
  const firstLaunch = service()
  assert.equal(await firstLaunch.getSaved(), null)
  assert.equal(gpuQueries, 0)
  assert.equal(encoderProbes, 0)
  const profiles = await Promise.all([firstLaunch.checkOnce(), firstLaunch.checkOnce(), firstLaunch.checkOnce()])
  assert.equal(gpuQueries, 1)
  assert.equal(encoderProbes, 1)
  assert.equal(profiles[0].checkedAt, profiles[2].checkedAt)
  assert.equal(profiles[0].recommendedMode, 'quality')
  assert.ok(files.has('/profile/hardware-profile.json'))
  const restarted = service()
  assert.equal((await restarted.getSaved()).checkedAt, profiles[0].checkedAt)
  assert.equal((await restarted.checkOnce()).checkedAt, profiles[0].checkedAt)
  assert.equal(gpuQueries, 1)
  assert.equal(encoderProbes, 1)
})

test('preview mode persists only on explicit selection, not playback updates', () => {
  const writes = []
  let initial
  const load = saved => loadModule('src/stores/previewStore.ts', {
    localStorage: { getItem: () => saved, setItem: (key, value) => writes.push([key, value]) },
  }, { zustand: { create: setup => { initial = setup(() => {}); return initial } } })
  load('quality')
  assert.equal(initial.previewQuality, 'quality')
  initial.setCurrentTime(10)
  initial.setIsPlaying(true)
  assert.equal(writes.length, 0)
  initial.setPreviewQuality('performance')
  assert.deepEqual(writes, [['d2-preview-quality', 'performance']])
  load('invalid')
  assert.equal(initial.previewQuality, 'balanced')
})

function bassFixture(hz = 110, amplitude = 180, sampleRate = 48000) {
  const raw = new Uint8Array(1024)
  raw[Math.round(hz / (sampleRate / 2048))] = amplitude
  return { sampleRate, rawFrequencies: raw, normalizedFrequencies: new Float32Array(1024),
    timeDomainData: new Uint8Array(1024), normalizedTimeDomain: new Float32Array(1024),
    bands: { subBass: 0.2, bass: 0.3, lowMid: 0.5, mid: 0.6, highMid: 0.7, treble: 0.8 },
    bassEnergy: 0.3, midEnergy: 0.6, trebleEnergy: 0.8, overallEnergy: 0.4, rms: 0.2 }
}

test('bass follower gates silence, isolates the selected Hz band, and preserves FFT data', () => {
  const { BassEnvelopeFollower, normalizeBassConfig } = loadModule('src/engine/audio/BassReactivity.ts')
  const config = normalizeBassConfig({ enabled: true, lowHz: 70, highHz: 160, gain: 2, threshold: 0.1, mix: 1, sidechain: 0.8 })
  const follower = new BassEnvelopeFollower()
  const frame = bassFixture()
  const bytes = [...frame.rawFrequencies]
  const processed = follower.apply(frame, config, 0)
  assert.ok(processed.bassEnergy > 0.1)
  assert.ok(processed.midEnergy < frame.midEnergy)
  assert.equal(processed.rawFrequencies, frame.rawFrequencies)
  assert.deepEqual([...frame.rawFrequencies], bytes)
  assert.equal(frame.bassEnergy, 0.3)
  const highTone = new BassEnvelopeFollower().process(bassFixture(2000), config, 0)
  assert.equal(highTone.envelope, 0)
  const silent = new BassEnvelopeFollower().process(bassFixture(110, 0), config, 0)
  assert.equal(silent.envelope, 0)
  assert.equal(silent.kick, 0)
  assert.equal(new BassEnvelopeFollower().apply(frame, undefined, 0), frame)
})

test('bass attack/release are time-based, peak hold releases, duplicate samples and seeks reset correctly', () => {
  const { BassEnvelopeFollower, normalizeBassConfig } = loadModule('src/engine/audio/BassReactivity.ts')
  const config = normalizeBassConfig({ enabled: true, lowHz: 70, highHz: 160, gain: 2, threshold: 0, attackMs: 100, releaseMs: 200, kickEmphasis: 0, holdMs: 0 })
  const loud = bassFixture()
  const silent = bassFixture(110, 0)
  const measure = fps => {
    const follower = new BassEnvelopeFollower()
    for (let index = 0; index <= fps; index++) follower.process(loud, config, index / fps)
    const attack = follower.getResponse().envelope
    for (let index = 1; index <= fps; index++) follower.process(silent, config, 1 + index / fps)
    return [attack, follower.getResponse().envelope]
  }
  const thirty = measure(30), sixty = measure(60)
  for (let index = 0; index < 2; index++) assert.ok(Math.abs(thirty[index] - sixty[index]) < 1e-6)
  assert.ok(thirty[0] > thirty[1] * 100)
  const heldConfig = { ...config, attackMs: 1, holdMs: 100 }
  const held = new BassEnvelopeFollower()
  const first = held.process(loud, heldConfig, 0)
  assert.equal(held.process(silent, heldConfig, 0), first)
  assert.ok(held.process(silent, heldConfig, 0.05).envelope >= first.envelope * 0.99)
  assert.ok(held.process(silent, heldConfig, 0.5).envelope < first.envelope * 0.2)
  assert.equal(held.process(silent, heldConfig, 0).envelope, 0)
  assert.equal(held.process(silent, heldConfig, 5).envelope, 0)
})

test('bass settings are bounded and survive serialization with legacy bypass defaults', () => {
  const { normalizeBassConfig } = loadModule('src/engine/audio/BassReactivity.ts')
  const config = normalizeBassConfig({ enabled: true, lowHz: 600, highHz: 20, gain: Infinity, attackMs: -1, releaseMs: 5000, mix: 3 })
  assert.equal(config.lowHz, 490)
  assert.equal(config.highHz, 500)
  assert.equal(config.gain, 1.5)
  assert.equal(config.attackMs, 1)
  assert.equal(config.releaseMs, 1000)
  assert.equal(config.mix, 1)
  assert.equal(normalizeBassConfig(undefined).enabled, false)
  assert.equal(JSON.stringify(normalizeBassConfig(JSON.parse(JSON.stringify(config)))), JSON.stringify(config))
})

test('catalog contains only the 37 original registered presets', () => {
  const catalog = loadModule('src/engine/visualizers/VisualizerPresetCatalog.ts')
  assert.equal(catalog.VISUALIZER_PRESETS.length, 37)
  assert.equal(catalog.VISUALIZER_PRESETS, catalog.LEGACY_VISUALIZER_PRESETS)
  assert.equal(new Set(catalog.VISUALIZER_PRESETS.map(preset => preset.id)).size, catalog.VISUALIZER_PRESETS.length)
  const plugins = fs.readdirSync(path.join(__dirname, '../src/engine/visualizers/styles')).map(filename =>
    fs.readFileSync(path.join(__dirname, '../src/engine/visualizers/styles', filename), 'utf8')).join('\n')
  for (const preset of catalog.VISUALIZER_PRESETS) {
    assert.ok(plugins.includes(`readonly id = '${preset.engineType}'`), `Unknown renderer ${preset.engineType}`)
    assert.ok(!preset.tags.includes('Bass Pack'))
  }
})

test('category wheel scrolling handles mice, trackpads, units, boundaries, and zoom gestures', () => {
  const { horizontalWheelDelta, canScrollHorizontally } = loadModule('src/components/ui/horizontalWheel.ts')
  const event = { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false }
  assert.equal(horizontalWheelDelta(event, 240), 100)
  assert.equal(horizontalWheelDelta({ ...event, deltaX: -120, deltaY: 5 }, 240), -120)
  assert.equal(horizontalWheelDelta({ ...event, deltaY: 3, deltaMode: 1 }, 240), 72)
  assert.equal(horizontalWheelDelta({ ...event, deltaY: 1, deltaMode: 2 }, 240), 240)
  assert.equal(horizontalWheelDelta({ ...event, ctrlKey: true }, 240), 0)
  assert.equal(horizontalWheelDelta({ ...event, deltaY: NaN }, 240), 0)
  assert.equal(canScrollHorizontally(0, 500, -100), false)
  assert.equal(canScrollHorizontally(500, 500, 100), false)
  assert.equal(canScrollHorizontally(250, 500, 100), true)
  assert.equal(canScrollHorizontally(250, 500, -100), true)
  assert.equal(canScrollHorizontally(0, 0, 100), false)
})
