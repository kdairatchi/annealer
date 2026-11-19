// The page's side of companions: what the worker sent, read back without trusting it, and the sums the panel shows.
// The lists of creatures, lead kinds and run states are the worker's own (shared/annealer/companions.ts), so a state
// the worker can send and this page cannot name fails the typecheck. Pure, so `node --test` can load it.
import {
  cleanHost, cleanLongText, cleanSoul, cleanText, cleanUrl, COMPANION_SPECIES, DEFAULT_SOUL, DETAIL_MAX, ENGINES, isAnswerShape, isAskState, isCompanionSpecies, isCronLordState,
  isEngine, isLeadKind, isLeadStatus, isParamType, isReach, isReads, isRunner, isSchedule, jobFailing, LEAD_TEXT_MAX, levelFor, OPINION_MAX, pointsOf, runStatusOf,
  type Ask, type CompanionJob, type CompanionSpecies, type CompanionState, type CronLordStatus, type Engine, type Lead, type Opinion, type Ritual, type ScopeEntry,
  type Soul, type XpEvent,
} from '../../../../shared/annealer/companions.ts'

export const NO_CRONLORD: CronLordStatus = { state: 'not-set-up', url: null, version: null, open: false }
const perSpecies = <T>(make: () => T) => Object.fromEntries(COMPANION_SPECIES.map((species) => [species, make()])) as Record<CompanionSpecies, T>
const noEngines = () => Object.fromEntries(ENGINES.map((engine) => [engine, engine === 'none'])) as Record<Engine, boolean>
export const EMPTY_COMPANIONS: CompanionState = {
  cronlord: NO_CRONLORD, souls: perSpecies(() => ({ ...DEFAULT_SOUL })), opinions: [], asks: [], engines: noEngines(), rituals: [], jobs: [], leads: [],
  ledger: perSpecies<XpEvent[]>(() => []), scope: [],
}

