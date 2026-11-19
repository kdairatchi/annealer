// SPDX-License-Identifier: Apache-2.0
//
// What a companion is, in one place. The worker and the My Work page both import this file, so every list of
// values below has exactly one definition (docs/architecture/state-machines.md). It imports nothing, on purpose:
// the two sides resolve modules differently, and a file with no imports loads the same way in both.
//
// A companion earns its level from what happened to its leads, never from how often its jobs ran
// (docs/annealer/companions.md).

/** The creatures a companion can be, in the order they unlock. */
export const COMPANION_SPECIES = ['cinder', 'sprout', 'moth', 'bolt'] as const
export type CompanionSpecies = (typeof COMPANION_SPECIES)[number]
export const isCompanionSpecies = (value: unknown): value is CompanionSpecies => COMPANION_SPECIES.includes(value as CompanionSpecies)

/** What one line of a job's output can be. A ritual prints `ANNEALER-LEAD <kind> <text>` for each. */
export const LEAD_KINDS = ['asset', 'change', 'note'] as const
export type LeadKind = (typeof LEAD_KINDS)[number]
export const LEAD_KIND_LABEL: Record<LeadKind, string> = { asset: 'New asset', change: 'Change', note: 'Note' }
export const isLeadKind = (value: unknown): value is LeadKind => LEAD_KINDS.includes(value as LeadKind)

/** What the owner decided about a lead. `new` means nothing yet. */
export const LEAD_STATUSES = ['new', 'kept', 'dismissed'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { new: 'New', kept: 'Kept', dismissed: 'Dismissed' }
export const isLeadStatus = (value: unknown): value is LeadStatus => LEAD_STATUSES.includes(value as LeadStatus)

/** Whether a ritual only reads public sources or sends traffic to the target. `touch` needs a scope match. */
export const REACHES = ['read', 'touch'] as const
export type Reach = (typeof REACHES)[number]
export const REACH_LABEL: Record<Reach, string> = { read: 'Public sources only', touch: 'Sends requests to the target' }
export const isReach = (value: unknown): value is Reach => REACHES.includes(value as Reach)

/** How a ritual's parameter is checked before it is handed to a shell as an environment variable. */
export const PARAM_TYPES = ['domain', 'url'] as const
export type ParamType = (typeof PARAM_TYPES)[number]
export const isParamType = (value: unknown): value is ParamType => PARAM_TYPES.includes(value as ParamType)

/** How often a job runs. Fixed choices, so nothing typed on the page ever becomes a cron line. */
export const SCHEDULES = ['hourly', 'six-hourly', 'daily', 'weekly'] as const
export type Schedule = (typeof SCHEDULES)[number]
export const SCHEDULE_CRON: Record<Schedule, string> = { hourly: '7 * * * *', 'six-hourly': '7 */6 * * *', daily: '7 5 * * *', weekly: '7 5 * * 1' }
export const SCHEDULE_LABEL: Record<Schedule, string> = { hourly: 'Every hour', 'six-hourly': 'Every six hours', daily: 'Every day', weekly: 'Every week' }
export const isSchedule = (value: unknown): value is Schedule => SCHEDULES.includes(value as Schedule)

/** A run's state, as CronLord reports it. `unknown` is anything this build has no word for. */
export const RUN_STATUSES = ['queued', 'running', 'success', 'fail', 'timeout', 'cancelling', 'cancelled', 'unknown'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Queued', running: 'Running', success: 'Ran', fail: 'Failed', timeout: 'Timed out', cancelling: 'Stopping', cancelled: 'Stopped', unknown: 'Unknown',
}
export const runStatusOf = (value: unknown): RunStatus => (RUN_STATUSES.includes(value as RunStatus) ? (value as RunStatus) : 'unknown')
const FAILED_RUNS: readonly RunStatus[] = ['fail', 'timeout']
const FINISHED_RUNS: readonly RunStatus[] = ['success', 'fail', 'timeout', 'cancelled']
export const runFailed = (status: RunStatus) => FAILED_RUNS.includes(status)
export const runFinished = (status: RunStatus) => FINISHED_RUNS.includes(status)

/** Whether the worker can talk to CronLord, the scheduler that runs every job. */
export const CRONLORD_STATES = ['not-set-up', 'unreachable', 'refused', 'connected'] as const
export type CronLordState = (typeof CRONLORD_STATES)[number]
export const CRONLORD_STATE_LABEL: Record<CronLordState, string> = {
  'not-set-up': 'CronLord is not set up', unreachable: 'CronLord did not answer', refused: 'CronLord refused the token', connected: 'Connected to CronLord',
}
export const isCronLordState = (value: unknown): value is CronLordState => CRONLORD_STATES.includes(value as CronLordState)

// --- Levels -----------------------------------------------------------------------------------------------------

/** Each level costs this much more than the one before it. */
export const LEVEL_STEP = 50
/** Points at which `level` starts. Level 1 starts at 0. The Grove and every companion use this one curve. */
export const levelFloor = (level: number) => (LEVEL_STEP * level * (level - 1)) / 2

export function levelFor(points: number): { level: number; intoLevel: number; toNextLevel: number } {
  let level = 1
  while (levelFloor(level + 1) <= points) level += 1
  const floor = levelFloor(level)
  const span = levelFloor(level + 1) - floor
  return { level, intoLevel: (points - floor) / span, toNextLevel: floor + span - points }
}

/** What a decision about a lead is worth to the creature that brought it. Running a job is worth nothing. */
export const LEAD_POINTS: Record<LeadStatus, number> = { new: 0, kept: 5, dismissed: -2 }
/** The most a creature can lose in one day, so one noisy job cannot undo a month. */
export const DAILY_LOSS_CAP = 60

export interface XpEvent { at: string; points: number }

/**
 * A creature's points from its ledger. Losses beyond the daily cap are not counted, and the total never goes below
 * zero. `at` is an ISO time; its first ten characters are the day.
 */
export function pointsOf(events: readonly XpEvent[]): number {
  const lostOn = new Map<string, number>()
  let total = 0
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (event.points >= 0) { total += event.points; continue }
    const day = event.at.slice(0, 10)
    const already = lostOn.get(day) ?? 0
    const loss = Math.min(-event.points, Math.max(0, DAILY_LOSS_CAP - already))
    lostOn.set(day, already + loss)
    total = Math.max(0, total - loss)
  }
  return total
}

