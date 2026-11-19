// The Grove's Companions panel: the creatures that can be given a job, the jobs CronLord runs for them, and the leads
// those runs printed. A creature levels up only from what you decide about its leads. Everything a job printed is
// shown as plain text.
import { useState } from 'react'
import { CheckIcon, PlayIcon, PlusIcon, RefreshCwIcon, ShieldAlertIcon, Trash2Icon, Undo2Icon, XIcon } from 'lucide-react'
import { interpolate, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Sprite } from '@/companion/companion'
import { COMPANION_SPECIES_LABEL, COMPANION_SPECIES_ROLE, COMPANION_UNLOCK_LEVEL, SPECIES_FRAMES, speciesUnlocked, type CompanionPalette } from '@/companion/companion-sprites'
import { askWorker, COMPANION_LOAD_NOTE, loadCompanions, patchCompanions, useCompanions, type CompanionSource } from '@/companion/use-companions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { creatureCard, toCompanionState, workingSpecies, type CreatureCard } from '@/growth/companions'
import {
  CRONLORD_STATE_LABEL, DAILY_LOSS_CAP, jobFailing, LEAD_KIND_LABEL, LEAD_POINTS, LEAD_STATUS_LABEL, REACH_LABEL, RUN_STATUS_LABEL, runFailed, SCHEDULE_LABEL, SCHEDULES,
  type CompanionJob, type CompanionSpecies, type CompanionState, type CronLordState, type Lead, type LeadStatus, type Ritual, type Schedule,
} from '../../../../shared/annealer/companions.ts'

const NO_BRANCH = 'none'
const RESOLVED_SHOWN = 6
const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const time = (at: string | null) => { const date = at ? new Date(at) : null; return date && !Number.isNaN(date.getTime()) ? when.format(date) : null }

/** The colour of the connection chip. A new state fails the typecheck until it has one. */
const CRONLORD_TONE: Record<CronLordState, string> = {
  connected: 'border-shipped-foreground/40 text-shipped-foreground', 'not-set-up': 'border-border text-muted-foreground',
  unreachable: 'border-attention-foreground/50 text-attention-foreground', refused: 'border-attention-foreground/50 text-attention-foreground',
}

