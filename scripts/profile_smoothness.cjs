const path = require('node:path')
const fs = require('node:fs')

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
  const root = path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
  const artifactRoot = fs.mkdtempSync(path.join(root, 'd2-smoothness-'))
  app.setPath('userData', path.join(artifactRoot, 'userData'))
  const rate = 44100, samples = rate * 30
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    const time = i / rate
    wav.writeInt16LE(Math.round(Math.sin(time * Math.PI * 2 * 110) * (0.15 + 0.5 * Math.exp(-((time * 2) % 1) * 8)) * 32767), 44 + i * 2)
  }
  const fixture = path.join(artifactRoot, 'beat.wav')
  fs.writeFileSync(fixture, wav)
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const timeout = setTimeout(() => { console.error('Smoothness profiling timed out'); app.exit(1) }, 90000)
  app.on('browser-window-created', (_event, window) => {
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
      const js = code => window.webContents.executeJavaScript(code)
      try {
        window.setSize(1600, 900)
        await wait(1000)
        await js(`(${async function(fixture) {
          await document.fonts.ready
          window.__D2_PROJECT_STORE__.getState().setAutoSaveSettings(false, 30)
          const audio = window.__D2_AUDIO_STORE__
          if (!await audio.getState().importFromPath(fixture, 'Beat.wav')) throw new Error('Fixture import failed')
          const preview = document.querySelector('[aria-label="Composition preview"]')
          const registry = window.__D2_REGISTRY__
          const metrics = window.__smoothness = { active: false, main: [], thumbnail: [], gaps: [], scheduler: [], longTasks: [], clears: 0, thumbnailClears: 0, fft: 0, lastFrame: null }
          const raf = window.requestAnimationFrame
          window.requestAnimationFrame = callback => raf(timestamp => {
            const start = performance.now()
            try { callback(timestamp) } finally {
              if (metrics.active) metrics.scheduler.push(performance.now() - start)
            }
          })
          for (const { id } of registry.getAllVisualizers()) {
            const proto = Object.getPrototypeOf(registry.getVisualizer(id))
            const render = proto.render
            proto.render = function(context) {
              const start = performance.now()
              try { return render.call(this, context) } finally {
                if (metrics.active) {
                  if (context.canvas === preview) {
                    metrics.main.push(performance.now() - start)
                    if (metrics.lastFrame !== null) metrics.gaps.push(start - metrics.lastFrame)
                    metrics.lastFrame = start
                  } else metrics.thumbnail.push(performance.now() - start)
                }
              }
            }
          }
          const clear = CanvasRenderingContext2D.prototype.clearRect
          CanvasRenderingContext2D.prototype.clearRect = function(...args) {
            if (metrics.active) {
              if (this.canvas === preview) metrics.clears++
              else if (this.canvas.closest('[data-preset-list]')) metrics.thumbnailClears++
            }
            return clear.apply(this, args)
          }
          const read = AnalyserNode.prototype.getByteFrequencyData
          AnalyserNode.prototype.getByteFrequencyData = function(...args) {
            if (metrics.active) metrics.fft++
            return read.apply(this, args)
          }
          new PerformanceObserver(list => {
            if (metrics.active) metrics.longTasks.push(...list.getEntries().map(entry => entry.duration))
          }).observe({ type: 'longtask', buffered: false })
        }.toString()})(${JSON.stringify(fixture)})`)
        window.webContents.debugger.attach('1.3')
        await window.webContents.debugger.sendCommand('Profiler.enable')
        await window.webContents.debugger.sendCommand('Profiler.setSamplingInterval', { interval: 1000 })
        const results = []
        for (const [name, quality, collapsed, bass, playing] of [
          ['balanced-browser', 'balanced', false, false, true],
          ['balanced-hidden-browser', 'balanced', true, false, true],
          ['balanced-bass-browser', 'balanced', false, true, true],
          ['performance-browser', 'performance', false, true, true],
          ['quality-browser', 'quality', false, false, true],
          ['idle-browser', 'balanced', false, false, false],
        ]) {
          await js(`(${async function(quality, collapsed, bass, playing) {
            const ui = window.__D2_UI_STORE__
            ui.getState().setActiveTab('visualizers')
            if (ui.getState().isSidebarCollapsed !== collapsed) ui.getState().toggleSidebar()
            window.__D2_PREVIEW_STORE__.getState().setPreviewQuality(quality)
            window.__D2_COMPOSITION_STORE__.getState().updateVisualizer({ type: 'spectrum-bars', barCount: 56, thickness: 12, glow: bass ? 32 : 18,
              bassReactivity: { enabled: bass, pulseScale: 0.22, glowBoost: 16, sidechain: 0.35 } })
            const audio = window.__D2_AUDIO_STORE__
            audio.getState().seek(2)
            if (playing) await audio.getState().play(); else audio.getState().pause()
          }.toString()})(${JSON.stringify(quality)}, ${collapsed}, ${bass}, ${playing})`)
          await wait(600)
          await window.webContents.debugger.sendCommand('Profiler.start')
          const result = await js(`(${async function(name) {
            const m = window.__smoothness
            for (const key of ['main', 'thumbnail', 'gaps', 'scheduler', 'longTasks']) m[key] = []
            m.clears = m.thumbnailClears = m.fft = 0; m.lastFrame = null; m.active = true
            const start = performance.now()
            await new Promise(resolve => setTimeout(resolve, 4000))
            m.active = false
            const seconds = (performance.now() - start) / 1000
            const stats = values => {
              const sorted = values.slice().sort((a, b) => a - b)
              return { count: sorted.length, totalMs: values.reduce((a, b) => a + b, 0), p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, max: sorted.at(-1) ?? 0 }
            }
            const canvas = document.querySelector('[aria-label="Composition preview"]')
            return { name, seconds, fps: m.clears / seconds, thumbnailFrames: m.thumbnailClears, fft: m.fft,
              buffer: [canvas.width, canvas.height], main: stats(m.main), thumbnail: stats(m.thumbnail), gaps: stats(m.gaps), scheduler: stats(m.scheduler), longTasks: stats(m.longTasks) }
          }.toString()})(${JSON.stringify(name)})`)
          const { profile } = await window.webContents.debugger.sendCommand('Profiler.stop')
          fs.writeFileSync(path.join(artifactRoot, `${name}.cpuprofile`), JSON.stringify(profile))
          result.cpu = profile.nodes.filter(node => node.hitCount).sort((a, b) => b.hitCount - a.hitCount).slice(0, 12).map(node => ({ function: node.callFrame.functionName, samples: node.hitCount }))
          results.push(result)
          console.log(JSON.stringify(result))
        }
        fs.writeFileSync(path.join(artifactRoot, 'results.json'), JSON.stringify(results, null, 2))
        console.log('Smoothness artifacts:', artifactRoot)
        window.webContents.debugger.detach()
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
