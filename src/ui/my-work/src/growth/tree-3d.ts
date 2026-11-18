// The Grove in three dimensions: the same model as the flat drawing, placed in space so it can be turned around.
// Branches leave the trunk a golden angle apart, the way real shoots do, so no two ever line up and a new branch never
// moves the others. Nothing is random: the same model always grows the same tree. Pure, so `node --test` can load it.
import type { LiveState } from '../data.ts'
import type { Grove } from './growth-model.ts'
import { TWIGS_SHOWN } from './tree-layout.ts'

export interface Vec3 { x: number; y: number; z: number }

/** A piece of wood: a line through space that tapers from `width[0]` to `width[1]`, in world units. */
export interface Limb3 {
  kind: 'trunk' | 'branch' | 'twig'
  points: Vec3[]
  width: readonly [number, number]
  /** Null on the trunk. */
  branchId: string | null
  /** Set on twigs. */
  requestId: string | null
  state: LiveState | null
  /** A twig whose request has no recorded next step is drawn dashed. */
  dashed: boolean
  /** When it starts growing in the opening animation, 0 to 1, and how long it takes. */
  grows: readonly [start: number, span: number]
}

export interface Leaf3 { at: Vec3; branchId: string; requestId: string }

/** Where a branch's label is pinned, and the direction it leaves the trunk (radians around the trunk). */
export interface BranchPin3 { branchId: string; at: Vec3; middle: Vec3; azimuth: number }

export interface Tree3 { limbs: Limb3[]; leaves: Leaf3[]; pins: BranchPin3[]; height: number; reach: number }

/** World height of the trunk. */
export const TREE_HEIGHT = 8.6
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const LEAVES_SHOWN = 5
const CURVE_STEPS = 10

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (a: Vec3, by: number): Vec3 => ({ x: a.x * by, y: a.y * by, z: a.z * by })
const mix = (a: Vec3, b: Vec3, at: number): Vec3 => add(scale(a, 1 - at), scale(b, at))
const normal = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1))

/** The trunk's centre at a height: it sways a little, so the tree does not look ruled. */
export function trunkAt(y: number): Vec3 {
  return { x: 0.16 * Math.sin(y * 0.62), y, z: 0.14 * Math.sin(y * 0.47 + 1.3) }
}

function curve(start: Vec3, bend: Vec3, end: Vec3): Vec3[] {
  return Array.from({ length: CURVE_STEPS + 1 }, (_, step) => {
    const at = step / CURVE_STEPS
    return mix(mix(start, bend, at), mix(bend, end, at), at)
  })
}

