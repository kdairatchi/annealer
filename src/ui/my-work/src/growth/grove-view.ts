// How the Grove is drawn. One definition: the switch, the saved preference and its check all read this list.
export const GROVE_VIEWS = ['3d', 'flat'] as const
export type GroveView = (typeof GROVE_VIEWS)[number]

/** The switch's words. A new way to draw the Grove fails the typecheck until it has a name here. */
export const GROVE_VIEW_LABEL: Record<GroveView, string> = { '3d': '3D', flat: 'Flat' }

export const isGroveView = (value: unknown): value is GroveView => GROVE_VIEWS.includes(value as GroveView)
