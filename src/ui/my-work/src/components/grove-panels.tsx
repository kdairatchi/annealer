// The Grove's two working panels: Benchmarks (how each branch is doing, in counts you can sort) and the Tune-up
// (a session that walks you through what would grow the tree right now). Both read recorded work only.
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { interpolate, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sprite } from '@/companion/companion'
import { COMPANION_FRAMES } from '@/companion/companion-sprites'
import {
  BENCHMARK_COLUMN_LABEL, BENCHMARK_COLUMN_MEANING, BENCHMARK_COLUMNS, benchmarks, readSnapshots, snapshotOf, sortBenchmarks, withSnapshot,
  type Benchmark, type BenchmarkColumn, type GroveSnapshot,
} from '@/growth/benchmarks'
import type { Grove } from '@/growth/growth-model'
import { TUNE_UP_LABEL, TUNE_UP_REASON, type TuneUpStep, type TuneUpTarget } from '@/growth/tune-up'
import { useStore } from '@/store'

/** Columns that hold a share (0 to 1) and are drawn with a bar; the rest are plain counts. */
const SHARE_COLUMNS: ReadonlySet<BenchmarkColumn> = new Set(['shipRate', 'reviewCoverage', 'averageProgress', 'checkedRate'])
/** Where the page keeps its daily snapshots of the tree. */
const SNAPSHOT_KEY = 'annealer:grove:snapshots'
const today = () => new Date().toLocaleDateString('en-CA')

function Cell({ row, column }: { row: Benchmark; column: BenchmarkColumn }) {
  const value = row[column]
  if (value === null) return <span className="text-muted-foreground">–</span>
  if (!SHARE_COLUMNS.has(column)) {
    const alarm = value > 0 && (column === 'adrift' || column === 'needsYou')
    return <span className={cn('font-mono tabular-nums', alarm && 'text-attention-foreground')}>{value}</span>
  }
  return (
    <span className="flex items-center justify-end gap-2">
      <span aria-hidden="true" className="hidden h-1 w-12 overflow-hidden rounded-full bg-border sm:block"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} /></span>
      <span className="w-9 text-right font-mono tabular-nums">{Math.round(value * 100)}%</span>
    </span>
  )
}

