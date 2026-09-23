<template>
  <canvas ref="canvasRef" class="block w-full h-full bg-black cursor-crosshair"
    :class="{ 'outline outline-1 outline-amber-500/60': fallback }"
    @click="onClick" @wheel.prevent="onWheel" />
  <!-- 容器尺寸取不到或异常时的页面说明（fixed 定位，容器折叠为零时仍可见） -->
  <div v-if="fallback"
    class="fixed left-1/2 bottom-6 -translate-x-1/2 z-50 max-w-md px-4 py-3 rounded-lg bg-amber-500/95 text-black text-sm shadow-lg">
    <p class="font-bold">星图画布尺寸异常</p>
    <p class="mt-1">{{ fallbackReason }}。请恢复容器宽度后自动重建。</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useSkyStore } from '../store/sky'
import {
  resolveViewport, getDevicePixelRatio,
  shouldLabelStar, starLabelStyle, constellationLabelStyle,
  DEFAULT_VIEWPORT, MAX_DPR,
} from '../render/viewport'

const store = useSkyStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
let animId = 0

// 当前生效的绘制口径：CSS 尺寸 + 屏幕实际像素密度
let cssWidth = DEFAULT_VIEWPORT.width
let cssHeight = DEFAULT_VIEWPORT.height
let dpr = 1
let ctx: CanvasRenderingContext2D | null = null

// 容器异常状态
const fallback = ref(false)
const fallbackReason = ref('')

let resizeObserver: ResizeObserver | null = null
const dprQueries: MediaQueryList[] = []

/**
 * 重建画布：按屏幕实际像素密度换算 backing store，
 * 容器尺寸取不到或异常时在页面说明并退回默认尺寸。
 * 切换缩放与屏幕密度后都会走到这里。
 */
function rebuild() {
  const canvas = canvasRef.value
  if (!canvas) return
  dpr = getDevicePixelRatio()
  const vp = resolveViewport(canvas.parentElement, dpr)

  fallback.value = vp.fallback
  fallbackReason.value = vp.reason ?? ''
  cssWidth = vp.cssWidth
  cssHeight = vp.cssHeight

  // backing store 按实际像素密度换算；CSS 尺寸保持一致，后续绘制统一用 CSS 像素
  const pixelWidth = Math.round(cssWidth * dpr)
  const pixelHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight

  if (vp.fallback) {
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
  } else {
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }

  ctx = canvas.getContext('2d')
  if (ctx) {
    // 统一口径：所有绘制坐标（含星点、标签、地平线）都是 CSS 像素
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}

function draw() {
  animId = requestAnimationFrame(draw)
  const canvas = canvasRef.value
  if (!canvas || !ctx) return

  const w = cssWidth, h = cssHeight
  const cx = w / 2, cy = h / 2
  const scale = Math.min(w, h) * store.zoom

  // background
  ctx.fillStyle = '#000814'
  ctx.fillRect(0, 0, w, h)

  // random background stars（数量跟随 CSS 面积，半径按 CSS 像素给出，由密度变换保证清晰）
  const rng = (seed: number) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 } }
  const r = rng(42)
  const bgCount = Math.min(600, Math.round((w * h) / 3000))
  for (let i = 0; i < bgCount; i++) {
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
    for (const c of store.CONSTELLATIONS) {
      for (const [i, j] of c.lines) {
        const s1 = store.STARS[i], s2 = store.STARS[j]
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

  // 标签口径（与缩放、密度同源）：字号有上限，超出后只保留关键星名
  const starLabel = starLabelStyle(store.zoom)
  const constLabel = constellationLabelStyle(store.zoom)

  // stars
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const star of store.STARS) {
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

    // label：字号封顶，高密度/高缩放收敛成关键星名，避免互相压住
    if (store.showLabels && shouldLabelStar(star.mag, store.zoom)) {
      ctx.fillStyle = 'rgba(200,200,255,0.75)'
      ctx.font = `${starLabel.fontPx}px system-ui`
      ctx.fillText(star.name, x + radius + 4, y)
    }
  }

  // horizon：高度角 0 经同一套地平投影换算，和星体严格对齐
  ctx.strokeStyle = 'rgba(0,200,100,0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let az = 0; az <= 360; az += 5) {
    const azRad = az * Math.PI / 180
    const [x, y] = store.projectAltAzToXY(0, azRad, cx, cy, scale)
    az === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()

  // constellation labels：同样设字号上限，高缩放时与星名一起收敛
  if (store.showLabels) {
    ctx.fillStyle = 'rgba(100,180,255,0.8)'
    ctx.font = `bold ${constLabel.fontPx}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const c of store.CONSTELLATIONS) {
      const midStar = store.STARS[c.stars[0]]
      const [x, y] = store.projectStar(midStar.ra, midStar.dec, cx, cy, scale)
      if (x < -500) continue
      ctx.fillText(c.nameCn, x, y - constLabel.fontPx - 4)
    }
  }
}

function onClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  // 统一在 CSS 像素坐标里拾取，和投影口径一致
  const x = (e.clientX - rect.left) * (cssWidth / rect.width)
  const y = (e.clientY - rect.top) * (cssHeight / rect.height)
  const cx = cssWidth / 2, cy = cssHeight / 2
  const scale = Math.min(cssWidth, cssHeight) * store.zoom
  store.selectStar(x, y, cx, cy, scale)
}

function onWheel(e: WheelEvent) {
  store.zoom = Math.max(0.3, Math.min(3, store.zoom + (e.deltaY > 0 ? -0.1 : 0.1)))
}

function onDprChange() {
  if (getDevicePixelRatio() !== dpr) rebuild()
}

onMounted(() => {
  rebuild()
  animId = requestAnimationFrame(draw)

  // 容器尺寸变化（含折叠/恢复、宽度变零）
  resizeObserver = new ResizeObserver(() => rebuild())
  if (canvasRef.value?.parentElement) resizeObserver.observe(canvasRef.value.parentElement)

  // 屏幕实际像素密度变化（跨屏拖动、缩放设置变化）
  for (let q = 1; q < MAX_DPR; q += 0.5) {
    const mql = window.matchMedia(`(resolution: ${q}dppx)`)
    mql.addEventListener('change', onDprChange)
    dprQueries.push(mql)
  }
  window.addEventListener('resize', onDprChange)
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  resizeObserver?.disconnect()
  dprQueries.forEach(mql => mql.removeEventListener('change', onDprChange))
  window.removeEventListener('resize', onDprChange)
})

// 切换缩放后按当前口径重建（尺寸/密度不变时仅重设变换，画面逐帧对齐）
watch(() => store.zoom, () => rebuild())
</script>
