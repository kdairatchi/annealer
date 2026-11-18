// The Grove's numbers: how far each focus area has grown, worked out from recorded work and nothing else.
// A branch is a focus area, a twig is a request, a leaf is a piece of work product. Growth is earned by evidence
// the worker already saved (a shipped request, a reviewed percent, a file or PR, a check by a person); time spent,
// prompts sent and tool calls earn nothing. Pure, so `node --test` can load it.
import { needsYou, OTHER_FOCUS_AREA_ID, type FocusArea, type LiveState, type Request } from '../data.ts'
import { focusOverview } from '../live/focus-overview.ts'

/** What each kind of recorded evidence is worth. One table, so the Grove can show the same numbers it adds up. */
export const GROWTH_POINTS = {
  /** A request recorded as shipped. */
  shipped: 40,
  /** An open request at 100% reviewed progress; a lower percent earns its share. Unreviewed work earns nothing. */
  reviewedProgress: 30,
  /** One piece of work product (PR, commit, file, page…). */
  leaf: 4,
  /** Leaves counted per request, so one request that lists fifty files does not outgrow five that shipped. */
  leavesCounted: 5,
  /** A person marked this version checked. */
  checked: 6,
} as const

/** Growth a level costs more of as it goes: level 2 at 50, 3 at 150, 4 at 300, 5 at 500… */
const LEVEL_STEP = 50

export interface GrowthSource { label: 'Shipped' | 'Reviewed progress' | 'Work product' | 'Checked by you'; points: number; count: number }

export interface GrowthTwig {
  requestId: string
  title: string | null
  state: LiveState
  /** Reviewed percent; null when nothing reviewed it. */
  percent: number | null
  leaves: number
  points: number
  /** A person marked this version checked. */
  checked: boolean
  /** The recorded next step is missing, so nobody knows what happens next. */
  missingNextStep: boolean
}

export interface GrowthBranch {
  /** A focus area id, or OTHER_FOCUS_AREA_ID. */
  id: string
  name: string
  goal: string | null
  suggested: boolean
  twigs: GrowthTwig[]
  points: number
  level: number
  /** How far into the current level, 0 to 1. */
  intoLevel: number
  /** Points still needed for the next level. */
  toNextLevel: number
  sources: GrowthSource[]
  needsYou: number
  working: number
  shipped: number
  /** Asks the owner made here that no request has picked up. */
  asksNotStarted: number
}

export interface Grove {
  branches: GrowthBranch[]
  points: number
  level: number
  intoLevel: number
  toNextLevel: number
  /** Requests with no recorded placement yet. They are not on the tree and earn nothing until sorted. */
  sorting: number
}

/** Points at which `level` starts. Level 1 starts at 0. */
export const levelFloor = (level: number) => (LEVEL_STEP * level * (level - 1)) / 2

export function levelFor(points: number): { level: number; intoLevel: number; toNextLevel: number } {
  let level = 1
  while (levelFloor(level + 1) <= points) level += 1
  const floor = levelFloor(level)
  const span = levelFloor(level + 1) - floor
  return { level, intoLevel: (points - floor) / span, toNextLevel: floor + span - points }
}

function twigOf(request: Request, nextStepMissingText: string): { twig: GrowthTwig; sources: Record<GrowthSource['label'], number> } {
  const shipped = request.state === 'shipped'
  const percent = request.progress.percent
  const leaves = request.detailCounts?.workProduct ?? request.workProduct.length
  const sources = {
    'Shipped': shipped ? GROWTH_POINTS.shipped : 0,
    // A shipped request already earned its full worth; its percent is not paid twice.
    'Reviewed progress': !shipped && percent !== null ? Math.round((Math.min(100, Math.max(0, percent)) / 100) * GROWTH_POINTS.reviewedProgress) : 0,
    'Work product': Math.min(leaves, GROWTH_POINTS.leavesCounted) * GROWTH_POINTS.leaf,
    'Checked by you': request.checkedAt ? GROWTH_POINTS.checked : 0,
  }
  const points = Object.values(sources).reduce((sum, value) => sum + value, 0)
  return {
    twig: {
      requestId: request.id, title: request.title, state: request.state, percent, leaves, points, checked: Boolean(request.checkedAt),
      missingNextStep: !shipped && (!request.next.text.trim() || request.next.text === nextStepMissingText),
    },
    sources,
  }
}

const SOURCE_ORDER: GrowthSource['label'][] = ['Shipped', 'Reviewed progress', 'Work product', 'Checked by you']

function branchOf(id: string, name: string, goal: string | null, suggested: boolean, requests: readonly Request[], asksNotStarted: number, nextStepMissingText: string): GrowthBranch {
  const open = requests.filter((request) => !request.closed)
  const totals = new Map<GrowthSource['label'], { points: number; count: number }>()
  const twigs = open.map((request) => {
    const { twig, sources } = twigOf(request, nextStepMissingText)
    for (const label of SOURCE_ORDER) {
      if (sources[label] === 0) continue
      const total = totals.get(label) ?? { points: 0, count: 0 }
      totals.set(label, { points: total.points + sources[label], count: total.count + 1 })
    }
    return twig
  })
  const points = twigs.reduce((sum, twig) => sum + twig.points, 0)
  return {
    id, name, goal, suggested, twigs, points, ...levelFor(points),
    sources: SOURCE_ORDER.flatMap((label) => totals.has(label) ? [{ label, ...totals.get(label)! }] : []),
    needsYou: open.filter(needsYou).length,
    working: open.filter((request) => request.state === 'working').length,
    shipped: open.filter((request) => request.state === 'shipped').length,
    asksNotStarted,
  }
}

/**
 * The tree for one work model: kept areas in the owner's order, then suggested areas that already hold work, then
 * Other when it holds any. `nextStepMissingText` is the mapper's wording for a next step nobody recorded.
 */
export function toGrove(focusAreas: readonly FocusArea[], requests: readonly Request[], otherAsks: number, nextStepMissingText: string, otherName = 'Other'): Grove {
  const overview = focusOverview(focusAreas, requests)
  const branches = [
    ...overview.areas.map((row) => branchOf(row.area.id, row.area.name, row.area.goal ?? row.area.about ?? null, false, row.requests, row.area.asks.length, nextStepMissingText)),
    ...overview.suggested.filter((row) => row.requests.some((request) => !request.closed))
      .map((row) => branchOf(row.area.id, row.area.name, row.area.goal ?? row.area.about ?? null, true, row.requests, row.area.asks.length, nextStepMissingText)),
    ...(overview.other.some((request) => !request.closed) ? [branchOf(OTHER_FOCUS_AREA_ID, otherName, null, false, overview.other, otherAsks, nextStepMissingText)] : []),
  ]
  const points = branches.reduce((sum, branch) => sum + branch.points, 0)
  return { branches, points, ...levelFor(points), sorting: overview.sorting.filter((request) => !request.closed).length }
}
