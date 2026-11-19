// A creature's soul and memory in the Companions panel. The soul is the words it is given before every question:
// what its species is for (fixed), what you add, how it talks, and which model it thinks with. Memory is what it
// holds to be true, each line written or confirmed by you. The preview is the exact text that is sent.
import { useRef, useState } from 'react'
import { DownloadIcon, PlusIcon, SaveIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { interpolate, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { COMPANION_SPECIES_LABEL } from '@/companion/companion-sprites'
import { askWorker, patchCompanions } from '@/companion/use-companions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toCompanionState } from '@/growth/companions'
import type { Say } from '@/companion/companion-words'
import {
  CLAUDE_MODELS, cleanSoul, composeSoul, ENGINE_LABEL, ENGINE_MEANING, enginePaid, ENGINES, exportSoul, importSoul, OPINION_MAX, opinionsFor, RUNS_PER_DAY_MAX,
  SOUL_CATCHPHRASE_MAX, SOUL_FRAGMENT, SOUL_NAME_MAX, SOUL_ROLE_MAX, TONE_LABEL, TONES,
  type CompanionSpecies, type CompanionState, type Engine, type Soul,
} from '../../../../shared/annealer/companions.ts'

const same = (a: Soul, b: Soul) => JSON.stringify(cleanSoul(a)) === JSON.stringify(cleanSoul(b))

function Segments<T extends string>({ label, options, value, labels, disabled, onPick }: { label: string; options: readonly T[]; value: T; labels: Record<T, string>; disabled?: (option: T) => boolean; onPick: (option: T) => void }) {
  const { t } = useI18n()
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium">{label}</legend>
      <div className="flex w-fit max-w-full flex-wrap rounded-[10px] border border-control-edge p-0.5">
        {options.map((option) => <Button key={option} type="button" size="xs" variant={value === option ? 'default' : 'ghost'} aria-pressed={value === option} disabled={disabled?.(option)} onClick={() => onPick(option)}>{t(labels[option])}</Button>)}
      </div>
    </fieldset>
  )
}

export function SoulEditor({ species, state, readOnly, onSay }: { species: CompanionSpecies; state: CompanionState; readOnly: boolean; onSay: Say }) {
  const { t } = useI18n()
  const saved = state.souls[species]
  const [draft, setDraft] = useState<Soul>(saved)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const speciesName = t(COMPANION_SPECIES_LABEL[species])
  const set = (change: Partial<Soul>) => setDraft({ ...draft, ...change })
  const questions = state.rituals.filter((ritual) => ritual.owner === species && ritual.runner === 'model')
  const dirty = !same(draft, saved)
  const pickEngine = (engine: Engine) => set({ engine, model: engine === 'claude' ? 'haiku' : '' })

  const save = async () => {
    setBusy(true)
    const answer = await askWorker(`/api/annealer/souls/${species}`, 'POST', draft)
    setBusy(false)
    if (!answer.ok) { onSay(answer.message, true); return }
    const souls = toCompanionState({ souls: answer.body.souls }).souls
    patchCompanions({ souls })
    setDraft(souls[species]); setLoaded(false)
    onSay(interpolate(t('{name}’s soul is saved. It applies from the next question.'), { name: souls[species].name || speciesName }))
  }
  const download = () => {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([exportSoul(species, saved)], { type: 'application/json' }))
    link.download = `${(saved.name || species).toLowerCase().replace(/[^a-z0-9]+/g, '-') || species}.companion.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  const load = async (picked: File | undefined) => {
    if (!picked) return
    const read = picked.size > 20_000 ? null : importSoul(await picked.text())
    if (!read) { onSay(t('That is not a companion file.'), true); return }
    if (read.species !== species) { onSay(interpolate(t('That file is a {other}. Open {other} to load it.'), { other: t(COMPANION_SPECIES_LABEL[read.species]) }), true); return }
    setDraft({ ...draft, ...read.words }); setLoaded(true); setPreview(true)
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-card p-3">
      <div>
        <p className="section-label">{interpolate(t('{name}’s soul'), { name: saved.name || speciesName })}</p>
        <p className="mt-1 text-xs text-muted-foreground">{interpolate(t('Every {species} starts from this, and it cannot be edited:'), { species: speciesName })} <span className="text-foreground">{t(SOUL_FRAGMENT[species])}</span></p>
      </div>
      {loaded && <p role="status" className="rounded-lg border border-attention-foreground/40 p-2 text-xs text-attention-foreground">{t('Loaded from a file and not saved yet. The role below was written by someone else and will be given to a model as instructions: read it before you save.')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="soul-name" className="text-xs">{t('Name')}</Label>
          <Input id="soul-name" value={draft.name} placeholder={speciesName} maxLength={SOUL_NAME_MAX} disabled={readOnly} onChange={(event) => set({ name: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="soul-catchphrase" className="text-xs">{t('Catchphrase')}</Label>
          <Input id="soul-catchphrase" value={draft.catchphrase} maxLength={SOUL_CATCHPHRASE_MAX} disabled={readOnly} placeholder={t('Shown on its card. Not sent to a model.')} onChange={(event) => set({ catchphrase: event.target.value })} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="soul-role" className="text-xs">{t('What you add to its job')}</Label>
          <Textarea id="soul-role" value={draft.role} rows={3} maxLength={SOUL_ROLE_MAX} disabled={readOnly} placeholder={t('What to prefer, what to skip, how you work.')} onChange={(event) => set({ role: event.target.value })} />
          <p className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">{draft.role.length} / {SOUL_ROLE_MAX}</p>
        </div>
        <Segments label={t('How it talks')} options={TONES} value={draft.tone} labels={TONE_LABEL} disabled={() => readOnly} onPick={(tone) => set({ tone })} />
        <div className="space-y-1">
          <Segments label={t('Thinks with')} options={ENGINES} value={draft.engine} labels={ENGINE_LABEL} disabled={() => readOnly} onPick={pickEngine} />
          <p className="text-[11px] text-muted-foreground">{t(ENGINE_MEANING[draft.engine])}</p>
          {draft.engine === 'local' && !state.engines.local && <p className="text-[11px] text-attention-foreground">{t('The worker has no address for a local model yet. Add "localModelUrl" to its CronLord settings file, for example http://127.0.0.1:1234/v1.')}</p>}
        </div>
        {draft.engine === 'local' && (
          <div className="space-y-1">
            <Label htmlFor="soul-model" className="text-xs">{t('Model, as the server names it')}</Label>
            <Input id="soul-model" value={draft.model} placeholder="hermes3:8b" maxLength={100} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={readOnly} onChange={(event) => set({ model: event.target.value })} />
          </div>
        )}
        {draft.engine === 'claude' && <Segments label={t('Model')} options={CLAUDE_MODELS} value={CLAUDE_MODELS.find((model) => model === draft.model) ?? 'haiku'} labels={{ haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }} disabled={() => readOnly} onPick={(model) => set({ model })} />}
        {draft.engine !== 'none' && (
          <div className="space-y-1">
            <Label htmlFor="soul-runs" className="text-xs">{t('Questions a day, at most')}</Label>
            <Input id="soul-runs" type="number" min={0} max={RUNS_PER_DAY_MAX} value={draft.runsPerDay} disabled={readOnly} className="w-24" onChange={(event) => set({ runsPerDay: Number(event.target.value) })} />
          </div>
        )}
      </div>
      {enginePaid(draft.engine) && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium">{t('Allowed to spend')}</legend>
          {questions.length === 0 ? <p className="text-xs text-muted-foreground">{interpolate(t('{name} has no rituals that ask a model.'), { name: speciesName })}</p> : questions.map((ritual) => (
            <label key={ritual.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-primary" checked={draft.paidRituals.includes(ritual.id)} disabled={readOnly}
                onChange={(event) => set({ paidRituals: event.target.checked ? [...draft.paidRituals, ritual.id] : draft.paidRituals.filter((id) => id !== ritual.id) })} />
              <span><span className="font-medium">{t(ritual.name)}</span> <span className="text-xs text-muted-foreground">{t(ritual.description)}</span></span>
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground">{t('Nothing here spends until its box is ticked, and then only when you press Ask.')}</p>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {!readOnly && <Button size="sm" busy={busy} disabled={!dirty || busy} onClick={() => void save()}><SaveIcon />{t('Save soul')}</Button>}
        <Button size="sm" variant="outline" aria-expanded={preview} onClick={() => setPreview(!preview)}>{t(preview ? 'Hide what is sent' : 'See what is sent')}</Button>
        <Button size="sm" variant="ghost" title={t('Its name, catchphrase, role and tone. Not its model, its limits or anything it remembers.')} onClick={download}><DownloadIcon />{t('Export')}</Button>
        {!readOnly && (
          <>
            <Button size="sm" variant="ghost" onClick={() => file.current?.click()}><UploadIcon />{t('Import')}</Button>
            <input ref={file} type="file" accept="application/json,.json" className="hidden" aria-label={t('Companion file to import')} onChange={(event) => { void load(event.target.files?.[0]); event.target.value = '' }} />
          </>
        )}
      </div>
      {preview && (
        <div>
          <p className="section-label pb-1">{t('Sent before every question')}{dirty && ` · ${t('with your unsaved changes')}`}</p>
          <pre className={cn('max-h-72 overflow-auto rounded-lg border border-border/70 bg-background p-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap')}>{composeSoul(species, speciesName, cleanSoul(draft), opinionsFor(state.opinions, species, ''))}</pre>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('Opinions about a target are added when the question is about that target.')}</p>
        </div>
      )}
    </div>
  )
}

export function Memory({ species, state, readOnly, onSay }: { species: CompanionSpecies; state: CompanionState; readOnly: boolean; onSay: Say }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [target, setTarget] = useState('')
  const mine = state.opinions.filter((opinion) => opinion.species === species)
  const name = state.souls[species].name || t(COMPANION_SPECIES_LABEL[species])
  const take = (answer: Awaited<ReturnType<typeof askWorker>>) => {
    if (!answer.ok) { onSay(answer.message, true); return false }
    patchCompanions({ opinions: toCompanionState({ opinions: answer.body.opinions }).opinions })
    return true
  }
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card p-3">
      <div>
        <p className="section-label">{interpolate(t('What {name} holds to be true'), { name })}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('Every line here was written or confirmed by you. A line about a target is given to it when it is asked about that target; a line with no target, every time. Delete a line and it is gone.')}</p>
      </div>
      {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t('Nothing yet.')}</p> : (
        <ul className="divide-y border-t">
          {mine.map((opinion) => (
            <li key={opinion.id} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm break-words">{opinion.text}</p>
                <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span className="font-mono">{opinion.target || t('everywhere')}</span>{opinion.leadId && <span>{t('from a lead')}</span>}</p>
              </div>
              {!readOnly && <Button size="icon-sm" variant="ghost" aria-label={interpolate(t('Forget “{text}”'), { text: opinion.text })} onClick={() => void askWorker(`/api/annealer/opinions/${opinion.id}`, 'DELETE').then(take)}><Trash2Icon /></Button>}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={(event) => {
          event.preventDefault()
          if (!text.trim()) return
          void askWorker('/api/annealer/opinions', 'POST', { species, target, text }).then((answer) => { if (take(answer)) { setText(''); setTarget('') } })
        }}>
          <div className="space-y-1">
            <Label htmlFor="opinion-text" className="text-xs">{t('Something it should know')}</Label>
            <Input id="opinion-text" value={text} maxLength={OPINION_MAX} placeholder={t('Rate limits here are per account, not per address.')} onChange={(event) => setText(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="opinion-target" className="text-xs">{t('About (optional)')}</Label>
            <Input id="opinion-target" value={target} placeholder="example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={253} onChange={(event) => setTarget(event.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={!text.trim()}><PlusIcon />{t('Add')}</Button>
        </form>
      )}
    </div>
  )
}
