const path = require('node:path')
const fs = require('node:fs')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { spawn } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename], { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} else {
  const { app } = require('electron')
  const root = path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
  fs.mkdirSync(root, { recursive: true })
  const artifacts = fs.mkdtempSync(path.join(root, 'd2-timeline-scrub-'))
  app.setPath('userData', path.join(artifacts, 'userData'))
  const rate = 44100, samples = rate * 30
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index / rate * 110 * 2 * Math.PI) * 10000), 44 + index * 2)
  const fixture = path.join(artifacts, 'scrub.wav')
  fs.writeFileSync(fixture, wav)
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const timeout = setTimeout(() => { console.error('Timeline scrubbing test timed out'); app.exit(1) }, 90000)
  app.on('browser-window-created', (_event, window) => {
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
      const js = code => window.webContents.executeJavaScript(code)
      try {
        window.setSize(1600, 1000)
        await wait(700)
        const results = await js(`(${async function(fixture) {
          const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
          await document.fonts.ready
          window.__D2_PROJECT_STORE__.getState().setAutoSaveSettings(false, 30)
          const audio = window.__D2_AUDIO_STORE__, preview = window.__D2_PREVIEW_STORE__, timeline = window.__D2_TIMELINE_STORE__
          const engine = window.__D2_TIMELINE_ENGINE__
          const viewport = document.getElementById('d2-timeline-scroll-container')
          const ruler = document.querySelector('[data-timeline-ruler]')
          const playhead = document.querySelector('[data-playhead]')
          const handle = document.querySelector('[aria-label="Timeline playhead"]')
          const compositor = window.__D2_COMPOSITOR__
          let active = false, seeks = 0, renders = 0, waveformPaints = 0, mutations = 0, updates = 0
          const mediaTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
          Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...mediaTime, set(value) {
            if (active && this.tagName === 'AUDIO') seeks++
            return mediaTime.set.call(this, value)
          } })
          const render = compositor.render
          compositor.render = function(context) { if (active) renders++; return render.call(this, context) }
          const clear = CanvasRenderingContext2D.prototype.clearRect
          CanvasRenderingContext2D.prototype.clearRect = function(...args) {
            if (active && this.canvas.closest('#d2-timeline-scroll-container')) waveformPaints++
            return clear.apply(this, args)
          }
          const observer = new MutationObserver(records => {
            if (active) mutations += records.filter(record => !record.target.closest?.('[data-playhead], [data-waveform-progress]')).length
          })
          observer.observe(viewport, { subtree: true, attributes: true, childList: true, characterData: true })
          const unsubscribe = preview.subscribe((state, previous) => { if (active && state.currentTime !== previous.currentTime) updates++ })
          const pointer = (type, x) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: viewport.getBoundingClientRect().top + 30,
            button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 81, isPrimary: true })
          const results = []
          try {
            // Scrub an empty project too: cursor time must not depend on media readiness.
            ruler.dispatchEvent(pointer('pointerdown', viewport.getBoundingClientRect().left + 50))
            window.dispatchEvent(pointer('pointerup', viewport.getBoundingClientRect().left + 75))
            results.push({ name: 'empty-project', time: preview.getState().currentTime, expected: 75 / timeline.getState().zoom, scrubbing: engine.getIsScrubbing() })
            if (!await audio.getState().importFromPath(fixture, 'Scrub fixture.wav')) throw new Error('Fixture import failed')
            preview.getState().setPreviewQuality('balanced')
            for (const [name, target, zoom, scroll, playing] of [
              ['ruler-paused', ruler, 20, 0, false],
              ['playhead-scrolled', handle, 60, 70, false],
              ['ruler-playing', ruler, 4, 0, true],
              ['playhead-playing', handle, 10, 0, true],
            ]) {
              audio.getState().pause(); audio.getState().seek(2)
              timeline.getState().setZoom(zoom)
              viewport.scrollLeft = scroll
              await wait(200)
              if (playing) { await audio.getState().play(); await wait(100) }
              const left = viewport.getBoundingClientRect().left
              const initial = Number(handle.getAttribute('aria-valuenow'))
              const startX = left + initial * zoom - viewport.scrollLeft
              const endX = left + 8.125 * zoom - viewport.scrollLeft
              target.dispatchEvent(pointer('pointerdown', startX))
              await wait(0)
              const frozen = preview.getState().currentTime
              active = true; seeks = renders = waveformPaints = mutations = updates = 0
              const positions = [], gaps = []
              const started = performance.now()
              let previous = started
              for (let frame = 1; frame <= 30; frame++) {
                const x = startX + (endX - startX) * frame / 30
                for (let sample = 0; sample < 100; sample++) window.dispatchEvent(pointer('pointermove', x))
                await new Promise(resolve => requestAnimationFrame(resolve))
                const now = performance.now(); gaps.push(now - previous); previous = now
                positions.push(Number(handle.getAttribute('aria-valuenow')))
              }
              const seconds = (performance.now() - started) / 1000
              const during = { seconds, seeks, renders, waveformPaints, mutations, updates,
                frozen: preview.getState().currentTime === frozen, positions, gaps, scrubbing: engine.getIsScrubbing(), transform: playhead.style.transform,
                playbackTimecode: document.querySelector('[data-playback-timecode]').textContent,
                timelineTimecode: document.querySelector('[data-timeline-timecode] span').textContent }
              active = false
              window.dispatchEvent(pointer('pointerup', endX))
              const released = { time: preview.getState().currentTime, expected: playing && target === handle ? initial + (endX - startX) / zoom : 8.125,
                scrubbing: engine.getIsScrubbing(), dataset: viewport.dataset.scrubbing }
              await wait(200)
              released.playing = audio.getState().status === 'playing'
              results.push({ name, during, released, playing })
              audio.getState().pause()
            }
            audio.getState().seek(3.5)
            const left = viewport.getBoundingClientRect().left
            ruler.dispatchEvent(pointer('pointerdown', left + 50))
            window.dispatchEvent(pointer('pointermove', left + 80))
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
            results.push({ name: 'escape', time: preview.getState().currentTime, scrubbing: engine.getIsScrubbing() })
            handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
            results.push({ name: 'keyboard', time: preview.getState().currentTime, expected: 3.5 + 1 / timeline.getState().fps })
            const marker = document.querySelector('[data-timeline-marker]')
            marker.dispatchEvent(pointer('pointerdown', left + 10))
            const markerStartedScrub = engine.getIsScrubbing()
            marker.click()
            results.push({ name: 'marker', startedScrub: markerStartedScrub, time: preview.getState().currentTime, expected: timeline.getState().markers[0].time })
          } finally {
            active = false
            observer.disconnect(); unsubscribe()
            Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', mediaTime)
            compositor.render = render
            CanvasRenderingContext2D.prototype.clearRect = clear
            audio.getState().pause()
          }
          return results
        }.toString()})(${JSON.stringify(fixture)})`)
        fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
        console.log('Timeline scrub artifacts:', artifacts)
        for (const result of results) {
          if (result.during) {
            const during = result.during
            assert.equal(during.updates, 0, result.name + ' writes persistent clock during pointer moves')
            assert.equal(during.frozen, true, result.name + ' clock is pulled back by decoder events')
            assert.equal(during.waveformPaints, 0, result.name + ' repaints waveform')
            // The one data-scrubbing attribute marks the interaction, not the ruler/clip subtree.
            assert.ok(during.mutations <= 1, result.name + ' mutates ruler or clips')
            assert.ok(during.seeks <= Math.ceil(during.seconds * 10) + 1, result.name + ' exceeds decoder seek budget')
            assert.ok(during.renders <= Math.ceil(during.seconds * 10) + 1, result.name + ' exceeds scrub preview budget')
            assert.ok(new Set(during.positions).size >= 20, result.name + ' cursor updates are stalled')
            assert.ok(Math.abs(result.released.time - result.released.expected) < 0.1, result.name + ' loses exact release position')
            assert.equal(result.released.scrubbing, false)
            assert.equal(result.released.playing, result.playing, result.name + ' does not restore playback state')
          } else if (result.name === 'escape') {
            assert.equal(result.time, 3.5); assert.equal(result.scrubbing, false)
          } else if (result.name === 'marker') {
            assert.equal(result.startedScrub, false); assert.equal(result.time, result.expected)
          } else {
            assert.ok(Math.abs(result.time - result.expected) < 1e-6, result.name + ' produced the wrong time')
          }
        }
        window.webContents.debugger.attach('1.3')
        for (const label of ['Timeline ruler', 'Timeline playhead']) {
          await js(`window.__D2_AUDIO_STORE__.getState().seek(3)`)
          await wait(100)
          const bounds = await js(`(() => { const target = document.querySelector('[aria-label="${label}"]'); const rect = target.getBoundingClientRect(); const viewport = document.getElementById('d2-timeline-scroll-container').getBoundingClientRect(); return { x: ${label === 'Timeline ruler' ? 'viewport.left + 55' : 'rect.left + rect.width / 2'}, y: rect.top + ${label === 'Timeline ruler' ? '30' : 'rect.height / 2'}, left: viewport.left, zoom: window.__D2_TIMELINE_STORE__.getState().zoom, scroll: document.getElementById('d2-timeline-scroll-container').scrollLeft }; })()`)
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.x, y: bounds.y })
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.x, y: bounds.y, button: 'left', buttons: 1, clickCount: 1 })
          for (let step = 1; step <= 12; step++) await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: bounds.x + step * 3, y: bounds.y, button: 'left', buttons: 1,
          })
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.x + 36, y: bounds.y, button: 'left', buttons: 0, clickCount: 1 })
          await wait(150)
          const time = await js(`window.__D2_PREVIEW_STORE__.getState().currentTime`)
          const expected = label === 'Timeline ruler' ? (bounds.x + 36 - bounds.left + bounds.scroll) / bounds.zoom : 3 + 36 / bounds.zoom
          assert.ok(Math.abs(time - expected) < 1e-6, label + ' Chromium mouse drag failed')
        }
        window.webContents.debugger.detach()
        fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
        fs.writeFileSync(path.join(artifacts, 'timeline-scrub.png'), (await window.webContents.capturePage()).toPNG())
        console.log(JSON.stringify(results, null, 2))
        console.log('Timeline scrub artifacts:', artifacts)
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
