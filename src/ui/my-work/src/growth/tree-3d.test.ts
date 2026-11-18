import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SAMPLE_REQUESTS, type FocusArea, type Request } from '../data.ts'
import { toGrove } from './growth-model.ts'
import { angleBetween, buildTree3, distanceToSegment, HOME_CAMERA, project, TREE_HEIGHT, yawFacing } from './tree-3d.ts'
import { TWIGS_SHOWN } from './tree-layout.ts'

const MISSING = 'Next step not recorded'
const area = (id: string): FocusArea => ({ id, name: id, goal: null, status: 'kept', ownerRank: null, priorityRank: null, source: 'owner', mergedInto: null, evidence: null, timesAsked: null, latestAt: null, quotes: [], asks: [] })
const request = (id: string, focusAreaId: string, change: Partial<Request> = {}): Request => ({
  ...SAMPLE_REQUESTS[0], id, focusAreaId, state: 'idle', closed: false, checkedAt: undefined, detailCounts: undefined, workProduct: [],
  progress: { percent: null, readings: 0, reviewedAt: '' }, next: { who: 'bot', text: 'Carry on' }, ...change,
})
const areas = ['a', 'b', 'c', 'd', 'e', 'f'].map(area)
const requests = [
  ...Array.from({ length: 10 }, (_, index) => request(`a${index}`, 'a', { workProduct: Array.from({ length: 8 }, () => ({ kind: 'File' as const, label: 'x' })) })),
  request('b0', 'b', { state: 'working', next: { who: 'bot', text: MISSING } }),
]
const grove = toGrove(areas, requests, 0, MISSING)

test('the same model grows the same tree, with one trunk, a limb and a pin per branch', () => {
  const tree = buildTree3(grove)
  assert.deepEqual(buildTree3(grove), tree)
  assert.equal(tree.limbs.filter((limb) => limb.kind === 'trunk').length, 1)
  assert.deepEqual(tree.limbs.filter((limb) => limb.kind === 'branch').map((limb) => limb.branchId), ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(tree.pins.map((pin) => pin.branchId), ['a', 'b', 'c', 'd', 'e', 'f'])
  for (const limb of tree.limbs) for (const point of limb.points) assert.ok(Number.isFinite(point.x + point.y + point.z))
})

test('twigs and leaves are capped, carry their request, and a missing next step is dashed', () => {
  const tree = buildTree3(grove)
  const twigs = tree.limbs.filter((limb) => limb.kind === 'twig')
  assert.equal(twigs.filter((twig) => twig.branchId === 'a').length, TWIGS_SHOWN)
  assert.equal(tree.leaves.filter((leaf) => leaf.requestId === 'a0').length, 5)
  const working = twigs.find((twig) => twig.requestId === 'b0')!
  assert.deepEqual([working.state, working.dashed], ['working', true])
})

test('no two branches leave the trunk in the same direction, and the first is lowest and longest', () => {
  const tree = buildTree3(grove)
  const directions = tree.pins.map((pin) => ((pin.azimuth % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b)
  for (let index = 1; index < directions.length; index += 1) assert.ok(directions[index] - directions[index - 1] > 0.3)
  const limbs = tree.limbs.filter((limb) => limb.kind === 'branch')
  const span = (index: number) => Math.hypot(limbs[index].points.at(-1)!.x, limbs[index].points.at(-1)!.z)
  assert.ok(limbs[0].points[0].y < limbs[5].points[0].y)
  assert.ok(span(0) > span(5))
  assert.ok(limbs.every((limb) => limb.points[0].y > 0 && limb.points.at(-1)!.y <= TREE_HEIGHT + 2))
})

test('everything grows in within the opening animation', () => {
  for (const limb of buildTree3(grove).limbs) assert.ok(limb.grows[0] >= 0 && limb.grows[0] + limb.grows[1] <= 1.1, `${limb.kind} ${limb.grows}`)
})

test('an empty grove is a bare trunk', () => {
  const tree = buildTree3(toGrove([], [], 0, MISSING))
  assert.deepEqual([tree.limbs.length, tree.leaves.length, tree.pins.length], [1, 0, 0])
})

test('the camera centres its target, shrinks what is further away, and a half turn mirrors left and right', () => {
  const centre = project(HOME_CAMERA.target, HOME_CAMERA, 800, 600)
  assert.deepEqual([centre.x, centre.y], [400, 300])
  const flat = { ...HOME_CAMERA, yaw: 0, pitch: 0 }
  const near = project({ x: 0, y: 4.3, z: -3 }, flat, 800, 600)
  const far = project({ x: 0, y: 4.3, z: 3 }, flat, 800, 600)
  assert.ok(near.scale > far.scale && near.depth < far.depth)
  const right = project({ x: 2, y: 4.3, z: 0 }, flat, 800, 600)
  const turned = project({ x: 2, y: 4.3, z: 0 }, { ...flat, yaw: Math.PI }, 800, 600)
  assert.ok(right.x > 400 && Math.abs(turned.x - (800 - right.x)) < 1e-6)
  assert.ok(project({ x: 0, y: 8, z: 0 }, flat, 800, 600).y < 300)
})

test('the whole tree fits in a wide and in a tall drawing from the home view', () => {
  const tree = buildTree3(grove)
  for (const [width, height] of [[1100, 620], [360, 420]]) {
    for (const yaw of [0, 1, 2, 3, 4, 5, 6]) {
      for (const limb of tree.limbs) for (const point of limb.points) {
        const at = project(point, { ...HOME_CAMERA, yaw }, width, height)
        assert.ok(at.x > 0 && at.x < width && at.y > 0 && at.y < height, `${width}x${height} yaw ${yaw}: ${Math.round(at.x)},${Math.round(at.y)}`)
      }
    }
  }
})

test('facing a branch brings it toward the viewer and to the right', () => {
  const [pin] = buildTree3(grove).pins
  const at = project(pin.at, { ...HOME_CAMERA, yaw: yawFacing(pin.azimuth), pitch: 0 }, 800, 600)
  const trunk = project({ x: 0, y: pin.at.y, z: 0 }, { ...HOME_CAMERA, yaw: yawFacing(pin.azimuth), pitch: 0 }, 800, 600)
  assert.ok(at.x > trunk.x && at.depth < trunk.depth)
})

test('angles take the short way round, and pointer distance is measured to the segment, not the line', () => {
  assert.ok(Math.abs(angleBetween(0.1, Math.PI * 2 - 0.1) + 0.2) < 1e-9)
  assert.ok(Math.abs(angleBetween(6, 0.5) - (0.5 + Math.PI * 2 - 6)) < 1e-9)
  assert.equal(distanceToSegment(5, 3, 0, 0, 10, 0), 3)
  assert.equal(distanceToSegment(13, 4, 0, 0, 10, 0), 5)
  assert.equal(distanceToSegment(3, 4, 0, 0, 0, 0), 5)
})
