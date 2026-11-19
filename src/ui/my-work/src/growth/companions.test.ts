import assert from 'node:assert/strict'
import { test } from 'node:test'
import { creatureCard, EMPTY_COMPANIONS, SAMPLE_COMPANIONS, toCompanionState, workingSpecies } from './companions.ts'

test('reads the worker\'s answer back and drops what it cannot name', () => {
  assert.deepEqual(toCompanionState(JSON.parse(JSON.stringify(SAMPLE_COMPANIONS))), SAMPLE_COMPANIONS)
  assert.deepEqual(toCompanionState(null), EMPTY_COMPANIONS)
  assert.deepEqual(toCompanionState({ cronlord: { state: 'haunted' }, jobs: 'no', leads: [null, 3] }), EMPTY_COMPANIONS)
  const odd = toCompanionState({
    cronlord: { state: 'connected', url: 7, open: 'yes' },
    jobs: [{ id: 'j', species: 'wolf', schedule: 'daily' }, { id: 'k', species: 'moth', schedule: 'hourly', recent: [{ status: 'exploded' }, 'x'], target: 'a\u0000b' }],
    leads: [{ id: '1', species: 'moth', kind: 'asset', status: 'promoted', text: 'x' }, { id: '2', species: 'moth', kind: 'asset', status: 'new', text: '<img src=x onerror=alert(1)>\u001b[2J' }],
    ledger: { moth: [{ at: '2026-11-19T00:00:00Z', points: 5 }, { at: 1, points: 5 }, { at: 'x', points: 'many' }], wolf: [{ at: 'x', points: 999 }] },
    scope: [{ id: '1', pattern: 'a.com' }, { id: 2, pattern: 'b.com' }],
  })
  assert.deepEqual(odd.cronlord, { state: 'connected', url: null, version: null, open: false })
  assert.deepEqual(odd.jobs.map((job) => [job.id, job.target, job.recent]), [['k', 'a b', [{ status: 'unknown', at: null }]]])
  // Kept as the text it is. The page prints it as text; nothing here is markup.
  assert.deepEqual(odd.leads.map((lead) => lead.text), ['<img src=x onerror=alert(1)> [2J'])
  assert.equal(odd.ledger.moth.length, 1)
  assert.equal('wolf' in odd.ledger, false)
  assert.deepEqual(odd.scope, [{ id: 2, pattern: 'b.com' }])
})

test('a creature\'s card comes from its ledger, its jobs and its leads', () => {
  const moth = creatureCard(SAMPLE_COMPANIONS, 'moth')
  assert.equal(moth.points, 63)
  assert.equal(moth.level, 2)
  assert.deepEqual([moth.jobs, moth.waiting, moth.kept, moth.dismissed, moth.failing], [1, 2, 0, 1, []])
  const bolt = creatureCard(SAMPLE_COMPANIONS, 'bolt')
  assert.deepEqual([bolt.level, bolt.failing], [1, ['https://app.example.com/main.js']])
  assert.equal(creatureCard(EMPTY_COMPANIONS, 'cinder').level, 1)
})

test('only creatures a ritual names can be given a job', () => {
  assert.deepEqual(workingSpecies(SAMPLE_COMPANIONS), ['moth', 'bolt'])
  assert.deepEqual(workingSpecies(EMPTY_COMPANIONS), [])
})
