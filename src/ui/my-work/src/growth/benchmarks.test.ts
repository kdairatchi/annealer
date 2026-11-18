import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SAMPLE_REQUESTS, type FocusArea, type Request } from '../data.ts'
import { SAMPLE_OWNER_RULES } from '../data-rules.ts'
import { benchmarks, readSnapshots, SNAPSHOTS_KEPT, snapshotOf, sortBenchmarks, withSnapshot } from './benchmarks.ts'
import { GROWTH_POINTS, toGrove } from './growth-model.ts'
import { TUNE_UP_KINDS, TUNE_UP_PER_KIND, tuneUp } from './tune-up.ts'

const MISSING = 'Next step not recorded'
const area = (id: string, change: Partial<FocusArea> = {}): FocusArea => ({ id, name: id, goal: null, status: 'kept', ownerRank: null, priorityRank: null, source: 'owner', mergedInto: null, evidence: null, timesAsked: null, latestAt: null, quotes: [], asks: [], ...change })
const request = (id: string, focusAreaId: string, change: Partial<Request> = {}): Request => ({
  ...SAMPLE_REQUESTS[0], id, title: id, focusAreaId, state: 'idle', closed: false, checkedAt: undefined, detailCounts: undefined, workProduct: [],
  progress: { percent: null, readings: 0, reviewedAt: '' }, next: { who: 'bot', text: 'Carry on' }, ...change,
})
const reviewed = (percent: number) => ({ percent, readings: 1, reviewedAt: '' })

const requests = [
  request('s1', 'a', { state: 'shipped', checkedAt: '2026-11-17' }),
  request('s2', 'a', { state: 'shipped' }),
  request('o1', 'a', { state: 'working', progress: reviewed(40) }),
  request('o2', 'a', { state: 'needs-check', progress: reviewed(100) }),
  request('o3', 'a', { next: { who: 'bot', text: MISSING } }),
  request('b1', 'b', { state: 'your-move' }),
]
const grove = toGrove([area('a'), area('b'), area('empty')], requests, 0, MISSING)

test('shares are counts over counts, and a share with nothing under it is null', () => {
  const { branches, whole } = benchmarks(grove)
  const [a, b, empty] = branches
  assert.deepEqual([a.requests, a.shipped, a.shipRate, a.checkedRate], [5, 2, 0.4, 0.5])
  assert.equal(a.reviewCoverage, 2 / 3)
  assert.equal(a.averageProgress, 0.7)
  assert.deepEqual([a.adrift, a.needsYou], [1, 1])
  assert.deepEqual([b.shipRate, b.reviewCoverage, b.averageProgress, b.checkedRate, b.needsYou], [0, 0, null, null, 1])
  assert.deepEqual([empty.requests, empty.shipRate, empty.reviewCoverage, empty.averageProgress, empty.checkedRate], [0, null, null, null, null])
  assert.deepEqual([whole.id, whole.requests, whole.shipped, whole.needsYou], [null, 6, 2, 2])
})

test('sorting puts rows with nothing to measure last in both directions', () => {
  const { branches } = benchmarks(grove)
  assert.deepEqual(sortBenchmarks(branches, 'shipRate', true).map((row) => row.id), ['a', 'b', 'empty'])
  assert.deepEqual(sortBenchmarks(branches, 'shipRate', false).map((row) => row.id), ['b', 'a', 'empty'])
  assert.deepEqual(sortBenchmarks(branches, 'averageProgress', false).map((row) => row.id)[0], 'a')
})

test('one snapshot per day: the same day is replaced, other days are kept in order, and the list is capped', () => {
  const day1 = snapshotOf(grove, '2026-11-17')
  assert.deepEqual([day1.requests, day1.shipped, day1.points], [6, 2, grove.points])
  let list = withSnapshot([], day1)
  list = withSnapshot(list, { ...day1, points: 999 })
  assert.deepEqual(list.map((entry) => entry.points), [999])
  list = withSnapshot(list, snapshotOf(grove, '2026-11-16'))
  assert.deepEqual(list.map((entry) => entry.day), ['2026-11-16', '2026-11-17'])
  let long: ReturnType<typeof withSnapshot> = []
  for (let index = 0; index < SNAPSHOTS_KEPT + 20; index += 1) long = withSnapshot(long, { ...day1, day: `2027-${String(1 + Math.floor(index / 28)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}` })
  assert.equal(long.length, SNAPSHOTS_KEPT)
})

test('saved snapshots that cannot be read are dropped, not trusted', () => {
  assert.deepEqual(readSnapshots('not json'), [])
  assert.deepEqual(readSnapshots('{"day":"2026-11-17"}'), [])
  const good = { day: '2026-11-17', points: 5, level: 1, requests: 2, shipped: 1 }
  assert.deepEqual(readSnapshots(JSON.stringify([{ ...good, day: 'yesterday' }, { ...good, points: -1 }, { ...good, level: 'high' }, good, null])), [good])
})

test('the tune-up asks for answers first, then checks, then missing next steps, and never lists a request twice', () => {
  const steps = tuneUp(requests, [], [], MISSING)
  assert.deepEqual(steps.map((step) => step.id), ['answer:b1', 'check:o2', 'next-step:o3', 'unreviewed'])
  assert.deepEqual(steps.map((step) => step.gain), [null, GROWTH_POINTS.checked, null, null])
  assert.deepEqual(steps[0].target, { kind: 'request', requestId: 'b1' })
  const both = tuneUp([request('x', 'a', { state: 'your-move', next: { who: 'human', text: MISSING } })], [], [], MISSING)
  assert.deepEqual(both.map((step) => step.id), ['answer:x', 'unreviewed'])
})

test('rules and focus areas waiting on a decision each become one step that names how many', () => {
  const steps = tuneUp([], SAMPLE_OWNER_RULES, [area('idea', { status: 'suggested' }), area('kept')], MISSING)
  const waiting = SAMPLE_OWNER_RULES.filter((rule) => rule.status === 'suggested').length
  assert.ok(waiting > 0)
  assert.deepEqual(steps.map((step) => [step.kind, step.target]), [['rules', { kind: 'page', page: 'rules' }], ['areas', { kind: 'page', page: 'suggested' }]])
  assert.ok(steps[0].subject.startsWith(`${waiting} learned rule`))
  assert.equal(steps[1].subject, '1 suggested focus area is waiting for your decision')
})

test('nothing waiting means an empty session; closed work is ignored; a busy kind is capped', () => {
  assert.deepEqual(tuneUp([request('done', 'a', { state: 'shipped' }), request('gone', 'a', { closed: true, state: 'your-move' })], [], [], MISSING), [])
  const many = Array.from({ length: 9 }, (_, index) => request(`q${index}`, 'a', { state: 'your-move', progress: reviewed(10) }))
  assert.equal(tuneUp(many, [], [], MISSING).length, TUNE_UP_PER_KIND)
  for (const step of tuneUp(requests, SAMPLE_OWNER_RULES, [], MISSING)) assert.ok(TUNE_UP_KINDS.includes(step.kind))
})
