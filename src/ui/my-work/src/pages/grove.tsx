// The Grove: My Work as a tree you can climb into. The trunk is you, each branch is a focus area, each twig is a
// request and each leaf is a piece of work product. Branches thicken and level up from recorded evidence only
// (growth/growth-model.ts); the sheet under the tree shows exactly where a branch's level came from.
import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, PaletteIcon, TreesIcon } from 'lucide-react'
import { interpolate, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { StateBadge } from '@/components/bits'
import { Grove3D, type TreeLabel } from '@/components/grove-3d'
import { ContextPanel } from '@/components/grove-context'
import { Benchmarks, TuneUp } from '@/components/grove-panels'
import { Trail } from '@/components/grove-trail'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import type { LiveState, Request } from '@/data'
import { ACCENT_LABEL, ACCENT_TONES, ACCENTS, GROVE_MOTION_LABEL, GROVE_MOTIONS, GROVE_PANEL_LABEL, GROVE_PANELS, GROVE_VIEW_LABEL, GROVE_VIEWS, type GrovePanel } from '@/growth/grove-view'
import { addNote, dueNotes, readTrail, removeNote, toggleNote, type TrailNote } from '@/growth/trail'
import { BRANCH_LIMBS_SHOWN, buildBranchTree3, buildTree3 } from '@/growth/tree-3d'
import { tuneUp, type TuneUpTarget } from '@/growth/tune-up'
import { GROWTH_POINTS, toGrove, type Grove as GroveModel, type GrowthBranch } from '@/growth/growth-model'
import { LABELS_SHOWN, layoutTree, TREE_VIEW, TWIGS_SHOWN, type BranchLayout } from '@/growth/tree-layout'
import { NEXT_STEP_NOT_RECORDED } from '@/live/to-work-model'
import { useStore, useWorkModel } from '@/store'

/** A twig takes its request's state colour, the same one its badge uses. A new state fails the typecheck here. */
const TWIG_TONE: Record<LiveState, string> = {
  working: 'text-working-foreground', 'needs-check': 'text-review-foreground', 'your-move': 'text-attention-foreground',
  idle: 'text-idle-foreground', shipped: 'text-shipped-foreground',
}

const pad = (value: number) => String(value).padStart(2, '0')

/** A thin bar for "how far into this level". */
function LevelBar({ value, className }: { value: number; className?: string }) {
  return <span aria-hidden="true" className={cn('block h-1 overflow-hidden rounded-full bg-border', className)}><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} /></span>
}

function HowGrowthIsEarned() {
  const { t } = useI18n()
  const rows: [string, string][] = [
    [t('A request recorded as shipped'), `+${GROWTH_POINTS.shipped}`],
    [t('Reviewed progress on open work'), interpolate(t('up to +{points}'), { points: GROWTH_POINTS.reviewedProgress })],
    [interpolate(t('Each piece of work product, first {count} per request'), { count: GROWTH_POINTS.leavesCounted }), `+${GROWTH_POINTS.leaf}`],
    [t('A version you marked checked'), `+${GROWTH_POINTS.checked}`],
  ]
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="sm"><InfoIcon />{t('How growth is earned')}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 text-sm">
        <p className="font-medium">{t('Growth comes from recorded work')}</p>
        <table className="w-full text-xs">
          <tbody>{rows.map(([what, worth]) => <tr key={what} className="border-t"><td className="py-1.5 pr-3 text-muted-foreground">{what}</td><td className="py-1.5 text-right font-mono tabular-nums">{worth}</td></tr>)}</tbody>
        </table>
        <p className="text-xs text-muted-foreground">{t('Time spent, prompts sent and tool calls earn nothing. Unreviewed work earns nothing until a review reads it.')}</p>
      </PopoverContent>
    </Popover>
  )
}

