import assert from 'node:assert/strict'
import { test } from 'node:test'
import { creatureCard, EMPTY_COMPANIONS, hostOfTarget, keptTargets, SAMPLE_COMPANIONS, toCompanionState, workingSpecies } from './companions.ts'
import { DEFAULT_SOUL } from '../../../../shared/annealer/companions.ts'

test('reads the worker\'s answer back and drops what it cannot name', () => {
  assert.deepEqual(toCompanionState(JSON.parse(JSON.stringify(SAMPLE_COMPANIONS))), SAMPLE_COMPANIONS)
  assert.deepEqual(toCompanionState(null), EMPTY_COMPANIONS)
  assert.deepEqual(toCompanionState({ cronlord: { state: 'haunted' }, jobs: 'no', leads: [null, 3], souls: 7, asks: {}, engines: 'all' }), EMPTY_COMPANIONS)
  const odd = toCompanionState({
    cronlord: { state: 'connected', url: 7, open: 'yes' },
    jobs: [{ id: 'j', species: 'wolf', schedule: 'daily' }, { id: 'k', species: 'moth', schedule: 'hourly', recent: [{ status: 'exploded' }, 'x'], target: 'a\u0000b' }],
    leads: [{ id: '1', species: 'moth', kind: 'asset', status: 'promoted', text: 'x' }, { id: '2', species: 'moth', kind: 'asset', status: 'new', text: '<img src=x onerror=alert(1)>\u001b[2J', detail: 7, sources: ['1', 2, null] }],
    ledger: { moth: [{ at: '2026-11-19T00:00:00Z', points: 5 }, { at: 1, points: 5 }, { at: 'x', points: 'many' }], wolf: [{ at: 'x', points: 999 }] },
    scope: [{ id: '1', pattern: 'a.com' }, { id: 2, pattern: 'b.com' }],
    souls: { cinder: { name: 'Ash', engine: 'claude', model: 'claude-opus-4-1-20250805', runsPerDay: 1e9 }, wolf: { name: 'x' } },
    asks: [{ id: 'a', species: 'cinder', engine: 'local', state: 'pondering' }, { id: 'b', species: 'cinder', engine: 'local', state: 'waiting', ritual: 'hypotheses', target: 'example.com' }],
    engines: { none: false, local: 'yes', claude: true, gpt: true },
    opinions: [{ id: '1', species: 'cinder', text: 'x' }, { id: 2, species: 'cinder', target: 'example.com', text: 'kept' }],
    rituals: [{ id: 'r', owner: 'cinder', reach: 'read', lead: 'hypothesis', runner: 'quantum', reads: 'minds', answer: 'song', params: [{ name: 'NOTES', type: 'text', optional: 'yes' }] }],
  })
  assert.deepEqual(odd.cronlord, { state: 'connected', url: null, version: null, open: false })
  assert.deepEqual(odd.jobs.map((job) => [job.id, job.target, job.recent]), [['k', 'a b', [{ status: 'unknown', at: null }]]])
  // Kept as the text it is. The page prints it as text; nothing here is markup.
  assert.deepEqual(odd.leads.map((lead) => [lead.text, lead.detail, lead.sources]), [['<img src=x onerror=alert(1)> [2J', '', ['1']]])
  assert.equal(odd.ledger.moth.length, 1)
  assert.equal('wolf' in odd.ledger, false)
  assert.deepEqual(odd.scope, [{ id: 2, pattern: 'b.com' }])
  // A dated Claude id is not kept, and no limit is taken on trust.
  assert.deepEqual(odd.souls.cinder, { ...DEFAULT_SOUL, name: 'Ash', engine: 'claude', model: 'haiku', runsPerDay: 48 })
  assert.equal('wolf' in odd.souls, false)
  assert.deepEqual(odd.asks.map((ask) => ask.id), ['b'])
  assert.deepEqual(odd.engines, { none: true, local: false, claude: true })
  assert.deepEqual(odd.opinions.map((opinion) => opinion.id), [2])
  assert.deepEqual(odd.rituals.map((ritual) => [ritual.runner, ritual.reads, ritual.answer, ritual.params[0].optional]), [['shell', 'nothing', null, false]])
})

test('a creature\'s card comes from its ledger, its jobs, its questions and its leads', () => {
  const moth = creatureCard(SAMPLE_COMPANIONS, 'moth')
  assert.equal(moth.points, 63)
  assert.equal(moth.level, 2)
  assert.deepEqual([moth.jobs, moth.waiting, moth.failing, moth.name], [1, 1, [], ''])
  const bolt = creatureCard(SAMPLE_COMPANIONS, 'bolt')
  assert.deepEqual([bolt.level, bolt.failing], [1, ['https://app.example.com/main.js']])
  const cinder = creatureCard(SAMPLE_COMPANIONS, 'cinder')
  assert.deepEqual([cinder.name, cinder.points, cinder.level, cinder.waiting], ['Ash', 200, 3, 1])
  assert.equal(creatureCard(SAMPLE_COMPANIONS, 'rime').thinking, 1)
  assert.equal(creatureCard(EMPTY_COMPANIONS, 'cinder').level, 1)
})

test('only creatures a ritual names can be given work', () => {
  assert.deepEqual(workingSpecies(SAMPLE_COMPANIONS), ['cinder', 'moth', 'bolt', 'weevil', 'rime', 'quill'])
  assert.deepEqual(workingSpecies(EMPTY_COMPANIONS), [])
})

test('the targets a creature can be asked about are the hosts with something found and kept', () => {
  assert.equal(hostOfTarget('https://app.example.com/main.js'), 'app.example.com')
  assert.equal(hostOfTarget('Example.com'), 'example.com')
  assert.equal(hostOfTarget('not a host'), '')
  // Two kept finds: one on example.com, one on app.example.com. Hypotheses and noise do not count.
  assert.deepEqual(keptTargets(SAMPLE_COMPANIONS.leads), [{ host: 'example.com', count: 2 }, { host: 'app.example.com', count: 1 }])
  assert.deepEqual(keptTargets([]), [])
})