function CreatureTile({ card, palette, groveLevel, selected, onSelect }: { card: CreatureCard; palette: CompanionPalette; groveLevel: number; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n()
  const unlocked = speciesUnlocked(card.species, groveLevel)
  const failing = card.failing.length > 0
  return (
    <Button variant="bare" disabled={!unlocked} aria-pressed={selected} onClick={onSelect}
      className={cn('flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left font-normal whitespace-normal transition-colors', selected ? 'border-primary' : 'border-border/70 hover:border-accent-border', !unlocked && 'opacity-55')}>
      <Sprite frame={SPECIES_FRAMES[card.species][failing ? 'concerned' : card.jobs > 0 ? 'working' : 'resting'][0]} palette={palette} className={cn('size-12 shrink-0', !unlocked && 'grayscale')} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{t(COMPANION_SPECIES_LABEL[card.species])}</span>
          <span className="font-mono text-[11px] tabular-nums">{unlocked ? `LV ${card.level}` : interpolate(t('Grove LV {level}'), { level: COMPANION_UNLOCK_LEVEL[card.species] })}</span>
        </span>
        <span className="block text-xs text-muted-foreground">{t(COMPANION_SPECIES_ROLE[card.species])}</span>
        <span aria-hidden="true" className="mt-2 block h-1 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(card.intoLevel * 100)}%` }} /></span>
        <span className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground tabular-nums">
          <span>{interpolate(t('{points} earned · {next} to LV {level}'), { points: card.points, next: card.toNextLevel, level: card.level + 1 })}</span>
          <span>{interpolate(t(card.jobs === 1 ? '{count} job' : '{count} jobs'), { count: card.jobs })}</span>
          {card.waiting > 0 && <span className="text-attention-foreground">{interpolate(t(card.waiting === 1 ? '{count} lead to decide' : '{count} leads to decide'), { count: card.waiting })}</span>}
          {failing && <span className="font-medium text-attention-foreground">{t('A job is failing')}</span>}
        </span>
      </span>
    </Button>
  )
}

function AssignForm({ species, rituals, branches, scopeEmpty, onAssigned }: { species: CompanionSpecies; rituals: Ritual[]; branches: { id: string; name: string }[]; scopeEmpty: boolean; onAssigned: (message: string) => void }) {
  const { t } = useI18n()
  const [ritualId, setRitualId] = useState(rituals[0]?.id ?? '')
  const ritual = rituals.find((entry) => entry.id === ritualId) ?? rituals[0]
  const [params, setParams] = useState<Record<string, string>>({})
  const [schedule, setSchedule] = useState<Schedule>('daily')
  const [branchId, setBranchId] = useState(NO_BRANCH)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!ritual) return <p className="text-sm text-muted-foreground">{interpolate(t('{name} has no rituals in this build.'), { name: t(COMPANION_SPECIES_LABEL[species]) })}</p>
  const filled = ritual.params.every((param) => (params[param.name] ?? '').trim() !== '')
  const assign = async () => {
    setBusy(true); setError(null)
    const answer = await askWorker('/api/annealer/jobs', 'POST', { species, ritual: ritual.id, schedule, branchId: branchId === NO_BRANCH ? null : branchId, params: Object.fromEntries(ritual.params.map((param) => [param.name, params[param.name] ?? ''])) })
    setBusy(false)
    if (!answer.ok) { setError(answer.message); return }
    setParams({})
    await loadCompanions()
    onAssigned(interpolate(t('{name} has the job. Its first run sets the baseline and reports nothing.'), { name: t(COMPANION_SPECIES_LABEL[species]) }))
  }
  return (
    <form className="space-y-3 rounded-xl border border-border/70 bg-card p-3" onSubmit={(event) => { event.preventDefault(); if (filled && !busy) void assign() }}>
      <p className="section-label">{interpolate(t('Give {name} a job'), { name: t(COMPANION_SPECIES_LABEL[species]) })}</p>
      {rituals.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {rituals.map((entry) => <Button key={entry.id} type="button" size="xs" variant={entry.id === ritual.id ? 'default' : 'outline'} aria-pressed={entry.id === ritual.id} onClick={() => { setRitualId(entry.id); setParams({}); setError(null) }}>{t(entry.name)}</Button>)}
        </div>
      )}
      <div>
        <p className="text-sm font-medium">{t(ritual.name)}</p>
        <p className="text-xs text-muted-foreground">{t(ritual.description)}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
          <span className={cn(ritual.reach === 'touch' && 'text-attention-foreground')}>{t(REACH_LABEL[ritual.reach])}</span>
          {ritual.needs && <span>{interpolate(t('Needs {tool} on the machine that runs CronLord'), { tool: ritual.needs })}</span>}
          <span>{t('No model, no tokens')}</span>
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {ritual.params.map((param) => (
          <div key={param.name} className="space-y-1 md:col-span-2">
            <Label htmlFor={`param-${param.name}`} className="text-xs">{t(param.label)}</Label>
            <Input id={`param-${param.name}`} value={params[param.name] ?? ''} placeholder={param.placeholder} inputMode={param.type === 'url' ? 'url' : 'text'} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2000}
              onChange={(event) => setParams({ ...params, [param.name]: event.target.value })} />
          </div>
        ))}
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">{t('How often')}</legend>
          <div className="flex w-fit max-w-full flex-wrap rounded-[10px] border border-control-edge p-0.5">
            {SCHEDULES.map((option) => <Button key={option} type="button" size="xs" variant={schedule === option ? 'default' : 'ghost'} aria-pressed={schedule === option} onClick={() => setSchedule(option)}>{t(SCHEDULE_LABEL[option])}</Button>)}
          </div>
        </fieldset>
        <div className="space-y-1">
          <Label htmlFor="job-branch" className="text-xs">{t('Leave kept leads on a branch’s trail')}</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger id="job-branch" className="h-11 w-full sm:h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_BRANCH}>{t('No branch')}</SelectItem>
              {branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {ritual.reach === 'touch' && scopeEmpty && <p className="text-xs text-attention-foreground">{t('The scope list is empty, so this ritual will be refused. Add the host below first.')}</p>}
      {error && <p role="alert" className="text-sm text-attention-foreground">{error}</p>}
      <Button type="submit" size="sm" busy={busy} disabled={!filled || busy}><PlusIcon />{t('Give the job')}</Button>
    </form>
  )
}

