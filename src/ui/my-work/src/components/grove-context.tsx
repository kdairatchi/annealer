// The Grove's Context panel: what each session was told when it started. The SessionStart hook writes a receipt of the
// text it delivers and the worker lists them; this panel reads that list and does arithmetic on it, nothing more.
import { useEffect, useMemo, useState } from 'react'
import { RefreshCwIcon } from 'lucide-react'
import { interpolate, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { Request } from '@/data'
import {
  compareReceipts, mostSent, RECEIPT_SOURCE_LABEL, RECEIPT_SOURCE_MEANING, receiptKey, receiptTotals, requestOfReceipt, SAMPLE_RECEIPTS, toReceipts,
  type Receipt, type ReceiptMemory,
} from '@/growth/context-receipts'

const RECEIPTS_URL = '/api/annealer/context-receipts?limit=200'
const SENT_SHOWN = 8
type Load = { state: 'loading' } | { state: 'ready'; receipts: Receipt[] } | { state: 'failed' }

const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const age = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3_600_000)}h`)

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="min-w-28"><p className="section-label">{label}</p><p className="font-mono text-lg tabular-nums">{value}</p>{note && <p className="text-xs text-muted-foreground">{note}</p>}</div>
}

function MemoryList({ title, memories, tone }: { title: string; memories: ReceiptMemory[]; tone?: string }) {
  const { t } = useI18n()
  return (
    <div className="min-w-0">
      <p className={cn('section-label pb-1', tone)}>{title} · {memories.length}</p>
      {memories.length === 0 ? <p className="text-xs text-muted-foreground">{t('None')}</p> : (
        <ul className="space-y-0.5 text-xs">
          {memories.map((memory) => <li key={memory.id} className="flex gap-2"><span className="shrink-0 font-mono text-muted-foreground tabular-nums">{memory.id}</span><span className="min-w-0 break-words">{memory.title || t('Untitled')}</span></li>)}
        </ul>
      )}
    </div>
  )
}

function ReceiptRow({ receipt, request, open, picked, canPick, onToggle, onPick, onOpenRequest }: {
  receipt: Receipt; request: Request | null; open: boolean; picked: boolean; canPick: boolean
  onToggle: () => void; onPick: () => void; onOpenRequest: (request: Request) => void
}) {
  const { t } = useI18n()
  const largest = Math.max(1, ...receipt.sections.map((section) => section.chars))
  const id = receiptKey(receipt)
  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <input type="checkbox" id={`pick-${id}`} checked={picked} disabled={!picked && !canPick} onChange={onPick} aria-label={interpolate(t('Compare the session from {time}'), { time: when.format(new Date(receipt.at)) })} className="size-4 shrink-0 accent-[var(--primary)]" />
        <Button variant="bare" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 flex-wrap items-baseline justify-start gap-x-3 gap-y-0.5 rounded py-1 text-left text-sm font-normal whitespace-normal hover:bg-accent/30">
          <span className="font-medium">{when.format(new Date(receipt.at))}</span>
          <span className="text-xs text-muted-foreground">{receipt.platform || t('unknown agent')}{receipt.projects.length > 0 && ` · ${receipt.projects.at(-1)}`}</span>
          <span title={t(RECEIPT_SOURCE_MEANING[receipt.source])} className={cn('rounded-full border px-1.5 text-[11px]', receipt.source === 'cache' ? 'border-review-border text-review-foreground' : 'border-border text-muted-foreground')}>
            {t(RECEIPT_SOURCE_LABEL[receipt.source])}{receipt.cacheAgeMs !== null && ` · ${interpolate(t('{age} old'), { age: age(receipt.cacheAgeMs) })}`}
          </span>
          <span className="ml-auto font-mono text-xs tabular-nums">{interpolate(t('about {tokens} tokens · {count} memories'), { tokens: receipt.tokens.toLocaleString(), count: receipt.memories.length })}</span>
        </Button>
      </div>
      {open && (
        <div className="mt-2 ml-7 grid gap-4 rounded-lg border border-border/70 bg-card p-3 md:grid-cols-2">
          <div className="space-y-2">
            <p className="section-label">{t('Sections, by size')}</p>
            <ul className="space-y-1 text-xs">
              {receipt.sections.map((section, index) => (
                <li key={index} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-2">
                  <span className="truncate">{section.title || t('Before the first heading')}</span>
                  <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-primary" style={{ width: `${(section.chars / largest) * 100}%` }} /></span>
                  <span className="text-right font-mono text-muted-foreground tabular-nums">{Math.ceil(section.chars / 4).toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{interpolate(t(receipt.summaries === 1 ? '{count} earlier session was summarised.' : '{count} earlier sessions were summarised.'), { count: receipt.summaries })}</p>
            {request
              ? <Button size="xs" variant="outline" onClick={() => onOpenRequest(request)}>{interpolate(t('Request: {title}'), { title: request.title ?? t('New request') })}</Button>
              : <p className="text-xs text-muted-foreground">{t('No request records a conversation with this session id.')}</p>}
          </div>
          <MemoryList title={t('Memories it was given')} memories={receipt.memories} />
        </div>
      )}
    </li>
  )
}

export function ContextPanel({ sample, requests, onOpenRequest }: { sample: boolean; requests: readonly Request[]; onOpenRequest: (request: Request) => void }) {
  const { t } = useI18n()
  const [load, setLoad] = useState<Load>(sample ? { state: 'ready', receipts: SAMPLE_RECEIPTS } : { state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (sample) return
    const stop = new AbortController()
    fetch(RECEIPTS_URL, { signal: stop.signal, headers: { Accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((body) => setLoad({ state: 'ready', receipts: toReceipts(body) }))
      .catch((error) => { if (!stop.signal.aborted) { console.warn('Context receipts could not be loaded', error); setLoad({ state: 'failed' }) } })
    return () => stop.abort()
  }, [sample, attempt])

  const receipts = useMemo(() => (load.state === 'ready' ? load.receipts : []), [load])
  const totals = useMemo(() => receiptTotals(receipts), [receipts])
  const sent = useMemo(() => mostSent(receipts, SENT_SHOWN), [receipts])
  const pair = picked.map((key) => receipts.find((receipt) => receiptKey(receipt) === key)).filter((receipt): receipt is Receipt => !!receipt)
  // Compared oldest first, so "only the second" reads as what changed since.
  const [first, second] = [...pair].sort((a, b) => a.at.localeCompare(b.at))
  const comparison = first && second ? compareReceipts(first, second) : null

  return (
    <section aria-label={t('Context')} className="space-y-4 rounded-xl border bg-card/70 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="section-label">{t('Context')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('What each session was told when it started. The hook saves a receipt of the text it hands the agent: which memories, how big, and whether it was rendered fresh or read from the saved copy. The text itself is not kept.')}</p>
        </div>
        {!sample && <Button size="sm" variant="outline" disabled={load.state === 'loading'} onClick={() => { setLoad({ state: 'loading' }); setAttempt(attempt + 1) }}><RefreshCwIcon />{t('Reload')}</Button>}
      </div>

      {load.state === 'loading' && <p className="text-sm text-muted-foreground">{t('Loading receipts…')}</p>}
      {load.state === 'failed' && <p className="text-sm text-attention-foreground">{t('Receipts could not be loaded. They come from the local worker; check it is running and is this fork’s build, then reload.')}</p>}
      {load.state === 'ready' && receipts.length === 0 && <p className="text-sm text-muted-foreground">{t('No receipts yet. One is written each time an agent session starts with this fork’s hooks installed. Start a new session, then reload.')}</p>}

      {receipts.length > 0 && (
        <>
          <div className="flex flex-wrap gap-x-8 gap-y-3 border-y py-3">
            <Figure label={t('Sessions')} value={String(totals.sessions)} note={t('most recent, newest first')} />
            <Figure label={t('Average size')} value={totals.averageTokens === null ? '–' : `≈${totals.averageTokens.toLocaleString()}`} note={t('tokens, at 4 characters each')} />
            <Figure label={t('From the saved copy')} value={totals.cachedShare === null ? '–' : `${Math.round(totals.cachedShare * 100)}%`} note={t('the rest were rendered fresh')} />
            <Figure label={t('Same as the one before')} value={String(totals.identicalToPrevious)} note={t('sessions told nothing new')} />
            <Figure label={t('Different memories')} value={String(totals.distinctMemories)} note={t('across these sessions')} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="section-label pb-1">{t('Sessions · tick two to compare')}</p>
              <ul className="divide-y border-t">
                {receipts.map((receipt) => {
                  const key = receiptKey(receipt)
                  return (
                    <ReceiptRow key={key} receipt={receipt} request={requestOfReceipt(receipt, requests)} open={openKey === key} picked={picked.includes(key)} canPick={picked.length < 2}
                      onToggle={() => setOpenKey(openKey === key ? null : key)} onOpenRequest={onOpenRequest}
                      onPick={() => setPicked(picked.includes(key) ? picked.filter((entry) => entry !== key) : [...picked, key])} />
                  )
                })}
              </ul>
            </div>
            <div className="min-w-0 space-y-2">
              <p className="section-label">{t('Sent most often')}</p>
              <ul className="space-y-2 text-xs">
                {sent.map((memory) => (
                  <li key={memory.id} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2"><span className="min-w-0 break-words"><span className="font-mono text-muted-foreground tabular-nums">{memory.id}</span> {memory.title || t('Untitled')}</span><span className="shrink-0 font-mono tabular-nums">{memory.sessions}/{totals.sessions}</span></div>
                    <span aria-hidden="true" className="block h-1 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-primary" style={{ width: `${memory.share * 100}%` }} /></span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('A memory sent to every session costs its size every time. Whether the agent used it is not recorded yet.')}</p>
            </div>
          </div>

          {comparison && first && second && (
            <div aria-live="polite" className="space-y-3 rounded-lg border border-primary/50 bg-card p-3">
              <p className="text-sm font-medium">
                {interpolate(t('{first} compared with {second}'), { first: when.format(new Date(first.at)), second: when.format(new Date(second.at)) })}
                <span className="ml-2 font-mono text-xs text-muted-foreground tabular-nums">
                  {comparison.identical ? t('exactly the same text') : interpolate(t(comparison.tokenDifference >= 0 ? 'the later one is about {tokens} tokens larger' : 'the later one is about {tokens} tokens smaller'), { tokens: Math.abs(comparison.tokenDifference).toLocaleString() })}
                </span>
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <MemoryList title={t('Only the earlier session')} memories={comparison.onlyFirst} tone="text-idle-foreground" />
                <MemoryList title={t('Both')} memories={comparison.both} />
                <MemoryList title={t('Only the later session')} memories={comparison.onlySecond} tone="text-shipped-foreground" />
              </div>
            </div>
          )}
          {picked.length === 1 && <p className="text-xs text-muted-foreground">{t('Tick one more session to compare the two.')}</p>}
        </>
      )}
    </section>
  )
}
