// 绘制口径（单一事实来源）：屏幕密度、画布尺寸、标签样式都在这里统一换算。

export const DEFAULT_VIEWPORT = { width: 960, height: 640 }
export const MAX_DPR = 4

/** 读取屏幕实际像素密度；环境异常时退回 1。 */
export function getDevicePixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1
  if (!Number.isFinite(dpr) || dpr <= 0) return 1
  return Math.min(dpr, MAX_DPR)
}

export interface ResolvedViewport {
  cssWidth: number
  cssHeight: number
  dpr: number
  /** 真实容器尺寸不可用时为 true，画布退回默认尺寸 */
  fallback: boolean
  /** 退回默认尺寸时给出的页面说明 */
  reason?: string
}

/**
 * 解析容器尺寸：取不到、为零或异常时退回默认尺寸并给出原因。
 * 屏幕实际像素密度由调用方通过 dpr 传入，这里只负责 CSS 尺寸。
 */
export function resolveViewport(el: HTMLElement | null, dpr: number): ResolvedViewport {
  const fallbackView = (reason: string): ResolvedViewport => ({
    cssWidth: DEFAULT_VIEWPORT.width,
    cssHeight: DEFAULT_VIEWPORT.height,
    dpr, fallback: true, reason,
  })

  if (!el) {
    return fallbackView('画布容器未就绪')
  }
  const width = el.clientWidth
  const height = el.clientHeight
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return fallbackView('画布容器尺寸异常（非数值），已退回默认尺寸')
  }
  if (width === 0 || height === 0) {
    return fallbackView('画布容器已折叠或宽度为零，当前以默认尺寸 960×640 渲染')
  }
  if (width < 2 || height < 2) {
    return fallbackView('画布容器尺寸过小，已退回默认尺寸')
  }
  return { cssWidth: width, cssHeight: height, dpr, fallback: false }
}

// ---- 标签口径：字号设上限；缩放继续放大时收敛成关键星名 ----

const STAR_LABEL_BASE_PX = 11
const STAR_LABEL_MAX_PX = 15
const CONST_LABEL_BASE_PX = 13
const CONST_LABEL_MAX_PX = 17
/** 基础缩放：zoom 超过它之后字号不再变大，标签开始收敛 */
export const LABEL_ZOOM_CAP = 1.5
/** 常规缩放：只标亮于该星等的星 */
export const STAR_LABEL_MAG = 2.5
/** 收敛后：只标关键（最亮）星名 */
export const KEY_STAR_LABEL_MAG = 1.5

/** 星名标签的字号与收敛状态。 */
export function starLabelStyle(zoom: number): { fontPx: number; collapsed: boolean } {
  const grow = Math.min(zoom, LABEL_ZOOM_CAP)
  return {
    fontPx: Math.min(STAR_LABEL_BASE_PX * grow, STAR_LABEL_MAX_PX),
    collapsed: zoom > LABEL_ZOOM_CAP,
  }
}

export function constellationLabelStyle(zoom: number): { fontPx: number; collapsed: boolean } {
  const grow = Math.min(zoom, LABEL_ZOOM_CAP)
  return {
    fontPx: Math.min(CONST_LABEL_BASE_PX * grow, CONST_LABEL_MAX_PX),
    collapsed: zoom > LABEL_ZOOM_CAP,
  }
}

/** 该星在当前缩放口径下是否显示名字。 */
export function shouldLabelStar(mag: number, zoom: number): boolean {
  const { collapsed } = starLabelStyle(zoom)
  return mag < (collapsed ? KEY_STAR_LABEL_MAG : STAR_LABEL_MAG)
}
