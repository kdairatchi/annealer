import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SAMPLE_REQUESTS, type Request } from '../data.ts'
import type { RequestChange } from '../live/update-queue.ts'
import { CHEER_MS, COMPANION_MOODS, companionStatus } from './companion-mood.ts'
import { ACCENT_TONES, ACCENTS, contrast } from '../growth/grove-view.ts'
import { COMPANION_COLORS, COMPANION_DEFAULT_NAME, COMPANION_PALETTES, COMPANION_SPECIES, COMPANION_UNLOCK_LEVEL, companionName, SPECIES_FRAMES, speciesUnlocked, SPRITE_SIZE } from './companion-sprites.ts'

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
  for (const species of COMPANION_SPECIES) for (const mood of COMPANION_MOODS) {
    assert.ok(SPECIES_FRAMES[species][mood].length >= 2, `${species} ${mood}`)
    for (const frame of SPECIES_FRAMES[species][mood]) {
      assert.equal(frame.length, SPRITE_SIZE, `${species} ${mood}`)
      for (const row of frame) {
        assert.equal(row.length, SPRITE_SIZE, `${species} ${mood}: "${row}"`)
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

test('creatures unlock at their level, the first one from the start, and no two creatures look the same', () => {
  assert.equal(COMPANION_UNLOCK_LEVEL[COMPANION_SPECIES[0]], 1)
  assert.deepEqual(COMPANION_SPECIES.filter((species) => speciesUnlocked(species, 1)), ['cinder'])
  assert.deepEqual(COMPANION_SPECIES.filter((species) => speciesUnlocked(species, 3)), ['cinder', 'sprout', 'moth'])
  assert.deepEqual(COMPANION_SPECIES.filter((species) => speciesUnlocked(species, 6)), ['cinder', 'sprout', 'moth', 'bolt', 'weevil', 'rime'])
  assert.equal(COMPANION_SPECIES.every((species) => speciesUnlocked(species, 7)), true)
  // The list is in the order they unlock.
  const levels = COMPANION_SPECIES.map((species) => COMPANION_UNLOCK_LEVEL[species])
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b))
  const looks = new Set(COMPANION_SPECIES.map((species) => SPECIES_FRAMES[species].working[1].join('')))
  assert.equal(looks.size, COMPANION_SPECIES.length)
})

test('every accent keeps the shipped orange\'s contrast, on near-black text and on a light card', () => {
  const orangeOnCard = contrast('#fd6500', '#fffdf9')
  for (const accent of ACCENTS) {
    const tones = ACCENT_TONES[accent]
    if (!tones) continue
    for (const tone of [tones.primary, tones.bright]) assert.ok(contrast(tone, '#0f0c0a') >= 4.5, `${accent} ${tone} under dark text`)
    assert.ok(contrast(tones.primary, '#fffdf9') >= orangeOnCard - 0.2, `${accent} on a light card: ${contrast(tones.primary, '#fffdf9').toFixed(2)}`)
  }
  assert.equal(ACCENT_TONES.ember, null)
})

test('a job that failed twice running worries the companion, after a cheer and before work in progress', () => {
  const working = { id: 'r1', title: 'Fix it', state: 'working', closed: false, next: { text: 'go' } } as never
  assert.equal(companionStatus([working], [], 0, 'none', []).mood, 'working')
  const worried = companionStatus([working], [], 0, 'none', ['example.com'])
  assert.equal(worried.mood, 'concerned')
  assert.equal(worried.requestId, null)
  assert.match(worried.line, /example\.com/)
  assert.match(companionStatus([], [], 0, 'none', ['a.com', 'b.com']).line, /^2 jobs/)
  const waiting = { id: 'r2', title: 'Answer', state: 'your-move', closed: false, next: { text: 'go' } } as never
  assert.equal(companionStatus([waiting], [], 0, 'none', ['example.com']).mood, 'needs-you')
})