// --- Leads ------------------------------------------------------------------------------------------------------

export const LEAD_TEXT_MAX = 300
/** Leads taken from one run. A job that prints more than this is noise; the rest are counted, not kept. */
export const LEADS_PER_RUN = 50
export const LEAD_MARK = 'ANNEALER-LEAD'

export interface ParsedLead { kind: LeadKind; text: string }

/** Control characters out, whitespace collapsed, cut to length. Job output is untrusted text and stays text. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trimEnd()
}

/**
 * The leads in a run's log. CronLord writes each line as `<time> <stream> <text>`; only what the job itself printed
 * to stdout counts, so the `meta` line that echoes the command (which contains the mark) is never read as a lead.
 * Also accepts CronLord's event-stream framing (`data: ` before each line).
 */
export function parseLeads(log: string): { leads: ParsedLead[]; dropped: number } {
  const leads: ParsedLead[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const raw of log.split('\n')) {
    const line = raw.startsWith('data: ') ? raw.slice(6) : raw
    const match = /^\S+ stdout ANNEALER-LEAD (\S+) (.+)$/.exec(line.trimEnd())
    if (!match || !isLeadKind(match[1])) continue
    const text = cleanText(match[2], LEAD_TEXT_MAX)
    const key = `${match[1]} ${text}`
    if (!text || seen.has(key)) continue
    seen.add(key)
    if (leads.length >= LEADS_PER_RUN) { dropped += 1; continue }
    leads.push({ kind: match[1], text })
  }
  return { leads, dropped }
}