export function buildTree3(grove: Grove): Tree3 {
  const limbs: Limb3[] = []
  const leaves: Leaf3[] = []
  const pins: BranchPin3[] = []
  const count = grove.branches.length
  const girth = Math.min(0.75, 0.42 + grove.level * 0.05)
  limbs.push({
    kind: 'trunk', points: Array.from({ length: 13 }, (_, step) => trunkAt((TREE_HEIGHT * step) / 12)), width: [girth, girth * 0.3],
    branchId: null, requestId: null, state: null, dashed: false, grows: [0, 0.45],
  })
  let reach = 2
  grove.branches.forEach((branch, index) => {
    // The first branch is the owner's first priority: lowest on the trunk, and the longest.
    const rank = count <= 1 ? 0 : index / (count - 1)
    const azimuth = 0.5 + index * GOLDEN_ANGLE
    const out: Vec3 = { x: Math.cos(azimuth), y: 0, z: Math.sin(azimuth) }
    const across: Vec3 = { x: -Math.sin(azimuth), y: 0, z: Math.cos(azimuth) }
    const length = 4.5 - rank * 1.9
    const start = trunkAt(2.1 + rank * (TREE_HEIGHT - 3.6))
    const end = add(start, add(scale(out, length), { x: 0, y: length * 0.42, z: 0 }))
    const bend = add(start, add(scale(out, length * 0.55), { x: 0, y: -length * 0.04, z: 0 }))
    const points = curve(start, bend, end)
    const thickness = Math.min(0.32, 0.1 + branch.level * 0.035)
    const born = 0.2 + rank * 0.3
    limbs.push({ kind: 'branch', points, width: [thickness, 0.045], branchId: branch.id, requestId: null, state: null, dashed: branch.suggested, grows: [born, 0.4] })
    pins.push({ branchId: branch.id, at: add(end, { x: 0, y: 0.35, z: 0 }), middle: points[Math.round(CURVE_STEPS * 0.6)], azimuth })
    reach = Math.max(reach, Math.hypot(end.x, end.z))

    const shown = branch.twigs.slice(0, TWIGS_SHOWN)
    shown.forEach((twig, twigIndex) => {
      const along = 0.34 + (0.62 * (twigIndex + 1)) / (shown.length + 1)
      const base = points[Math.round(along * CURVE_STEPS)]
      const side = twigIndex % 2 === 0 ? 1 : -1
      const direction = normal(add(add(scale(across, side * 0.75), { x: 0, y: 0.85, z: 0 }), scale(out, 0.25)))
      // A twig lengthens with what its request has earned.
      const twigLength = 0.55 + Math.min(0.75, twig.points * 0.013)
      const tip = add(base, scale(direction, twigLength))
      const knee = add(mix(base, tip, 0.5), scale(out, 0.08))
      limbs.push({
        kind: 'twig', points: [base, knee, tip], width: [0.05, 0.03], branchId: branch.id, requestId: twig.requestId, state: twig.state,
        dashed: twig.missingNextStep, grows: [born + 0.3 + twigIndex * 0.02, 0.2],
      })
      for (let leaf = 0; leaf < Math.min(twig.leaves, LEAVES_SHOWN); leaf += 1) {
        // Leaves sit in a small spiral around the twig's tip.
        const turn = leaf * GOLDEN_ANGLE + twigIndex
        const spread = 0.13 * Math.sqrt(leaf + 1)
        leaves.push({ branchId: branch.id, requestId: twig.requestId, at: add(tip, { x: Math.cos(turn) * spread, y: 0.08 + leaf * 0.05, z: Math.sin(turn) * spread }) })
      }
    })
  })
  return { limbs, leaves, pins, height: TREE_HEIGHT, reach }
}

// ── Camera ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The view: turned `yaw` around the trunk, tilted `pitch` down, looking at `target` from `distance` away. */
export interface Camera3 { yaw: number; pitch: number; distance: number; zoom: number; target: Vec3 }

export interface Projected { x: number; y: number; scale: number; depth: number }

export const HOME_CAMERA: Camera3 = { yaw: 0.35, pitch: 0.2, distance: 18, zoom: 1, target: { x: 0, y: 4.3, z: 0 } }

/** World units to pixels for a drawing `width` by `height` pixels: the whole tree fits either way round. */
export const unitPixels = (width: number, height: number) => Math.min(height / 11.5, width / 12.5)

/** Where a point lands on screen. `scale` is pixels per world unit at that depth; a larger `depth` is further away. */
export function project(point: Vec3, camera: Camera3, width: number, height: number): Projected {
  const x = point.x - camera.target.x
  const y = point.y - camera.target.y
  const z = point.z - camera.target.z
  const cosYaw = Math.cos(camera.yaw)
  const sinYaw = Math.sin(camera.yaw)
  const turnedX = x * cosYaw + z * sinYaw
  const turnedZ = -x * sinYaw + z * cosYaw
  const cosPitch = Math.cos(camera.pitch)
  const sinPitch = Math.sin(camera.pitch)
  const tiltedY = y * cosPitch - turnedZ * sinPitch
  const tiltedZ = y * sinPitch + turnedZ * cosPitch
  const depth = Math.max(0.5, camera.distance + tiltedZ)
  const scale = (camera.distance / depth) * unitPixels(width, height) * camera.zoom
  return { x: width / 2 + turnedX * scale, y: height / 2 - tiltedY * scale, scale, depth }
}

/** The yaw that turns a branch to face the viewer, a little to the right, so its label has room. */
export const yawFacing = (azimuth: number) => azimuth + 0.6

/** The shortest way round from one angle to another. */
export function angleBetween(from: number, to: number): number {
  const turn = (to - from) % (Math.PI * 2)
  return turn > Math.PI ? turn - Math.PI * 2 : turn < -Math.PI ? turn + Math.PI * 2 : turn
}

/** Distance in pixels from a point to a line segment, for telling what the pointer is over. */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const at = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + at * dx), py - (ay + at * dy))
}
