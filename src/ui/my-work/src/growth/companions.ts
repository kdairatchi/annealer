// The page's side of companions: what the worker sent, read back without trusting it, and the sums the panel shows.
// The lists of creatures, lead kinds and run states are the worker's own (shared/annealer/companions.ts), so a state
// the worker can send and this page cannot name fails the typecheck. Pure, so `node --test` can load it.
import {
  cleanText, COMPANION_SPECIES, isCompanionSpecies, isCronLordState, isLeadKind, isLeadStatus, isParamType, isReach, isSchedule, jobFailing,
  LEAD_TEXT_MAX, levelFor, pointsOf, runStatusOf,
  type CompanionJob, type CompanionSpecies, type CompanionState, type CronLordStatus, type Lead, type Ritual, type ScopeEntry, type XpEvent,
} from '../../../../shared/annealer/companions.ts'

export const NO_CRONLORD: CronLordStatus = { state: 'not-set-up', url: null, version: null, open: false }
const emptyLedger = () => Object.fromEntries(COMPANION_SPECIES.map((species) => [species, [] as XpEvent[]])) as Record<CompanionSpecies, XpEvent[]>
export const EMPTY_COMPANIONS: CompanionState = { cronlord: NO_CRONLORD, rituals: [], jobs: [], leads: [], ledger: emptyLedger(), scope: [] }

const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object') : [])
const word = (value: unknown, max = 200) => cleanText(value, max)

/** The worker's answer, with anything this page cannot name dropped. Leads are job output and stay plain text. */
export function toCompanionState(body: unknown): CompanionState {
  const from = (body ?? {}) as Record<string, unknown>
  const cronlord = (from.cronlord ?? {}) as Record<string, unknown>
  const ledger = emptyLedger()
  const sentLedger = (from.ledger ?? {}) as Record<string, unknown>
  for (const species of COMPANION_SPECIES) {
    ledger[species] = list(sentLedger[species]).flatMap((event) => typeof event.at === 'string' && typeof event.points === 'number' && Number.isFinite(event.points) ? [{ at: event.at, points: event.points }] : [])
  }
  return {
    cronlord: isCronLordState(cronlord.state)
      ? { state: cronlord.state, url: typeof cronlord.url === 'string' ? word(cronlord.url) : null, version: typeof cronlord.version === 'string' ? word(cronlord.version, 20) : null, open: cronlord.open === true }
      : NO_CRONLORD,
    rituals: list(from.rituals).flatMap((ritual): Ritual[] => {
      const { owner, reach, lead } = ritual
      if (!isCompanionSpecies(owner) || !isReach(reach) || !isLeadKind(lead) || typeof ritual.id !== 'string') return []
      const params = list(ritual.params).flatMap((param) => { const { type } = param; return isParamType(type) && typeof param.name === 'string' ? [{ name: param.name, label: word(param.label, 60) || param.name, type, placeholder: word(param.placeholder, 120) }] : [] })
      return [{ id: ritual.id, name: word(ritual.name, 60) || ritual.id, description: word(ritual.description, 300), owner, reach, lead, needs: word(ritual.needs, 60), params }]
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
      return [{ id: lead.id, species, kind, status, jobId: typeof lead.jobId === 'string' ? lead.jobId : null, text: word(lead.text, LEAD_TEXT_MAX), target: word(lead.target, 300), createdAt: word(lead.createdAt, 40) }]
    }),
    ledger,
    scope: list(from.scope).flatMap((entry): ScopeEntry[] => typeof entry.id === 'number' && typeof entry.pattern === 'string' ? [{ id: entry.id, pattern: word(entry.pattern, 260) }] : []),
  }
}

export interface CreatureCard {
  species: CompanionSpecies
  points: number; level: number; intoLevel: number; toNextLevel: number
  jobs: number; failing: string[]; waiting: number; kept: number; dismissed: number
}