// --- Scope and parameters ---------------------------------------------------------------------------------------

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/

/** A plain DNS name in lower case, or null. No ports, paths, wildcards, IP addresses or single labels. */
export function cleanHost(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  return HOST.test(host) ? host : null
}

/** A scope entry: `example.com` (that host only) or `*.example.com` (the host and everything under it). */
export function cleanScopePattern(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const pattern = value.trim().toLowerCase()
  const host = cleanHost(pattern.startsWith('*.') ? pattern.slice(2) : pattern)
  // `*.com` would put half the internet in scope.
  if (!host || (pattern.startsWith('*.') && host.split('.').length < 2)) return null
  return pattern.startsWith('*.') ? `*.${host}` : host
}

export function hostInScope(host: string, patterns: readonly string[]): boolean {
  const name = cleanHost(host)
  if (!name) return false
  return patterns.some((pattern) => pattern.startsWith('*.') ? name === pattern.slice(2) || name.endsWith(pattern.slice(1)) : name === pattern)
}

export const PARAM_VALUE_MAX = 2000

/** An http or https address on a named host, with no credentials in it, or null. */
export function cleanUrl(value: unknown): { href: string; host: string } | null {
  if (typeof value !== 'string' || value.length > PARAM_VALUE_MAX) return null
  let url: URL
  try { url = new URL(value.trim()) } catch { return null }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
  const host = cleanHost(url.hostname)
  return host ? { href: url.href, host } : null
}

/** A parameter value as it will be handed to the job, and the host it points at; or null when it is not usable. */
export function cleanParam(type: ParamType, value: unknown): { value: string; host: string } | null {
  if (type === 'domain') { const host = cleanHost(value); return host ? { value: host, host } : null }
  const url = cleanUrl(value)
  return url ? { value: url.href, host: url.host } : null
}

// --- Job names --------------------------------------------------------------------------------------------------

/** FNV-1a, as eight hex characters. Only used to tell two jobs of the same ritual apart. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export const JOB_ID_PREFIX = 'annealer-'
/** A job's id in CronLord. It names the creature and the ritual, so the job is recognisable in CronLord's own pages. */
export const jobIdFor = (species: CompanionSpecies, ritualId: string, params: Record<string, string>) =>
  `${JOB_ID_PREFIX}${species}-${ritualId}-${shortHash(Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('\n'))}`
export const isAnnealerJobId = (value: unknown): value is string => typeof value === 'string' && /^annealer-[a-z]+-[a-z0-9-]+-[0-9a-f]{8}$/.test(value)

// --- What the worker tells the page -----------------------------------------------------------------------------

export interface RitualParam { name: string; label: string; type: ParamType; placeholder: string }
export interface Ritual { id: string; name: string; description: string; owner: CompanionSpecies; reach: Reach; lead: LeadKind; needs: string; params: RitualParam[] }
export interface CompanionJob {
  id: string; species: CompanionSpecies; ritual: string; target: string; schedule: Schedule; branchId: string | null
  /** Newest first, at most five. Empty until the job has run and been checked. */
  recent: { status: RunStatus; at: string | null }[]
  createdAt: string
}
export interface Lead { id: string; species: CompanionSpecies; jobId: string | null; kind: LeadKind; text: string; target: string; status: LeadStatus; createdAt: string }
export interface ScopeEntry { id: number; pattern: string }
export interface CronLordStatus { state: CronLordState; url: string | null; version: string | null; /** It answered a request that carried no token. */ open: boolean }
export interface CompanionState { cronlord: CronLordStatus; rituals: Ritual[]; jobs: CompanionJob[]; leads: Lead[]; /** Every decision that earned or cost a creature points. */ ledger: Record<CompanionSpecies, XpEvent[]>; scope: ScopeEntry[] }

/** A job is failing when its last two checked runs both failed or timed out. One bad run is not a pattern. */
export const jobFailing = (job: Pick<CompanionJob, 'recent'>) => job.recent.length >= 2 && runFailed(job.recent[0].status) && runFailed(job.recent[1].status)