/** One branch of the drawing: the limb, its twigs and their leaves. */
function BranchArt({ layout, branch, index, selected, dimmed, onSelect }: { layout: BranchLayout; branch: GrowthBranch; index: number; selected: boolean; dimmed: boolean; onSelect: () => void }) {
  const twigById = new Map(branch.twigs.map((twig) => [twig.requestId, twig]))
  return (
    <g className={cn('cursor-pointer transition-opacity', dimmed && 'opacity-35')} onClick={onSelect}>
      <motion.path d={layout.path} fill="none" strokeLinecap="round" strokeWidth={layout.girth}
        className={cn(selected ? 'stroke-primary' : 'stroke-foreground/55', branch.suggested && 'opacity-60')} strokeDasharray={branch.suggested ? '2 10' : undefined}
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.25 + index * 0.08, ease: 'easeOut' }} />
      {/* A wide invisible stroke, so the limb is easy to hit. */}
      <path d={layout.path} fill="none" stroke="transparent" strokeWidth={36} />
      {layout.twigs.map((twig, twigIndex) => {
        const model = twigById.get(twig.requestId)!
        return (
          <motion.g key={twig.requestId} className={TWIG_TONE[model.state]} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 + index * 0.08 + twigIndex * 0.04 }}>
            <line x1={twig.base.x} y1={twig.base.y} x2={twig.tip.x} y2={twig.tip.y} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray={model.missingNextStep ? '3 4' : undefined} />
            {twig.leaves.map((leaf, leafIndex) => <rect key={leafIndex} x={leaf.x - 4} y={leaf.y - 4} width={8} height={8} className="fill-primary/80" transform={`rotate(45 ${leaf.x} ${leaf.y})`} />)}
            <motion.circle cx={twig.tip.x} cy={twig.tip.y} r={model.state === 'shipped' ? 5 : 4} fill="currentColor"
              animate={model.state === 'working' ? { opacity: [1, 0.35, 1] } : undefined} transition={{ duration: 1.6, repeat: Infinity }} />
          </motion.g>
        )
      })}
      {/* The callout hairline, from the tip of the limb to its label at the edge. */}
      {layout.label && <line x1={layout.tip.x} y1={layout.tip.y} x2={layout.side === 'left' ? 190 : TREE_VIEW.width - 190} y2={layout.label.y + 18} className={cn('hidden xl:block', selected ? 'stroke-primary' : 'stroke-foreground/30')} strokeWidth={1} />}
    </g>
  )
}

