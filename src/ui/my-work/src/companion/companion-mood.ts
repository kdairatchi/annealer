// What the companion is doing, read from the work model the screen already shows. It reacts to recorded work only:
// it never claims an agent is busy because time passed, and it never celebrates something nobody recorded as shipped.
// Pure, so `node --test` can load it.
import { needsYou, type Request } from '../data.ts'
import type { RequestChange } from '../live/update-queue.ts'

/** The one definition of the companion's moods; sprites and words below are keyed by it. */
export const COMPANION_MOODS = ['needs-you', 'celebrating', 'working', 'resting', 'concerned'] as const
export type CompanionMood = (typeof COMPANION_MOODS)[number]

/** The mood in words, for the label under the sprite and for screen readers. */
export const COMPANION_MOOD_LABEL: Record<CompanionMood, string> = {
  'needs-you': 'Waiting on you',
  celebrating: 'Just shipped',
  working: 'Working',
  resting: 'Resting',
  concerned: 'A job is failing',
}

/** How long a shipped request is worth a cheer after the screen saw it. */
export const CHEER_MS = 60_000

export interface CompanionStatus {
  mood: CompanionMood
  /** One sentence saying why, built from recorded titles and counts. */
  line: string
  /** The request this is about, when there is one to open. */
  requestId: string | null
}

const titleOf = (request: Request) => request.title ?? request.resolvesTo?.title ?? 'A new request'
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * Attention first, as My Work sorts it: something waiting on you outranks a cheer, a cheer outranks a failing job,
 * a failing job outranks work in progress, and with nothing moving it rests and says what was left without a next
 * step. `failingJobs` names this creature's jobs whose last two runs failed.
 */
export function companionStatus(requests: readonly Request[], recentChanges: readonly RequestChange[], now: number, nextStepMissingText: string, failingJobs: readonly string[] = []): CompanionStatus {
  const open = requests.filter((request) => !request.closed)
  const waiting = open.filter(needsYou)
  if (waiting.length > 0) {
    const first = waiting.find((request) => request.state === 'your-move') ?? waiting[0]
    return {
      mood: 'needs-you', requestId: first.id,
      line: waiting.length === 1 ? `“${titleOf(first)}” is waiting on you.` : `${waiting.length} requests are waiting on you. First: “${titleOf(first)}”.`,
    }
  }
  const shipped = recentChanges.find((change) => change.kind === 'state' && change.to === 'shipped' && now - change.at < CHEER_MS)
  if (shipped) return { mood: 'celebrating', requestId: shipped.requestId, line: `Shipped: “${shipped.title}”.` }
  // A job this creature was given has failed twice running. It outranks work in progress: nobody is watching a job.
  if (failingJobs.length > 0) {
    return { mood: 'concerned', requestId: null, line: failingJobs.length === 1 ? `“${failingJobs[0]}” failed its last two runs.` : `${failingJobs.length} jobs failed their last two runs. First: “${failingJobs[0]}”.` }
  }
  const working = open.filter((request) => request.state === 'working')
  if (working.length > 0) {
    return {
      mood: 'working', requestId: working[0].id,
      line: working.length === 1 ? `Working on “${titleOf(working[0])}”.` : `${working.length} requests are moving. Newest: “${titleOf(working[0])}”.`,
    }
  }
  const adrift = open.filter((request) => request.state !== 'shipped' && (!request.next.text.trim() || request.next.text === nextStepMissingText))
  if (adrift.length > 0) {
    return { mood: 'resting', requestId: adrift[0].id, line: `Nothing is moving. ${plural(adrift.length, 'open request has', 'open requests have')} no next step recorded.` }
  }
  return { mood: 'resting', requestId: null, line: open.length === 0 ? 'No requests recorded yet.' : 'Nothing is moving right now.' }
}
