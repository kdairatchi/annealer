// How the Grove is drawn. One definition: the switch, the saved preference and its check all read this list.
export const GROVE_VIEWS = ['3d', 'flat'] as const
export type GroveView = (typeof GROVE_VIEWS)[number]

/** The switch's words. A new way to draw the Grove fails the typecheck until it has a name here. */
export const GROVE_VIEW_LABEL: Record<GroveView, string> = { '3d': '3D', flat: 'Flat' }

export const isGroveView = (value: unknown): value is GroveView => GROVE_VIEWS.includes(value as GroveView)

/** What the panel under the tree shows. One definition: the switch and the page both read this list. */
export const GROVE_PANELS = ['branch', 'tune-up', 'benchmarks', 'context'] as const
export type GrovePanel = (typeof GROVE_PANELS)[number]

/** The panel switch's words. A new panel fails the typecheck until it has a name here. */
export const GROVE_PANEL_LABEL: Record<GrovePanel, string> = { branch: 'Branch', 'tune-up': 'Tune-up', benchmarks: 'Benchmarks', context: 'Context' }

/** How much the Grove moves on its own. Calm keeps the tree still and the air clear; dragging still works. */
export const GROVE_MOTIONS = ['full', 'calm'] as const
export type GroveMotion = (typeof GROVE_MOTIONS)[number]
export const GROVE_MOTION_LABEL: Record<GroveMotion, string> = { full: 'Full', calm: 'Calm' }
export const isGroveMotion = (value: unknown): value is GroveMotion => GROVE_MOTIONS.includes(value as GroveMotion)

/** The accent colours a person can pick. Ember is the shipped brand colour and changes nothing. */
export const ACCENTS = ['ember', 'blood', 'violet', 'moss', 'tide'] as const
export type Accent = (typeof ACCENTS)[number]
export const ACCENT_LABEL: Record<Accent, string> = { ember: 'Ember', blood: 'Blood', violet: 'Violet', moss: 'Moss', tide: 'Tide' }
export const isAccent = (value: unknown): value is Accent => ACCENTS.includes(value as Accent)

/**
 * Each accent's three tones, written over the theme's `--primary` tokens. Every `--primary` here keeps the contrast the
 * shipped orange has: at least 4.5:1 under near-black text, and no paler than the orange on a light card.
 * `null` leaves the stylesheet's own colours alone.
 */
export const ACCENT_TONES: Record<Accent, { primary: string; bright: string; deep: string } | null> = {
  ember: null,
  blood: { primary: '#f4503f', bright: '#ff6b5c', deep: '#e2412f' },
  violet: { primary: '#9a86ff', bright: '#ad9cff', deep: '#8a72ff' },
  moss: { primary: '#2faf5c', bright: '#44c873', deep: '#259a4e' },
  tide: { primary: '#2a9be6', bright: '#49aef2', deep: '#1f88d0' },
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}
