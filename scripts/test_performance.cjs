const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { spawn } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], {
    cwd: path.join(__dirname, '..'), env, stdio: 'inherit',
  })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} else {
  const { app } = require('electron')
  const tempRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'opencode')
  fs.mkdirSync(tempRoot, { recursive: true })
  const cachedProfileIndex = process.argv.indexOf('--cached-profile')
  const artifactRoot = cachedProfileIndex >= 0 ? process.argv[cachedProfileIndex + 1] : fs.mkdtempSync(path.join(tempRoot, 'd2-performance-'))
  app.setPath('userData', path.join(artifactRoot, 'userData'))
  const baseline = process.argv.includes('--baseline')
  const timeout = setTimeout(() => { console.error('Performance test timed out'); app.exit(1) }, 90000)

  // Use real media decoding/playback, not only the synthesizer demo.
  const sampleRate = 44100
  const samples = sampleRate * 30
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRate
    const amplitude = 0.15 + 0.5 * Math.exp(-((time * 2) % 1) * 8)
    wav.writeInt16LE(Math.round(Math.sin(time * Math.PI * 2 * 110) * amplitude * 32767), 44 + index * 2)
  }
  const fixturePath = path.join(artifactRoot, 'performance-fixture.wav')
  fs.writeFileSync(fixturePath, wav)
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  let hardwareQueries = 0
  const getGPUInfo = app.getGPUInfo.bind(app)
  app.getGPUInfo = (...args) => { hardwareQueries++; return getGPUInfo(...args) }

  app.on('browser-window-created', (_event, window) => {
    // Keep benchmark timing independent of other foreground desktop windows.
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
      const js = code => window.webContents.executeJavaScript(code)
      const key = async keyCode => {
        // Exercise renderer keyboard handlers without foreground-dependent OS input.
        const key = keyCode === 'Return' ? 'Enter' : keyCode
        await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`)
        await wait(100)
      }
      const screenshot = async name => {
        const filename = path.join(artifactRoot, `${name}.png`)
        fs.writeFileSync(filename, (await window.webContents.capturePage()).toPNG())
        console.log(`Screenshot: ${filename}`)
      }
      try {
        if (cachedProfileIndex >= 0) {
          await wait(700)
          const profile = await js(`window.electronAPI.hardwareGetSaved()`)
          assert.ok(profile && profile.checkedAt, 'Hardware profile did not survive app restart')
          assert.equal(hardwareQueries, 0, 'Hardware was scanned during app startup')
          const mode = await js(`window.__D2_PREVIEW_STORE__.getState().previewQuality`)
          assert.equal(mode, profile.recommendedMode, 'Applied recommendation did not survive restart')
          await js(`document.querySelector('[aria-label="Settings"]').click()`)
          await wait(150)
          await js(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent.trim() === 'Performance Mode').click()`)
          await wait(100)
          assert.equal(await js(`document.querySelector('[aria-label="Check computer hardware"]').disabled`), true, 'Restart enables a repeat hardware scan')
          await screenshot('hardware-cached-after-restart')
          console.log('Hardware profile and preview recommendation survived a full app restart without scanning')
          clearTimeout(timeout)
          app.exit(0)
          return
        }
        const results = await js(`(${async function run(fixturePath, baseline) {
          const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
          window.__D2_PROJECT_STORE__.getState().setAutoSaveSettings(false, 30)
          await wait(500)
          const preview = document.querySelector('canvas.object-contain')
          if (!preview) throw new Error('Preview canvas missing')
          const counters = { mainFrames: 0, thumbnailFrames: 0, analyserReads: 0, timelineMutations: 0, waveformPaints: 0 }
          const originalClear = CanvasRenderingContext2D.prototype.clearRect
          CanvasRenderingContext2D.prototype.clearRect = function(...args) {
            if (this.canvas === preview) counters.mainFrames++
            else if (this.canvas.closest('#d2-timeline-scroll-container')) counters.waveformPaints++
            else if (this.canvas.isConnected && this.canvas.closest('.space-y-1\\.5, .space-y-1')) counters.thumbnailFrames++
            return originalClear.apply(this, args)
          }
          const originalRead = AnalyserNode.prototype.getByteFrequencyData
          AnalyserNode.prototype.getByteFrequencyData = function(...args) {
            counters.analyserReads++
            return originalRead.apply(this, args)
          }
          const timeline = document.getElementById('d2-timeline-scroll-container')
          const observer = new MutationObserver(records => {
            counters.timelineMutations += records.filter(record => !record.target.closest?.('[data-playhead], [data-waveform-progress]')).length
          })
          observer.observe(timeline, { subtree: true, attributes: true, childList: true, characterData: true })
          const sample = async name => {
            await wait(300)
            for (const key of Object.keys(counters)) counters[key] = 0
            const start = performance.now()
            await wait(2000)
            return { name, seconds: (performance.now() - start) / 1000, ...counters,
              buffer: [preview.width, preview.height], display: [preview.clientWidth, preview.clientHeight] }
          }
          const results = []
          const ui = window.__D2_UI_STORE__
          const audio = window.__D2_AUDIO_STORE__
          const previewStore = window.__D2_PREVIEW_STORE__
          const composition = window.__D2_COMPOSITION_STORE__
          const registry = window.__D2_REGISTRY__
          const plugin = registry.getVisualizer('3d-sphere')
          results.push({ name: 'lazy-webgl', allocated: !!plugin.renderer })
          ui.getState().setActiveTab('visualizers')
          results.push(await sample('idle-visualizers'))
          await audio.getState().play()
          results.push(await sample('playing-visualizers'))
          previewStore.getState().setPreviewQuality('performance')
          results.push(await sample('performance-mode'))
          audio.getState().pause()
          const imported = await audio.getState().importFromPath(fixturePath, 'Performance fixture.wav')
          if (!imported || !audio.getState().waveform?.points.length) throw new Error('Real WAV import or waveform failed')
          await audio.getState().play()
          results.push(await sample('real-audio-playback'))
          let last3DContext
          const originalRender = plugin.render
          plugin.render = function(context) {
            last3DContext = context
            return originalRender.call(this, context)
          }
          composition.getState().updateVisualizer({ type: '3d-sphere' })
          await wait(500)
          const renderer = plugin.renderer
          if (!renderer) throw new Error('3D renderer missing after selection')
          results.push({ name: '3d-buffer', buffer: [renderer.domElement.width, renderer.domElement.height], previewBuffer: [preview.width, preview.height] })
          if (!baseline) {
            originalRender.call(plugin, { ...last3DContext, width: 1920, height: 1080,
              renderScale: undefined, ctx2d: undefined })
            results.push({ name: '3d-export-resolution', buffer: [renderer.domElement.width, renderer.domElement.height] })
          }
          plugin.render = originalRender
          window.__D2_EXPORT_STORE__.setState({ isExporting: true })
          results.push(await sample('export-preview-suspended'))
          window.__D2_EXPORT_STORE__.setState({ isExporting: false })
          composition.getState().updateVisualizer({ type: 'spectrum-bars' })
          audio.getState().pause()
          await wait(250)
          const tiny = document.createElement('canvas')
          tiny.width = 32; tiny.height = 18
          const context = tiny.getContext('2d')
          context.drawImage(preview, 0, 0, 32, 18)
          const pixels = context.getImageData(0, 0, 32, 18).data
          const uniqueColors = new Set()
          for (let index = 0; index < pixels.length; index += 4) uniqueColors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`)
          results.push({ name: 'preview-content', colors: uniqueColors.size })
          observer.disconnect()
          CanvasRenderingContext2D.prototype.clearRect = originalClear
          AnalyserNode.prototype.getByteFrequencyData = originalRead
          return results
        }.toString()})(${JSON.stringify(fixturePath)}, ${baseline})`)
        console.log(JSON.stringify(results, null, 2))
        fs.writeFileSync(path.join(artifactRoot, 'results.json'), JSON.stringify(results, null, 2))
        if (!baseline) {
          const byName = name => results.find(result => result.name === name)
          const performance = byName('performance-mode')
          const idle = byName('idle-visualizers')
          const real = byName('real-audio-playback')
          const sphere = byName('3d-buffer')
          const exporting = byName('export-preview-suspended')
          assert.ok(performance.mainFrames / performance.seconds <= 32, 'Performance mode exceeded 30 FPS budget')
          assert.ok(performance.mainFrames >= 12, 'Preview is stalled')
          assert.ok(idle.mainFrames / idle.seconds <= 17, 'Idle preview exceeded 15 FPS budget')
          assert.equal(byName('lazy-webgl').allocated, false, 'Unused 3D renderer allocated a context')
          assert.deepEqual(sphere.buffer, sphere.previewBuffer, '3D ignores preview resolution')
          assert.deepEqual(byName('3d-export-resolution').buffer, [1920, 1080], 'Export lost native resolution')
          assert.equal(real.waveformPaints, 0, 'Waveforms repaint on playback')
          assert.equal(real.timelineMutations, 0, 'Timeline clips mutate on playback')
          assert.equal(exporting.mainFrames, 0, 'Live preview continued during export')
          assert.equal(exporting.thumbnailFrames, 0, 'Thumbnails continued during export')
          assert.equal(exporting.analyserReads, 0, 'FFT sampling continued during export')
          assert.ok(byName('preview-content').colors > 10, 'Preview is blank')

          await screenshot('editor-after-effects')
          const checkVolumeSlider = async () => {
            const volumeStates = await js(`(${async function() {
              const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
              const audio = window.__D2_AUDIO_STORE__
              const saved = { volume: audio.getState().volume, isMuted: audio.getState().isMuted }
              const input = document.querySelector('input[aria-label="Volume"]')
              const toolbar = document.querySelector('[data-playback-toolbar]')
              const states = []
              try {
                if (audio.getState().isMuted) audio.getState().toggleMute()
                for (const value of [0, 0.5, 1]) {
                  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
                  input.dispatchEvent(new Event('input', { bubbles: true }))
                  await wait(50)
                  const rect = input.getBoundingClientRect()
                  const bounds = toolbar.getBoundingClientRect()
                  const style = getComputedStyle(input)
                  states.push({ value: audio.getState().volume, label: input.getAttribute('aria-valuetext'),
                    width: rect.width, height: rect.height, background: style.backgroundImage,
                    visible: rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom })
                }
                audio.getState().setVolume(0.5)
                await wait(50)
                document.querySelector('[aria-label="Mute audio"]').click()
                await wait(50)
                states.push({ muted: audio.getState().isMuted, value: Number(input.value), rememberedVolume: audio.getState().volume })
                document.querySelector('[aria-label="Unmute audio"]').click()
                await wait(50)
                states.push({ muted: audio.getState().isMuted, value: Number(input.value) })
              } finally {
                audio.getState().setVolume(saved.volume)
                if (audio.getState().isMuted !== saved.isMuted) audio.getState().toggleMute()
              }
              return states
            }.toString()})()`)
            for (const [index, value] of [0, 0.5, 1].entries()) {
              const state = volumeStates[index]
              assert.equal(state.value, value, 'Volume slider input did not update audio')
              assert.equal(state.label, `${value * 100}%`, 'Volume percentage label incorrect')
              assert.ok(state.width >= 80 && state.height >= 6, 'Volume track shrank')
              assert.ok(state.visible && state.background.includes('linear-gradient'), 'Volume track is hidden or transparent')
            }
            assert.deepEqual(volumeStates[3], { muted: true, value: 0, rememberedVolume: 0.5 }, 'Mute lost the volume setting')
            assert.deepEqual(volumeStates[4], { muted: false, value: 0.5 }, 'Unmute did not restore the volume setting')
            console.log('Volume slider checks:', JSON.stringify(volumeStates))
          }
          await checkVolumeSlider()
          await js(`window.__D2_AUDIO_STORE__.getState().setVolume(0.5)`)
          await wait(100)
          await screenshot('volume-slider-visible')
          await js(`document.querySelector('[aria-label="Preview quality"]').click()`)
          await wait(150)
          assert.equal(await js(`document.querySelector('[role="listbox"]').parentElement === document.body`), true, 'Menu is not portalled')
          await screenshot('preview-quality-menu')
          await key('End')
          assert.equal(await js(`document.activeElement.textContent.trim().startsWith('Quality')`), true, 'End did not focus last option')
          await key('Return')
          await wait(200)
          assert.equal(await js(`window.__D2_PREVIEW_STORE__.getState().previewQuality`), 'quality', 'Keyboard selection failed')
          assert.equal(await js(`document.activeElement.getAttribute('aria-label')`), 'Preview quality', 'Focus was not restored')
          assert.equal(await js(`!!document.querySelector('[role="listbox"]')`), false, 'Menu did not close after selection')
          await js(`document.querySelector('[aria-label="Preview quality"]').click()`)
          await wait(100)
          await key('Escape')
          await wait(100)
          assert.equal(await js(`!!document.querySelector('[role="listbox"]')`), false, 'Escape did not dismiss menu')
          for (const ratio of ['9:16', '1:1', '4:5', '21:9', '16:9']) {
            await js(`document.querySelector('[aria-label="Composition format"]').click()`)
            await wait(100)
            await js(`Array.from(document.querySelectorAll('[role="option"]')).find(option => option.firstElementChild.textContent.startsWith(${JSON.stringify(ratio)})).click()`)
            await wait(200)
            const aspect = await js(`(() => {
              const canvas = document.querySelector('canvas.object-contain');
              return canvas.clientWidth / canvas.clientHeight;
            })()`)
            // The standard ultrawide preset is 2560×1080, conventionally named 21:9.
            const [width, height] = ratio === '21:9' ? [2560, 1080] : ratio.split(':').map(Number)
            assert.ok(Math.abs(aspect - width / height) < 0.015, `${ratio} preview is distorted`)
          }
          await js(`window.__D2_PREVIEW_STORE__.getState().setPreviewQuality('balanced')`)
          window.setSize(1200, 700)
          await wait(500)
          await checkVolumeSlider()
          await screenshot('editor-compact')
          const layout = await js(`(() => {
            const toolbar = document.querySelector('[data-preview-toolbar]');
            const rect = toolbar.getBoundingClientRect();
            return [...toolbar.querySelectorAll('button')].every(button => {
              const bounds = button.getBoundingClientRect();
              return bounds.left >= rect.left && bounds.right <= rect.right && bounds.bottom <= rect.bottom;
            });
          })()`)
          assert.equal(layout, true, 'Toolbar controls overflow at minimum window size')
          await js(`document.querySelector('[aria-label="Preview quality"]').click()`)
          await wait(150)
          const menuVisible = await js(`(() => {
            const rect = document.querySelector('[role="listbox"]').getBoundingClientRect();
            return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
          })()`)
          assert.equal(menuVisible, true, 'Dropdown overflows compact viewport')
          await key('Escape')
          const tracksBefore = await js(`window.__D2_TIMELINE_STORE__.getState().tracks.length`)
          await js(`document.querySelector('[aria-label="Add track"]').click()`)
          await wait(100)
          await js(`Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent.trim() === 'Particles').click()`)
          assert.equal(await js(`window.__D2_TIMELINE_STORE__.getState().tracks.length`), tracksBefore + 1, 'Add track dropdown failed')
          window.webContents.debugger.attach('1.3')
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
          })
          await js(`window.__D2_EXPORT_STORE__.setState({ isExporting: true })`)
          await wait(200)
          const transitions = await js(`(${async function() {
            const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
            const ui = window.__D2_UI_STORE__
            const results = []
            const sampleTransition = async (element, property, toggle) => {
              // Sample a real CSS transition at a fixed animation time instead of assuming
              // React and the compositor start within a wall-clock 40 ms timeout.
              toggle()
              await wait(0)
              let transition
              for (let attempt = 0; attempt < 12 && !transition; attempt++) {
                transition = element.getAnimations().find(animation => animation.transitionProperty === property)
                if (!transition) await wait(16)
              }
              if (!transition) throw new Error('Missing CSS transition for ' + property)
              transition.pause()
              transition.currentTime = 80
              const mid = element.getBoundingClientRect()[property === 'grid-template-rows' ? 'height' : property]
              const duration = transition.effect.getTiming().duration
              transition.finish()
              await wait(20)
              return { mid, duration }
            }
            for (const [selector, method, dimension, collapsedSize] of [
              ['[data-inspector-panel]', 'toggleInspector', 'width', 40],
              ['[data-sidebar-panel]', 'toggleSidebar', 'width', 0],
              ['[data-timeline-panel]', 'toggleTimeline', 'height', 32],
            ]) {
              const panel = document.querySelector(selector)
              const before = panel.getBoundingClientRect()[dimension]
              const { mid, duration } = await sampleTransition(panel, dimension, () => ui.getState()[method]())
              const after = panel.getBoundingClientRect()[dimension]
              const computedCollapsed = parseFloat(getComputedStyle(panel)[dimension])
              ui.getState()[method]()
              await wait(260)
              const restored = panel.getBoundingClientRect()[dimension]
              results.push({ selector, before, mid, after, restored, computedCollapsed, collapsedSize, duration })
            }
            const toggle = document.querySelector('[data-inspector-panel] button[aria-controls]')
            const content = document.getElementById(toggle.getAttribute('aria-controls'))
            const retainedInput = content.querySelector('input')
            const before = content.getBoundingClientRect().height
            const { mid, duration } = await sampleTransition(content, 'grid-template-rows', () => toggle.click())
            const after = content.getBoundingClientRect().height
            const inert = content.inert
            toggle.click()
            await wait(260)
            results.push({ selector: 'collapsible-section', before, mid, after,
              restored: content.getBoundingClientRect().height, inert, inputRetained: retainedInput?.isConnected, duration })
            return results
          }.toString()})()`)
          console.log('Collapse transition checks:', JSON.stringify(transitions))
          await js(`window.__D2_EXPORT_STORE__.setState({ isExporting: false })`)
          for (const transition of transitions) {
            assert.equal(transition.duration, 200, `${transition.selector} does not use a 200 ms transition`)
            assert.ok(transition.mid < transition.before && transition.mid > transition.after, `${transition.selector} does not animate`)
            assert.ok(Math.abs(transition.restored - transition.before) < 1, `${transition.selector} does not restore size`)
            if (transition.selector === 'collapsible-section') {
              assert.ok(transition.after < 1 && transition.inert && transition.inputRetained, 'Collapsed section loses state or remains focusable')
            } else {
              assert.equal(transition.computedCollapsed, transition.collapsedSize, `${transition.selector} has incorrect collapsed size`)
            }
          }
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
          })
          const reducedMotion = await js(`getComputedStyle(document.querySelector('[data-inspector-panel]')).transitionDuration`)
          assert.equal(reducedMotion, '0s', 'Reduced-motion preference ignored')
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
          window.webContents.debugger.detach()

          for (const [tab, label] of [['visualizers', 'Visualizer categories'], ['effects', 'Camera motion categories']]) {
            await js(`window.__D2_UI_STORE__.getState().setActiveTab(${JSON.stringify(tab)})`)
            await wait(150)
            const stripResult = await js(`(${async function(label) {
              const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
               const root = document.querySelector('[data-category-strip="' + label + '"]')
               const viewport = root.querySelector('[data-category-viewport]')
               // Wait for overflow arrows and tab layout before measuring the viewport.
               await wait(100)
               const max = viewport.scrollWidth - viewport.clientWidth
              if (max <= 0) throw new Error('Category overflow not detected')
              const wheel = (deltaX, deltaY, ctrlKey = false) => {
                const event = new WheelEvent('wheel', { deltaX, deltaY, ctrlKey, bubbles: true, cancelable: true })
                viewport.dispatchEvent(event)
                return event.defaultPrevented
              }
              viewport.scrollLeft = 0
              const consumed = wheel(0, 100)
              const down = viewport.scrollLeft
              wheel(-50, 0)
              const trackpad = viewport.scrollLeft
              const zoomConsumed = wheel(0, 100, true)
              const zoomPosition = viewport.scrollLeft
               viewport.scrollLeft = viewport.scrollWidth
              const endConsumed = wheel(0, 100)
              await wait(50)
              const rightDisabled = root.querySelector('[aria-label="' + label + ': scroll right"]').disabled
              root.querySelector('[aria-label="' + label + ': scroll left"]').click()
              await wait(350)
              const arrow = viewport.scrollLeft
              viewport.scrollLeft = 0
              const last = viewport.querySelector('button:last-child')
              last.focus()
              const focusRevealed = viewport.scrollLeft > 0 && last.getBoundingClientRect().right <= viewport.getBoundingClientRect().right + 1
              viewport.focus()
              viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
              const home = viewport.scrollLeft
              viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
              const end = viewport.scrollLeft
              return { label, max, consumed, down, trackpad, zoomConsumed, zoomPosition, endConsumed, rightDisabled, arrow, focusRevealed, home, end }
             }.toString()})(${JSON.stringify(label)})`)
             console.log('Category wheel checks:', JSON.stringify(stripResult))
            assert.ok(stripResult.consumed && stripResult.down > 0, 'Vertical wheel did not scroll categories')
            assert.ok(stripResult.trackpad < stripResult.down, 'Horizontal trackpad scroll failed')
            assert.ok(!stripResult.zoomConsumed && stripResult.zoomPosition === stripResult.trackpad, 'Category strip consumes zoom gestures')
            assert.ok(!stripResult.endConsumed && stripResult.rightDisabled, 'Category boundary traps wheel input')
            assert.ok(stripResult.arrow < stripResult.max && stripResult.focusRevealed, 'Arrow or focused-category reveal failed')
            assert.equal(stripResult.home, 0)
            assert.ok(Math.abs(stripResult.end - stripResult.max) < 1, 'End did not reveal the final category')
            window.webContents.debugger.attach('1.3')
            const wheelTarget = await js(`(() => { const viewport = document.querySelector('[data-category-viewport]'); viewport.scrollLeft = 0; const rect = viewport.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`)
            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelTarget, deltaX: 0, deltaY: 120 })
            await wait(100)
            assert.ok(await js(`document.querySelector('[data-category-viewport]').scrollLeft > 0`), 'Chromium mouse-wheel input failed')
            window.webContents.debugger.detach()
            await screenshot(tab === 'effects' ? 'camera-category-wheel' : 'visualizer-category-wheel')
          }
          await js(`window.__D2_UI_STORE__.getState().setActiveTab('visualizers')`)
          await wait(100)

          const splitterChecks = await js(`(${async function() {
            const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
            const ui = window.__D2_UI_STORE__
            const audio = window.__D2_AUDIO_STORE__
            const preview = document.querySelector('[aria-label="Composition preview"]')
            const clear = CanvasRenderingContext2D.prototype.clearRect
            let painting = 0, checking = false
            CanvasRenderingContext2D.prototype.clearRect = function(...args) {
              if (checking && this.canvas === preview) painting++
              return clear.apply(this, args)
            }
            const results = []
            await audio.getState().play()
            try {
              for (const [label, field, setter, axis, direction] of [
                ['Resize sidebar', 'sidebarWidth', 'setSidebarWidth', 'x', 1],
                ['Resize inspector', 'inspectorWidth', 'setInspectorWidth', 'x', -1],
                ['Resize timeline', 'timelineHeight', 'setTimelineHeight', 'y', -1],
              ]) {
                const handle = document.querySelector('[aria-label="' + label + '"]')
                const panel = handle.closest('[data-sidebar-panel], [data-inspector-panel], [data-timeline-panel]')
                const initial = ui.getState()[field]
                const buffer = [preview.width, preview.height]
                let commits = 0
                const unsubscribe = ui.subscribe((state, previous) => { if (state[field] !== previous[field]) commits++ })
                const pointer = (type, delta) => new PointerEvent(type, { bubbles: true, cancelable: true,
                  button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 71, isPrimary: true,
                  clientX: 400 + (axis === 'x' ? delta * direction : 0), clientY: 300 + (axis === 'y' ? delta * direction : 0) })
                handle.dispatchEvent(pointer('pointerdown', 0))
                checking = true; painting = 0
                const gaps = []
                let previous = performance.now()
                for (let frame = 1; frame <= 12; frame++) {
                  for (let sample = 0; sample < 100; sample++) window.dispatchEvent(pointer('pointermove', frame * 3))
                  await new Promise(resolve => requestAnimationFrame(resolve))
                  const now = performance.now(); gaps.push(now - previous); previous = now
                }
                const during = { commits, paints: painting, bufferStable: preview.width === buffer[0] && preview.height === buffer[1],
                  cssSize: parseFloat(panel.style.getPropertyValue('--panel-size')), transition: getComputedStyle(panel).transitionDuration }
                checking = false
                window.dispatchEvent(pointer('pointerup', 40))
                await wait(250)
                const released = { commits, stored: ui.getState()[field], resizing: panel.dataset.resizing }
                handle.dispatchEvent(pointer('pointerdown', 0))
                window.dispatchEvent(pointer('pointermove', 20))
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
                const cancelled = ui.getState()[field] === released.stored && panel.dataset.resizing === 'false'
                handle.dispatchEvent(new KeyboardEvent('keydown', { key: axis === 'x' ? 'ArrowRight' : 'ArrowDown', bubbles: true, cancelable: true }))
                const keyboard = ui.getState()[field] === released.stored + 8 * direction
                unsubscribe()
                ui.getState()[setter](initial)
                await wait(250)
                results.push({ label, initial, during, released, cancelled, keyboard, gaps })
              }
            } finally {
              checking = false
              CanvasRenderingContext2D.prototype.clearRect = clear
              audio.getState().pause()
            }
            return results
          }.toString()})()`)
          for (const check of splitterChecks) {
            assert.equal(check.during.commits, 0, check.label + ' updates store while dragging')
            assert.equal(check.during.paints, 0, check.label + ' repaints composition during drag')
            assert.equal(check.during.bufferStable, true, check.label + ' reallocates preview buffer during drag')
            assert.equal(check.during.cssSize, check.initial + 36, check.label + ' does not follow pointer')
            assert.equal(check.during.transition, '0s', check.label + ' animates drag dimensions')
            assert.equal(check.released.commits, 1, check.label + ' must commit only once')
            assert.equal(check.released.stored, check.initial + 40, check.label + ' loses final pointer position')
            assert.ok(check.cancelled && check.keyboard, check.label + ' cancel or keyboard control failed')
          }
          window.webContents.debugger.attach('1.3')
          for (const [label, field, setter, direction] of [
            ['Resize sidebar', 'sidebarWidth', 'setSidebarWidth', 1],
            ['Resize inspector', 'inspectorWidth', 'setInspectorWidth', -1],
            ['Resize timeline', 'timelineHeight', 'setTimelineHeight', -1],
          ]) {
            const target = await js(`(() => { const rect = document.querySelector('[aria-label="${label}"]').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: window.__D2_UI_STORE__.getState().${field} }; })()`)
            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 })
            const end = { x: target.x + (field === 'timelineHeight' ? 0 : 32 * direction), y: target.y + (field === 'timelineHeight' ? -32 : 0) }
            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1 })
            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 })
            await wait(250)
            assert.equal(await js(`window.__D2_UI_STORE__.getState().${field}`), target.size + 32, label + ' native mouse drag failed')
            await js(`window.__D2_UI_STORE__.getState().${setter}(${target.size})`)
            await wait(250)
          }
          window.webContents.debugger.detach()
          console.log('Splitter checks:', JSON.stringify(splitterChecks))

          await js(`Array.from(document.querySelectorAll('button[aria-pressed]')).find(button => button.textContent.trim().startsWith('All')).click()`)
          await wait(200)
          assert.equal(await js(`document.querySelectorAll('[data-preset-id]').length`), 24, 'Preset browser mounts more than one page')
          const presetIds = new Set()
          for (let page = 0; page < 2; page++) {
            for (const id of await js(`Array.from(document.querySelectorAll('[data-preset-id]')).map(card => card.dataset.presetId)`)) presetIds.add(id)
            if (page < 1) { await js(`document.querySelector('[aria-label="Next preset page"]').click()`); await wait(80) }
          }
          assert.equal(presetIds.size, 37, 'Browser must contain exactly the original 37 presets')
          assert.equal(await js(`document.querySelector('[data-sidebar-panel]').textContent.includes('BASS PACK')`), false, 'Removed pack badge remains')
          await js(`document.querySelector('[data-preset-id]').click()`)
          await wait(150)
          assert.equal(await js(`document.querySelectorAll('[data-preset-id][aria-pressed="true"]').length`), 1, 'Preset browser selects multiple cards')
          assert.equal(await js(`window.__D2_COMPOSITION_STORE__.getState().visualizer.bassReactivity.enabled`), false, 'Original preset should bypass bass rack by default')
          await js(`window.__D2_UI_STORE__.getState().setSelectedLayer('visualizer')`)
          await wait(100)
          await js(`document.querySelector('[aria-label="Bass response preset"]').click()`)
          await wait(80)
          await js(`Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent.trim() === 'Tight Kick').click()`)
          await wait(100)
          assert.equal(await js(`window.__D2_COMPOSITION_STORE__.getState().visualizer.bassReactivity.attackMs`), 3, 'Bass rack response preset failed')
          const configBeforeEdit = await js(`window.__D2_COMPOSITION_STORE__.getState().visualizer.bassReactivity`)
          await js(`(() => { const input = document.querySelector('input[aria-label="Bass Gain"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '3'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
          await wait(100)
          assert.equal(await js(`window.__D2_COMPOSITION_STORE__.getState().visualizer.bassReactivity.gain`), 3, 'Bass gain slider is not wired')
          await js(`window.__D2_COMPOSITION_STORE__.getState().undo()`)
          assert.equal(await js(`window.__D2_COMPOSITION_STORE__.getState().visualizer.bassReactivity.gain`), configBeforeEdit.gain, 'Undo did not restore bass settings')
          await js(`window.__D2_COMPOSITION_STORE__.getState().redo()`)
          assert.equal(await js(`window.__D2_COMPOSITION_STORE__.getState().visualizer.bassReactivity.gain`), 3, 'Redo did not restore bass settings')
          await js(`document.querySelector('[role="switch"][aria-label="Bass reactivity"]').click()`)
          await wait(100)
          assert.equal(await js(`window.__D2_COMPOSITION_STORE__.getState().visualizer.bassReactivity.enabled`), false, 'Bass bypass switch failed')
          await js(`document.querySelector('[role="switch"][aria-label="Bass reactivity"]').click()`)
          const serializedBass = await js(`(${async function() {
            const manager = window.__D2_PROJECT_MANAGER__
            const project = JSON.parse(JSON.stringify(manager.exportCurrentProjectData()))
            const before = JSON.stringify(project.composition.visualizer.bassReactivity)
            const result = await manager.loadProjectData(project)
            return { success: result.success, same: JSON.stringify(window.__D2_COMPOSITION_STORE__.getState().visualizer.bassReactivity) === before }
          }.toString()})()`)
          assert.ok(serializedBass.success && serializedBass.same, 'Project round trip dropped bass configuration')
          await js(`document.querySelector('[aria-label="Live bass envelope and kick meter"]').scrollIntoView({ block: 'center' })`)
          await js(`window.__D2_AUDIO_STORE__.getState().play()`)
          await wait(300)
          await screenshot('bass-rack-and-presets')
          await js(`window.__D2_AUDIO_STORE__.getState().pause()`)
          console.log('Original 37 presets, rack controls, undo/redo, and project round trip passed')

          assert.equal(hardwareQueries, 0, 'App launch performed a hardware scan')
          assert.equal(await js(`window.electronAPI.hardwareGetSaved()`), null, 'Fresh test profile unexpectedly has hardware data')
          await js(`(() => { const button = document.querySelector('[aria-label="Settings"]'); button.focus(); button.click(); })()`)
          await wait(200)
          assert.equal(await js(`document.querySelectorAll('input[type="checkbox"]').length`), 0, 'Native checkboxes remain')
          await js(`document.querySelector('[role="switch"][aria-label="Automatic Background Saving"]').click()`)
          await wait(100)
          assert.equal(await js(`window.__D2_PROJECT_STORE__.getState().autoSaveEnabled`), true, 'Auto-save switch did not enable saving')
          assert.equal(await js(`document.querySelector('[aria-label="Auto-Save Interval"]').disabled`), false, 'Enabled auto-save has disabled interval')
          await screenshot('settings-switches')
          await js(`document.querySelector('[role="switch"][aria-label="Automatic Background Saving"]').click()`)
          await wait(100)
          assert.equal(await js(`document.querySelector('[aria-label="Auto-Save Interval"]').disabled`), true, 'Auto-save off did not disable interval')
          await js(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent.trim() === 'Video & Export').click()`)
          await wait(100)
          await js(`document.querySelector('[role="switch"][aria-label="Hardware Accelerated Video Encoding"]').click()`)
          await wait(100)
          assert.equal(await js(`window.__D2_EXPORT_STORE__.getState().videoCodec`), 'libx264', 'Encoding switch does not control export settings')
          await js(`document.querySelector('[role="switch"][aria-label="Hardware Accelerated Video Encoding"]').click()`)
          await wait(100)
          assert.equal(await js(`window.__D2_EXPORT_STORE__.getState().videoCodec`), 'auto', 'Hardware encoding switch did not restore auto mode')
          await js(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent.trim() === 'Performance Mode').click()`)
          await wait(100)
          assert.equal(hardwareQueries, 0, 'Opening performance settings scanned hardware')
          await js(`(${async function() {
            document.querySelector('[aria-label="Check computer hardware"]').click()
            for (let attempt = 0; attempt < 90; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 200))
              if (document.querySelector('[aria-label="Check computer hardware"]').textContent.includes('Hardware checked')) return
              const error = document.querySelector('[role="alert"]')
              if (error) throw new Error(error.textContent)
            }
            throw new Error('Hardware check did not finish')
          }.toString()})()`)
          const hardwareProfile = await js(`window.electronAPI.hardwareGetSaved()`)
          assert.ok(hardwareProfile && hardwareProfile.logicalCores > 0 && hardwareProfile.memoryGB > 0, 'Hardware detection returned no CPU/RAM')
          assert.equal(hardwareQueries, 1, 'Manual hardware scan did not run exactly once')
          assert.equal(await js(`document.querySelector('[aria-label="Check computer hardware"]').disabled`), true, 'Completed hardware check can run again')
          const repeated = await js(`window.electronAPI.hardwareCheckOnce()`)
          assert.equal(repeated.checkedAt, hardwareProfile.checkedAt, 'Repeat call replaced the saved profile')
          assert.equal(hardwareQueries, 1, 'Repeat hardware request performed another scan')
          await js(`window.__D2_PREVIEW_STORE__.getState().setPreviewQuality(${JSON.stringify(hardwareProfile.recommendedMode === 'quality' ? 'balanced' : 'quality')})`)
          await wait(100)
          await js(`document.querySelector('[aria-label="Apply recommended preview mode"]').click()`)
          await wait(100)
          assert.equal(await js(`window.__D2_PREVIEW_STORE__.getState().previewQuality`), hardwareProfile.recommendedMode, 'Hardware recommendation was not applied')
          assert.equal(await js(`localStorage.getItem('d2-preview-quality')`), hardwareProfile.recommendedMode, 'Hardware recommendation was not persisted')
          await screenshot('hardware-recommendation')
          await key('Escape')
          assert.equal(await js(`!!document.querySelector('[role="dialog"]')`), false, 'Settings did not close on Escape')
          assert.equal(await js(`document.activeElement.getAttribute('aria-label')`), 'Settings', 'Settings did not restore focus')

          assert.equal(await js(`!!document.querySelector('aside button[aria-label="Video Export"]')`), false, 'Export remains in sidebar')
          await js(`(() => { const button = document.querySelector('header [aria-label="Export Video"]'); button.focus(); button.click(); })()`)
          await wait(200)
          assert.equal(await js(`document.getElementById('root').inert`), true, 'Editor remains interactive behind popup')
          await screenshot('export-popup')
          const popupBounds = await js(`(() => { const rect = document.querySelector('[role="dialog"]').getBoundingClientRect(); return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; })()`)
          assert.equal(popupBounds, true, 'Export popup overflows compact viewport')
          await js(`document.querySelector('[aria-label="Frame Rate"]').click()`)
          await wait(100)
          await key('End')
          await key('Return')
          assert.equal(await js(`window.__D2_EXPORT_STORE__.getState().fps`), 60, 'Export frame-rate dropdown did not update settings')
          assert.ok(await js(`document.querySelector('[role="dialog"]').contains(document.activeElement)`), 'Dropdown focus escaped export popup')
          await js(`document.querySelector('[aria-label="Video Quality"]').click()`)
          await wait(100)
          await key('Escape')
          assert.equal(await js(`!!document.querySelector('[role="dialog"]')`), true, 'Dropdown Escape also closed export popup')
          await js(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent.includes('9:16 Vertical Story')).click()`)
          await wait(100)
          assert.equal(await js(`window.__D2_EXPORT_STORE__.getState().selectedPresetId`), 'shorts', 'Export preset selection failed')
          await js(`(() => { const dialog = document.querySelector('[role="dialog"]'); dialog.querySelector('button').focus(); })()`)
          await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))`)
          assert.equal(await js(`document.activeElement.textContent.trim()`), 'Close', 'Modal did not wrap keyboard focus')
          await js(`window.__D2_EXPORT_STORE__.setState({ isExporting: true, exportStage: 'rendering', progress: 0.42, currentFrame: 126, totalFrames: 300 })`)
          await wait(100)
          assert.equal(await js(`document.querySelector('[aria-label="Frame Rate"]').disabled`), true, 'Export configuration remains enabled during rendering')
          await screenshot('export-popup-progress')
          await key('Escape')
          assert.equal(await js(`window.__D2_EXPORT_STORE__.getState().isExporting`), true, 'Closing popup cancelled export')
          assert.equal(await js(`document.getElementById('root').inert`), false, 'Closing popup left editor inert')
          assert.equal(await js(`document.activeElement.getAttribute('aria-label')`), 'Export Video', 'Export popup did not restore focus')
          await js(`document.querySelector('header [aria-label="Export Video"]').click()`)
          await wait(100)
          assert.equal(await js(`document.querySelector('[role="dialog"]').textContent.includes('42%')`), true, 'Reopened popup lost export progress')
          await js(`window.__D2_EXPORT_STORE__.getState().resetStatus()`)
          await key('Escape')
          console.log('Switch, export popup, focus, and one-time hardware recommendation checks passed')
          console.log('Performance and toolbar regression checks passed')
        }
        clearTimeout(timeout)
        app.exit(0)
      } catch (error) {
        console.error(error)
        clearTimeout(timeout)
        app.exit(1)
      }
    })
  })
  require('../dist-electron/main.js')
}
