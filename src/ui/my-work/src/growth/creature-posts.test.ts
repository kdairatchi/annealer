import assert from 'node:assert/strict'
import { test } from 'node:test'
import { creaturePosts, POST_LABEL } from './creature-posts.ts'
import { buildTree3 } from './tree-3d.ts'
import { toGrove } from './growth-model.ts'
import { SAMPLE_REQUESTS, type FocusArea, type Request } from '../data.ts'
import { COMPANION_SPECIES } from '../../../../shared/annealer/companions.ts'

const area = (id: string): FocusArea => ({ id, name: id, goal: null, status: 'kept', ownerRank: null, priorityRank: null, source: 'owner', mergedInto: null, evidence: null, timesAsked: null, latestAt: null, quotes: [], asks: [] })
const request = (id: string, focusAreaId: string): Request => ({ ...SAMPLE_REQUESTS[0], id, focusAreaId, state: 'idle', closed: false, workProduct: [], progress: { percent: null, readings: 0, reviewedAt: '' }, next: { who: 'bot', text: 'Carry on' } })
const tree = buildTree3(toGrove(['a', 'b', 'c'].map(area), [request('a0', 'a'), request('a1', 'a'), request('b0', 'b'), request('c0', 'c')], [], 'none'))
const empty = buildTree3(toGrove([], [], [], 'none'))

test('every creature has a post of its own, on a full tree and on a bare trunk', () => {
  for (const drawn of [tree, empty]) {
    const posts = creaturePosts(drawn, COMPANION_SPECIES)
    assert.deepEqual(posts.map((post) => post.species), [...COMPANION_SPECIES])
    for (const post of posts) assert.ok([post.at.x, post.at.y, post.at.z].every(Number.isFinite), post.species)
    const keys = new Set(posts.map((post) => `${post.at.x.toFixed(2)},${post.at.y.toFixed(2)},${post.at.z.toFixed(2)}`))
    assert.equal(keys.size, posts.length)
  }
  assert.deepEqual(Object.keys(POST_LABEL).sort(), [...COMPANION_SPECIES].sort())
})

test('the scout is out on a branch, the watcher above everything, and the skeptic and the writer on the ground', () => {
  const at = Object.fromEntries(creaturePosts(tree, COMPANION_SPECIES).map((post) => [post.species, post.at]))
  assert.ok(at.bolt.y > at.moth.y && at.moth.y > at.rime.y)
  assert.ok(Math.hypot(at.moth.x, at.moth.z) > 1, 'the scout is away from the trunk')
  assert.ok(at.rime.y < 1 && at.quill.y < 1 && at.sprout.y < 1)
  assert.deepEqual(creaturePosts(tree, ['rime']).map((post) => post.species), ['rime'])
})
