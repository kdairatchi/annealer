// Where the trail lives for this page. On the local worker it is the worker's, so it is the same in every browser;
// the fixtures and the hosted page keep it in the browser, as before.
import { useEffect, useState } from 'react'
import { askWorker, type CompanionSource } from '@/companion/use-companions'
import { addNote, readTrail, removeNote, toggleNote, trailFromWorker, type TrailNote } from '@/growth/trail'

const TRAIL_KEY = 'annealer:grove:trail'
/** Where a browser's notes go once the worker has them. They are set aside, not deleted. */
const TRAIL_MOVED_KEY = 'annealer:grove:trail:moved'
/** An id for a new note. `crypto.randomUUID` only exists on https and localhost, and the worker can be opened by LAN address. */
const newNoteId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const stored = (key: string): TrailNote[] => { try { return readTrail(localStorage.getItem(key)) } catch { return [] } }

export interface TrailHandle {
  notes: TrailNote[]
  /** Why the last change did not happen, in the worker's words. */
  error: string | null
  /** Notes this browser kept before the worker held the trail, waiting to be moved. */
  inBrowser: number
  add: (note: { branchId: string; text: string; link?: string; remindOn?: string }) => void
  toggle: (id: string) => void
  remove: (id: string) => void
  moveFromBrowser: () => void
}

/**
 * The trail, wherever it lives for this page. Sample data gets its own browser key, so trying the fixtures never
 * touches real notes.
 */
export function useTrail(source: CompanionSource | null): TrailHandle {
  const local = source === 'local'
  const key = source === 'sample' ? `${TRAIL_KEY}:sample` : TRAIL_KEY
  // What is held depends on where the page reads from, and the page learns that a moment after it opens.
  const start = () => ({ source, notes: source === 'sample' || source === 'cloud' ? stored(key) : [], inBrowser: local ? stored(TRAIL_KEY).length : 0 })
  const [held, setHeld] = useState(start)
  if (held.source !== source) setHeld(start())
  const { notes, inBrowser } = held
  const setNotes = (next: TrailNote[]) => setHeld((current) => ({ ...current, notes: next }))
  const setInBrowser = (count: number) => setHeld((current) => ({ ...current, inBrowser: count }))
  const [error, setError] = useState<string | null>(null)
  const take = (answer: Awaited<ReturnType<typeof askWorker>>) => {
    if (!answer.ok) { setError(answer.message); return false }
    setError(null)
    setNotes(trailFromWorker(answer.body.notes))
    return true
  }
  useEffect(() => {
    if (!local) return
    let stopped = false
    void askWorker('/api/annealer/trail', 'GET').then((answer) => { if (!stopped) take(answer) })
    return () => { stopped = true }
    // `take` only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local])
  const save = (next: TrailNote[]) => { setNotes(next); try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Storage is blocked: the trail lasts for this visit. */ } }
  return {
    notes, error, inBrowser,
    add: (note) => {
      const full = { ...note, id: newNoteId(), createdAt: new Date().toISOString() }
      if (local) void askWorker('/api/annealer/trail', 'POST', { notes: [full] }).then(take)
      else save(addNote(notes, full))
    },
    toggle: (id) => {
      if (local) void askWorker(`/api/annealer/trail/${encodeURIComponent(id)}`, 'POST', { done: !notes.find((note) => note.id === id)?.done }).then(take)
      else save(toggleNote(notes, id))
    },
    remove: (id) => {
      if (local) void askWorker(`/api/annealer/trail/${encodeURIComponent(id)}`, 'DELETE').then(take)
      else save(removeNote(notes, id))
    },
    moveFromBrowser: () => {
      const waiting = stored(TRAIL_KEY)
      if (!local || waiting.length === 0) return
      void askWorker('/api/annealer/trail', 'POST', { notes: waiting }).then((answer) => {
        if (!take(answer)) return
        try { localStorage.setItem(TRAIL_MOVED_KEY, JSON.stringify(waiting)); localStorage.removeItem(TRAIL_KEY) } catch { /* The worker has them either way. */ }
        setInBrowser(0)
      })
    },
  }
}
