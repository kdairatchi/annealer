import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addNote, branchTrail, dueNotes, readTrail, removeNote, toggleNote, TRAIL_KEPT, TRAIL_TEXT_MAX, trailLink, type TrailNote } from './trail.ts'

const note = (id: string, change: Partial<TrailNote> = {}): TrailNote => ({ id, branchId: 'a', text: id, link: null, remindOn: null, done: false, createdAt: `2026-11-${id.padStart(2, '0')}`, ...change })

test('only http and https are kept as links', () => {
  assert.equal(trailLink(' https://example.com/a?b=1 '), 'https://example.com/a?b=1')
  assert.equal(trailLink('http://localhost:37777'), 'http://localhost:37777/')
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'example.com', '', null, 42]) assert.equal(trailLink(bad), null)
})

test('a note is cleaned on the way in, and an empty one is not added', () => {
  const list = addNote([], { id: '1', branchId: 'a', text: `  check   the\nredirect ${'x'.repeat(400)}`, link: 'javascript:alert(1)', remindOn: 'tomorrow', createdAt: '2026-11-18' })
  assert.equal(list.length, 1)
  assert.ok(list[0].text.startsWith('check the redirect x'))
  assert.equal(list[0].text.length, TRAIL_TEXT_MAX)
  assert.deepEqual([list[0].link, list[0].remindOn, list[0].done], [null, null, false])
  assert.equal(addNote(list, { id: '2', branchId: 'a', text: '   ', createdAt: '' }).length, 1)
})

test('saved notes that cannot be read are dropped, not trusted', () => {
  assert.deepEqual(readTrail('nope'), [])
  assert.deepEqual(readTrail('{"id":"1"}'), [])
  const good = note('1', { link: 'https://example.com/', remindOn: '2026-11-20' })
  assert.deepEqual(readTrail(JSON.stringify([good, { ...good, id: '' }, { ...good, text: '' }, { ...good, id: '2', link: 'javascript:x', remindOn: 'soon', done: 'yes' }, null])), [good, { ...good, id: '2', link: null, remindOn: null, done: false }])
})

test('reminders come due on their day, earliest first, and finished ones stay quiet', () => {
  const list = [note('1', { remindOn: '2026-11-20' }), note('2', { remindOn: '2026-11-18' }), note('3', { remindOn: '2026-11-17', done: true }), note('4')]
  assert.deepEqual(dueNotes(list, '2026-11-19').map((entry) => entry.id), ['2'])
  assert.deepEqual(dueNotes(list, '2026-11-20').map((entry) => entry.id), ['2', '1'])
  assert.deepEqual(dueNotes(toggleNote(list, '2'), '2026-11-20').map((entry) => entry.id), ['1'])
})

test('a branch shows its own notes, unfinished first then newest, and removing one leaves the rest', () => {
  const list = [note('1'), note('2', { done: true }), note('3'), note('4', { branchId: 'b' })]
  assert.deepEqual(branchTrail(list, 'a').map((entry) => entry.id), ['3', '1', '2'])
  assert.deepEqual(removeNote(list, '3').map((entry) => entry.id), ['1', '2', '4'])
})

test('when the trail is full, the oldest finished note makes room before any unfinished one', () => {
  const full = Array.from({ length: TRAIL_KEPT }, (_, index) => note(String(index + 1), { done: index === 5 }))
  const next = addNote(full, { id: 'new', branchId: 'a', text: 'new', createdAt: '2026-12-01' })
  assert.equal(next.length, TRAIL_KEPT)
  assert.equal(next.some((entry) => entry.id === '6'), false)
  assert.equal(next.at(-1)!.id, 'new')
  assert.equal(next[0].id, '1')
})

test('a due reminder is the first step of the tune-up and points at its branch', async () => {
  const { tuneUp } = await import('./tune-up.ts')
  const steps = tuneUp([], [], [], 'Next step not recorded', [note('9', { text: 'retest the open redirect', branchId: 'b', remindOn: '2026-11-18' })])
  assert.deepEqual(steps, [{ id: 'reminder:9', kind: 'reminder', subject: 'retest the open redirect', gain: null, target: { kind: 'branch', branchId: 'b' } }])
})
