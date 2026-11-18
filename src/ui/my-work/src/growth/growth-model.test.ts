import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OTHER_FOCUS_AREA_ID, SAMPLE_REQUESTS, type FocusArea, type Request } from '../data.ts'
import { GROWTH_POINTS, levelFloor, levelFor, toGrove } from './growth-model.ts'
import { layoutTree, TREE_VIEW, TWIGS_SHOWN } from './tree-layout.ts'

const MISSING = 'Next step not recorded'

const area = (id: string, change: Partial<FocusArea> = {}): FocusArea => ({
  id, name: id, goal: null, status: 'kept', ownerRank: null, priorityRank: null, source: 'owner', mergedInto: null,
  evidence: null, timesAsked: null, latestAt: null, quotes: [], asks: [], ...change,
})

const ask = (id: string, timesAsked: number) => ({ id, title: id, timesAsked, latestAt: '', quotes: [] })
const request = (id: string, change: Partial<Request> = {}): Request => ({
  ...SAMPLE_REQUESTS[0], id, focusAreaId: 'a', state: 'idle', stage: 'Building', closed: false, checkedAt: undefined, detailCounts: undefined,
  workProduct: [], progress: { percent: null, readings: 0, reviewedAt: '' }, next: { who: 'bot', text: 'Carry on' }, ...change,
})

test('levels start at 0, 50, 150, 300 and report the distance to the next', () => {
  assert.deepEqual([1, 2, 3, 4].map(levelFloor), [0, 50, 150, 300])
  assert.deepEqual(levelFor(0), { level: 1, intoLevel: 0, toNextLevel: 50 })
  assert.deepEqual(levelFor(49), { level: 1, intoLevel: 0.98, toNextLevel: 1 })
  assert.deepEqual(levelFor(50), { level: 2, intoLevel: 0, toNextLevel: 100 })
  assert.equal(levelFor(299).level, 3)
})

test('unreviewed, unshipped work with nothing to show earns nothing', () => {
  const grove = toGrove([area('a')], [request('r1'), request('r2')], [], MISSING)
  assert.equal(grove.points, 0)
  assert.equal(grove.level, 1)
  assert.deepEqual(grove.branches[0].sources, [])
})

test('each kind of evidence earns its listed worth, and shipped work is not paid for its percent too', () => {
  const grove = toGrove([area('a')], [
    request('shipped', { state: 'shipped', progress: { percent: 100, readings: 2, reviewedAt: '' } }),
    request('half', { progress: { percent: 50, readings: 1, reviewedAt: '' } }),
    request('files', { workProduct: Array.from({ length: 9 }, (_, index) => ({ kind: 'File' as const, label: `f${index}` })) }),
    request('checked', { checkedAt: '2026-11-17' }),
  ], [], MISSING)
  const [branch] = grove.branches
  assert.deepEqual(branch.twigs.map((twig) => twig.points), [
    GROWTH_POINTS.shipped, 15, GROWTH_POINTS.leavesCounted * GROWTH_POINTS.leaf, GROWTH_POINTS.checked,
  ])
  assert.deepEqual(branch.sources, [
    { label: 'Shipped', points: 40, count: 1 },
    { label: 'Reviewed progress', points: 15, count: 1 },
    { label: 'Work product', points: 20, count: 1 },
    { label: 'Checked by you', points: 6, count: 1 },
  ])
  assert.equal(branch.points, 81)
  assert.equal(branch.sources.reduce((sum, source) => sum + source.points, 0), branch.points)
  assert.equal(grove.points, 81)
})

test('a compact overview counts its exact work product, not the bounded preview', () => {
  const grove = toGrove([area('a')], [request('r', { detailCounts: { workProduct: 3 }, workProduct: [{ kind: 'File', label: 'one' }] })], [], MISSING)
  assert.equal(grove.branches[0].twigs[0].leaves, 3)
})