/** One creature's standing: its level from its ledger, and what its jobs and leads are doing. */
export function creatureCard(state: CompanionState, species: CompanionSpecies): CreatureCard {
  const points = pointsOf(state.ledger[species])
  const jobs = state.jobs.filter((job) => job.species === species)
  const leads = state.leads.filter((lead) => lead.species === species)
  const count = (status: Lead['status']) => leads.filter((lead) => lead.status === status).length
  return { species, points, ...levelFor(points), jobs: jobs.length, failing: jobs.filter(jobFailing).map((job) => job.target), waiting: count('new'), kept: count('kept'), dismissed: count('dismissed') }
}

/** The creatures that can be given a job: the ones some ritual names as its owner. */
export const workingSpecies = (state: CompanionState): CompanionSpecies[] => COMPANION_SPECIES.filter((species) => state.rituals.some((ritual) => ritual.owner === species))

/** What the fixtures show, so the panel can be tried without a worker or a scheduler. Nothing here runs. */
export const SAMPLE_COMPANIONS: CompanionState = {
  cronlord: { state: 'connected', url: 'http://127.0.0.1:7070', version: '0.3.6', open: false },
  rituals: [
    { id: 'subdomain-watch', name: 'Subdomain watch', description: 'Lists a root domain\'s subdomains from passive sources and reports the ones that were not there last time.', owner: 'moth', reach: 'read', lead: 'asset', needs: 'subfinder', params: [{ name: 'TARGET', label: 'Root domain', type: 'domain', placeholder: 'example.com' }] },
    { id: 'endpoint-watch', name: 'Endpoint watch', description: 'Fetches one address and reports when its status code or its body is different from last time.', owner: 'bolt', reach: 'touch', lead: 'change', needs: 'curl', params: [{ name: 'URL', label: 'Address to watch', type: 'url', placeholder: 'https://app.example.com/main.js' }] },
  ],
  jobs: [
    { id: 'annealer-moth-subdomain-watch-0a1b2c3d', species: 'moth', ritual: 'subdomain-watch', target: 'example.com', schedule: 'daily', branchId: null, createdAt: '2026-11-12T09:00:00.000Z', recent: [{ status: 'success', at: '2026-11-19T05:07:10.000Z' }, { status: 'success', at: '2026-11-18T05:07:09.000Z' }] },
    { id: 'annealer-bolt-endpoint-watch-4e5f6a7b', species: 'bolt', ritual: 'endpoint-watch', target: 'https://app.example.com/main.js', schedule: 'six-hourly', branchId: null, createdAt: '2026-11-14T09:00:00.000Z', recent: [{ status: 'timeout', at: '2026-11-19T06:07:21.000Z' }, { status: 'fail', at: '2026-11-19T00:07:02.000Z' }, { status: 'success', at: '2026-11-18T18:07:02.000Z' }] },
  ],
  leads: [
    { id: '4', species: 'moth', jobId: 'annealer-moth-subdomain-watch-0a1b2c3d', kind: 'asset', text: 'staging-admin.example.com', target: 'example.com', status: 'new', createdAt: '2026-11-19T05:07:10.000Z' },
    { id: '3', species: 'moth', jobId: 'annealer-moth-subdomain-watch-0a1b2c3d', kind: 'asset', text: 'grafana.example.com', target: 'example.com', status: 'new', createdAt: '2026-11-19T05:07:10.000Z' },
    { id: '2', species: 'bolt', jobId: 'annealer-bolt-endpoint-watch-4e5f6a7b', kind: 'change', text: 'body changed, HTTP 200, 48211 bytes then, 51877 now', target: 'https://app.example.com/main.js', status: 'kept', createdAt: '2026-11-18T12:07:02.000Z' },
    { id: '1', species: 'moth', jobId: 'annealer-moth-subdomain-watch-0a1b2c3d', kind: 'asset', text: 'cdn-eu.example.com', target: 'example.com', status: 'dismissed', createdAt: '2026-11-15T05:07:09.000Z' },
  ],
  ledger: {
    ...emptyLedger(),
    moth: [...Array.from({ length: 13 }, (_, index) => ({ at: `2026-11-${String(index + 3).padStart(2, '0')}T05:07:00.000Z`, points: 5 })), { at: '2026-11-15T05:07:09.000Z', points: -2 }],
    bolt: [{ at: '2026-11-18T12:07:02.000Z', points: 5 }],
  },
  scope: [{ id: 1, pattern: '*.example.com' }],
}