function JobRow({ job, ritual, branchName, readOnly, onDone }: { job: CompanionJob; ritual: Ritual | undefined; branchName: string | null; readOnly: boolean; onDone: (message: string, failed?: boolean) => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<'run' | 'remove' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const last = job.recent[0]
  const failing = jobFailing(job)
  const act = async (kind: 'run' | 'remove') => {
    setBusy(kind)
    const answer = kind === 'run' ? await askWorker(`/api/annealer/jobs/${encodeURIComponent(job.id)}/run`, 'POST') : await askWorker(`/api/annealer/jobs/${encodeURIComponent(job.id)}`, 'DELETE')
    setBusy(null); setConfirming(false)
    if (!answer.ok) { onDone(answer.message, true); return }
    if (kind === 'remove') await loadCompanions()
    onDone(kind === 'run' ? t('Started. Check for new runs in a moment.') : t('The job is removed from CronLord. Its leads are kept.'))
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm break-all"><span className="font-medium">{ritual ? t(ritual.name) : job.ritual}</span> <span className="text-muted-foreground">·</span> {job.target}</p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{t(COMPANION_SPECIES_LABEL[job.species])}</span>
          <span>{t(SCHEDULE_LABEL[job.schedule])}</span>
          {branchName && <span>{interpolate(t('Trail: {name}'), { name: branchName })}</span>}
          {last
            ? <span className={cn(runFailed(last.status) && 'font-medium text-attention-foreground')}>{t(RUN_STATUS_LABEL[last.status])}{time(last.at) && ` · ${time(last.at)}`}{failing && ` · ${t('twice running')}`}</span>
            : <span>{t('No finished run read yet')}</span>}
        </p>
      </div>
      {/* The last five runs, oldest on the left. */}
      <span className="flex items-center gap-1" role="img" aria-label={job.recent.length === 0 ? t('No runs read yet') : interpolate(t('Last runs, newest last: {runs}'), { runs: [...job.recent].reverse().map((run) => t(RUN_STATUS_LABEL[run.status])).join(', ') })}>
        {[...job.recent].reverse().map((run, index) => <span key={index} className={cn('size-2 rounded-full', run.status === 'success' ? 'bg-shipped-foreground' : runFailed(run.status) ? 'bg-attention-foreground' : 'bg-border')} />)}
      </span>
      {!readOnly && (confirming ? (
        <span className="flex items-center gap-1.5">
          <Button size="xs" variant="destructive" busy={busy === 'remove'} onClick={() => void act('remove')}>{t('Remove it')}</Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>{t('Keep')}</Button>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <Button size="xs" variant="outline" busy={busy === 'run'} onClick={() => void act('run')}><PlayIcon />{t('Run now')}</Button>
          <Button size="icon-sm" variant="ghost" aria-label={interpolate(t('Remove the job on {target}'), { target: job.target })} onClick={() => setConfirming(true)}><Trash2Icon /></Button>
        </span>
      ))}
    </li>
  )
}

function LeadRow({ lead, readOnly, onDecide }: { lead: Lead; readOnly: boolean; onDecide: (status: LeadStatus) => void }) {
  const { t } = useI18n()
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1 basis-64">
        <p className={cn('font-mono text-[0.8rem] break-all', lead.status === 'dismissed' && 'text-muted-foreground line-through')}>{lead.text}</p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{t(LEAD_KIND_LABEL[lead.kind])}</span><span className="break-all">{lead.target}</span><span>{t(COMPANION_SPECIES_LABEL[lead.species])}</span>{time(lead.createdAt) && <span>{time(lead.createdAt)}</span>}
          {lead.status !== 'new' && <span className={cn(lead.status === 'kept' ? 'text-shipped-foreground' : 'text-idle-foreground')}>{t(LEAD_STATUS_LABEL[lead.status])} · {LEAD_POINTS[lead.status] > 0 ? '+' : ''}{LEAD_POINTS[lead.status]}</span>}
        </p>
      </div>
      {!readOnly && (lead.status === 'new' ? (
        <span className="flex items-center gap-1.5">
          <Button size="xs" onClick={() => onDecide('kept')}><CheckIcon />{interpolate(t('Keep +{points}'), { points: LEAD_POINTS.kept })}</Button>
          <Button size="xs" variant="outline" onClick={() => onDecide('dismissed')}><XIcon />{interpolate(t('Noise {points}'), { points: LEAD_POINTS.dismissed })}</Button>
        </span>
      ) : <Button size="xs" variant="ghost" onClick={() => onDecide('new')}><Undo2Icon />{t('Undo')}</Button>)}
    </li>
  )
}

