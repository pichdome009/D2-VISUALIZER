import { AudioDecoder } from './AudioDecoder'
import { FrequencyExtractor, AudioFrameData } from './FrequencyExtractor'
import { WaveformGenerator, WaveformData } from './WaveformGenerator'
import { AudioMetadata } from './AudioMetadata'

export type AudioEngineStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error'

export interface AudioEngineListener {
  onTimeUpdate?: (currentTime: number, duration: number) => void
  onStatusChange?: (status: AudioEngineStatus) => void
  onError?: (error: string) => void
}

export class AudioEngine {
  private static instance: AudioEngine | null = null

  private audioCtx: AudioContext
  private audioElement: HTMLAudioElement
  private sourceNode: MediaElementAudioSourceNode | null = null
  private gainNode: GainNode
  private analyserNode: AnalyserNode
  private extractor: FrequencyExtractor
  private liveFrame: AudioFrameData | null = null
  private liveFrameTimestamp: number | null = null

  // Active audio metadata & buffer
  private currentMetadata: AudioMetadata | null = null
  private currentBuffer: AudioBuffer | null = null
  private currentWaveform: WaveformData | null = null

  // State
  private status: AudioEngineStatus = 'idle'
  private isMuted: boolean = false
  private previousVolume: number = 0.85
  private listeners = new Set<AudioEngineListener>()

  // Synthesizer demo source (if playing built-in demo)
  private isDemoMode: boolean = false
  private demoInterval: number | null = null
  private demoCurrentTime: number = 0
  private readonly demoDuration: number = 198.0

  private constructor() {
    this.audioCtx = AudioDecoder.getContext()

    // 1. Create HTMLAudioElement for high-performance audio streaming
    this.audioElement = new Audio()
    this.audioElement.crossOrigin = 'anonymous'
    this.audioElement.preload = 'auto'

    // 2. Create Gain and Analyser nodes
    this.gainNode = this.audioCtx.createGain()
    this.gainNode.gain.value = 0.85

    this.analyserNode = this.audioCtx.createAnalyser()
    this.analyserNode.fftSize = 2048
    this.analyserNode.smoothingTimeConstant = 0.4

    // Connect Gain -> Analyser -> Speakers
    this.gainNode.connect(this.analyserNode)
    this.analyserNode.connect(this.audioCtx.destination)

    // Connect AudioElement to Web Audio pipeline
    try {
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement)
      this.sourceNode.connect(this.gainNode)
    } catch (err) {
      console.warn('[AUDIO ENGINE] createMediaElementSource warning:', err)
    }

    // 3. Initialize FrequencyExtractor
    this.extractor = new FrequencyExtractor(
      this.analyserNode,
      this.audioCtx.sampleRate,
      { fftSize: 2048, sensitivity: 1.0, smoothing: 0.8 }
    )

