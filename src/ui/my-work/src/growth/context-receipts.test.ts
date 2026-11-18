import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SAMPLE_REQUESTS } from '../data.ts'
import { compareReceipts, mostSent, receiptKey, receiptTotals, requestOfReceipt, SAMPLE_RECEIPTS, toReceipts, type Receipt } from './context-receipts.ts'

const receipt = (change: Partial<Receipt>): Receipt => ({ at: '2026-11-18T10:00:00.000Z', sessionId: 's', platform: 'claude-code', projects: ['p'], source: 'worker', cacheAgeMs: null, chars: 400, tokens: 100, sections: [], memories: [], summaries: 0, hash: 'h', ...change })
const memory = (id: string, title = `m${id}`) => ({ id, title })

test('the worker answer is read safely: wrong shapes are dropped, wrong fields become empty', () => {
  assert.deepEqual(toReceipts(null), [])
  assert.deepEqual(toReceipts({ receipts: 'x' }), [])
  const good = receipt({ memories: [memory('1')] })
  const read = toReceipts({ receipts: [good, { ...good, at: 'never' }, { ...good, source: 'guess' }, null, { at: good.at, source: 'cache', cacheAgeMs: 9, tokens: -4, memories: [{ id: '' }, { id: '7' }], projects: [1, 'p'] }] })
  assert.deepEqual(read[0], good)
  assert.equal(read.length, 2)
  assert.deepEqual([read[1].tokens, read[1].cacheAgeMs, read[1].sessionId, read[1].projects], [0, 9, null, ['p']])
  assert.deepEqual(read[1].memories, [{ id: '7', title: '' }])
})

test('totals count sessions, average size, the cached share, distinct memories and repeats of the session before', () => {
  assert.deepEqual(receiptTotals([]), { sessions: 0, averageTokens: null, cachedShare: null, distinctMemories: 0, identicalToPrevious: 0 })
  const totals = receiptTotals(SAMPLE_RECEIPTS)
  assert.deepEqual(totals, { sessions: 3, averageTokens: 1730, cachedShare: 1 / 3, distinctMemories: 4, identicalToPrevious: 1 })
  assert.equal(receiptTotals([receipt({ hash: '' }), receipt({ hash: '' })]).identicalToPrevious, 0)
})

test('most sent counts sessions, not mentions, and keeps the newest title', () => {
  const sent = mostSent([
    receipt({ memories: [memory('5', 'new title'), memory('5', 'new title'), memory('9')] }),
    receipt({ memories: [memory('5', 'old title')] }),
    receipt({ memories: [memory('12')] }),
  ], 2)
  assert.deepEqual(sent, [{ id: '5', title: 'new title', sessions: 2, share: 2 / 3 }, { id: '9', title: 'm9', sessions: 1, share: 1 / 3 }])
})

test('comparing two sessions splits their memories three ways and gives the size difference', () => {
  const [newest, , oldest] = SAMPLE_RECEIPTS
  const diff = compareReceipts(oldest, newest)
  assert.deepEqual(diff.onlyFirst.map((entry) => entry.id), ['2181'])
  assert.deepEqual(diff.onlySecond.map((entry) => entry.id), ['2210', '2204'])
  assert.deepEqual(diff.both.map((entry) => entry.id), ['2198'])
  assert.deepEqual([diff.tokenDifference, diff.identical], [300, false])
  assert.equal(compareReceipts(SAMPLE_RECEIPTS[0], SAMPLE_RECEIPTS[1]).identical, true)
})

test('a receipt is tied to a request only through a recorded conversation with the same session id', () => {
  const request = { ...SAMPLE_REQUESTS[0], conversations: [{ tool: 'Claude Code', at: '', title: '', platform: 'claude', conversationSessionId: 'abc' }] }
  assert.equal(requestOfReceipt(receipt({ sessionId: 'abc' }), [request])?.id, request.id)
  assert.equal(requestOfReceipt(receipt({ sessionId: 'zzz' }), [request]), null)
  assert.equal(requestOfReceipt(receipt({ sessionId: null }), [request]), null)
})

test('sample receipts have distinct keys', () => {
  assert.equal(new Set(SAMPLE_RECEIPTS.map(receiptKey)).size, SAMPLE_RECEIPTS.length)
})
