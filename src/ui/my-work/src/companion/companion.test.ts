import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SAMPLE_REQUESTS, type Request } from '../data.ts'
import type { RequestChange } from '../live/update-queue.ts'
import { CHEER_MS, COMPANION_MOODS, companionStatus } from './companion-mood.ts'
import { COMPANION_COLORS, COMPANION_DEFAULT_NAME, COMPANION_FRAMES, COMPANION_PALETTES, companionName, SPRITE_SIZE } from './companion-sprites.ts'

const MISSING = 'Next step not recorded'
const NOW = 1_800_000_000_000
const request = (id: string, change: Partial<Request> = {}): Request => ({ ...SAMPLE_REQUESTS[0], id, title: id, state: 'idle', closed: false, next: { who: 'bot', text: 'Carry on' }, ...change })
const shippedChange = (at: number): RequestChange => ({ kind: 'state', requestId: 'done', title: 'done', from: 'working', to: 'shipped', at })

test('something waiting on you outranks everything, and your move comes before a check', () => {
  const status = companionStatus([request('busy', { state: 'working' }), request('check', { state: 'needs-check' }), request('mine', { state: 'your-move' })], [shippedChange(NOW)], NOW, MISSING)
  assert.deepEqual([status.mood, status.requestId], ['needs-you', 'mine'])
  assert.match(status.line, /^2 requests are waiting on you/)
})

test('a recorded ship is cheered for a minute, then work in progress shows again', () => {
  const requests = [request('busy', { state: 'working' })]
  assert.equal(companionStatus(requests, [shippedChange(NOW - CHEER_MS + 1)], NOW, MISSING).mood, 'celebrating')
  assert.deepEqual(companionStatus(requests, [shippedChange(NOW - CHEER_MS)], NOW, MISSING), { mood: 'working', requestId: 'busy', line: 'Working on “busy”.' })
})

test('progress and new-request changes are not a ship', () => {
  const changes: RequestChange[] = [{ kind: 'progress', requestId: 'a', title: 'a', from: 10, to: 90, at: NOW }, { kind: 'new', requestId: 'b', title: 'b', at: NOW }]
  assert.equal(companionStatus([request('a')], changes, NOW, MISSING).mood, 'resting')
})

test('at rest it names open work with no next step, and ignores closed and shipped work', () => {
  const status = companionStatus([
    request('adrift', { next: { who: 'bot', text: MISSING } }),
    request('closed', { closed: true, state: 'your-move' }),
    request('done', { state: 'shipped', next: { who: 'bot', text: MISSING } }),
  ], [], NOW, MISSING)
  assert.deepEqual(status, { mood: 'resting', requestId: 'adrift', line: 'Nothing is moving. 1 open request has no next step recorded.' })
  assert.equal(companionStatus([], [], NOW, MISSING).line, 'No requests recorded yet.')
})

test('every mood has frames, every frame is a full grid, and every palette colours every pixel used', () => {
  const used = new Set<string>()
  for (const mood of COMPANION_MOODS) {
    assert.ok(COMPANION_FRAMES[mood].length >= 2, mood)
    for (const frame of COMPANION_FRAMES[mood]) {
      assert.equal(frame.length, SPRITE_SIZE, mood)
      for (const row of frame) {
        assert.equal(row.length, SPRITE_SIZE, `${mood}: "${row}"`)
        for (const pixel of row) if (pixel !== '.') used.add(pixel)
      }
    }
  }
  for (const palette of COMPANION_PALETTES) for (const pixel of used) assert.match(COMPANION_COLORS[palette][pixel as 'd'] ?? '', /^#[0-9a-f]{6}$/, `${palette} ${pixel}`)
})

test('a saved name is trimmed, shortened, and never empty', () => {
  assert.equal(companionName('  Forge   Goblin  '), 'Forge Goblin')
  assert.equal(companionName('x'.repeat(40)).length, 16)
  assert.equal(companionName('   '), COMPANION_DEFAULT_NAME)
  assert.equal(companionName(42), COMPANION_DEFAULT_NAME)
})