const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object') : [])
const fields = (value: unknown) => (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>
const word = (value: unknown, max = 200) => cleanText(value, max)

/** The worker's answer, with anything this page cannot name dropped. Leads and answers are output and stay plain text. */
export function toCompanionState(body: unknown): CompanionState {
  const from = fields(body)
  const cronlord = fields(from.cronlord)
  const sentLedger = fields(from.ledger)
  const sentSouls = fields(from.souls)
  const sentEngines = fields(from.engines)
  return {
    cronlord: isCronLordState(cronlord.state)
      ? { state: cronlord.state, url: typeof cronlord.url === 'string' ? word(cronlord.url) : null, version: typeof cronlord.version === 'string' ? word(cronlord.version, 20) : null, open: cronlord.open === true }
      : NO_CRONLORD,
    souls: Object.fromEntries(COMPANION_SPECIES.map((species) => [species, cleanSoul(sentSouls[species])])) as Record<CompanionSpecies, Soul>,
    opinions: list(from.opinions).flatMap((opinion): Opinion[] => isCompanionSpecies(opinion.species) && typeof opinion.id === 'number'
      ? [{ id: opinion.id, species: opinion.species, target: word(opinion.target, 260), text: word(opinion.text, OPINION_MAX), leadId: typeof opinion.leadId === 'string' ? opinion.leadId : null, createdAt: word(opinion.createdAt, 40) }]
      : []),
    asks: list(from.asks).flatMap((ask): Ask[] => isCompanionSpecies(ask.species) && isEngine(ask.engine) && isAskState(ask.state) && typeof ask.id === 'string'
      ? [{ id: ask.id, species: ask.species, engine: ask.engine, state: ask.state, ritual: word(ask.ritual, 60), target: word(ask.target, 300), note: word(ask.note, 200), createdAt: word(ask.createdAt, 40) }]
      : []),
    engines: Object.fromEntries(ENGINES.map((engine) => [engine, engine === 'none' || sentEngines[engine] === true])) as Record<Engine, boolean>,
    rituals: list(from.rituals).flatMap((ritual): Ritual[] => {
      const { owner, reach, lead } = ritual
      if (!isCompanionSpecies(owner) || !isReach(reach) || !isLeadKind(lead) || typeof ritual.id !== 'string') return []
      const params = list(ritual.params).flatMap((param) => { const { type } = param; return isParamType(type) && typeof param.name === 'string' ? [{ name: param.name, label: word(param.label, 60) || param.name, type, placeholder: word(param.placeholder, 120), optional: param.optional === true }] : [] })
      return [{
        id: ritual.id, name: word(ritual.name, 60) || ritual.id, description: word(ritual.description, 300), owner, reach, lead, needs: word(ritual.needs, 60), params,
        runner: isRunner(ritual.runner) ? ritual.runner : 'shell', reads: isReads(ritual.reads) ? ritual.reads : 'nothing', answer: isAnswerShape(ritual.answer) ? ritual.answer : null,
      }]
    }),
    jobs: list(from.jobs).flatMap((job): CompanionJob[] => {
      const { species, schedule } = job
      if (!isCompanionSpecies(species) || !isSchedule(schedule) || typeof job.id !== 'string') return []
      return [{
        id: job.id, species, schedule, ritual: word(job.ritual, 60), target: word(job.target, 300), branchId: typeof job.branchId === 'string' ? job.branchId : null, createdAt: word(job.createdAt, 40),
        recent: list(job.recent).slice(0, 5).map((run) => ({ status: runStatusOf(run.status), at: typeof run.at === 'string' ? run.at : null })),
      }]
    }),
    leads: list(from.leads).flatMap((lead): Lead[] => {
      const { species, kind, status } = lead
      if (!isCompanionSpecies(species) || !isLeadKind(kind) || !isLeadStatus(status) || typeof lead.id !== 'string') return []
      return [{
        id: lead.id, species, kind, status, jobId: typeof lead.jobId === 'string' ? lead.jobId : null, text: word(lead.text, LEAD_TEXT_MAX), target: word(lead.target, 300), createdAt: word(lead.createdAt, 40),
        detail: cleanLongText(lead.detail, DETAIL_MAX), sources: Array.isArray(lead.sources) ? lead.sources.filter((source): source is string => typeof source === 'string').slice(0, 100) : [],
      }]
    }),
    ledger: Object.fromEntries(COMPANION_SPECIES.map((species) => [species, list(sentLedger[species]).flatMap((event) => typeof event.at === 'string' && typeof event.points === 'number' && Number.isFinite(event.points) ? [{ at: event.at, points: event.points }] : [])])) as Record<CompanionSpecies, XpEvent[]>,
    scope: list(from.scope).flatMap((entry): ScopeEntry[] => typeof entry.id === 'number' && typeof entry.pattern === 'string' ? [{ id: entry.id, pattern: word(entry.pattern, 260) }] : []),
  }
}

export interface CreatureCard {
  species: CompanionSpecies
  /** The name you gave it, or '' while it still goes by its species. */
  name: string
  points: number; level: number; intoLevel: number; toNextLevel: number
  jobs: number; failing: string[]; waiting: number; thinking: number
}

/** One creature's standing: its level from its ledger, and what its jobs, questions and leads are doing. */
export function creatureCard(state: CompanionState, species: CompanionSpecies): CreatureCard {
  const points = pointsOf(state.ledger[species])
  const jobs = state.jobs.filter((job) => job.species === species)
  return {
    species, name: state.souls[species].name, points, ...levelFor(points), jobs: jobs.length, failing: jobs.filter(jobFailing).map((job) => job.target),
    waiting: state.leads.filter((lead) => lead.species === species && lead.status === 'new').length,
    thinking: state.asks.filter((ask) => ask.species === species && ask.state === 'waiting').length,
  }
}

/** The creatures that can be given work: the ones some ritual names as its owner. */
export const workingSpecies = (state: CompanionState): CompanionSpecies[] => COMPANION_SPECIES.filter((species) => state.rituals.some((ritual) => ritual.owner === species))

/** The domain a lead's target sits under, for asking about "everything kept on this target". */
export const hostOfTarget = (target: string): string => cleanHost(target) ?? cleanUrl(target)?.host ?? ''

/**
 * The targets a creature could be asked about: every host that has something kept, and its parent domains that
 * also do, most leads first. Only found things count; what a model wrote is not material.
 */
export function keptTargets(leads: readonly Lead[]): { host: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const lead of leads) {
    if (!['kept', 'confirmed', 'shipped', 'accepted'].includes(lead.status) || !['asset', 'change', 'endpoint', 'note'].includes(lead.kind)) continue
    const labels = hostOfTarget(lead.target).split('.')
    // example.com and every name under it that the lead belongs to, but never a bare suffix such as "com".
    for (let cut = 0; cut <= labels.length - 2; cut += 1) { const host = labels.slice(cut).join('.'); counts.set(host, (counts.get(host) ?? 0) + 1) }
  }
  return [...counts.entries()].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || a.host.length - b.host.length || a.host.localeCompare(b.host)).slice(0, 12)
}