    this.setupAudioElementEvents()
  }

  public static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine()
    }
    return AudioEngine.instance
  }

  private setupAudioElementEvents(): void {
    this.audioElement.addEventListener('timeupdate', () => {
      this.notifyTimeUpdate()
    })

    this.audioElement.addEventListener('play', () => {
      this.setStatus('playing')
    })

    this.audioElement.addEventListener('pause', () => {
      if (this.status !== 'idle') {
        this.setStatus('paused')
      }
    })

    this.audioElement.addEventListener('ended', () => {
      if (!this.audioElement.loop) {
        this.setStatus('paused')
        this.notifyTimeUpdate()
      }
    })

    this.audioElement.addEventListener('error', (e) => {
      // Ignore errors when no source is assigned or during demo synthesis mode
      if (!this.audioElement.src || this.isDemoMode || !this.currentBuffer) return
      const err = this.audioElement.error
      const message = err ? `Audio playback error: code ${err.code}` : 'Failed to load audio'
      console.warn('[AUDIO ENGINE]', message, e)
      this.setStatus('error')
      this.notifyError(message)
    })
  }

  /**
   * Loads an audio file from a Blob, File, or local URL
   */
  public async loadAudioFile(
    fileOrUrl: File | string,
    metadata?: Partial<AudioMetadata>,
    rawBuffer?: Uint8Array
  ): Promise<void> {
    this.stopSynthesizerDemo()
    this.isDemoMode = false
    this.stop()
    this.setStatus('loading')

    try {
      let buffer: ArrayBuffer

      if (typeof fileOrUrl === 'string') {
        if (rawBuffer) {
          const copy = new Uint8Array(new ArrayBuffer(rawBuffer.byteLength))
          copy.set(rawBuffer)
          buffer = copy.buffer
        } else {
          const resp = await fetch(fileOrUrl)
          buffer = await resp.arrayBuffer()
        }
      } else {
        buffer = await fileOrUrl.arrayBuffer()
      }

      // Decode into AudioBuffer for waveform generation and duration verification
      const decodedBuffer = await AudioDecoder.decodeBuffer(buffer)
      this.currentBuffer = decodedBuffer

      // Create native high-performance Blob URL for <audio> element
      const fileName = metadata?.name || (typeof fileOrUrl === 'string' ? fileOrUrl : fileOrUrl.name)
      const ext = fileName.split('.').pop()?.toLowerCase() || 'wav'
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        flac: 'audio/flac',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
      }
      const mime = mimeMap[ext] || 'audio/wav'
      const blob = new Blob([buffer], { type: mime })
      const objectUrl = URL.createObjectURL(blob)

      // Generate accurate real waveform
      const waveform = WaveformGenerator.generateWaveform(
        decodedBuffer,
        800,
        metadata?.id || (typeof fileOrUrl === 'string' ? fileOrUrl : fileOrUrl.name)
      )
      this.currentWaveform = waveform

      // Setup audio element source and await initial buffer readiness
      this.audioElement.src = objectUrl
      await new Promise<void>((resolve) => {
        let resolved = false
        const done = () => {
          if (!resolved) {
            resolved = true
            this.audioElement.removeEventListener('canplay', done)
            resolve()
          }
        }
        this.audioElement.addEventListener('canplay', done)
        this.audioElement.load()
        setTimeout(done, 500)
      })

      // Populate metadata
      this.currentMetadata = {
        id: metadata?.id || String(Date.now()),
        name: fileName,
        filePath: metadata?.filePath || (typeof fileOrUrl === 'string' ? fileOrUrl : undefined),
        duration: decodedBuffer.duration,
        fileSize: metadata?.fileSize || buffer.byteLength,
        sampleRate: decodedBuffer.sampleRate,
        channels: decodedBuffer.numberOfChannels,
        format: fileName.split('.').pop()?.toUpperCase() || 'AUDIO',
      }

      this.setStatus('ready')
      this.notifyTimeUpdate()
    } catch (err) {
      console.error('[AUDIO ENGINE] Load failed:', err)
      this.setStatus('error')
      this.notifyError(String(err))
      throw err
    }
  }

  /**
   * Transport controls
   */
  public async play(): Promise<void> {
    if (this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume()
      } catch (err) {
        console.warn('[AUDIO ENGINE] AudioContext resume error:', err)
      }
    }

    // If no real audio buffer has been decoded and loaded, run or resume synthesizer demo
    if (!this.currentBuffer) {
      this.startSynthesizerDemo()
      return
    }

    // Stop demo synthesizer if active before playing real audio
    if (this.isDemoMode) {
      this.stopSynthesizerDemo()
    }

    try {
      await this.audioElement.play()
      this.setStatus('playing')
    } catch (err: unknown) {
      const domErr = err as { name?: string; message?: string }
      // AbortError is a standard browser race condition when play is rapidly interrupted by pause
      if (domErr?.name === 'AbortError') {
        return
      }
      console.warn('[AUDIO ENGINE] Play failed:', domErr?.name || 'Error', domErr?.message || err)
      this.setStatus('paused')
    }
  }

  public pause(): void {
    if (this.isDemoMode) {
      this.stopSynthesizerDemo()
    }
    if (this.currentBuffer) {
      this.audioElement.pause()
    }
    this.setStatus('paused')
  }

  public stop(): void {
    if (this.isDemoMode) {
      this.stopSynthesizerDemo()
    }
    this.demoCurrentTime = 0
    if (this.currentBuffer) {
      this.audioElement.pause()
      this.audioElement.currentTime = 0
    }
    this.extractor.reset()
    this.setStatus('paused')
    this.notifyTimeUpdate()
  }

  public seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return
    const target = Math.max(0, Math.min(this.getDuration(), seconds))
    if (this.currentBuffer) {
      this.audioElement.currentTime = target
    } else {
      this.demoCurrentTime = target
    }
    this.notifyTimeUpdate()
  }

  public getIsSeeking(): boolean {
    return !!this.currentBuffer && this.audioElement.seeking
  }

  public setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume))
    this.gainNode.gain.setValueAtTime(v, this.audioCtx.currentTime)
    this.audioElement.volume = v
  }

  public getVolume(): number {
    return this.gainNode.gain.value
  }

  public toggleMute(): boolean {
    if (this.isMuted) {
      this.setVolume(this.previousVolume)
      this.isMuted = false
    } else {
      this.previousVolume = this.getVolume()
      this.setVolume(0)
      this.isMuted = true
    }
    return this.isMuted
  }

  public setLoop(loop: boolean): void {
    this.audioElement.loop = loop
  }

  public getCurrentTime(): number {
    if (this.currentBuffer) {
      return this.audioElement.currentTime
    }
    return this.demoCurrentTime
  }

  public getDuration(): number {
    if (this.currentMetadata?.duration) return this.currentMetadata.duration
    if (this.currentBuffer && !isNaN(this.audioElement.duration) && this.audioElement.duration > 0) {
      return this.audioElement.duration
    }
    return this.demoDuration
  }

  public getStatus(): AudioEngineStatus {
    return this.status
  }

  public getMetadata(): AudioMetadata | null {
    return this.currentMetadata
  }

  public getAudioBuffer(): AudioBuffer | null {
    return this.currentBuffer
  }

  public getWaveform(): WaveformData | null {
    return this.currentWaveform
  }

  public getFrequencyExtractor(): FrequencyExtractor {
    return this.extractor
  }

  public getLiveFrameData(frameTimestamp?: number): AudioFrameData {
    // All scheduled consumers share one FFT sample and one smoothing update per frame.
    if (frameTimestamp !== undefined && this.liveFrame && this.liveFrameTimestamp === frameTimestamp) {
      return this.liveFrame
    }
    this.liveFrame = this.extractor.getFrameData()
    this.liveFrameTimestamp = frameTimestamp ?? null
    return this.liveFrame
  }

  public getSampleRate(): number {
    return this.audioCtx.sampleRate
  }

  public getFftSize(): number {
    return this.analyserNode.fftSize
  }

  public setFftSize(fftSize: number): void {
    this.analyserNode.fftSize = fftSize
  }

  /**
   * Synthesizer Demo: generates real audio frequencies through the Web Audio API
   * for immediate live testing and visualizer reaction before importing external files.
   * Seamlessly advances the playhead and syncs with the project timeline.
   */
  public startSynthesizerDemo(): void {
    if (this.isDemoMode && this.status === 'playing') return
    this.isDemoMode = true
    this.setStatus('playing')

    const bpm = 128
    const intervalTime = (60 / bpm / 4) * 1000 // 16th notes (~117ms)
    let step = Math.floor(this.demoCurrentTime / (60 / bpm / 4))

    if (this.demoInterval !== null) {
      clearInterval(this.demoInterval)
    }

    const stepSeconds = intervalTime / 1000

    this.demoInterval = window.setInterval(() => {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {})
      }
      const now = this.audioCtx.currentTime

      // 1. Kick drum every quarter note
      if (step % 4 === 0) {
        try {
          const osc = this.audioCtx.createOscillator()
          const kickGain = this.audioCtx.createGain()
          osc.frequency.setValueAtTime(145, now)
          osc.frequency.exponentialRampToValueAtTime(36, now + 0.14)
          kickGain.gain.setValueAtTime(0.95, now)
          kickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.17)

          osc.connect(kickGain)
          kickGain.connect(this.gainNode)
          osc.start(now)
          osc.stop(now + 0.18)
        } catch {
          // ignore closed context
        }
      }

      // 2. Hi-hat on offbeats
      if (step % 2 === 1) {
        try {
          const osc = this.audioCtx.createOscillator()
          const hatGain = this.audioCtx.createGain()
          osc.type = 'triangle'
          osc.frequency.setValueAtTime(7500, now)
          hatGain.gain.setValueAtTime(0.12, now)
          hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)

          osc.connect(hatGain)
          hatGain.connect(this.gainNode)
          osc.start(now)
          osc.stop(now + 0.05)
        } catch {
          // ignore
        }
      }

      // 3. Synth Chord Pad
      if (step % 8 === 0) {
        try {
          const chordNotes = [220, 277.18, 329.63, 440] // A Minor
          chordNotes.forEach((freq) => {
            const osc = this.audioCtx.createOscillator()
            const padGain = this.audioCtx.createGain()
            osc.type = 'sawtooth'
            osc.frequency.setValueAtTime(freq, now)
            padGain.gain.setValueAtTime(0.06, now)
            padGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38)

            osc.connect(padGain)
            padGain.connect(this.gainNode)
            osc.start(now)
            osc.stop(now + 0.42)
          })
        } catch {
          // ignore
        }
      }

      // Advance demo clock & notify
      this.demoCurrentTime += stepSeconds
      if (this.demoCurrentTime >= this.demoDuration) {
        if (this.audioElement.loop) {
          this.demoCurrentTime = 0
          step = 0
        } else {
          this.stopSynthesizerDemo()
          this.setStatus('paused')
          this.notifyTimeUpdate()
          return
        }
      }
      step++
      this.notifyTimeUpdate()
    }, intervalTime)
  }

  public stopSynthesizerDemo(): void {
    this.isDemoMode = false
    if (this.demoInterval !== null) {
      clearInterval(this.demoInterval)
      this.demoInterval = null
    }
  }

  // Listener management
  public addListener(listener: AudioEngineListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: AudioEngineStatus): void {
    this.status = status
    this.listeners.forEach((l) => l.onStatusChange?.(status))
  }

  private notifyTimeUpdate(): void {
    const cur = this.getCurrentTime()
    const dur = this.getDuration()
    this.listeners.forEach((l) => l.onTimeUpdate?.(cur, dur))
  }

  private notifyError(err: string): void {
    this.listeners.forEach((l) => l.onError?.(err))
  }

  public dispose(): void {
    this.stop()
    this.audioElement.removeAttribute('src')
    this.audioElement.load()
    this.listeners.clear()
    WaveformGenerator.clearCache()
    if (this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {})
    }
  }
}
