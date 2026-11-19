// A lead in the Companions panel: what a creature brought back, how far it got, and what can be done with it next.
// Everything a job or a model wrote is shown as plain text.
import { useState } from 'react'
import { BrainIcon, ChevronDownIcon, Undo2Icon } from 'lucide-react'
import { interpolate, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { speciesUnlocked } from '@/companion/companion-sprites'
import { creatureName, shortTime, type Say } from '@/companion/companion-words'
import { askWorker, loadCompanions, patchCompanions } from '@/companion/use-companions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { hostOfTarget, toCompanionState } from '@/growth/companions'
import {
  ASK_STATE_LABEL, ENGINE_LABEL, enginePaid, LEAD_KIND_LABEL, LEAD_NEXT, LEAD_POINTS, LEAD_STATUS_LABEL, LEAD_STATUS_MEANING, leadFitsAnswer, OPINION_MAX, PARAM_TEXT_MAX,
  type Ask, type CompanionState, type Lead, type LeadStatus, type Ritual,
} from '../../../../shared/annealer/companions.ts'

const signed = (points: number) => (points > 0 ? `+${points}` : String(points))
/** The colour of a status. A new status fails the typecheck until it has one. */
const STATUS_TONE: Record<LeadStatus, string> = {
  new: 'text-muted-foreground', kept: 'text-shipped-foreground', confirmed: 'text-shipped-foreground', shipped: 'text-shipped-foreground', accepted: 'text-shipped-foreground',
  dismissed: 'text-idle-foreground', 'false-positive': 'text-attention-foreground', duplicate: 'text-attention-foreground', 'not-applicable': 'text-attention-foreground',
}
const WRONG: readonly LeadStatus[] = ['dismissed', 'false-positive', 'duplicate', 'not-applicable']

/** The form that opens under a lead when a creature is asked to work on it. */
function AskAboutLead({ lead, ritual, state, onDone, onCancel }: { lead: Lead; ritual: Ritual; state: CompanionState; onDone: Say; onCancel: () => void }) {
  const { t } = useI18n()
  const notes = ritual.params.find((param) => param.type === 'text')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const soul = state.souls[ritual.owner]
  const name = creatureName(state, ritual.owner, t)
  const ready = !notes || notes.optional || text.trim() !== ''
  const ask = async () => {
    setBusy(true); setError(null)
    const answer = await askWorker('/api/annealer/asks', 'POST', { species: ritual.owner, ritual: ritual.id, leadId: lead.id, params: notes ? { [notes.name]: text } : {} })
    setBusy(false)
    if (!answer.ok) { setError(answer.message); return }
    await loadCompanions()
    onDone(interpolate(t('{name} is thinking. The answer appears here as a new lead.'), { name }))
  }
  return (
    <form className="mt-2 space-y-2 rounded-lg border border-border/70 bg-background/60 p-3" onSubmit={(event) => { event.preventDefault(); if (ready && !busy) void ask() }}>
      <p className="text-xs text-muted-foreground">{t(ritual.description)}</p>
      {notes && (
        <div className="space-y-1">
          <Label htmlFor={`ask-${lead.id}-${ritual.id}`} className="text-xs">{t(notes.label)}{notes.optional && <span className="font-normal text-muted-foreground"> · {t('optional')}</span>}</Label>
          <Textarea id={`ask-${lead.id}-${ritual.id}`} value={text} rows={4} maxLength={PARAM_TEXT_MAX} placeholder={notes.placeholder} onChange={(event) => setText(event.target.value)} />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {soul.engine === 'none' ? interpolate(t('{name} has no model yet. Choose one under Soul.'), { name })
          : interpolate(t(enginePaid(soul.engine) ? 'Asked once, on {engine} ({model}). This spends tokens or your plan.' : 'Asked once, on {engine} ({model}). Free.'), { engine: t(ENGINE_LABEL[soul.engine]), model: soul.model || '?' })}
        {' '}{t('It reads this lead, what it was built from and your notes. It gets no tools.')}
      </p>
      {error && <p role="alert" className="text-sm text-attention-foreground">{error}</p>}
      <div className="flex gap-1.5">
        <Button type="submit" size="xs" busy={busy} disabled={!ready || busy}><BrainIcon />{interpolate(t('Ask {name}'), { name })}</Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>{t('Cancel')}</Button>
      </div>
    </form>
  )
}

export function LeadRow({ lead, state, groveLevel, readOnly, onSay }: { lead: Lead; state: CompanionState; groveLevel: number; readOnly: boolean; onSay: Say }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const sources = lead.sources.flatMap((id) => state.leads.filter((entry) => entry.id === id))
  const hasMore = lead.detail !== '' || sources.length > 0
  // The creatures that can take this lead further, as it stands.
  const asks = state.rituals.filter((ritual) => ritual.runner === 'model' && ritual.reads === 'one-lead' && ritual.answer !== null && leadFitsAnswer(ritual.answer, lead))
  const remembered = state.opinions.some((opinion) => opinion.leadId === lead.id)
  const askingRitual = asks.find((ritual) => ritual.id === asking)

  const decide = async (status: LeadStatus) => {
    const answer = await askWorker(`/api/annealer/leads/${encodeURIComponent(lead.id)}`, 'POST', { status })
    if (!answer.ok) { onSay(answer.message, true); return }
    const next = toCompanionState({ leads: [answer.body.lead], ledger: answer.body.ledger })
    patchCompanions({ leads: state.leads.map((entry) => (entry.id === lead.id ? next.leads[0] ?? entry : entry)), ledger: next.ledger })
  }
  const remember = async () => {
    const answer = await askWorker('/api/annealer/opinions', 'POST', { species: lead.species, target: hostOfTarget(lead.target), leadId: lead.id, text: `${t(LEAD_STATUS_LABEL[lead.status])}: ${lead.text}`.slice(0, OPINION_MAX) })
    if (!answer.ok) { onSay(answer.message, true); return }
    patchCompanions({ opinions: toCompanionState({ opinions: answer.body.opinions }).opinions })
    onSay(interpolate(t('{name} will be told this the next time it is asked about {target}.'), { name: creatureName(state, lead.species, t), target: hostOfTarget(lead.target) || t('anything') }))
  }

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <p className={cn('text-[0.8rem] break-words', lead.kind === 'hypothesis' || lead.kind === 'verdict' || lead.kind === 'draft' ? 'font-medium' : 'font-mono break-all', WRONG.includes(lead.status) && 'text-muted-foreground line-through')}>{lead.text}</p>
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{t(LEAD_KIND_LABEL[lead.kind])}</span><span className="break-all">{lead.target}</span><span>{creatureName(state, lead.species, t)}</span>{shortTime(lead.createdAt) && <span>{shortTime(lead.createdAt)}</span>}
            {lead.status !== 'new' && <span className={STATUS_TONE[lead.status]} title={t(LEAD_STATUS_MEANING[lead.status])}>{t(LEAD_STATUS_LABEL[lead.status])} · {signed(LEAD_POINTS[lead.status])}</span>}
          </p>
          {hasMore && (
            <Button variant="link" size="xs" className="h-auto gap-1 px-0 text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>
              <ChevronDownIcon className={cn('size-3 transition-transform', open && 'rotate-180')} />{t(open ? 'Show less' : lead.detail ? 'Read it' : 'What it was built from')}
            </Button>
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-1.5">
            {LEAD_NEXT[lead.status].filter((status) => status !== 'new').map((status, index) => (
              <Button key={status} size="xs" variant={index === 0 ? 'default' : 'outline'} title={t(LEAD_STATUS_MEANING[status])} onClick={() => void decide(status)}>{t(LEAD_STATUS_LABEL[status])} {signed(LEAD_POINTS[status])}</Button>
            ))}
            {asks.map((ritual) => {
              const unlocked = speciesUnlocked(ritual.owner, groveLevel)
              return (
                <Button key={ritual.id} size="xs" variant="outline" disabled={!unlocked} aria-expanded={asking === ritual.id} title={unlocked ? t(ritual.description) : t('That creature is not unlocked yet.')} onClick={() => setAsking(asking === ritual.id ? null : ritual.id)}>
                  <BrainIcon />{interpolate(t('{name}: {ritual}'), { name: creatureName(state, ritual.owner, t), ritual: t(ritual.name) })}
                </Button>
              )
            })}
            {WRONG.includes(lead.status) && lead.kind === 'hypothesis' && (remembered
              ? <span className="text-xs text-muted-foreground">{t('Remembered')}</span>
              : <Button size="xs" variant="outline" title={t('Its creature is told this before it is next asked about the target.')} onClick={() => void remember()}>{t('Remember as a dead end')}</Button>)}
            {lead.status !== 'new' && <Button size="xs" variant="ghost" title={t('Back to undecided. Its points are taken back.')} onClick={() => void decide('new')}><Undo2Icon />{t('Undo')}</Button>}
          </div>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border/70 bg-background/60 p-3">
          {lead.detail && <p className="text-[0.8rem] leading-relaxed break-words whitespace-pre-wrap">{lead.detail}</p>}
          {sources.length > 0 && (
            <div>
              <p className="section-label pb-1">{t('Built from')}</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {sources.map((source) => <li key={source.id} className="break-all"><span className="font-mono">{source.text}</span> · {t(LEAD_KIND_LABEL[source.kind])} · {creatureName(state, source.species, t)}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
      {askingRitual && !readOnly && <AskAboutLead lead={lead} ritual={askingRitual} state={state} onCancel={() => setAsking(null)} onDone={(text) => { setAsking(null); onSay(text) }} />}
    </li>
  )
}

/** The questions put to creatures lately, newest first. */
export function Asks({ asks, state }: { asks: readonly Ask[]; state: CompanionState }) {
  const { t } = useI18n()
  if (asks.length === 0) return null
  return (
    <div>
      <p className="section-label pb-1">{t('Questions')}</p>
      <ul className="divide-y border-t text-sm">
        {asks.slice(0, 6).map((ask) => (
          <li key={ask.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
            <span className={cn('font-medium', ask.state === 'waiting' && 'animate-pulse text-working-foreground', ask.state === 'failed' && 'text-attention-foreground')}>{t(ASK_STATE_LABEL[ask.state])}</span>
            <span>{creatureName(state, ask.species, t)} · {t(state.rituals.find((ritual) => ritual.id === ask.ritual)?.name ?? ask.ritual)}</span>
            <span className="text-xs break-all text-muted-foreground">{ask.target}</span>
            <span className="text-xs text-muted-foreground">{t(ENGINE_LABEL[ask.engine])}{shortTime(ask.createdAt) && ` · ${shortTime(ask.createdAt)}`}{ask.note && ` · ${ask.note}`}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
