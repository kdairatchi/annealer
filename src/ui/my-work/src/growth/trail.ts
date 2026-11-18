// The trail: notes, links and reminders you leave on a branch, so the thing you meant to come back to is still there.
// You write every entry; nothing here is generated. They are kept in this browser until the worker can hold them, and
// a reminder can only show up while this page is open. Pure, so `node --test` can load it.

export interface TrailNote {
  id: string
  /** The focus area it was left on. */
  branchId: string
  text: string
  /** An http or https link, or null. */
  link: string | null
  /** The day to bring it back up, as YYYY-MM-DD, or null. */
  remindOn: string | null
  done: boolean
  createdAt: string
}

export const TRAIL_TEXT_MAX = 280
/** Notes kept across all branches. The oldest finished ones go first when it is full. */
export const TRAIL_KEPT = 300
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A link only if it is plain http or https. Anything else (javascript:, data:, a bare word) is not kept as a link. */
export function trailLink(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function clean(value: unknown): TrailNote | null {
  const note = value as Partial<TrailNote> | null
  if (!note || typeof note !== 'object') return null
  const text = typeof note.text === 'string' ? note.text.replace(/\s+/g, ' ').trim().slice(0, TRAIL_TEXT_MAX) : ''
  if (!text || typeof note.id !== 'string' || !note.id || typeof note.branchId !== 'string' || !note.branchId) return null
  return {
    id: note.id, branchId: note.branchId, text, link: trailLink(note.link),
    remindOn: typeof note.remindOn === 'string' && DAY.test(note.remindOn) ? note.remindOn : null,
    done: note.done === true, createdAt: typeof note.createdAt === 'string' ? note.createdAt : '',
  }
}

/** Saved notes read back safely: anything unreadable is dropped. */
export function readTrail(saved: string | null): TrailNote[] {
  try {
    const list: unknown = JSON.parse(saved ?? '[]')
    return Array.isArray(list) ? list.map(clean).filter((note): note is TrailNote => note !== null).slice(-TRAIL_KEPT) : []
  } catch {
    return []
  }
}

/** The list with a new note on the end, or unchanged when the note has no text. */
export function addNote(list: readonly TrailNote[], note: { id: string; branchId: string; text: string; link?: string; remindOn?: string; createdAt: string }): TrailNote[] {
  const added = clean({ ...note, done: false })
  if (!added) return [...list]
  const next = [...list, added]
  if (next.length <= TRAIL_KEPT) return next
  const oldestDone = next.findIndex((entry) => entry.done)
  return next.filter((_, index) => index !== (oldestDone === -1 ? 0 : oldestDone))
}

export const removeNote = (list: readonly TrailNote[], id: string) => list.filter((note) => note.id !== id)
export const toggleNote = (list: readonly TrailNote[], id: string) => list.map((note) => note.id === id ? { ...note, done: !note.done } : note)

/** Unfinished reminders whose day has come, earliest first. */
export const dueNotes = (list: readonly TrailNote[], today: string) =>
  list.filter((note) => !note.done && note.remindOn !== null && note.remindOn <= today).sort((a, b) => a.remindOn!.localeCompare(b.remindOn!))

/** One branch's notes: unfinished first, then newest first. */
export const branchTrail = (list: readonly TrailNote[], branchId: string) =>
  list.filter((note) => note.branchId === branchId).sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt))