test('closed requests are off the tree; unsorted ones are counted and earn nothing', () => {
  const grove = toGrove([area('a')], [
    request('closed', { closed: true, state: 'shipped' }),
    request('lost', { focusAreaId: undefined, state: 'shipped' }),
  ], [], MISSING)
  assert.equal(grove.branches[0].twigs.length, 0)
  assert.equal(grove.points, 0)
  assert.equal(grove.sorting, 1)
})

test('kept areas come first in the owner order, then suggested areas holding work, then Other', () => {
  const grove = toGrove(
    [area('second', { ownerRank: 2 }), area('first', { ownerRank: 1 }), area('idea', { status: 'suggested' }), area('empty-idea', { status: 'suggested' }), area('gone', { status: 'dismissed' })],
    [request('r1', { focusAreaId: 'idea' }), request('r2', { focusAreaId: OTHER_FOCUS_AREA_ID })], [ask('rare', 1), ask('often', 9)], MISSING,
  )
  assert.deepEqual(grove.branches.map((branch) => [branch.id, branch.suggested]), [['first', false], ['second', false], ['idea', true], [OTHER_FOCUS_AREA_ID, false]])
  assert.equal(grove.branches.at(-1)!.asksNotStarted, 2)
  assert.deepEqual(grove.branches.at(-1)!.asks.map((entry) => entry.id), ['often', 'rare'])
})

test('a missing next step is flagged on open work only', () => {
  const grove = toGrove([area('a')], [
    request('none', { next: { who: 'bot', text: MISSING } }),
    request('blank', { next: { who: 'bot', text: '  ' } }),
    request('known'),
    request('done', { state: 'shipped', next: { who: 'bot', text: MISSING } }),
  ], [], MISSING)
  assert.deepEqual(grove.branches[0].twigs.map((twig) => twig.missingNextStep), [true, true, false, false])
})

test('the layout is the same every time and stays inside the drawing', () => {
  const requests = Array.from({ length: 12 }, (_, index) => request(`r${index}`, { focusAreaId: index % 2 ? 'a' : 'b', workProduct: [{ kind: 'File', label: 'x' }] }))
  const areas = Array.from({ length: 12 }, (_, index) => area(String.fromCharCode(97 + index)))
  const grown: Request[] = requests.map((entry) => ({ ...entry, focusAreaId: 'l', progress: { percent: 100, readings: 1, reviewedAt: '' } }))
  const grove = toGrove(areas, [...grown, ...requests], [], MISSING)
  const layout = layoutTree(grove)
  assert.deepEqual(layoutTree(grove), layout)
  assert.deepEqual(layout.branches.slice(0, 5).map((branch) => branch.side), ['left', 'right', 'left', 'right', 'left'])
  // Ten branches get an edge label; on each side they are at least a label apart.
  assert.deepEqual(layout.branches.map((branch) => branch.label !== null), [...Array(10).fill(true), false, false])
  for (const side of ['left', 'right']) {
    const ys = layout.branches.filter((branch) => branch.side === side && branch.label).map((branch) => branch.label!.y).sort((a, b) => a - b)
    for (let index = 1; index < ys.length; index += 1) assert.ok(ys[index] - ys[index - 1] >= 86, `${side} labels ${ys[index - 1]} and ${ys[index]}`)
    assert.ok(ys.at(-1)! <= TREE_VIEW.height - 86, `${side} last label ${ys.at(-1)}`)
  }
  for (const branch of layout.branches) {
    assert.ok(branch.twigs.length <= TWIGS_SHOWN)
    for (const point of [branch.root, branch.tip, ...branch.twigs.flatMap((twig) => [twig.base, twig.tip, ...twig.leaves])]) {
      assert.ok(point.x >= 0 && point.x <= TREE_VIEW.width, `x ${point.x} of ${branch.id}`)
      assert.ok(point.y >= 0 && point.y <= TREE_VIEW.height, `y ${point.y} of ${branch.id}`)
    }
  }
})

test('an empty model still has a trunk to stand on', () => {
  const layout = layoutTree(toGrove([], [], [], MISSING))
  assert.deepEqual(layout.branches, [])
  assert.ok(layout.trunk.startsWith('M 500 510'))
})
