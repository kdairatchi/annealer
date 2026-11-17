// The companion's pixels. An original 12×12 forge sprite: a round body, two eyes, a flame tuft and two feet.
// Each row is 12 characters: `.` empty, `d` outline, `b` body, `e` eye, `f` flame, `h` flame highlight, `a` alert mark.
// Frames are composed from a few rows, so a new pose is a few lines and every frame is the same size by construction.
import type { CompanionMood } from './companion-mood.ts'

export const SPRITE_SIZE = 12
export type SpritePixel = 'd' | 'b' | 'e' | 'f' | 'h' | 'a'
export type SpriteFrame = readonly string[]

const TUFT = ['.....ff.....', '....fhff....', '....ffff....']
const TUFT_TALL = ['....fhff....', '...ffhhff...', '....ffff....']
const TUFT_ALERT = ['.....ff...a.', '....fhff..a.', '....ffff....']
const TUFT_LOW = ['............', '.....ff.....', '....fhff....']
const HEAD = ['...dddddd...', '..dbbbbbbd..', '.dbbbbbbbbd.']
const HEAD_ALERT = ['...dddddd.a.', '..dbbbbbbd..', '.dbbbbbbbbd.']
const HEAD_ARMS_UP = ['...dddddd...', 'd.dbbbbbbd.d', 'ddbbbbbbbbdd']
const EYES = { open: '.dbbebbebbd.', closed: '.dbddbbddbd.', wide: '.dbeebbeebd.' }
const BELLY = ['.dbbbbbbbbd.', '..dbbbbbbd..', '...dddddd...']
const FEET = {
  stand: ['...d....d...', '..dd....dd..'],
  left: ['..d.....d...', '.dd.....dd..'],
  right: ['...d.....d..', '...dd....dd.'],
  tucked: ['............', '..dd....dd..'],
}

const frame = (tuft: string[], head: string[], eyes: string, feet: string[]): SpriteFrame => [...tuft, ...head, eyes, ...BELLY, ...feet]

/** The frames each mood cycles through. A mood without a sprite fails the typecheck. */
export const COMPANION_FRAMES: Record<CompanionMood, readonly SpriteFrame[]> = {
  'needs-you': [frame(TUFT_ALERT, HEAD_ALERT, EYES.wide, FEET.stand), frame(TUFT, HEAD, EYES.wide, FEET.stand)],
  celebrating: [frame(TUFT_TALL, HEAD_ARMS_UP, EYES.open, FEET.tucked), frame(TUFT, HEAD, EYES.open, FEET.stand)],
  working: [frame(TUFT, HEAD, EYES.open, FEET.left), frame(TUFT, HEAD, EYES.open, FEET.stand), frame(TUFT, HEAD, EYES.open, FEET.right), frame(TUFT, HEAD, EYES.open, FEET.stand)],
  resting: [frame(TUFT_LOW, HEAD, EYES.closed, FEET.tucked), frame(TUFT_LOW, HEAD, EYES.closed, FEET.tucked), frame(TUFT, HEAD, EYES.closed, FEET.tucked)],
}

/** Milliseconds each frame holds. Walking is quick, sleeping is slow. */
export const COMPANION_FRAME_MS: Record<CompanionMood, number> = { 'needs-you': 360, celebrating: 240, working: 180, resting: 900 }

/** The one definition of the palettes a person can pick; the picker and the saved preference both read it. */
export const COMPANION_PALETTES = ['ember', 'moss', 'tide', 'ash'] as const
export type CompanionPalette = (typeof COMPANION_PALETTES)[number]

export const COMPANION_PALETTE_LABEL: Record<CompanionPalette, string> = { ember: 'Ember', moss: 'Moss', tide: 'Tide', ash: 'Ash' }

/** Sprite art colours. These are the drawing itself, so they are fixed per palette and do not follow the page theme. */
export const COMPANION_COLORS: Record<CompanionPalette, Record<SpritePixel, string>> = {
  ember: { d: '#3a1508', b: '#e8622a', e: '#fff3e0', f: '#ffb238', h: '#fff0b8', a: '#ffd23f' },
  moss: { d: '#12301c', b: '#4f9d5d', e: '#f1ffe9', f: '#b6e36a', h: '#eeffc2', a: '#ffd23f' },
  tide: { d: '#0c2740', b: '#3d8fd1', e: '#eaf6ff', f: '#7fe0e6', h: '#dcfbff', a: '#ffd23f' },
  ash: { d: '#1d1b1a', b: '#8d8580', e: '#ffffff', f: '#d8d2cc', h: '#ffffff', a: '#ffd23f' },
}

/** Longest name the companion can be given. */
export const COMPANION_NAME_MAX = 16
export const COMPANION_DEFAULT_NAME = 'Cinder'

/** A saved name, trimmed to something safe to show; anything unusable falls back to the default. */
export function companionName(value: unknown): string {
  if (typeof value !== 'string') return COMPANION_DEFAULT_NAME
  const name = value.replace(/\s+/g, ' ').trim().slice(0, COMPANION_NAME_MAX).trimEnd()
  return name || COMPANION_DEFAULT_NAME
}
