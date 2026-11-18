// Context receipts on the page: what each session was told when it started, as the SessionStart hook recorded it
// (src/shared/annealer/context-receipts.ts writes them; the worker lists them at /api/annealer/context-receipts).
// Everything here is arithmetic over those records. Pure, so `node --test` can load it.
import type { Request } from '../data.ts'

/** Where the hook got the text. Mirrors CONTEXT_RECEIPT_SOURCES in the worker's module. */
export const RECEIPT_SOURCES = ['worker', 'cache', 'server'] as const
export type ReceiptSource = (typeof RECEIPT_SOURCES)[number]

/** Each source in words. A new source fails the typecheck until it has them. */
export const RECEIPT_SOURCE_LABEL: Record<ReceiptSource, string> = { worker: 'Fresh', cache: 'Cached', server: 'Server' }
export const RECEIPT_SOURCE_MEANING: Record<ReceiptSource, string> = {
  worker: 'Rendered by the worker for this session.',
  cache: 'Read from the saved render on disk, without asking the worker.',
  server: 'Rendered by the hosted server.',
}

export interface ReceiptMemory { id: string; title: string }
export interface Receipt {
  at: string
  sessionId: string | null
  platform: string
  projects: string[]
  source: ReceiptSource
  cacheAgeMs: number | null
  chars: number
  tokens: number
  sections: { title: string; chars: number }[]
  memories: ReceiptMemory[]
  summaries: number
  hash: string
}

/** A stable key for a receipt in a list: receipts have no id of their own. */
export const receiptKey = (receipt: Receipt) => `${receipt.at}|${receipt.sessionId ?? ''}|${receipt.hash}`

/** The worker's answer read safely: the page trusts only the shape it checks here. */
export function toReceipts(body: unknown): Receipt[] {
  const list = (body as { receipts?: unknown } | null)?.receipts
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    const raw = entry as Partial<Receipt> | null
    if (!raw || typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at)) || !RECEIPT_SOURCES.includes(raw.source as ReceiptSource)) return []
    const size = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
    return [{
      at: raw.at, sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null, platform: typeof raw.platform === 'string' ? raw.platform : '',
      projects: Array.isArray(raw.projects) ? raw.projects.filter((project) => typeof project === 'string') : [],
      source: raw.source as ReceiptSource, cacheAgeMs: typeof raw.cacheAgeMs === 'number' ? size(raw.cacheAgeMs) : null,
      chars: size(raw.chars), tokens: size(raw.tokens),
      sections: Array.isArray(raw.sections) ? raw.sections.map((section) => ({ title: String(section?.title ?? ''), chars: size(section?.chars) })) : [],
      memories: Array.isArray(raw.memories) ? raw.memories.filter((memory) => typeof memory?.id === 'string' && memory.id).map((memory) => ({ id: memory.id, title: String(memory.title ?? '') })) : [],
      summaries: size(raw.summaries), hash: typeof raw.hash === 'string' ? raw.hash : '',
    }]
  })
}

export interface ReceiptTotals { sessions: number; averageTokens: number | null; cachedShare: number | null; distinctMemories: number; identicalToPrevious: number }

/** Receipts are newest first, as the worker returns them. */
export function receiptTotals(receipts: readonly Receipt[]): ReceiptTotals {
  const count = receipts.length
  return {
    sessions: count,
    averageTokens: count === 0 ? null : Math.round(receipts.reduce((sum, receipt) => sum + receipt.tokens, 0) / count),
    cachedShare: count === 0 ? null : receipts.filter((receipt) => receipt.source === 'cache').length / count,
    distinctMemories: new Set(receipts.flatMap((receipt) => receipt.memories.map((memory) => memory.id))).size,
    // A session told exactly what the session before it was told.
    identicalToPrevious: receipts.filter((receipt, index) => receipt.hash !== '' && receipts[index + 1]?.hash === receipt.hash).length,
  }
}

export interface SentMemory { id: string; title: string; sessions: number; share: number }

