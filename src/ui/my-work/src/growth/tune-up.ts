// The tune-up: a short session that walks you through the things that would grow this tree right now. Every step is
// something recorded as waiting (a version to check, a question to answer, a rule to decide), so the list shrinks only
// when the work really changes. Nothing here asks a model anything. Pure, so `node --test` can load it.
import type { FocusArea, Request } from '../data.ts'
import type { OwnerRule } from '../data-rules.ts'
import { GROWTH_POINTS } from './growth-model.ts'
import type { TrailNote } from './trail.ts'

/** The one definition of what a tune-up can ask for, in the order it asks. */
export const TUNE_UP_KINDS = ['reminder', 'answer', 'check', 'next-step', 'rules', 'areas', 'unreviewed'] as const
export type TuneUpKind = (typeof TUNE_UP_KINDS)[number]

/** Each kind as a short instruction. A new kind fails the typecheck until it has one. */
export const TUNE_UP_LABEL: Record<TuneUpKind, string> = {
  reminder: 'A reminder you left',
  answer: 'Answer what it asked',
  check: 'Check this version',
  'next-step': 'Give it a next step',
  rules: 'Decide the learned rules',
  areas: 'Decide the suggested focus areas',
  unreviewed: 'Get open work reviewed',
}

/** Why each kind matters, in one sentence. */
export const TUNE_UP_REASON: Record<TuneUpKind, string> = {
  reminder: 'You asked to be reminded of this on its branch. Mark it done on the trail when it is.',
  answer: 'The agent stopped and is waiting on you. Nothing on this request moves until you reply.',
  check: 'The work says it is done and wants your eyes. A version you mark checked earns growth.',
  'next-step': 'Nobody recorded what happens next, so this request is the kind that gets forgotten.',
  rules: 'Rules learned from how you work do nothing until you approve them.',
  areas: 'Suggested focus areas hold work that is not on a kept branch yet.',
  unreviewed: 'Work no review has read earns nothing and shows no progress.',
}

export type TuneUpTarget = { kind: 'request'; requestId: string } | { kind: 'page'; page: 'rules' | 'suggested' | 'work' } | { kind: 'branch'; branchId: string }

export interface TuneUpStep {
  id: string
  kind: TuneUpKind
  /** The request's title, or what is waiting, in plain words. */
  subject: string
  /** Growth this step earns when done, where the model says so; null where it only unblocks work. */
  gain: number | null
  target: TuneUpTarget
}

const titleOf = (request: Request) => request.title ?? request.resolvesTo?.title ?? 'A new request'
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** At most this many request steps of one kind, so one busy state does not bury the rest of the session. */
export const TUNE_UP_PER_KIND = 5

export function tuneUp(requests: readonly Request[], rules: readonly OwnerRule[], focusAreas: readonly FocusArea[], nextStepMissingText: string, dueReminders: readonly TrailNote[] = []): TuneUpStep[] {
  const open = requests.filter((request) => !request.closed)
  const forRequests = (kind: TuneUpKind, list: Request[], gain: number | null): TuneUpStep[] =>
    list.slice(0, TUNE_UP_PER_KIND).map((request) => ({ id: `${kind}:${request.id}`, kind, subject: titleOf(request), gain, target: { kind: 'request', requestId: request.id } }))
  const waiting = open.filter((request) => request.state === 'your-move')
  const toCheck = open.filter((request) => request.state === 'needs-check')
  const busy = new Set([...waiting, ...toCheck].map((request) => request.id))
  // A request already listed above is not listed again for its missing next step.
  const adrift = open.filter((request) => !busy.has(request.id) && request.state !== 'shipped' && (!request.next.text.trim() || request.next.text === nextStepMissingText))
  const undecidedRules = rules.filter((rule) => rule.status === 'suggested').length
  const undecidedAreas = focusAreas.filter((area) => area.status === 'suggested').length
  const unreviewed = open.filter((request) => request.state !== 'shipped' && request.progress.percent === null).length
  return [
    ...dueReminders.slice(0, TUNE_UP_PER_KIND).map((note) => ({ id: `reminder:${note.id}`, kind: 'reminder' as const, subject: note.text, gain: null, target: { kind: 'branch' as const, branchId: note.branchId } })),
    ...forRequests('answer', waiting, null),
    ...forRequests('check', toCheck, toCheck.length ? GROWTH_POINTS.checked : null),
    ...forRequests('next-step', adrift, null),
    ...(undecidedRules > 0 ? [{ id: 'rules', kind: 'rules' as const, subject: plural(undecidedRules, 'learned rule is waiting for your decision', 'learned rules are waiting for your decision'), gain: null, target: { kind: 'page' as const, page: 'rules' as const } }] : []),
    ...(undecidedAreas > 0 ? [{ id: 'areas', kind: 'areas' as const, subject: plural(undecidedAreas, 'suggested focus area is waiting for your decision', 'suggested focus areas are waiting for your decision'), gain: null, target: { kind: 'page' as const, page: 'suggested' as const } }] : []),
    ...(unreviewed > 0 ? [{ id: 'unreviewed', kind: 'unreviewed' as const, subject: plural(unreviewed, 'open request has not been reviewed', 'open requests have not been reviewed'), gain: null, target: { kind: 'page' as const, page: 'work' as const } }] : []),
  ]
}
