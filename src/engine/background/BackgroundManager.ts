import { BackgroundConfig } from '@/stores/compositionStore'

export interface GradientPreset {
  id: string
  name: string
  c1: string
  c2: string
  c3?: string
  angle?: number
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: 'midnight-blue', name: 'Midnight Blue', c1: '#0a0f1d', c2: '#020617', c3: '#1e1b4b', angle: 135 },
  { id: 'neon-purple', name: 'Neon Purple', c1: '#3b0764', c2: '#18022e', c3: '#4c0519', angle: 140 },
  { id: 'deep-black', name: 'Deep Black', c1: '#090a0f', c2: '#000000', c3: '#0f172a', angle: 180 },
  { id: 'cosmic-violet', name: 'Cosmic Violet', c1: '#2e1065', c2: '#0f051d', c3: '#581c87', angle: 125 },
  { id: 'sunset-orange', name: 'Sunset Orange', c1: '#431407', c2: '#1c0702', c3: '#7c2d12', angle: 135 },
  { id: 'deep-emerald', name: 'Deep Emerald', c1: '#022c22', c2: '#01140e', c3: '#064e3b', angle: 150 },
  { id: 'electric-cyan', name: 'Electric Cyan', c1: '#083344', c2: '#02131a', c3: '#164e63', angle: 135 },
  { id: 'warm-amber', name: 'Warm Amber', c1: '#451a03', c2: '#1a0b02', c3: '#78350f', angle: 145 },
]

export class BackgroundManager {
  private static instance: BackgroundManager | null = null

  // Image cache
  private imageElement: HTMLImageElement | null = null
  private loadedImagePath: string | null = null
  private isImageLoaded: boolean = false

  // Video element for background video playback
  private videoElement: HTMLVideoElement | null = null
  private loadedVideoPath: string | null = null
  private isVideoLoaded: boolean = false
  private isVideoReady: boolean = false

  private constructor() {
    this.setupVideoElement()
  }

  public static getInstance(): BackgroundManager {
    if (!BackgroundManager.instance) {
      BackgroundManager.instance = new BackgroundManager()
    }
    return BackgroundManager.instance
  }

  private setupVideoElement(): void {
    if (typeof document === 'undefined') return
    this.videoElement = document.createElement('video')
    this.videoElement.crossOrigin = 'anonymous'
    this.videoElement.playsInline = true
    this.videoElement.muted = true
    this.videoElement.loop = true
    this.videoElement.autoplay = false
    this.videoElement.preload = 'auto'

    this.videoElement.addEventListener('canplay', () => {
      this.isVideoReady = true
    })

    this.videoElement.addEventListener('error', (e) => {
      console.warn('[BACKGROUND VIDEO ERROR]', e)
      this.isVideoReady = false
    })
  }

