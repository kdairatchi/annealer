// How the Grove is drawn. One definition: the switch, the saved preference and its check all read this list.
export const GROVE_VIEWS = ['3d', 'flat'] as const
export type GroveView = (typeof GROVE_VIEWS)[number]

/** The switch's words. A new way to draw the Grove fails the typecheck until it has a name here. */
export const GROVE_VIEW_LABEL: Record<GroveView, string> = { '3d': '3D', flat: 'Flat' }

export const isGroveView = (value: unknown): value is GroveView => GROVE_VIEWS.includes(value as GroveView)

/** What the panel under the tree shows. One definition: the switch and the page both read this list. */
export const GROVE_PANELS = ['branch', 'tune-up', 'benchmarks'] as const
export type GrovePanel = (typeof GROVE_PANELS)[number]

/** The panel switch's words. A new panel fails the typecheck until it has a name here. */
export const GROVE_PANEL_LABEL: Record<GrovePanel, string> = { branch: 'Branch', 'tune-up': 'Tune-up', benchmarks: 'Benchmarks' }