/** Growth on the days the Grove was opened. Days it was not opened are gaps, and the caption says how many days it has. */
function Trend({ snapshots }: { snapshots: GroveSnapshot[] }) {
  const { t } = useI18n()
  if (snapshots.length < 2) return <p className="text-xs text-muted-foreground">{t('The growth chart starts on the second day you open the Grove. The worker keeps no history of the tree, so this page saves one snapshot a day in this browser.')}</p>
  const width = 320
  const height = 56
  const top = Math.max(...snapshots.map((entry) => entry.points), 1)
  const x = (index: number) => 4 + (index / (snapshots.length - 1)) * (width - 8)
  const y = (points: number) => height - 6 - (points / top) * (height - 14)
  const line = snapshots.map((entry, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(entry.points).toFixed(1)}`).join(' ')
  const first = snapshots[0]
  const last = snapshots.at(-1)!
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={interpolate(t('Growth from {from} on {first} to {to} on {last}.'), { from: first.points, first: first.day, to: last.points, last: last.day })} className="h-14 w-full max-w-sm">
        <line x1={4} x2={width - 4} y1={height - 6} y2={height - 6} className="stroke-border" strokeWidth={1} />
        <motion.path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-primary" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
        {snapshots.map((entry, index) => <circle key={entry.day} cx={x(index)} cy={y(entry.points)} r={index === snapshots.length - 1 ? 3.5 : 2} className="fill-primary"><title>{`${entry.day}: ${entry.points}`}</title></circle>)}
      </svg>
      <figcaption className="text-xs text-muted-foreground">{interpolate(t('Growth on the {count} days you opened the Grove: {from} on {first}, {to} today. Saved in this browser only.'), { count: snapshots.length, from: first.points, first: first.day, to: last.points })}</figcaption>
    </figure>
  )
}

export function Benchmarks({ grove, sample, onOpenBranch, onSpotlight }: { grove: Grove; sample: boolean; onOpenBranch: (branchId: string) => void; onSpotlight: (branchId: string | null) => void }) {
  const { t } = useI18n()
  const [sort, setSort] = useState<{ column: BenchmarkColumn; descending: boolean }>({ column: 'requests', descending: true })
  const measured = useMemo(() => benchmarks(grove, t('Whole tree')), [grove, t])
  const rows = useMemo(() => sortBenchmarks(measured.branches, sort.column, sort.descending), [measured, sort])
  // One snapshot a day, of real data only: the sample fixtures never read or write the saved history.
  const snapshots = useMemo<GroveSnapshot[]>(() => {
    if (sample) return []
    const now = snapshotOf(grove, today())
    try { return withSnapshot(readSnapshots(localStorage.getItem(SNAPSHOT_KEY)), now) } catch { return [now] }
  }, [grove, sample])
  useEffect(() => {
    if (sample) return
    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots)) } catch { /* Storage is blocked: the chart has no history this visit. */ }
  }, [snapshots, sample])

  return (
    <section aria-label={t('Benchmarks')} className="space-y-4 rounded-xl border bg-card/70 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-md">
          <p className="section-label">{t('Benchmarks')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('How each branch is doing, counted from recorded work. Pick a column to sort by it, or a row to open that branch.')}</p>
        </div>
        {sample ? <p className="text-xs text-muted-foreground">{t('Sample data: no history is kept.')}</p> : <Trend snapshots={snapshots} />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 text-left font-medium">{t('Branch')}</th>
              {BENCHMARK_COLUMNS.map((column) => {
                const active = sort.column === column
                return (
                  <th key={column} scope="col" aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'} className="py-1 pl-3 text-right font-medium">
                    <Button variant="bare" title={t(BENCHMARK_COLUMN_MEANING[column])} onClick={() => setSort({ column, descending: active ? !sort.descending : true })}
                      className={cn('inline-flex items-center gap-1 rounded px-1 py-1 text-xs font-medium hover:text-foreground', active ? 'text-foreground' : 'text-muted-foreground')}>
                      {t(BENCHMARK_COLUMN_LABEL[column])}
                      {active && (sort.descending ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
                    </Button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="cursor-pointer border-b transition-colors hover:bg-accent/30" onClick={() => onOpenBranch(row.id!)} onPointerEnter={() => onSpotlight(row.id)} onPointerLeave={() => onSpotlight(null)}>
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  <Button variant="bare" onClick={(event) => { event.stopPropagation(); onOpenBranch(row.id!) }} onFocus={() => onSpotlight(row.id)} onBlur={() => onSpotlight(null)} className="flex items-baseline gap-2 text-left font-medium hover:underline">
                    <span className="truncate">{row.name}</span><span className="font-mono text-[10px] text-primary tabular-nums">LV {row.level}</span>
                  </Button>
                </th>
                {BENCHMARK_COLUMNS.map((column) => <td key={column} className="py-2 pl-3 text-right"><Cell row={row} column={column} /></td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <th scope="row" className="py-2 pr-3 text-left">{measured.whole.name} <span className="font-mono text-[10px] text-primary tabular-nums">LV {measured.whole.level}</span></th>
              {BENCHMARK_COLUMNS.map((column) => <td key={column} className="py-2 pl-3 text-right"><Cell row={measured.whole} column={column} /></td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('A dash means there is nothing to measure yet, which is different from zero. Hover a column name to see exactly what it counts.')}</p>
    </section>
  )
}

/** The tune-up session: one step at a time, with the companion saying why it matters. */
export function TuneUp({ steps, onGo }: { steps: TuneUpStep[]; onGo: (target: TuneUpTarget) => void }) {
  const { t } = useI18n()
  const companion = useStore((state) => state.view.companion)
  // The place is kept by step id, so when a step is really done and drops out of the list, the session moves on
  // to whatever took its place instead of jumping back to the start.
  const [at, setAt] = useState(0)
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const remaining = steps.filter((step) => !skipped.has(step.id))
  const index = Math.min(at, Math.max(0, remaining.length - 1))
  const step = remaining[index]

  if (steps.length === 0 || !step) {
    return (
      <section aria-label={t('Tune-up')} className="flex flex-wrap items-center gap-4 rounded-xl border bg-card/70 p-4 md:p-5">
        <Sprite frame={COMPANION_FRAMES.celebrating[0]} palette={companion.palette} className="size-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="section-label">{t('Tune-up')}</p>
          <p className="mt-1 font-medium">{steps.length === 0 ? t('Nothing is waiting on you.') : t('That was the last step.')}</p>
          <p className="text-sm text-muted-foreground">{steps.length === 0
            ? t('No version to check, no question to answer, no rule or focus area to decide, and every open request has a next step.')
            : interpolate(t(skipped.size === 1 ? 'You skipped {count} step. It is still waiting.' : 'You skipped {count} steps. They are still waiting.'), { count: skipped.size })}</p>
        </div>
        {skipped.size > 0 && <Button size="sm" variant="outline" onClick={() => { setSkipped(new Set()); setAt(0) }}>{t('Go through the skipped steps')}</Button>}
      </section>
    )
  }

  const gain = remaining.reduce((sum, entry) => sum + (entry.gain ?? 0), 0)
  return (
    <section aria-label={t('Tune-up')} className="space-y-4 rounded-xl border bg-card/70 p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="section-label">{t('Tune-up')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {interpolate(t(remaining.length === 1 ? '{count} thing would grow this tree right now.' : '{count} things would grow this tree right now.'), { count: remaining.length })}
            {gain > 0 && <> {interpolate(t('The checks alone are worth +{gain}.'), { gain })}</>}
          </p>
        </div>
        <ol aria-label={t('Steps')} className="flex flex-wrap gap-1">
          {remaining.map((entry, position) => (
            <li key={entry.id}>
              <Button variant="bare" aria-label={interpolate(t('Step {position}: {label}'), { position: position + 1, label: t(TUNE_UP_LABEL[entry.kind]) })} aria-current={position === index ? 'step' : undefined} onClick={() => setAt(position)}
                className={cn('block h-2 rounded-full transition-all', position === index ? 'w-6 bg-primary' : 'w-2 bg-border hover:bg-muted-foreground')} />
            </li>
          ))}
        </ol>
      </div>
      <motion.div key={step.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex flex-wrap items-start gap-4 rounded-lg border border-border/70 bg-card p-4">
        <Sprite frame={COMPANION_FRAMES[step.kind === 'answer' || step.kind === 'check' ? 'needs-you' : 'working'][0]} palette={companion.palette} className="size-14 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[11px] tracking-wider text-muted-foreground">{String(index + 1).padStart(2, '0')} / {String(remaining.length).padStart(2, '0')}</span>
            <span className="font-semibold">{t(TUNE_UP_LABEL[step.kind])}</span>
            {step.gain !== null && <span className="font-mono text-xs text-primary tabular-nums">+{step.gain}</span>}
          </p>
          <p className="text-sm">{step.target.kind === 'request' ? `“${step.subject}”` : step.subject}</p>
          <p className="text-sm text-muted-foreground">{t(TUNE_UP_REASON[step.kind])}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => onGo(step.target)}>{t(step.target.kind === 'request' ? 'Open the request' : step.target.page === 'rules' ? 'Open My Rules' : step.target.page === 'suggested' ? 'Open Suggested' : 'Open My Work')}<ArrowRightIcon /></Button>
          <Button size="sm" variant="ghost" onClick={() => setSkipped(new Set([...skipped, step.id]))}>{t('Skip for now')}</Button>
        </div>
      </motion.div>
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" disabled={index === 0} onClick={() => setAt(index - 1)}><ChevronLeftIcon />{t('Back')}</Button>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckIcon className="size-3.5" />{t('A step leaves this list when the work is recorded as done, not when you press a button here.')}</p>
        <Button size="sm" variant="outline" disabled={index >= remaining.length - 1} onClick={() => setAt(index + 1)}>{t('Next')}<ChevronRightIcon /></Button>
      </div>
    </section>
  )
}