  /**
   * Loads an image background from a path or URL
   */
  public async loadImage(src: string): Promise<boolean> {
    if (this.loadedImagePath === src && this.isImageLoaded) return true

    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        this.imageElement = img
        this.loadedImagePath = src
        this.isImageLoaded = true
        resolve(true)
      }
      img.onerror = () => {
        console.error('[BACKGROUND MANAGER] Failed to load image:', src)
        this.isImageLoaded = false
        resolve(false)
      }
      img.src = src
    })
  }

  /**
   * Loads a video background from a path or URL
   */
  public async loadVideo(src: string): Promise<boolean> {
    if (this.loadedVideoPath === src && this.isVideoLoaded && this.videoElement) {
      return true
    }

    if (!this.videoElement) {
      this.setupVideoElement()
    }

    const video = this.videoElement!
    this.isVideoReady = false
    this.loadedVideoPath = src
    video.src = src
    video.load()

    return new Promise((resolve) => {
      const onCanPlay = () => {
        this.isVideoLoaded = true
        this.isVideoReady = true
        video.removeEventListener('canplay', onCanPlay)
        resolve(true)
      }

      video.addEventListener('canplay', onCanPlay)
      setTimeout(() => {
        // Resolve after 1s even if canplay didn't fire to not block UI
        resolve(this.isVideoReady)
      }, 1500)
    })
  }

  /**
   * Synchronizes background video playback state and time with the main project audio timeline
   */
  public syncVideoPlayback(config: BackgroundConfig, audioTime: number, isPlaying: boolean): void {
    const video = this.videoElement
    if (!video || !this.isVideoLoaded || config.type !== 'video') return

    // Volume & Mute
    video.muted = config.videoMuted
    video.volume = config.videoMuted ? 0 : config.videoVolume
    video.playbackRate = config.playbackSpeed || 1.0
    video.loop = config.loop

    if (!video.duration || isNaN(video.duration)) return

    // Calculate target time with loop and optional trim
    const trimStart = config.trimStart || 0
    const trimEnd = config.trimEnd > trimStart ? config.trimEnd : video.duration
    const durationRange = Math.max(0.1, trimEnd - trimStart)
    const targetVideoTime = trimStart + (audioTime % durationRange)

    // Synchronize play / pause
    if (isPlaying && video.paused) {
      video.play().catch(() => {})
    } else if (!isPlaying && !video.paused) {
      video.pause()
    }

    // Drift correction: if drift exceeds 100ms, align video currentTime to audio timeline
    if (!video.seeking && Math.abs(video.currentTime - targetVideoTime) > 0.1) {
      video.currentTime = targetVideoTime
    }
  }

  /**
   * Deterministic frame-accurate video seek for offline rendering
   */
  public async seekVideoExact(config: BackgroundConfig, audioTime: number): Promise<void> {
    const video = this.videoElement
    if (!video || !this.isVideoLoaded || config.type !== 'video' || !video.duration) return

    const trimStart = config.trimStart || 0
    const trimEnd = config.trimEnd > trimStart ? config.trimEnd : video.duration
    const durationRange = Math.max(0.1, trimEnd - trimStart)
    const targetVideoTime = trimStart + (audioTime % durationRange)

    if (Math.abs(video.currentTime - targetVideoTime) < 0.02) return

    await new Promise<void>((resolve) => {
      let resolved = false
      const onSeeked = () => {
        if (!resolved) {
          resolved = true
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
      }
      video.addEventListener('seeked', onSeeked)
      video.currentTime = targetVideoTime
      setTimeout(onSeeked, 80)
    })
  }

  /**
   * Renders the configured background to the given canvas context
   */
  public render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    config: BackgroundConfig,
    _timestamp: number
  ): void {
    ctx.save()

    // 1. Solid Color
    if (config.type === 'color') {
      ctx.fillStyle = config.color1
      ctx.fillRect(0, 0, width, height)
      ctx.restore()
      return
    }

    // 2. Gradient Background
    if (config.type === 'gradient') {
      if (config.gradientType === 'radial') {
        const cx = width / 2
        const cy = height / 2
        const maxRadius = Math.max(width, height) * 0.75
        const radGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxRadius)
        radGrad.addColorStop(0, config.color1)
        if (config.color3) radGrad.addColorStop(0.5, config.color3)
        radGrad.addColorStop(1, config.color2)
        ctx.fillStyle = radGrad
      } else {
        // Linear Gradient with angle
        const rad = (config.gradientAngle * Math.PI) / 180
        const halfLen = Math.max(width, height) * 0.6
        const x1 = width / 2 - Math.cos(rad) * halfLen
        const y1 = height / 2 - Math.sin(rad) * halfLen
        const x2 = width / 2 + Math.cos(rad) * halfLen
        const y2 = height / 2 + Math.sin(rad) * halfLen

        const linGrad = ctx.createLinearGradient(x1, y1, x2, y2)
        linGrad.addColorStop(0, config.color1)
        if (config.color3) linGrad.addColorStop(0.5, config.color3)
        linGrad.addColorStop(1, config.color2)
        ctx.fillStyle = linGrad
      }
      ctx.fillRect(0, 0, width, height)
      ctx.restore()
      return
    }

    // 3. Image or Video Media Layer
    const source: CanvasImageSource | null =
      config.type === 'image' && this.isImageLoaded
        ? this.imageElement
        : config.type === 'video' && this.videoElement && this.videoElement.readyState >= 2
        ? this.videoElement
        : null

    if (source) {
      // Clear background with base color first
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)

      // Apply CSS-like filter string (brightness, contrast, blur, saturation)
      const filterParts: string[] = []
      if (config.blur > 0) filterParts.push(`blur(${config.blur}px)`)
      if (config.brightness !== 1) filterParts.push(`brightness(${Math.round(config.brightness * 100)}%)`)
      if (config.contrast !== 1) filterParts.push(`contrast(${Math.round(config.contrast * 100)}%)`)
      if (config.saturation !== 1) filterParts.push(`saturate(${Math.round(config.saturation * 100)}%)`)

      if (filterParts.length > 0) {
        ctx.filter = filterParts.join(' ')
      }

      ctx.globalAlpha = config.opacity

      // Compute sizing & transformation
      const srcW =
        config.type === 'image' && this.imageElement
          ? this.imageElement.naturalWidth || width
          : this.videoElement
          ? this.videoElement.videoWidth || width
          : width

      const srcH =
        config.type === 'image' && this.imageElement
          ? this.imageElement.naturalHeight || height
          : this.videoElement
          ? this.videoElement.videoHeight || height
          : height

      this.drawTransformedMedia(ctx, source, srcW, srcH, width, height, config)
    } else {
      // Media not yet loaded or missing: fallback dark gradient
      const fallbackGrad = ctx.createLinearGradient(0, 0, width, height)
      fallbackGrad.addColorStop(0, '#0f172a')
      fallbackGrad.addColorStop(1, '#020617')
      ctx.fillStyle = fallbackGrad
      ctx.fillRect(0, 0, width, height)
    }

    ctx.restore()
  }

  private drawTransformedMedia(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    destW: number,
    destH: number,
    config: BackgroundConfig
  ): void {
    ctx.save()

    const centerX = destW / 2 + (config.positionX / 100) * destW
    const centerY = destH / 2 + (config.positionY / 100) * destH

    ctx.translate(centerX, centerY)
    ctx.scale(config.scale, config.scale)
    ctx.rotate((config.rotation * Math.PI) / 180)

    let drawW = destW
    let drawH = destH

    const srcAspect = srcW / (srcH || 1)
    const destAspect = destW / (destH || 1)

    switch (config.sizing) {
      case 'fit':
        if (srcAspect > destAspect) {
          drawW = destW
          drawH = destW / srcAspect
        } else {
          drawH = destH
          drawW = destH * srcAspect
        }
        break
      case 'stretch':
        drawW = destW
        drawH = destH
        break
      case 'crop':
      case 'fill':
      default:
        if (srcAspect > destAspect) {
          drawH = destH
          drawW = destH * srcAspect
        } else {
          drawW = destW
          drawH = destW / srcAspect
        }
        break
    }

    ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()
  }

  public dispose(): void {
    if (this.videoElement) {
      this.videoElement.pause()
      this.videoElement.src = ''
      this.videoElement.load()
      this.videoElement = null
    }
    this.imageElement = null
    this.isImageLoaded = false
    this.isVideoLoaded = false
    this.isVideoReady = false
  }
}
