// Where the Grove draws things. The same model always gives the same tree: nothing here is random, so a branch
// stays where you last saw it and a screenshot matches the next visit. Pure, so `node --test` can load it.
import type { Grove, GrowthBranch } from './growth-model.ts'

export const TREE_VIEW = { width: 1000, height: 540, trunkX: 500, groundY: 510 } as const

export interface Point { x: number; y: number }

export interface TwigLayout { requestId: string; base: Point; tip: Point; leaves: Point[] }

export interface BranchLayout {
  id: string
  side: 'left' | 'right'
  /** Where it leaves the trunk. */
  root: Point
  /** The bend of its curve. */
  bend: Point
  tip: Point
  /** SVG path from root to tip. */
  path: string
  /** Stroke width: a higher level is a thicker limb. */
  girth: number
  twigs: TwigLayout[]
  /** Where its callout line ends and its label starts; null when the edge has no room left for one. */
  label: Point | null
}

export interface TreeLayout { trunk: string; trunkTop: Point; branches: BranchLayout[] }

/** A point along a quadratic curve, `at` from 0 (start) to 1 (end). */
export function alongCurve(start: Point, bend: Point, end: Point, at: number): Point {
  const rest = 1 - at
  return {
    x: rest * rest * start.x + 2 * rest * at * bend.x + at * at * end.x,
    y: rest * rest * start.y + 2 * rest * at * bend.y + at * at * end.y,
  }
}

/** Twigs drawn per branch on the whole-tree view; the branch's own view shows every one. */
export const TWIGS_SHOWN = 7
/** The closest a twig comes to the top of the drawing. */
const EDGE = 16
/** Branches that get a label at the edge of the drawing; the rest are named in the list under it. */
export const LABELS_SHOWN = 10
/** The least room one edge label needs, in drawing units. */
const LABEL_ROOM = 86
/** Leaves drawn per twig. */
const LEAVES_SHOWN = 5

const round = (value: number) => Math.round(value * 10) / 10

function branchLayout(branch: GrowthBranch, index: number, count: number): BranchLayout {
  const { trunkX, groundY } = TREE_VIEW
  const side = index % 2 === 0 ? 'left' : 'right'
  const direction = side === 'left' ? -1 : 1
  // Branches climb the trunk in pairs; the first (highest priority) sits lowest and reaches furthest.
  const tier = Math.floor(index / 2)
  const tiers = Math.max(1, Math.ceil(count / 2))
  const rootY = groundY - 130 - (tier * 220) / tiers - (side === 'right' ? 26 : 0)
  const reach = 300 - tier * (120 / tiers)
  const root = { x: trunkX, y: round(rootY) }
  const tip = { x: round(trunkX + direction * reach), y: round(rootY - 80 + tier * 6) }
  const bend = { x: round(trunkX + direction * reach * 0.45), y: round(rootY - 8) }
  const shown = branch.twigs.slice(0, TWIGS_SHOWN)
  const twigs = shown.map((twig, twigIndex) => {
    const at = 0.34 + (0.66 * (twigIndex + 1)) / (shown.length + 1)
    const base = alongCurve(root, bend, tip, at)
    // Twigs alternate above and below the limb; growth lengthens them.
    const up = twigIndex % 2 === 0 ? -1 : 1
    const length = 26 + Math.min(34, twig.points * 0.6)
    // Kept inside the drawing: a long twig on the top limb stops at the edge.
    const tipPoint = { x: round(base.x + direction * length * 0.45), y: round(Math.max(EDGE, base.y + up * length)) }
    const leaves = Array.from({ length: Math.min(twig.leaves, LEAVES_SHOWN) }, (_, leaf) => ({
      x: round(tipPoint.x + direction * (6 + leaf * 7) * (leaf % 2 === 0 ? 1 : 0.4)),
      y: round(Math.max(EDGE / 2, tipPoint.y + up * (4 + leaf * 5) * (leaf % 2 === 0 ? 0.5 : 1))),
    }))
    return { requestId: twig.requestId, base: { x: round(base.x), y: round(base.y) }, tip: tipPoint, leaves }
  })
  return {
    id: branch.id, side, root, bend, tip,
    path: `M ${root.x} ${root.y} Q ${bend.x} ${bend.y} ${tip.x} ${tip.y}`,
    girth: Math.min(16, 5 + branch.level * 2),
    twigs,
    label: null,
  }
}

export function layoutTree(grove: Grove): TreeLayout {
  const { trunkX, groundY } = TREE_VIEW
  const branches = grove.branches.map((branch, index) => branchLayout(branch, index, grove.branches.length))
  // Edge labels are stacked evenly down each side, highest limb first, so two labels never share a slot.
  for (const side of ['left', 'right'] as const) {
    const labelled = branches.slice(0, LABELS_SHOWN).filter((branch) => branch.side === side).sort((a, b) => a.tip.y - b.tip.y)
    const step = Math.max(LABEL_ROOM, Math.min(120, (groundY - 80) / Math.max(1, labelled.length)))
    labelled.forEach((branch, slot) => { branch.label = { x: side === 'left' ? 24 : TREE_VIEW.width - 24, y: round(24 + slot * step) } })
  }
  const top = branches.length ? Math.min(...branches.map((branch) => branch.root.y)) - 60 : groundY - 200
  return {
    trunk: `M ${trunkX} ${groundY} C ${trunkX - 14} ${groundY - 160}, ${trunkX + 12} ${top + 120}, ${trunkX} ${top}`,
    trunkTop: { x: trunkX, y: top },
    branches,
  }
}
