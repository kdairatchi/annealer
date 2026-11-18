// Benchmarks for the work itself: how much of each branch has shipped, how much has been reviewed, and what is stuck.
// These measure recorded work, not a model. Every figure is a count or a share of counts from the growth model, and a
// share with nothing to divide by is null, never zero. Pure, so `node --test` can load it.
import type { Grove, GrowthBranch } from './growth-model.ts'

export interface Benchmark {
  /** A branch id, or null for the whole tree. */
  id: string | null
  name: string
  level: number
  requests: number
  shipped: number
  /** Shipped requests out of all requests on the branch. */
  shipRate: number | null
  /** Open requests a review has read, out of open requests. */
  reviewCoverage: number | null
  /** Mean reviewed percent across the open requests a review has read. */
  averageProgress: number | null
  /** Shipped requests a person marked checked, out of shipped requests. */
  checkedRate: number | null
  needsYou: number
  /** Open requests with no recorded next step. */
  adrift: number
  workProduct: number
}

/** The benchmark columns that can be sorted. One list: the table's headers and its sort both read it. */
export const BENCHMARK_COLUMNS = ['requests', 'shipRate', 'reviewCoverage', 'averageProgress', 'checkedRate', 'adrift', 'needsYou'] as const
export type BenchmarkColumn = (typeof BENCHMARK_COLUMNS)[number]

/** Column headers. A new column fails the typecheck until it has words here. */
export const BENCHMARK_COLUMN_LABEL: Record<BenchmarkColumn, string> = {
  requests: 'Requests', shipRate: 'Shipped', reviewCoverage: 'Reviewed', averageProgress: 'Progress',
  checkedRate: 'Checked', adrift: 'No next step', needsYou: 'Needs you',
}

/** What each column measures, in a sentence, for its header's tooltip. */
export const BENCHMARK_COLUMN_MEANING: Record<BenchmarkColumn, string> = {
  requests: 'Open and shipped requests on this branch.',
  shipRate: 'Requests recorded as shipped, out of all requests here.',
  reviewCoverage: 'Open requests a progress review has read, out of open requests.',
  averageProgress: 'Average reviewed percent across the open requests that were reviewed.',
  checkedRate: 'Shipped requests you marked checked, out of shipped requests.',
  adrift: 'Open requests with no next step recorded.',
  needsYou: 'Requests waiting on your move or your check.',
}

const share = (part: number, whole: number) => (whole === 0 ? null : part / whole)

function measure(id: string | null, name: string, level: number, twigs: GrowthBranch['twigs']): Benchmark {
  const shipped = twigs.filter((twig) => twig.state === 'shipped')
  const open = twigs.filter((twig) => twig.state !== 'shipped')
  const reviewed = open.filter((twig) => twig.percent !== null)
  return {
    id, name, level, requests: twigs.length, shipped: shipped.length,
    shipRate: share(shipped.length, twigs.length),
    reviewCoverage: share(reviewed.length, open.length),
    averageProgress: reviewed.length === 0 ? null : reviewed.reduce((sum, twig) => sum + twig.percent!, 0) / reviewed.length / 100,
    checkedRate: share(shipped.filter((twig) => twig.checked).length, shipped.length),
    needsYou: twigs.filter((twig) => twig.state === 'your-move' || twig.state === 'needs-check').length,
    adrift: twigs.filter((twig) => twig.missingNextStep).length,
    workProduct: twigs.reduce((sum, twig) => sum + twig.leaves, 0),
  }
}

export function benchmarks(grove: Grove, wholeName = 'Whole tree'): { whole: Benchmark; branches: Benchmark[] } {
  return {
    whole: measure(null, wholeName, grove.level, grove.branches.flatMap((branch) => branch.twigs)),
    branches: grove.branches.map((branch) => measure(branch.id, branch.name, branch.level, branch.twigs)),
  }
}

/** Rows ordered by a column. Rows with nothing to measure in that column go last either way. */
export function sortBenchmarks(rows: readonly Benchmark[], column: BenchmarkColumn, descending: boolean): Benchmark[] {
  return [...rows].sort((a, b) => {
    const left = a[column]
    const right = b[column]
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
    return descending ? right - left : left - right
  })
}

// ── Growth over time ─────────────────────────────────────────────────────────────────────────────────────────────────
// The worker keeps no history of the tree, so the page keeps its own: one snapshot for each day the Grove was opened.
// A day the Grove was not opened has no snapshot, and the chart says so instead of drawing a line through it.

export interface GroveSnapshot { day: string; points: number; level: number; requests: number; shipped: number }

/** Snapshots kept. About three months of daily visits. */
export const SNAPSHOTS_KEPT = 90

export const snapshotOf = (grove: Grove, day: string): GroveSnapshot => {
  const twigs = grove.branches.flatMap((branch) => branch.twigs)
  return { day, points: grove.points, level: grove.level, requests: twigs.length, shipped: twigs.filter((twig) => twig.state === 'shipped').length }
}

const isSnapshot = (value: unknown): value is GroveSnapshot => {
  const entry = value as GroveSnapshot | null
  return !!entry && typeof entry === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.day))
    && [entry.points, entry.level, entry.requests, entry.shipped].every((figure) => Number.isFinite(figure) && figure >= 0)
}

/** Saved snapshots read back safely: anything unreadable is dropped, the rest is in day order. */
export function readSnapshots(saved: string | null): GroveSnapshot[] {
  try {
    const list: unknown = JSON.parse(saved ?? '[]')
    return Array.isArray(list) ? list.filter(isSnapshot).sort((a, b) => a.day.localeCompare(b.day)).slice(-SNAPSHOTS_KEPT) : []
  } catch {
    return []
  }
}

/** The list with today's snapshot in it: today's replaces an earlier one from the same day, older days are kept. */
export function withSnapshot(list: readonly GroveSnapshot[], snapshot: GroveSnapshot): GroveSnapshot[] {
  return [...list.filter((entry) => entry.day !== snapshot.day), snapshot].sort((a, b) => a.day.localeCompare(b.day)).slice(-SNAPSHOTS_KEPT)
}
