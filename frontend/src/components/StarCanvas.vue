<template>
  <div ref="wrapRef" class="w-full h-full relative">
    <!-- 容器尺寸取不到或异常时的说明，画布同时退回默认尺寸渲染 -->
    <div v-if="sizeError"
      class="fixed top-0 inset-x-0 z-10 px-4 py-2 bg-amber-500/90 text-black text-xs text-center leading-relaxed">
      星图容器尺寸不可用（宽度或高度为 0 / 异常），已暂时按默认尺寸
      {{ DEFAULT_WIDTH }}×{{ DEFAULT_HEIGHT }} 绘制；展开或恢复窗口后将自动适配。
    </div>
    <canvas ref="canvasRef"
      :class="['bg-black cursor-crosshair block', sizeError ? 'fixed top-10 left-2' : 'w-full h-full']"
      :style="sizeError ? { width: DEFAULT_WIDTH + 'px', height: DEFAULT_HEIGHT + 'px' } : undefined"
      @click="onClick" @wheel.prevent="onWheel" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSkyStore } from '../store/sky'
import { STARS, CONSTELLATIONS } from '../data/stars'
import type { Star } from '../types'

const store = useSkyStore()
const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// ---- 统一口径：默认尺寸 / 像素密度上限 / 标签字号上限 --------------------
const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 600
const MAX_DPR = 4 // 防止超大屏物理像素撑爆显存
const STAR_FONT_BASE = 10 // CSS px @ zoom=1
const STAR_FONT_MAX = 14
const CONST_FONT_BASE = 12
const CONST_FONT_MAX = 16
// 字号触顶后只保留这些最亮的关键星名（mag < 1.5）
const KEY_STAR_MAG = 1.5
const LABEL_MAG_LIMIT = 2.5
const PICK_RADIUS = 20 // CSS px

let animId = 0
let dprQuery: MediaQueryList | null = null
let lastCanvasW = 0
let lastCanvasH = 0
let lastDpr = 0

function devicePixelRatio(): number {
  const dpr = window.devicePixelRatio
  if (!Number.isFinite(dpr) || dpr <= 0) return 1
  return Math.min(dpr, MAX_DPR)
}

// 返回当前 CSS 像素绘制尺寸；容器异常时退回默认尺寸并给出页面说明
function measureSize(): { w: number; h: number; error: boolean } {
  const el = wrapRef.value
  if (!el) return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, error: true }
  const rect = el.getBoundingClientRect()
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT, error: true }
  }
  return { w, h, error: false }
}