const sampleRitual = (ritual: Omit<Ritual, 'runner' | 'reads' | 'needs' | 'answer'> & Partial<Pick<Ritual, 'runner' | 'reads' | 'needs' | 'answer'>>): Ritual => ({ runner: 'shell', reads: 'nothing', needs: '', answer: null, ...ritual })
const sampleLead = (lead: Omit<Lead, 'detail' | 'sources'> & Partial<Pick<Lead, 'detail' | 'sources'>>): Lead => ({ detail: '', sources: [], ...lead })

/** What the fixtures show, so the panel can be tried without a worker or a scheduler. Nothing here runs. */
export const SAMPLE_COMPANIONS: CompanionState = {
  cronlord: { state: 'connected', url: 'http://127.0.0.1:7070', version: '0.3.6', open: false },
  souls: {
    ...perSpecies(() => ({ ...DEFAULT_SOUL })),
    cinder: { ...DEFAULT_SOUL, name: 'Ash', catchphrase: 'Cheapest test first.', role: 'Prefer authentication and access-control bugs. Skip anything that needs a paid account.', tone: 'terse', engine: 'local', model: 'hermes3:8b' },
    rime: { ...DEFAULT_SOUL, tone: 'dry', engine: 'claude', model: 'sonnet', paidRituals: ['challenge'], runsPerDay: 6 },
  },
  opinions: [
    { id: 2, species: 'cinder', target: 'example.com', text: 'SSRF through the image proxy was a dead end: it only fetches from an allow-list.', leadId: null, createdAt: '2026-11-16T09:00:00.000Z' },
    { id: 1, species: 'cinder', target: '', text: 'Rate limits here are usually per account, not per address.', leadId: null, createdAt: '2026-11-10T09:00:00.000Z' },
  ],
  asks: [
    { id: 'annealer-rime-challenge-9c8d7e6f', species: 'rime', ritual: 'challenge', target: 'example.com', engine: 'claude', state: 'waiting', note: '', createdAt: '2026-11-19T09:41:00.000Z' },
    { id: 'annealer-cinder-hypotheses-1a2b3c4d', species: 'cinder', ritual: 'hypotheses', target: 'example.com', engine: 'local', state: 'answered', note: '2 leads', createdAt: '2026-11-19T09:30:00.000Z' },
  ],
  engines: { none: true, local: true, claude: true },
  rituals: [
    sampleRitual({ id: 'subdomain-watch', name: 'Subdomain watch', description: 'Lists a root domain\'s subdomains from passive sources and reports the ones that were not there last time.', owner: 'moth', reach: 'read', lead: 'asset', needs: 'subfinder', params: [{ name: 'TARGET', label: 'Root domain', type: 'domain', placeholder: 'example.com', optional: false }] }),
    sampleRitual({ id: 'endpoint-watch', name: 'Endpoint watch', description: 'Fetches one address and reports when its status code or its body is different from last time.', owner: 'bolt', reach: 'touch', lead: 'change', needs: 'curl', params: [{ name: 'URL', label: 'Address to watch', type: 'url', placeholder: 'https://app.example.com/main.js', optional: false }] }),
    sampleRitual({ id: 'script-endpoints', name: 'Script endpoints', description: 'Fetches one script and lists the paths and addresses quoted inside it. Reports the ones that were not there last time.', owner: 'weevil', reach: 'touch', lead: 'endpoint', needs: 'curl', params: [{ name: 'URL', label: 'Script to read', type: 'url', placeholder: 'https://app.example.com/assets/main.js', optional: false }] }),
    sampleRitual({ id: 'hypotheses', name: 'Hypotheses', description: 'Reads what you kept about a target and proposes attack hypotheses, each with the cheapest test that would prove it wrong.', owner: 'cinder', reach: 'read', lead: 'hypothesis', runner: 'model', reads: 'target-leads', answer: 'list', params: [{ name: 'TARGET', label: 'Target', type: 'domain', placeholder: 'example.com', optional: false }, { name: 'NOTES', label: 'Anything else it should know', type: 'text', placeholder: 'Stack, auth model, what you already tried', optional: true }] }),
    sampleRitual({ id: 'challenge', name: 'Challenge', description: 'Tries to break one lead: what would make it a false positive, a duplicate or out of scope, and what evidence is missing.', owner: 'rime', reach: 'read', lead: 'verdict', runner: 'model', reads: 'one-lead', answer: 'verdict', params: [{ name: 'NOTES', label: 'Evidence you have', type: 'text', placeholder: 'The request that reproduces it, the response, what you checked', optional: true }] }),
    sampleRitual({ id: 'report-draft', name: 'Report draft', description: 'Drafts a report from one confirmed lead and the steps you give it. It only writes; sending is yours.', owner: 'quill', reach: 'read', lead: 'draft', runner: 'model', reads: 'one-lead', answer: 'document', params: [{ name: 'NOTES', label: 'Steps and evidence', type: 'text', placeholder: 'What you did, in order, and what came back', optional: false }] }),
  ],
  jobs: [
    { id: 'annealer-moth-subdomain-watch-0a1b2c3d', species: 'moth', ritual: 'subdomain-watch', target: 'example.com', schedule: 'daily', branchId: null, createdAt: '2026-11-12T09:00:00.000Z', recent: [{ status: 'success', at: '2026-11-19T05:07:10.000Z' }, { status: 'success', at: '2026-11-18T05:07:09.000Z' }] },
    { id: 'annealer-bolt-endpoint-watch-4e5f6a7b', species: 'bolt', ritual: 'endpoint-watch', target: 'https://app.example.com/main.js', schedule: 'six-hourly', branchId: null, createdAt: '2026-11-14T09:00:00.000Z', recent: [{ status: 'timeout', at: '2026-11-19T06:07:21.000Z' }, { status: 'fail', at: '2026-11-19T00:07:02.000Z' }, { status: 'success', at: '2026-11-18T18:07:02.000Z' }] },
  ],
  leads: [
    sampleLead({ id: '8', species: 'moth', jobId: 'annealer-moth-subdomain-watch-0a1b2c3d', kind: 'asset', text: 'grafana.example.com', target: 'example.com', status: 'new', createdAt: '2026-11-19T05:07:10.000Z' }),
    sampleLead({ id: '7', species: 'cinder', jobId: null, kind: 'hypothesis', text: 'Anonymous dashboards on a forgotten Grafana', target: 'example.com', status: 'new', createdAt: '2026-11-19T09:31:00.000Z', detail: 'Test: GET /api/dashboards/home without a cookie.\nBecause: staging-admin.example.com shares its certificate with a metrics host.', sources: ['3', '2'] }),
    sampleLead({ id: '6', species: 'cinder', jobId: null, kind: 'hypothesis', text: 'Host header poisoning on the staging-admin password reset', target: 'example.com', status: 'confirmed', createdAt: '2026-11-19T09:31:00.000Z', detail: 'Test: send one reset with a forged Host and read the link in the mail.\nBecause: staging-admin.example.com', sources: ['3', '2'] }),
    sampleLead({ id: '5', species: 'rime', jobId: null, kind: 'verdict', text: 'Could not break it: the reset link is built from the Host header on staging only', target: 'example.com', status: 'kept', createdAt: '2026-11-19T09:36:00.000Z', detail: 'VERDICT: stands\n1. Staging may be out of scope. Check the programme page for staging hosts.\n2. No proof the mail is delivered to a real user. Show the received link.', sources: ['6'] }),
    sampleLead({ id: '3', species: 'moth', jobId: 'annealer-moth-subdomain-watch-0a1b2c3d', kind: 'asset', text: 'staging-admin.example.com', target: 'example.com', status: 'kept', createdAt: '2026-11-18T05:07:09.000Z' }),
    sampleLead({ id: '2', species: 'bolt', jobId: 'annealer-bolt-endpoint-watch-4e5f6a7b', kind: 'change', text: 'body changed, HTTP 200, 48211 bytes then, 51877 now', target: 'https://app.example.com/main.js', status: 'kept', createdAt: '2026-11-18T12:07:02.000Z' }),
    sampleLead({ id: '1', species: 'moth', jobId: 'annealer-moth-subdomain-watch-0a1b2c3d', kind: 'asset', text: 'cdn-eu.example.com', target: 'example.com', status: 'dismissed', createdAt: '2026-11-15T05:07:09.000Z' }),
  ],
  ledger: {
    ...perSpecies<XpEvent[]>(() => []),
    moth: [...Array.from({ length: 13 }, (_, index) => ({ at: `2026-11-${String(index + 3).padStart(2, '0')}T05:07:00.000Z`, points: 5 })), { at: '2026-11-15T05:07:09.000Z', points: -2 }],
    bolt: [{ at: '2026-11-18T12:07:02.000Z', points: 5 }],
    cinder: [{ at: '2026-11-19T09:50:00.000Z', points: 40 }, { at: '2026-11-12T09:50:00.000Z', points: 60 }, { at: '2026-11-08T09:50:00.000Z', points: 100 }],
    rime: [{ at: '2026-11-19T09:40:00.000Z', points: 5 }],
  },
  scope: [{ id: 1, pattern: '*.example.com' }],
}