/** A branch's label: its rank, name, level and what is going on in it. One button, used at the tree's edge and in the list. */
function BranchLabel({ branch, index, selected, onSelect, className, style }: { branch: GrowthBranch; index: number; selected: boolean; onSelect: () => void; className?: string; style?: React.CSSProperties }) {
  const { t } = useI18n()
  return (
    <Button variant="bare" onClick={onSelect} aria-pressed={selected} style={style}
      className={cn('block w-44 rounded-lg border bg-card/85 px-2.5 py-2 text-left font-normal whitespace-normal backdrop-blur-sm transition-colors', selected ? 'border-primary' : 'border-border/70 hover:border-accent-border', className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="section-label truncate">{pad(index + 1)} · {t(branch.suggested ? 'Suggested' : 'Branch')}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums">LV {branch.level}</span>
      </span>
      <span className="mt-0.5 block truncate text-[0.85rem] font-medium">{branch.name}</span>
      <LevelBar value={branch.intoLevel} className="mt-1.5" />
      <span className="mt-1.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        {branch.needsYou > 0 && <span className="text-attention-foreground">{interpolate(t(branch.needsYou === 1 ? '{count} needs you' : '{count} need you'), { count: branch.needsYou })}</span>}
        {branch.working > 0 && <span className="text-working-foreground">{interpolate(t('{count} working'), { count: branch.working })}</span>}
        <span>{interpolate(t(branch.twigs.length === 1 ? '{count} request' : '{count} requests'), { count: branch.twigs.length })}</span>
      </span>
    </Button>
  )
}

/** The sheet for one branch: where its level came from, and every request on it. */
function BranchSheet({ branch, requests, onOpenRequest, onOpenFocus, onSpotlight, climb, trail }: { branch: GrowthBranch; requests: readonly Request[]; onOpenRequest: (request: Request) => void; onOpenFocus: (focusAreaId: string) => void; onSpotlight: (requestId: string | null) => void; climb: React.ReactNode; trail: React.ReactNode }) {
  const { t } = useI18n()
  const byId = new Map(requests.map((request) => [request.id, request]))
  const adrift = branch.twigs.filter((twig) => twig.missingNextStep).length
  return (
    <motion.section key={branch.id} aria-label={branch.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-5 rounded-xl border bg-card/70 p-4 md:p-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div>
          <p className="section-label">{t(branch.suggested ? 'Suggested focus' : 'Focus area')}</p>
          <h3 className="text-lg font-semibold tracking-tight">{branch.name}</h3>
          {branch.goal && <p className="mt-1 text-sm text-muted-foreground">{branch.goal}</p>}
        </div>
        <div>
          <p className="flex items-baseline justify-between font-mono text-xs tabular-nums"><span>LV {branch.level}</span><span className="text-muted-foreground">{interpolate(t('{points} to LV {level}'), { points: branch.toNextLevel, level: branch.level + 1 })}</span></p>
          <LevelBar value={branch.intoLevel} className="mt-1 h-1.5" />
        </div>
        <table className="w-full text-xs">
          <caption className="section-label pb-1 text-left">{t('Where this level came from')}</caption>
          <tbody>
            {branch.sources.length === 0 && <tr className="border-t"><td className="py-1.5 text-muted-foreground">{t('Nothing recorded has earned growth here yet.')}</td></tr>}
            {branch.sources.map((source) => (
              <tr key={source.label} className="border-t">
                <td className="py-1.5 text-muted-foreground">{t(source.label)}</td>
                <td className="py-1.5 text-right text-muted-foreground tabular-nums">×{source.count}</td>
                <td className="w-12 py-1.5 text-right font-mono tabular-nums">+{source.points}</td>
              </tr>
            ))}
            <tr className="border-t font-medium"><td className="py-1.5">{t('Total')}</td><td /><td className="py-1.5 text-right font-mono tabular-nums">{branch.points}</td></tr>
          </tbody>
        </table>
        {adrift > 0 && <p className="text-xs text-attention-foreground">{interpolate(t(adrift === 1 ? '{count} open request has no next step recorded (dashed twig).' : '{count} open requests have no next step recorded (dashed twigs).'), { count: adrift })}</p>}
        {branch.asksNotStarted > 0 && <p className="text-xs text-muted-foreground">{interpolate(t(branch.asksNotStarted === 1 ? '{count} recorded ask is not linked to a request yet.' : '{count} recorded asks are not linked to requests yet.'), { count: branch.asksNotStarted })}</p>}
        {branch.asks.length > 0 && (
          <div>
            <p className="section-label pb-1">{t('Buds: asked for, not started')}</p>
            <ul className="space-y-1 text-xs">
              {branch.asks.slice(0, 6).map((ask) => <li key={ask.id} className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate">{ask.title}</span><span className="shrink-0 font-mono text-muted-foreground tabular-nums">×{ask.timesAsked}</span></li>)}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {climb}
          <Button size="sm" variant="outline" onClick={() => onOpenFocus(branch.id)}>{t('Open in My Work')}<ArrowRightIcon /></Button>
        </div>
      </div>
      <div className="min-w-0">
        <p className="section-label pb-1">{interpolate(t(branch.twigs.length === 1 ? '{count} request on this branch' : '{count} requests on this branch'), { count: branch.twigs.length })}</p>
        {branch.twigs.length === 0 ? <p className="border-t py-3 text-sm text-muted-foreground">{t('No requests are placed here yet. A focus area can exist before its work is sorted into it.')}</p> : (
          <ul className="divide-y border-t">
            {branch.twigs.map((twig) => {
              const request = byId.get(twig.requestId)
              return (
                <li key={twig.requestId}>
                  <Button variant="bare" disabled={!request} onClick={() => request && onOpenRequest(request)}
                    onPointerEnter={() => onSpotlight(twig.requestId)} onPointerLeave={() => onSpotlight(null)} onFocus={() => onSpotlight(twig.requestId)} onBlur={() => onSpotlight(null)} className="flex w-full items-center justify-start gap-3 rounded-none py-2 text-left text-sm font-normal whitespace-normal transition-colors hover:bg-accent/30">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{twig.title ?? t('New request')}</span>
                      <span className="block text-xs text-muted-foreground">
                        {twig.percent === null ? t('Not reviewed yet') : interpolate(t('{percent}% reviewed'), { percent: twig.percent })}
                        {' · '}{interpolate(t(twig.leaves === 1 ? '{count} piece of work product' : '{count} pieces of work product'), { count: twig.leaves })}
                        {twig.missingNextStep && <> · <span className="text-attention-foreground">{t('No next step recorded')}</span></>}
                      </span>
                    </span>
                    <StateBadge state={twig.state} />
                    <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums">+{twig.points}</span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {trail}
    </motion.section>
  )
}

function Tree({ grove, selectedId, onSelect }: { grove: GroveModel; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n()
  const layout = useMemo(() => layoutTree(grove), [grove])
  const { width, height, groundY } = TREE_VIEW
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card/50">
      {/* A low glow behind the trunk, in the brand colour, so the tree reads as lit from the ground. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_100%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent)]" />
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={interpolate(t('A tree with {count} branches, one per focus area. The list below names each branch and its level.'), { count: grove.branches.length })} className="relative block h-auto w-full">
        <line x1={60} x2={width - 60} y1={groundY} y2={groundY} className="stroke-foreground/25" strokeWidth={1} />
        <motion.path d={layout.trunk} fill="none" strokeLinecap="round" strokeWidth={Math.min(30, 14 + grove.level * 2)} className="stroke-foreground/70"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: 'easeOut' }} />
        {layout.branches.map((branch, index) => (
          <BranchArt key={branch.id} layout={branch} branch={grove.branches[index]} index={index} selected={selectedId === branch.id} dimmed={selectedId !== null && selectedId !== branch.id} onSelect={() => onSelect(branch.id)} />
        ))}
      </svg>
      {/* Labels sit at the edge the callout hairline runs to. Narrower screens use the list under the tree. */}
      {layout.branches.map((branch, index) => branch.label && (
        <BranchLabel key={branch.id} branch={grove.branches[index]} index={index} selected={selectedId === branch.id} onSelect={() => onSelect(branch.id)}
          className="absolute hidden xl:block" style={{ top: `${(branch.label.y / height) * 100}%`, [branch.side]: '0.75rem' }} />
      ))}
    </div>
  )
}

const TRAIL_KEY = 'annealer:grove:trail'
const today = () => new Date().toLocaleDateString('en-CA')

/** Colour, motion and how the tree is drawn, in one place. Every choice is saved in this browser. */
function Customize() {
  const { t } = useI18n()
  const accent = useStore((state) => state.view.accent)
  const motionLevel = useStore((state) => state.view.groveMotion)
  const groveView = useStore((state) => state.view.groveView)
  const { setAccent, setGroveMotion, setGroveView } = useStore.getState()
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="sm"><PaletteIcon />{t('Customize')}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4 text-sm">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium">{t('Accent colour, on every page')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {ACCENTS.map((option) => (
              <Button key={option} variant="bare" aria-pressed={accent === option} onClick={() => setAccent(option)}
                className={cn('flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-normal', accent === option ? 'border-primary' : 'border-control-edge hover:border-accent-border')}>
                <span aria-hidden="true" className="size-3 rounded-full" style={{ background: ACCENT_TONES[option]?.primary ?? '#fd6500' }} />{t(ACCENT_LABEL[option])}
              </Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium">{t('How the tree is drawn')}</legend>
          <div className="flex w-fit rounded-[10px] border border-control-edge p-0.5">
            {GROVE_VIEWS.map((option) => <Button key={option} size="xs" variant={groveView === option ? 'default' : 'ghost'} aria-pressed={groveView === option} onClick={() => setGroveView(option)}>{t(GROVE_VIEW_LABEL[option])}</Button>)}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium">{t('Motion')}</legend>
          <div className="flex w-fit rounded-[10px] border border-control-edge p-0.5">
            {GROVE_MOTIONS.map((option) => <Button key={option} size="xs" variant={motionLevel === option ? 'default' : 'ghost'} aria-pressed={motionLevel === option} onClick={() => setGroveMotion(option)}>{t(GROVE_MOTION_LABEL[option])}</Button>)}
          </div>
          <p className="text-xs text-muted-foreground">{t('Calm stops the tree turning by itself and leaves out the embers. You can still drag it.')}</p>
        </fieldset>
        <p className="border-t pt-3 text-xs text-muted-foreground">{t('The companion has its own settings: pick it in the corner.')}</p>
      </PopoverContent>
    </Popover>
  )
}

export function Grove({ onOpenRequest, onOpenFocus, onOpenPage }: { onOpenRequest: (request: Request) => void; onOpenFocus: (focusAreaId: string) => void; onOpenPage: (page: 'rules' | 'suggested' | 'work') => void }) {
  const { t } = useI18n()
  const { focusAreas, requests, otherAsks, rules } = useWorkModel()
  const companion = useStore((state) => state.view.companion)
  const groveView = useStore((state) => state.view.groveView)
  const calm = useStore((state) => state.view.groveMotion) === 'calm'
  const selectedId = useStore((state) => state.view.groveBranch)
  const { setCompanion, openGroveBranch: setSelectedId } = useStore.getState()
  const sample = new URLSearchParams(window.location.search).get('source') === 'sample'
  const grove = useMemo(() => toGrove(focusAreas, requests, otherAsks, NEXT_STEP_NOT_RECORDED, t('Other')), [focusAreas, requests, otherAsks, t])
  const selected = grove.branches.find((branch) => branch.id === selectedId) ?? null

  // The trail lives in this browser. Sample data gets its own, so trying the fixtures never touches real notes.
  const trailKey = sample ? `${TRAIL_KEY}:sample` : TRAIL_KEY
  const [trail, setTrail] = useState<TrailNote[]>(() => { try { return readTrail(localStorage.getItem(trailKey)) } catch { return [] } })
  const saveTrail = (next: TrailNote[]) => { setTrail(next); try { localStorage.setItem(trailKey, JSON.stringify(next)) } catch { /* Storage is blocked: the trail lasts for this visit. */ } }
  const day = today()

  const steps = useMemo(() => tuneUp(requests, rules, focusAreas, NEXT_STEP_NOT_RECORDED, dueNotes(trail, day)), [requests, rules, focusAreas, trail, day])
  const [panel, setPanel] = useState<GrovePanel>(selectedId ? 'branch' : 'tune-up')
  const [spotlight, setSpotlight] = useState<{ branchId: string | null; requestId: string | null }>({ branchId: null, requestId: null })
  // Climbing redraws one branch as its own tree. It is remembered per branch, so leaving the branch climbs back down.
  const [climbedId, setClimbedId] = useState<string | null>(null)
  const climbed = selected !== null && climbedId === selected.id && groveView === '3d'

  const openBranch = (id: string | null) => { setSelectedId(id); if (id) setPanel('branch') }
  const select = (id: string) => openBranch(selectedId === id ? null : id)
  const openById = (requestId: string) => { const request = requests.find((entry) => entry.id === requestId); if (request) onOpenRequest(request) }
  const go = (target: TuneUpTarget) => {
    if (target.kind === 'request') openById(target.requestId)
    else if (target.kind === 'branch') openBranch(target.branchId)
    else onOpenPage(target.page)
  }

  const rulesOn = rules.filter((rule) => rule.status === 'on').length
  const rulesWaiting = rules.filter((rule) => rule.status === 'suggested').length
  const tree = useMemo(() => climbed && selected ? buildBranchTree3(selected) : buildTree3(grove, { on: rulesOn, waiting: rulesWaiting }), [climbed, selected, grove, rulesOn, rulesWaiting])
  const labels = useMemo<TreeLabel[]>(() => climbed && selected
    ? selected.twigs.slice(0, BRANCH_LIMBS_SHOWN).map((twig) => ({ id: twig.requestId, name: twig.title ?? t('New request'), tag: twig.percent === null ? '–' : `${twig.percent}%`, alert: twig.state === 'your-move' || twig.state === 'needs-check' ? t('Needs you') : null }))
    : grove.branches.map((branch) => ({ id: branch.id, name: branch.name, tag: `LV ${branch.level}`, alert: branch.needsYou > 0 ? interpolate(t(branch.needsYou === 1 ? '{count} needs you' : '{count} need you'), { count: branch.needsYou }) : null })),
  [climbed, selected, grove, t])
  const tooltips = useMemo(() => new Map(grove.branches.flatMap((branch) => branch.twigs.map((twig) => [twig.requestId, { title: twig.title, state: twig.state }] as const))), [grove])
  const hidden = grove.branches.reduce((sum, branch) => sum + Math.max(0, branch.twigs.length - TWIGS_SHOWN), 0)

  return (
    <section aria-labelledby="grove-heading" className="space-y-4 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="section-label">{t('Grow')}</p>
          <h2 id="grove-heading" className="text-2xl font-semibold tracking-tight">{t('Grove')}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('Every focus area is a branch, every request a twig, every piece of work product a leaf. Asks nobody started are buds, and your rules are the roots.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch id="companion-shown" checked={companion.shown} onCheckedChange={(shown) => setCompanion({ shown })} />
            <Label htmlFor="companion-shown" className="text-xs">{interpolate(t('Show {name}'), { name: companion.name })}</Label>
          </div>
          <Customize />
          <HowGrowthIsEarned />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card/70 px-4 py-3">
        <p className="font-mono text-sm tabular-nums">LV {grove.level}</p>
        <div className="min-w-40 flex-1"><LevelBar value={grove.intoLevel} className="h-1.5" /></div>
        <p className="text-xs text-muted-foreground tabular-nums">{interpolate(t('{points} growth · {next} to LV {level}'), { points: grove.points, next: grove.toNextLevel, level: grove.level + 1 })}</p>
        {grove.sorting > 0 && <p className="text-xs text-muted-foreground">{interpolate(t(grove.sorting === 1 ? '{count} request is still being sorted and is not on the tree.' : '{count} requests are still being sorted and are not on the tree.'), { count: grove.sorting })}</p>}
      </div>

      {grove.branches.length === 0 ? (
        <p className="rounded-xl border bg-card/60 p-6 text-sm text-muted-foreground">{t('Nothing to grow yet. The Grove needs at least one focus area or one sorted request; keep working and check back after a refresh.')}</p>
      ) : (
        <>
          {groveView === '3d' ? (
            <div className="relative">
              {/* A new key replays the grow-in, so climbing into a branch reads as a new tree, not a jump cut. */}
              <Grove3D key={climbed ? `branch:${selected!.id}` : 'tree'} tree={tree} labels={labels} tooltips={tooltips} calm={calm}
                describe={climbed
                  ? interpolate(t('The branch {name} drawn as its own tree: {count} requests as limbs. Drag to turn it. Each request has a button on the tree.'), { name: selected!.name, count: labels.length })
                  : interpolate(t('A tree with {count} branches, one per focus area. Drag to turn it. Each branch has a button on the tree.'), { count: grove.branches.length })}
                selectedId={climbed ? null : selected?.id ?? null} spotlight={climbed ? { branchId: spotlight.requestId, requestId: spotlight.requestId } : spotlight}
                onSelect={(id) => { if (climbed) { if (id) openById(id) } else openBranch(id) }} onOpenRequest={openById} />
              {climbed && (
                <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-lg border bg-card/90 py-1 pr-1 pl-3 text-xs backdrop-blur-sm">
                  <span className="max-w-40 truncate font-medium">{selected!.name}</span>
                  <Button size="xs" variant="outline" onClick={() => setClimbedId(null)}><ArrowLeftIcon />{t('Whole tree')}</Button>
                </div>
              )}
            </div>
          ) : <Tree grove={grove} selectedId={selected?.id ?? null} onSelect={select} />}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {!climbed && rulesOn + rulesWaiting > 0 && groveView === '3d' && (
              <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => onOpenPage('rules')}>
                {interpolate(t('Roots: {on} rules on, {waiting} waiting on you'), { on: rulesOn, waiting: rulesWaiting })}<ArrowRightIcon />
              </Button>
            )}
            {!climbed && hidden > 0 && <span>{interpolate(t('The tree draws the first {shown} requests of each branch; {count} more are listed on their branch.'), { shown: TWIGS_SHOWN, count: hidden })}</span>}
            {climbed && selected!.twigs.length > BRANCH_LIMBS_SHOWN && <span>{interpolate(t('Showing the first {shown} of {count} requests; the rest are in the list below.'), { shown: BRANCH_LIMBS_SHOWN, count: selected!.twigs.length })}</span>}
          </div>
          <ul aria-label={t('Branches')} className={cn('flex gap-2 overflow-x-auto pb-1', grove.branches.length <= LABELS_SHOWN && 'xl:hidden')}>
            {grove.branches.map((branch, index) => <li key={branch.id} className="shrink-0"><BranchLabel branch={branch} index={index} selected={selected?.id === branch.id} onSelect={() => select(branch.id)} /></li>)}
          </ul>
          <div role="group" aria-label={t('What to show under the tree')} className="flex w-fit max-w-full overflow-x-auto rounded-[10px] border border-control-edge p-0.5">
            {GROVE_PANELS.map((option) => (
              <Button key={option} size="sm" variant={panel === option ? 'default' : 'ghost'} aria-pressed={panel === option} onClick={() => setPanel(option)}>
                {t(GROVE_PANEL_LABEL[option])}
                {option === 'tune-up' && steps.length > 0 && <span className="ml-1 font-mono text-[10px] tabular-nums opacity-80">{steps.length}</span>}
              </Button>
            ))}
          </div>
          {panel === 'tune-up' && <TuneUp steps={steps} onGo={go} />}
          {panel === 'benchmarks' && <Benchmarks grove={grove} sample={sample} onOpenBranch={openBranch} onSpotlight={(branchId) => setSpotlight({ branchId, requestId: null })} />}
          {panel === 'context' && <ContextPanel sample={sample} requests={requests} onOpenRequest={onOpenRequest} />}
          {panel === 'branch' && (selected
            ? <BranchSheet branch={selected} requests={requests} onOpenRequest={onOpenRequest} onOpenFocus={onOpenFocus} onSpotlight={(requestId) => setSpotlight({ branchId: null, requestId })}
                climb={groveView === '3d' && selected.twigs.length > 0
                  ? <Button size="sm" onClick={() => setClimbedId(climbed ? null : selected.id)}><TreesIcon />{t(climbed ? 'Back to the whole tree' : 'Climb into this branch')}</Button>
                  : null}
                trail={<Trail branchId={selected.id} notes={trail} today={day}
                  onAdd={(note) => saveTrail(addNote(trail, { ...note, id: crypto.randomUUID(), createdAt: new Date().toISOString() }))}
                  onToggle={(id) => saveTrail(toggleNote(trail, id))} onRemove={(id) => saveTrail(removeNote(trail, id))} />} />
            : <p className="rounded-xl border border-dashed bg-card/40 px-4 py-3 text-sm text-muted-foreground">{t('Pick a branch on the tree to open it.')}</p>)}
        </>
      )}
    </section>
  )
}