// 按屏幕实际像素密度重建画布 backing store，并把绘制坐标系统一为 CSS 像素
function syncCanvas(cssW: number, cssH: number, dpr: number) {
  const canvas = canvasRef.value!
  const physicalW = Math.round(cssW * dpr)
  const physicalH = Math.round(cssH * dpr)
  if (physicalW !== lastCanvasW || physicalH !== lastCanvasH || dpr !== lastDpr) {
    canvas.width = physicalW
    canvas.height = physicalH
    lastCanvasW = physicalW
    lastCanvasH = physicalH
    lastDpr = dpr
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

interface PlacedLabel { x: number; y: number; w: number; h: number }

function overlap(a: PlacedLabel, b: PlacedLabel, pad = 2): boolean {
  return !(a.x - pad > b.x + b.w || a.x + a.w + pad < b.x ||
           a.y - pad > b.y + b.h || a.y + a.h + pad < b.y)
}

function draw() {
  animId = requestAnimationFrame(draw)
  const canvas = canvasRef.value
  if (!canvas) return

  const { w, h, error } = measureSize()
  sizeError.value = error
  const dpr = devicePixelRatio()
  syncCanvas(w, h, dpr)

  const ctx = canvas.getContext('2d')!
  const cx = w / 2, cy = h / 2
  const scale = Math.min(w, h) * store.zoom

  // background
  ctx.fillStyle = '#000814'
  ctx.fillRect(0, 0, w, h)

  // random background stars
  const rng = (seed: number) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 } }
  const r = rng(42)
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(255,255,255,${r() * 0.4})`
    ctx.beginPath()
    ctx.arc(r() * w, r() * h, r() * 1.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // grid
  if (store.showGrid) {
    ctx.strokeStyle = 'rgba(100,100,200,0.15)'
    ctx.lineWidth = 1
    for (let dec = -60; dec <= 60; dec += 30) {
      ctx.beginPath()
      for (let ra = 0; ra <= 24; ra += 0.5) {
        const [x, y] = store.projectStar(ra, dec, cx, cy, scale)
        if (x < -500) continue
        ra === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    for (let ra = 0; ra < 24; ra += 2) {
      ctx.beginPath()
      for (let dec = -90; dec <= 90; dec += 5) {
        const [x, y] = store.projectStar(ra, dec, cx, cy, scale)
        if (x < -500) continue
        dec === -90 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  // constellation lines
  if (store.showConstLines) {
    ctx.strokeStyle = 'rgba(100,180,255,0.4)'
    ctx.lineWidth = 1.5
    for (const c of CONSTELLATIONS) {
      for (const [i, j] of c.lines) {
        const s1 = STARS[i], s2 = STARS[j]
        const [x1, y1] = store.projectStar(s1.ra, s1.dec, cx, cy, scale)
        const [x2, y2] = store.projectStar(s2.ra, s2.dec, cx, cy, scale)
        if (x1 < -500 || x2 < -500) continue
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }
    }
  }

  // stars：先算投影，星体本体先画，标签收集后统一处理（亮星优先）
  interface PlottedStar { star: Star; x: number; y: number; radius: number; color: string }
  const plotted: PlottedStar[] = []
  for (const star of STARS) {
    const [x, y] = store.projectStar(star.ra, star.dec, cx, cy, scale)
    if (x < -500 || x > w + 500 || y < -500 || y > h + 500) continue
    const radius = store.starRadius(star.mag)
    const color = store.spectralColor(star.spectral)

    // glow
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 3)
    gradient.addColorStop(0, color)
    gradient.addColorStop(1, 'transparent')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, radius * 3, 0, Math.PI * 2)
    ctx.fill()

    // core
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()

    plotted.push({ star, x, y, radius, color })
  }

  // 标签：字号随缩放在上限内放大；触顶后收敛成关键星名；再做重叠剔除
  const placed: PlacedLabel[] = []
  if (store.showLabels) {
    const starFontSize = Math.min(STAR_FONT_BASE * store.zoom, STAR_FONT_MAX)
    const capped = STAR_FONT_BASE * store.zoom > STAR_FONT_MAX
    const candidates = plotted
      .filter(p => p.star.mag < LABEL_MAG_LIMIT && (!capped || p.star.mag < KEY_STAR_MAG))
      .sort((a, b) => a.star.mag - b.star.mag)

    ctx.textBaseline = 'alphabetic'
    ctx.font = `${starFontSize}px system-ui`
    ctx.fillStyle = 'rgba(200,200,255,0.7)'
    for (const p of candidates) {
      const box: PlacedLabel = {
        x: p.x + p.radius + 4,
        y: p.y - starFontSize / 2,
        w: ctx.measureText(p.star.name).width,
        h: starFontSize
      }
      if (placed.some(q => overlap(box, q))) continue
      placed.push(box)
      ctx.fillText(p.star.name, box.x, box.y + box.h * 0.85)
    }
  }

  // horizon：与星体同一投影口径（等价于高度角 0 的点），cx/cy/scale/pan 完全一致
  ctx.strokeStyle = 'rgba(0,200,100,0.3)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let az = 0; az <= 360; az += 5) {
    const azRad = az * Math.PI / 180
    const r = (Math.PI / 2) * scale * 0.45
    const x = cx + store.panX + r * Math.sin(azRad)
    const y = cy + store.panY - r * Math.cos(azRad)
    az === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()

  // constellation labels：同样设字号上限，并避免与星名或彼此重叠
  if (store.showLabels) {
    const constFontSize = Math.min(CONST_FONT_BASE * store.zoom, CONST_FONT_MAX)
    ctx.font = `bold ${constFontSize}px system-ui`
    ctx.fillStyle = 'rgba(100,180,255,0.8)'
    ctx.textBaseline = 'alphabetic'
    for (const c of CONSTELLATIONS) {
      const midStar = STARS[c.stars[0]]
      const [x, y] = store.projectStar(midStar.ra, midStar.dec, cx, cy, scale)
      if (x < -500 || x > w + 200 || y < -200 || y > h + 200) continue
      const textW = ctx.measureText(c.nameCn).width
      const box: PlacedLabel = {
        x: x - textW / 2,
        y: y - constFontSize - 4,
        w: textW,
        h: constFontSize
      }
      if (placed.some(q => overlap(box, q))) continue
      placed.push(box)
      ctx.fillText(c.nameCn, box.x, box.y + box.h * 0.85)
    }
  }
}

function onClick(e: MouseEvent) {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  // 统一在 CSS 像素坐标系拾取，与 projectStar 的 cx/cy/scale 同口径
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const { w, h } = measureSize()
  const cx = w / 2, cy = h / 2
  const scale = Math.min(w, h) * store.zoom

  let closest: Star | null = null
  let minDist = PICK_RADIUS
  for (const star of STARS) {
    const [sx, sy] = store.projectStar(star.ra, star.dec, cx, cy, scale)
    const dist = Math.hypot(sx - x, sy - y)
    if (dist < minDist) { minDist = dist; closest = star }
  }
  store.selectedStar = closest
}

function onWheel(e: WheelEvent) {
  store.zoom = Math.max(0.3, Math.min(3, store.zoom + (e.deltaY > 0 ? -0.1 : 0.1)))
}

const sizeError = ref(false)

function onDprChange() {
  // 密度档位变化时重建监听与画布（下一帧 draw 会按新 dpr 重建 backing store）
  dprQuery?.removeEventListener('change', onDprChange)
  dprQuery = matchMedia(`(resolution: ${devicePixelRatio()}dppx)`)
  dprQuery.addEventListener('change', onDprChange)
}

onMounted(() => {
  window.addEventListener('resize', onDprChange)
  onDprChange()
  draw() // rAF 每帧读取容器尺寸，折叠/展开/跨屏移动都会在下一帧重建画布
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  dprQuery?.removeEventListener('change', onDprChange)
  window.removeEventListener('resize', onDprChange)
})
</script>