function Scope({ state, readOnly }: { state: CompanionState; readOnly: boolean }) {
  const { t } = useI18n()
  const [pattern, setPattern] = useState('')
  const [error, setError] = useState<string | null>(null)
  const change = async (answer: Awaited<ReturnType<typeof askWorker>>) => {
    if (!answer.ok) { setError(answer.message); return }
    setError(null); setPattern('')
    patchCompanions({ scope: toCompanionState({ scope: answer.body.scope }).scope })
  }
  return (
    <div className="space-y-2">
      <div>
        <p className="section-label">{t('Scope')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('A ritual that sends requests to its target is refused unless the host is on this list. Put only what a program’s scope page allows.')}</p>
      </div>
      {state.scope.length === 0 ? <p className="text-sm text-muted-foreground">{t('Nothing in scope yet.')}</p> : (
        <ul className="flex flex-wrap gap-1.5">
          {state.scope.map((entry) => (
            <li key={entry.id} className="flex items-center gap-1 rounded-lg border border-border/70 bg-card py-0.5 pr-0.5 pl-2 font-mono text-xs">
              {entry.pattern}
              {!readOnly && <Button size="icon-xs" variant="ghost" aria-label={interpolate(t('Take {pattern} out of scope'), { pattern: entry.pattern })} onClick={() => void askWorker(`/api/annealer/scope/${entry.id}`, 'DELETE').then(change)}><XIcon /></Button>}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (pattern.trim()) void askWorker('/api/annealer/scope', 'POST', { pattern }).then(change) }}>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="scope-pattern" className="text-xs">{t('Host, or *.host for everything under it')}</Label>
            <Input id="scope-pattern" value={pattern} placeholder="*.example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={260} onChange={(event) => setPattern(event.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={!pattern.trim()}><PlusIcon />{t('Add to scope')}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-attention-foreground">{error}</p>}
    </div>
  )
}

export function CompanionsPanel({ source, palette, groveLevel, branches }: { source: CompanionSource | null; palette: CompanionPalette; groveLevel: number; branches: { id: string; name: string }[] }) {
  const { t } = useI18n()
  const { load, state } = useCompanions(source)
  const readOnly = source !== 'local'
  const species = workingSpecies(state)
  const [picked, setPicked] = useState<CompanionSpecies | null>(null)
  const selected = picked && species.includes(picked) && speciesUnlocked(picked, groveLevel) ? picked : species.find((entry) => speciesUnlocked(entry, groveLevel)) ?? null
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null)
  const say = (text: string, failed = false) => setNotice({ text, failed })
  const branchName = (id: string | null) => branches.find((branch) => branch.id === id)?.name ?? null
  const connected = state.cronlord.state === 'connected'
  const waiting = state.leads.filter((lead) => lead.status === 'new')
  const resolved = state.leads.filter((lead) => lead.status !== 'new').slice(0, RESOLVED_SHOWN)

  const check = async () => {
    setChecking(true)
    const answer = await loadCompanions(true)
    setChecking(false)
    if (!answer.ok) { say(answer.message, true); return }
    const added = typeof answer.body.added === 'number' ? answer.body.added : 0
    const failed = typeof answer.body.failed === 'number' ? answer.body.failed : 0
    say(failed > 0
      ? interpolate(t(failed === 1 ? '{count} job could not be read from CronLord.' : '{count} jobs could not be read from CronLord.'), { count: failed })
      : added === 0 ? t('No new leads.') : interpolate(t(added === 1 ? '{count} new lead.' : '{count} new leads.'), { count: added }), failed > 0)
  }
  const decide = async (lead: Lead, status: LeadStatus) => {
    const answer = await askWorker(`/api/annealer/leads/${encodeURIComponent(lead.id)}`, 'POST', { status })
    if (!answer.ok) { say(answer.message, true); return }
    const next = toCompanionState({ leads: [answer.body.lead], ledger: answer.body.ledger })
    patchCompanions({ leads: state.leads.map((entry) => entry.id === lead.id ? next.leads[0] ?? entry : entry), ledger: next.ledger })
    setNotice(null)
  }

  return (
    <section aria-label={t('Companions')} className="space-y-5 rounded-xl border bg-card/70 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="section-label">{t('Companions')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('Creatures that do a job on a schedule and bring back what they found. CronLord runs the jobs; a creature levels up only from the leads you keep, and loses a little for noise.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full border px-2 py-0.5 text-xs', CRONLORD_TONE[state.cronlord.state])}>{t(CRONLORD_STATE_LABEL[state.cronlord.state])}{state.cronlord.version && ` · ${state.cronlord.version}`}</span>
          {!readOnly && <Button size="sm" variant="outline" busy={checking} disabled={!connected || state.jobs.length === 0} onClick={() => void check()}><RefreshCwIcon />{t('Check for new runs')}</Button>}
        </div>
      </div>

      {source === 'sample' && <p className="text-xs text-muted-foreground">{t('Sample data. Nothing here is scheduled and the buttons are off.')}</p>}
      {source === 'cloud' && <p className="text-sm text-muted-foreground">{t('Jobs and leads are kept on the machine that runs the worker. Open My Work on that machine to see them.')}</p>}
      {(source === null || (source === 'local' && COMPANION_LOAD_NOTE[load])) && (
        <p className={cn('text-sm', load === 'failed' ? 'text-attention-foreground' : 'text-muted-foreground')}>
          {t(COMPANION_LOAD_NOTE[source === null ? 'loading' : load] ?? '')}{' '}
          {load === 'failed' && <Button variant="link" size="xs" className="h-auto px-0" onClick={() => void loadCompanions()}>{t('Try again')}</Button>}
        </p>
      )}

      {source === 'local' && load === 'ready' && state.cronlord.state === 'not-set-up' && (
        <div className="space-y-1 rounded-lg border border-border/70 bg-card p-3 text-sm">
          <p className="font-medium">{t('Tell the worker where CronLord is')}</p>
          <p className="text-muted-foreground">{t('Save the address and token in a file only you can read, then reload this page. The page itself cannot set them.')}</p>
          <pre className="overflow-x-auto rounded-md bg-background p-2 font-mono text-xs">{'mkdir -p ~/.claude-mem/annealer && umask 077 && \\\nprintf \'{"url":"http://127.0.0.1:7070","token":"%s"}\\n\' "$CRONLORD_ADMIN_TOKEN" > ~/.claude-mem/annealer/cronlord.json'}</pre>
        </div>
      )}
      {state.cronlord.state === 'unreachable' && <p className="text-sm text-attention-foreground">{interpolate(t('Nothing answered at {url}. Jobs already given keep their schedule in CronLord; nothing is caught up later.'), { url: state.cronlord.url ?? '' })}</p>}
      {state.cronlord.state === 'refused' && <p className="text-sm text-attention-foreground">{t('CronLord is there but did not accept the token in the worker’s settings.')}</p>}
      {state.cronlord.open && (
        <p className="flex items-start gap-2 rounded-lg border border-attention-foreground/40 p-3 text-sm text-attention-foreground">
          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
          <span>{t('CronLord answered a request that carried no token. Anything that can reach it can make it run a shell command. Set admin_token in its config before giving it jobs.')}</span>
        </p>
      )}

      {species.length > 0 && (
        <ul className="grid gap-2 md:grid-cols-2">
          {species.map((entry) => <li key={entry}><CreatureTile card={creatureCard(state, entry)} palette={palette} groveLevel={groveLevel} selected={selected === entry} onSelect={() => setPicked(entry)} /></li>)}
        </ul>
      )}

      {notice && <p role="status" className={cn('text-sm', notice.failed ? 'text-attention-foreground' : 'text-muted-foreground')}>{notice.text}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          {!readOnly && selected && connected && (
            <AssignForm key={selected} species={selected} rituals={state.rituals.filter((ritual) => ritual.owner === selected)} branches={branches} scopeEmpty={state.scope.length === 0} onAssigned={say} />
          )}
          {!readOnly && !selected && species.length > 0 && <p className="text-sm text-muted-foreground">{t('No working creature is unlocked yet. They unlock as the Grove levels up from recorded work.')}</p>}
          <Scope state={state} readOnly={readOnly} />
        </div>
        <div className="min-w-0 space-y-5">
          <div>
            <p className="section-label pb-1">{t('Jobs')} · {state.jobs.length}</p>
            {state.jobs.length === 0 ? <p className="text-sm text-muted-foreground">{t('No creature has a job yet.')}</p> : (
              <ul className="divide-y border-t">
                {state.jobs.map((job) => <JobRow key={job.id} job={job} ritual={state.rituals.find((ritual) => ritual.id === job.ritual)} branchName={branchName(job.branchId)} readOnly={readOnly} onDone={say} />)}
              </ul>
            )}
          </div>
          <div>
            <p className="section-label pb-1">{t('Leads to decide')} · {waiting.length}</p>
            {waiting.length === 0 ? <p className="text-sm text-muted-foreground">{t('Nothing waiting. A job’s first run only sets its baseline.')}</p> : (
              <ul className="divide-y border-t">{waiting.map((lead) => <LeadRow key={lead.id} lead={lead} readOnly={readOnly} onDecide={(status) => void decide(lead, status)} />)}</ul>
            )}
          </div>
          {resolved.length > 0 && (
            <div>
              <p className="section-label pb-1">{t('Decided lately')}</p>
              <ul className="divide-y border-t">{resolved.map((lead) => <LeadRow key={lead.id} lead={lead} readOnly={readOnly} onDecide={(status) => void decide(lead, status)} />)}</ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{interpolate(t('A kept lead is worth +{kept}, noise {dismissed}. Running a job is worth nothing. A creature cannot lose more than {cap} in a day.'), { kept: LEAD_POINTS.kept, dismissed: LEAD_POINTS.dismissed, cap: DAILY_LOSS_CAP })}</p>
        </div>
      </div>
    </section>
  )
}
