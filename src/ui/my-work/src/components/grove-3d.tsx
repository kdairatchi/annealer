// The Grove, drawn in 3D on a canvas. Drag to turn the tree, pick a branch to bring it round to face you, pick a twig
// to open its request. Branch labels are real buttons pinned to points on the tree, so they ride along as it turns.
//
// There is no 3D library here on purpose: the tree is a few hundred line segments, and the projection is a dozen lines
// in growth/tree-3d.ts. Everything drawn comes from the growth model; the only decoration is the embers, which rise
// from twigs whose request is recorded as working and from nowhere else.
import { useEffect, useMemo, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import { LocateFixedIcon, RotateCcwIcon, RotateCwIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import { interpolate, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { STATE_LABEL } from '@/components/bits'
import { Button } from '@/components/ui/button'
import type { LiveState } from '@/data'
import type { Grove } from '@/growth/growth-model'
import { angleBetween, buildTree3, distanceToSegment, HOME_CAMERA, project, yawFacing, type Camera3, type Vec3 } from '@/growth/tree-3d'

/** The colour token each request state draws in. A new state fails the typecheck here. */
const STATE_TOKEN: Record<LiveState, string> = {
  working: '--working-foreground', 'needs-check': '--review-foreground', 'your-move': '--attention-foreground',
  idle: '--idle-foreground', shipped: '--shipped-foreground',
}

interface Palette { wood: string; accent: string; ground: string; state: Record<LiveState, string> }

function readPalette(element: Element): Palette {
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    wood: token('--foreground', '#888'), accent: token('--primary', '#f60'), ground: token('--card', '#111'),
    state: Object.fromEntries(Object.entries(STATE_TOKEN).map(([state, name]) => [state, token(name, '#888')])) as Record<LiveState, string>,
  }
}

/** What the pointer can land on: a stretch of a branch or twig, in screen pixels, from the last frame drawn. */
interface Hit { branchId: string; requestId: string | null; ax: number; ay: number; bx: number; by: number; reach: number }
interface Ember { at: Vec3; age: number; drift: number }

const OPENING_SECONDS = 1.8
const EMBER_SECONDS = 2.4
const PITCH_LIMITS = [-0.05, 0.8] as const
const ZOOM_LIMITS = [0.7, 2.2] as const
/** Room one pinned label needs, in pixels, before another may sit beside or under it. */
const LABEL_WIDTH = 150
const LABEL_HEIGHT = 30
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function Grove3D({ grove, selectedId, onSelect, onOpenRequest }: {
  grove: Grove
  selectedId: string | null
  /** Called with a branch id, or null when the pointer picks empty space. */
  onSelect: (branchId: string | null) => void
  onOpenRequest: (requestId: string) => void
}) {
  const { t } = useI18n()
  const still = useReducedMotion() ?? false
  const tree = useMemo(() => buildTree3(grove), [grove])
  const twigs = useMemo(() => new Map(grove.branches.flatMap((branch) => branch.twigs.map((twig) => [twig.requestId, twig] as const))), [grove])
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const labels = useRef(new Map<string, HTMLElement>())
  // Everything the frame loop reads lives in one ref, so a new selection or hover never restarts the loop.
  const live = useRef({
    camera: { ...HOME_CAMERA, target: { ...HOME_CAMERA.target } } as Camera3,
    goal: { yaw: HOME_CAMERA.yaw, pitch: HOME_CAMERA.pitch, zoom: 1, targetY: HOME_CAMERA.target.y },
    selectedId, hoverBranch: null as string | null, hoverRequest: null as string | null,
    hits: [] as Hit[], embers: [] as Ember[], touchedAt: 0, bornAt: 0,
    drag: null as null | { x: number; y: number; yaw: number; pitch: number; moved: boolean },
  })

  // A picked branch turns to face the viewer and the camera moves in on it; letting go returns to the whole tree.
  useEffect(() => {
    const state = live.current
    state.selectedId = selectedId
    const pin = tree.pins.find((entry) => entry.branchId === selectedId)
    if (pin) {
      state.goal = { yaw: state.camera.yaw + angleBetween(state.camera.yaw, yawFacing(pin.azimuth)), pitch: 0.24, zoom: 1.35, targetY: pin.middle.y }
    } else {
      state.goal = { ...state.goal, zoom: 1, targetY: HOME_CAMERA.target.y }
    }
  }, [selectedId, tree])

  useEffect(() => {
    const surface = canvas.current
    const holder = wrap.current
    const context = surface?.getContext('2d')
    if (!surface || !holder || !context) return
    const state = live.current
    let palette = readPalette(holder)
    let width = 0
    let height = 0
    const resize = () => {
      const box = holder.getBoundingClientRect()
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      width = box.width
      height = box.height
      surface.width = Math.round(width * ratio)
      surface.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    const resized = new ResizeObserver(resize)
    resized.observe(holder)
    // The theme switch changes the root's attributes; the palette is read again when it does.
    // Wood is painted solid, already mixed toward the ground colour for distance. Painting it see-through instead
    // would show every joint between two pieces of a limb as a darker bead.
    let tones = new Map<string, string>()
    const tone = (colour: string, strength: number) => {
      const percent = Math.round(clamp(strength, 0, 1) * 20) * 5
      const key = `${colour}|${percent}`
      let mixed = tones.get(key)
      if (!mixed) { mixed = `color-mix(in oklab, ${colour} ${percent}%, ${palette.ground})`; tones.set(key, mixed) }
      return mixed
    }
    const themed = new MutationObserver(() => { palette = readPalette(holder); tones = new Map() })
    themed.observe(document.documentElement, { attributes: true })

    let frame = 0
    let last = performance.now()
    state.bornAt = state.bornAt || last
    const workingTips = tree.limbs.filter((limb) => limb.kind === 'twig' && limb.state === 'working').map((limb) => limb.points.at(-1)!)
    let emberDue = 0

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (width === 0 || height === 0) return
      const grown = still ? 1 : clamp((now - state.bornAt) / 1000 / OPENING_SECONDS, 0, 1)
      const { camera, goal } = state

      // Left alone, the tree turns slowly. Any touch, hover or selection stops it.
      const idle = !still && !state.drag && !state.selectedId && !state.hoverBranch && now - state.touchedAt > 2500
      if (idle) goal.yaw += dt * 0.07
      const ease = still ? 1 : Math.min(1, dt * 5)
      camera.yaw += (goal.yaw - camera.yaw) * ease
      camera.pitch += (goal.pitch - camera.pitch) * ease
      camera.zoom += (goal.zoom - camera.zoom) * ease
      camera.target.y += (goal.targetY - camera.target.y) * ease
      const at = (point: Vec3) => project(point, camera, width, height)
      const fog = (depth: number) => 1 - 0.55 * clamp((depth - (camera.distance - 5)) / 10, 0, 1)

      context.clearRect(0, 0, width, height)

      // Ground: a glow under the trunk and three rings, tilted with the camera.
      const foot = at({ x: 0, y: 0, z: 0 })
      const squash = Math.max(0.08, Math.sin(camera.pitch) + 0.1)
      context.save()
      context.translate(foot.x, foot.y)
      context.scale(1, squash)
      const glow = context.createRadialGradient(0, 0, 0, 0, 0, 6 * foot.scale)
      glow.addColorStop(0, palette.accent)
      glow.addColorStop(1, 'transparent')
      context.globalAlpha = 0.3 * grown
      context.fillStyle = glow
      context.beginPath()
      context.arc(0, 0, 6 * foot.scale, 0, Math.PI * 2)
      context.fill()
      context.restore()
      context.lineWidth = 1
      context.strokeStyle = palette.wood
      for (const radius of [2.2, 3.8, 5.4]) {
        context.globalAlpha = 0.13 * grown
        context.beginPath()
        for (let step = 0; step <= 48; step += 1) {
          const turn = (step / 48) * Math.PI * 2
          const point = at({ x: Math.cos(turn) * radius, y: 0, z: Math.sin(turn) * radius })
          if (step === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y)
        }
        context.stroke()
      }

      // Everything else is collected, then painted from the back forward.
      const paint: { depth: number; run: () => void }[] = []
      const hits: Hit[] = []
      const dimmed = (branchId: string | null) => state.selectedId !== null && branchId !== null && branchId !== state.selectedId
      for (const limb of tree.limbs) {
        const reveal = clamp((grown - limb.grows[0]) / limb.grows[1], 0, 1)
        if (reveal <= 0) continue
        const pieces = limb.points.length - 1
        const lit = limb.branchId !== null && (limb.branchId === state.selectedId || limb.branchId === state.hoverBranch)
        const colour = limb.kind === 'twig' ? palette.state[limb.state!] : lit ? palette.accent : palette.wood
        const strength = (limb.kind === 'twig' ? 1 : limb.kind === 'trunk' ? 0.8 : lit ? 1 : 0.62) * (dimmed(limb.branchId) ? 0.22 : 1)
        for (let piece = 0; piece < pieces; piece += 1) {
          const part = clamp(reveal * pieces - piece, 0, 1)
          if (part <= 0) break
          const from = limb.points[piece]
          const full = limb.points[piece + 1]
          const to = part === 1 ? full : { x: from.x + (full.x - from.x) * part, y: from.y + (full.y - from.y) * part, z: from.z + (full.z - from.z) * part }
          const a = at(from)
          const b = at(to)
          const thickness = limb.width[0] + (limb.width[1] - limb.width[0]) * ((piece + 0.5) / pieces)
          const pixels = Math.max(1, thickness * (a.scale + b.scale) / 2) * (limb.requestId !== null && limb.requestId === state.hoverRequest ? 1.8 : 1)
          const depth = (a.depth + b.depth) / 2
          paint.push({ depth, run: () => {
            context.globalAlpha = 1
            context.strokeStyle = tone(colour, strength * fog(depth))
            context.lineWidth = pixels
            context.lineCap = 'round'
            context.setLineDash(limb.dashed ? (limb.kind === 'twig' ? [4, 5] : [2, 9]) : [])
            context.beginPath()
            context.moveTo(a.x, a.y)
            context.lineTo(b.x, b.y)
            context.stroke()
          } })
          if (limb.branchId !== null) hits.push({ branchId: limb.branchId, requestId: limb.requestId, ax: a.x, ay: a.y, bx: b.x, by: b.y, reach: Math.max(limb.kind === 'twig' ? 12 : 9, pixels) })
        }
        if (limb.kind === 'twig' && reveal === 1) {
          const tip = at(limb.points.at(-1)!)
          const pulse = limb.state === 'working' && !still ? 0.55 + 0.45 * Math.sin(now / 260) : 1
          paint.push({ depth: tip.depth - 0.01, run: () => {
            context.setLineDash([])
            context.globalAlpha = pulse * (dimmed(limb.branchId) ? 0.22 : 1) * fog(tip.depth)
            context.fillStyle = colour
            context.beginPath()
            context.arc(tip.x, tip.y, Math.max(2.5, (limb.state === 'shipped' ? 0.12 : 0.09) * tip.scale), 0, Math.PI * 2)
            context.fill()
          } })
        }
      }
      const leafShow = clamp((grown - 0.85) / 0.15, 0, 1)
      if (leafShow > 0) {
        for (const leaf of tree.leaves) {
          const spot = at(leaf.at)
          const size = Math.max(2, 0.11 * spot.scale) * leafShow
          paint.push({ depth: spot.depth, run: () => {
            context.globalAlpha = (dimmed(leaf.branchId) ? 0.2 : 0.9) * fog(spot.depth)
            context.fillStyle = palette.accent
            context.beginPath()
            context.moveTo(spot.x, spot.y - size)
            context.lineTo(spot.x + size, spot.y)
            context.lineTo(spot.x, spot.y + size)
            context.lineTo(spot.x - size, spot.y)
            context.closePath()
            context.fill()
          } })
        }
      }

      // Embers rise only from twigs whose request is recorded as working.
      if (!still && grown === 1 && workingTips.length > 0) {
        emberDue -= dt
        if (emberDue <= 0) {
          emberDue = 0.28 / workingTips.length
          const tip = workingTips[Math.floor((now / 97) % workingTips.length)]
          state.embers.push({ at: { ...tip }, age: 0, drift: now % 6.28 })
        }
      }
      state.embers = state.embers.filter((ember) => ember.age < EMBER_SECONDS)
      for (const ember of state.embers) {
        ember.age += dt
        ember.at.y += dt * 0.85
        ember.at.x += Math.sin(ember.drift + ember.age * 2.2) * dt * 0.22
        ember.at.z += Math.cos(ember.drift + ember.age * 1.7) * dt * 0.22
        const spot = at(ember.at)
        const size = Math.max(1.5, 0.055 * spot.scale)
        paint.push({ depth: spot.depth, run: () => {
          context.globalAlpha = (1 - ember.age / EMBER_SECONDS) * 0.9
          context.fillStyle = palette.accent
          context.fillRect(spot.x - size / 2, spot.y - size / 2, size, size)
        } })
      }

      paint.sort((a, b) => b.depth - a.depth)
      for (const item of paint) item.run()
      context.setLineDash([])
      state.hits = hits

      // Labels follow their pins. The nearest label takes its place first; one that would cover it is lifted clear,
      // and a hairline runs from each label back to its pin. A label on the far side fades behind the near ones.
      const placed: { x: number; y: number }[] = []
      const pins = tree.pins.map((pin) => ({ pin, spot: at(pin.at) })).sort((a, b) => a.spot.depth - b.spot.depth)
      for (const { pin, spot } of pins) {
        const label = labels.current.get(pin.branchId)
        if (!label) continue
        let y = spot.y - 10
        for (let pass = 0; pass < placed.length; pass += 1) {
          const clash = placed.find((other) => Math.abs(other.x - spot.x) < LABEL_WIDTH && Math.abs(other.y - y) < LABEL_HEIGHT)
          if (!clash) break
          y = clash.y - LABEL_HEIGHT
        }
        placed.push({ x: spot.x, y })
        const shown = grown < 0.75 ? 0 : (dimmed(pin.branchId) ? 0.4 : 1) * fog(spot.depth)
        context.globalAlpha = shown * 0.5
        context.strokeStyle = pin.branchId === state.selectedId ? palette.accent : palette.wood
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(spot.x, spot.y + 0.3 * spot.scale)
        context.lineTo(spot.x, y)
        context.stroke()
        label.style.transform = `translate(${spot.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
        label.style.opacity = shown.toFixed(2)
        label.style.zIndex = String(Math.round(2000 - spot.depth * 20))
      }
      context.globalAlpha = 1
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); resized.disconnect(); themed.disconnect() }
  }, [tree, still])

  /** The branch or twig under a point, twigs first since they are the smaller target. */
  const hitAt = (x: number, y: number): Hit | null => {
    let best: Hit | null = null
    let bestScore = Infinity
    for (const hit of live.current.hits) {
      const distance = distanceToSegment(x, y, hit.ax, hit.ay, hit.bx, hit.by)
      if (distance > hit.reach) continue
      const score = distance - (hit.requestId ? 6 : 0)
      if (score < bestScore) { best = hit; bestScore = score }
    }
    return best
  }
  const local = (event: React.PointerEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const showTooltip = (hit: Hit | null, x: number, y: number) => {
    const element = tooltip.current
    if (!element) return
    const twig = hit?.requestId ? twigs.get(hit.requestId) : undefined
    if (!twig) { element.style.opacity = '0'; return }
    element.textContent = `${twig.title ?? t('New request')} · ${t(STATE_LABEL[twig.state])}`
    element.style.transform = `translate(${x + 14}px, ${y + 14}px)`
    element.style.opacity = '1'
  }
  const turn = (by: number) => { live.current.touchedAt = performance.now(); live.current.goal.yaw += by }
  const zoom = (by: number) => { live.current.touchedAt = performance.now(); live.current.goal.zoom = clamp(live.current.goal.zoom * by, ...ZOOM_LIMITS) }
  const home = () => {
    const state = live.current
    state.touchedAt = performance.now()
    state.goal = { yaw: state.camera.yaw + angleBetween(state.camera.yaw, HOME_CAMERA.yaw), pitch: HOME_CAMERA.pitch, zoom: 1, targetY: HOME_CAMERA.target.y }
    onSelect(null)
  }

  return (
    <div ref={wrap} role="group" aria-label={interpolate(t('A tree with {count} branches, one per focus area. Drag to turn it. Each branch has a button on the tree.'), { count: grove.branches.length })}
      className="relative isolate h-[clamp(22rem,62vh,40rem)] overflow-hidden rounded-xl border bg-card/50">
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 size-full cursor-grab touch-pan-y active:cursor-grabbing"
        onPointerDown={(event) => {
          const { x, y } = local(event)
          event.currentTarget.setPointerCapture(event.pointerId)
          live.current.drag = { x, y, yaw: live.current.goal.yaw, pitch: live.current.goal.pitch, moved: false }
          live.current.touchedAt = performance.now()
        }}
        onPointerMove={(event) => {
          const state = live.current
          const { x, y } = local(event)
          if (state.drag) {
            const dx = x - state.drag.x
            const dy = y - state.drag.y
            if (Math.abs(dx) + Math.abs(dy) > 5) state.drag.moved = true
            if (state.drag.moved) {
              state.goal.yaw = state.drag.yaw + dx * 0.009
              state.goal.pitch = clamp(state.drag.pitch + dy * 0.004, ...PITCH_LIMITS)
              state.touchedAt = performance.now()
              showTooltip(null, x, y)
            }
            return
          }
          const hit = hitAt(x, y)
          state.hoverBranch = hit?.branchId ?? null
          state.hoverRequest = hit?.requestId ?? null
          event.currentTarget.style.cursor = hit ? 'pointer' : ''
          showTooltip(hit, x, y)
        }}
        onPointerUp={(event) => {
          const state = live.current
          const drag = state.drag
          state.drag = null
          state.touchedAt = performance.now()
          if (!drag || drag.moved) return
          const { x, y } = local(event)
          const hit = hitAt(x, y)
          if (hit?.requestId) onOpenRequest(hit.requestId)
          else onSelect(hit ? hit.branchId : null)
        }}
        onPointerCancel={() => { live.current.drag = null }}
        onPointerLeave={(event) => { live.current.hoverBranch = null; live.current.hoverRequest = null; showTooltip(null, 0, 0); event.currentTarget.style.cursor = '' }}
      />
      {grove.branches.map((branch, index) => (
        <Button key={branch.id} variant="bare" aria-pressed={selectedId === branch.id} onClick={() => onSelect(selectedId === branch.id ? null : branch.id)}
          ref={(element: HTMLButtonElement | null) => { if (element) labels.current.set(branch.id, element); else labels.current.delete(branch.id) }}
          onPointerEnter={() => { live.current.hoverBranch = branch.id }} onPointerLeave={() => { live.current.hoverBranch = null }}
          onFocus={() => { live.current.hoverBranch = branch.id }} onBlur={() => { live.current.hoverBranch = null }}
          style={{ opacity: 0 }}
          className={cn('absolute top-0 left-0 flex items-baseline gap-1.5 rounded-md border bg-card/90 px-2 py-1 text-left font-normal whitespace-nowrap backdrop-blur-sm transition-colors will-change-transform',
            selectedId === branch.id ? 'border-primary' : 'border-border/70 hover:border-accent-border')}>
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
          <span className="max-w-32 truncate text-xs font-medium">{branch.name}</span>
          <span className="font-mono text-[10px] tabular-nums text-primary">LV {branch.level}</span>
          {branch.needsYou > 0 && <span aria-label={interpolate(t(branch.needsYou === 1 ? '{count} needs you' : '{count} need you'), { count: branch.needsYou })} className="size-1.5 self-center rounded-full bg-attention-foreground" />}
        </Button>
      ))}
      <div ref={tooltip} role="presentation" style={{ opacity: 0 }} className="pointer-events-none absolute top-0 left-0 z-[3000] max-w-64 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-panel transition-opacity" />
      <div className="absolute bottom-2 left-2 z-[3000] flex gap-1">
        <Button variant="outline" size="icon-sm" aria-label={t('Turn left')} onClick={() => turn(-0.6)}><RotateCcwIcon /></Button>
        <Button variant="outline" size="icon-sm" aria-label={t('Turn right')} onClick={() => turn(0.6)}><RotateCwIcon /></Button>
        <Button variant="outline" size="icon-sm" aria-label={t('Zoom in')} onClick={() => zoom(1.25)}><ZoomInIcon /></Button>
        <Button variant="outline" size="icon-sm" aria-label={t('Zoom out')} onClick={() => zoom(0.8)}><ZoomOutIcon /></Button>
        <Button variant="outline" size="icon-sm" aria-label={t('Back to the whole tree')} onClick={home}><LocateFixedIcon /></Button>
      </div>
      <p className="pointer-events-none absolute top-3 left-3 hidden text-[11px] text-muted-foreground md:block">{t('Drag to turn · pick a branch · pick a twig to open its request')}</p>
    </div>
  )
}