/** The memories sent to the most sessions, most first. A memory sent twice in one session counts once. */
export function mostSent(receipts: readonly Receipt[], limit: number): SentMemory[] {
  const counts = new Map<string, { title: string; sessions: number }>()
  for (const receipt of receipts) {
    for (const id of new Set(receipt.memories.map((memory) => memory.id))) {
      const seen = counts.get(id)
      // Receipts are newest first, so the first title seen is the memory's current one.
      if (seen) seen.sessions += 1
      else counts.set(id, { title: receipt.memories.find((memory) => memory.id === id)!.title, sessions: 1 })
    }
  }
  return [...counts.entries()]
    .map(([id, entry]) => ({ id, title: entry.title, sessions: entry.sessions, share: entry.sessions / receipts.length }))
    .sort((a, b) => b.sessions - a.sessions || a.id.localeCompare(b.id, undefined, { numeric: true }))
    .slice(0, limit)
}

export interface ReceiptComparison { onlyFirst: ReceiptMemory[]; onlySecond: ReceiptMemory[]; both: ReceiptMemory[]; tokenDifference: number; identical: boolean }

/** What two sessions were told, set against each other. `tokenDifference` is the second minus the first. */
export function compareReceipts(first: Receipt, second: Receipt): ReceiptComparison {
  const inFirst = new Set(first.memories.map((memory) => memory.id))
  const inSecond = new Set(second.memories.map((memory) => memory.id))
  return {
    onlyFirst: first.memories.filter((memory) => !inSecond.has(memory.id)),
    onlySecond: second.memories.filter((memory) => !inFirst.has(memory.id)),
    both: first.memories.filter((memory) => inSecond.has(memory.id)),
    tokenDifference: second.tokens - first.tokens,
    identical: first.hash !== '' && first.hash === second.hash,
  }
}

/** The request whose recorded conversation is this receipt's session, when there is one. */
export function requestOfReceipt(receipt: Receipt, requests: readonly Request[]): Request | null {
  if (!receipt.sessionId) return null
  return requests.find((request) => request.conversations.some((conversation) => conversation.conversationSessionId === receipt.sessionId)) ?? null
}

/** Sample receipts for the wireframe's sample data. Never mixed with real ones. */
export const SAMPLE_RECEIPTS: Receipt[] = [
  { at: '2026-10-20T20:16:00.000Z', sessionId: 'sample-3', platform: 'claude-code', projects: ['claude-mem'], source: 'cache', cacheAgeMs: 240_000, chars: 7320, tokens: 1830, hash: 'a1',
    sections: [{ title: 'Recent work', chars: 5900 }, { title: 'Rules and tools', chars: 1420 }], summaries: 2,
    memories: [{ id: '2210', title: 'My Work reads the saved database, no model call' }, { id: '2204', title: 'Decided: cards and list share one model' }, { id: '2198', title: 'Viewer build writes straight into plugin/ui' }] },
  { at: '2026-10-20T18:02:00.000Z', sessionId: 'sample-2', platform: 'codex', projects: ['claude-mem'], source: 'worker', cacheAgeMs: null, chars: 7320, tokens: 1830, hash: 'a1',
    sections: [{ title: 'Recent work', chars: 5900 }, { title: 'Rules and tools', chars: 1420 }], summaries: 2,
    memories: [{ id: '2210', title: 'My Work reads the saved database, no model call' }, { id: '2204', title: 'Decided: cards and list share one model' }, { id: '2198', title: 'Viewer build writes straight into plugin/ui' }] },
  { at: '2026-10-19T16:40:00.000Z', sessionId: 'sample-1', platform: 'claude-code', projects: ['claude-mem'], source: 'worker', cacheAgeMs: null, chars: 6120, tokens: 1530, hash: 'b7',
    sections: [{ title: 'Recent work', chars: 4700 }, { title: 'Rules and tools', chars: 1420 }], summaries: 1,
    memories: [{ id: '2198', title: 'Viewer build writes straight into plugin/ui' }, { id: '2181', title: 'Sync pull is a nudge, never a wait' }] },
]
