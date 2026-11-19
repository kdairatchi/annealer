// Where each creature stands on the Grove's tree. A post says what the creature is for: the scout is out at a branch
// tip, the skeptic at the foot of the trunk where everything bound for a report passes, the writer on the ground
// beside it. Positions come from the tree that is drawn, so they move when the tree does. Pure.
import { TREE_HEIGHT, trunkAt, type Tree3, type Vec3 } from './tree-3d.ts'
import type { CompanionSpecies } from '../../../../shared/annealer/companions.ts'

export interface CreaturePost { species: CompanionSpecies; at: Vec3 }

const lift = (point: Vec3, by: number): Vec3 => ({ x: point.x, y: point.y + by, z: point.z })
const middle = (points: readonly Vec3[]): Vec3 => points[Math.floor(points.length / 2)]
const last = (points: readonly Vec3[]): Vec3 => points[points.length - 1]

/** What each creature's place is called, for the note under the tree. */
export const POST_LABEL: Record<CompanionSpecies, string> = {
  cinder: 'at a fork', sprout: 'on the ground', moth: 'at a branch tip', bolt: 'at the top', weevil: 'on a twig', rime: 'at the foot of the trunk', quill: 'beside the trunk',
}

/**
 * One post per creature, in the order given. A tree with no branches still has a trunk and ground, so every creature
 * has somewhere to stand; the ones that live on branches come down to the trunk.
 */
export function creaturePosts(tree: Tree3, species: readonly CompanionSpecies[]): CreaturePost[] {
  const branches = tree.limbs.filter((limb) => limb.kind === 'branch')
  const twigs = tree.limbs.filter((limb) => limb.kind === 'twig')
  // The highest tip is the scout's; the lowest branch's start is the smith's fork. Different limbs when there are two.
  const byTip = [...branches].sort((a, b) => last(b.points).y - last(a.points).y)
  const byFork = [...branches].sort((a, b) => a.points[0].y - b.points[0].y)
  const place: Record<CompanionSpecies, Vec3> = {
    // Most of the way out, short of the tip: the branch's own label is pinned there.
    moth: byTip[0] ? lift(byTip[0].points[Math.floor((byTip[0].points.length - 1) * 0.7)], 0.25) : lift(trunkAt(tree.height * 0.8), 0.2),
    cinder: byFork[0] ? lift(byFork[0].points[Math.min(1, byFork[0].points.length - 1)], 0.3) : lift(trunkAt(tree.height * 0.45), 0.2),
    weevil: twigs[0] ? lift(middle(twigs[0].points), 0.25) : byTip[1] ? lift(middle(byTip[1].points), 0.3) : lift(trunkAt(tree.height * 0.6), 0.2),
    bolt: lift(trunkAt(tree.height || TREE_HEIGHT), 0.35),
    rime: { x: 1.2, y: 0.35, z: 0.3 },
    quill: { x: -1.6, y: 0.3, z: 0.7 },
    sprout: { x: 0.2, y: 0.3, z: -2.1 },
  }
  return species.map((entry) => ({ species: entry, at: place[entry] }))
}
