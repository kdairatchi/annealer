// The companions' state as the page holds it: one copy, shared by the corner companion and the Grove's panel, loaded
// from the worker when the page is reading the local worker. Sample data shows the fixture and the hosted page shows
// nothing, because jobs and leads live on the machine that runs the worker.
import { useEffect, useSyncExternalStore } from 'react'
import { useStore } from '@/store'
import { EMPTY_COMPANIONS, SAMPLE_COMPANIONS, toCompanionState } from '@/growth/companions'
import type { CompanionState } from '../../../../shared/annealer/companions.ts'

export type CompanionSource = 'sample' | 'local' | 'cloud'
/** How far the page has got with reading the companions from the worker. */
export const COMPANION_LOADS = ['idle', 'loading', 'ready', 'failed'] as const
export type CompanionLoad = (typeof COMPANION_LOADS)[number]
/** What the panel says about each, or null when there is nothing to say. A new state fails the typecheck until it is here. */
export const COMPANION_LOAD_NOTE: Record<CompanionLoad, string | null> = {
  idle: null, loading: 'Loading companions…', ready: null,
  failed: 'Companions could not be loaded. They come from the local worker; check it is running and is this fork’s build.',
}
export interface CompanionsLive { load: CompanionLoad; state: CompanionState }

let live: CompanionsLive = { load: 'idle', state: EMPTY_COMPANIONS }
const listeners = new Set<() => void>()
const set = (next: CompanionsLive) => { live = next; listeners.forEach((listener) => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** Replaces part of the state with what a write returned, so a decision shows without asking for everything again. */
export const patchCompanions = (change: Partial<CompanionState>) => set({ load: 'ready', state: { ...live.state, ...change } })

/** What a request to the worker came to: the parsed answer, or the sentence the worker gave for refusing. */
export type Answer = { ok: true; body: Record<string, unknown> } | { ok: false; message: string }

export async function askWorker(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<Answer> {
  try {
    const response = await fetch(path, { method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const answer: unknown = await response.json().catch(() => null)
    const fields = (answer !== null && typeof answer === 'object' ? answer : {}) as Record<string, unknown>
    if (response.ok) return { ok: true, body: fields }
    return { ok: false, message: typeof fields.message === 'string' ? fields.message.slice(0, 300) : response.status === 404 ? 'The worker does not know that. It may be an older build.' : `The worker answered ${response.status}.` }
  } catch {
    return { ok: false, message: 'The worker did not answer.' }
  }
}

/** Loads the state. With `sync`, the worker first reads new runs from CronLord; that is the only thing that does. */
export async function loadCompanions(sync = false): Promise<Answer> {
  set({ ...live, load: live.load === 'ready' ? 'ready' : 'loading' })
  const answer = sync ? await askWorker('/api/annealer/companions/sync', 'POST') : await askWorker('/api/annealer/companions', 'GET')
  if (answer.ok) set({ load: 'ready', state: toCompanionState(sync ? answer.body.state : answer.body) })
  else if (live.load !== 'ready') set({ ...live, load: 'failed' })
  return answer
}

/** Where this page's data comes from, or null until the page knows. Nothing asks the worker before it does. */
export function useCompanionSource(): CompanionSource | null {
  const sourceKind = useStore((state) => state.work.sourceKind)
  if (new URLSearchParams(window.location.search).get('source') === 'sample') return 'sample'
  if (sourceKind === null) return null
  return sourceKind === 'cloud' ? 'cloud' : 'local'
}

const SAMPLE_LIVE: CompanionsLive = { load: 'ready', state: SAMPLE_COMPANIONS }
const CLOUD_LIVE: CompanionsLive = { load: 'ready', state: EMPTY_COMPANIONS }

/** The shared state. The first caller on the local worker starts the one load; it is not polled. */
export function useCompanions(source: CompanionSource | null): CompanionsLive {
  const current = useSyncExternalStore(subscribe, () => live)
  useEffect(() => { if (source === 'local' && live.load === 'idle') void loadCompanions() }, [source])
  return source === 'sample' ? SAMPLE_LIVE : source === 'cloud' ? CLOUD_LIVE : current
}
