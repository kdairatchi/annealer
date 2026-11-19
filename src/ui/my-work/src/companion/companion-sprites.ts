// The companion's pixels. Original 12×12 creatures: a round body, two eyes, something on its head and two feet.
// Each row is 12 characters: `.` empty, `d` outline, `b` body, `e` eye, `f` flame, `h` flame highlight, `a` alert mark.
// Frames are composed from a few rows, so a new pose is a few lines and every frame is the same size by construction.
import type { CompanionMood } from './companion-mood.ts'
import { COMPANION_SPECIES, SPECIES_NAME, type CompanionSpecies } from '../../../../shared/annealer/companions.ts'

export const SPRITE_SIZE = 12
export type SpritePixel = 'd' | 'b' | 'e' | 'f' | 'h' | 'a'
export type SpriteFrame = readonly string[]

/** The rows a creature is built from. Every creature shares the belly and feet, so they all walk the same way. */
interface CreatureParts {
  tuft: string[]; tuftTall: string[]; tuftAlert: string[]; tuftLow: string[]
  head: string[]; headAlert: string[]; headArmsUp: string[]
  eyes: { open: string; closed: string; wide: string }
}

const BELLY = ['.dbbbbbbbbd.', '..dbbbbbbd..', '...dddddd...']
const FEET = {
  stand: ['...d....d...', '..dd....dd..'],
  left: ['..d.....d...', '.dd.....dd..'],
  right: ['...d.....d..', '...dd....dd.'],
  tucked: ['............', '..dd....dd..'],
}
const ROUND_HEAD = {
  head: ['...dddddd...', '..dbbbbbbd..', '.dbbbbbbbbd.'],
  headAlert: ['...dddddd.a.', '..dbbbbbbd..', '.dbbbbbbbbd.'],
  headArmsUp: ['...dddddd...', 'd.dbbbbbbd.d', 'ddbbbbbbbbdd'],
}

// The creatures themselves are defined once, where the worker can read the list too.
export { COMPANION_SPECIES, type CompanionSpecies }

export const COMPANION_SPECIES_LABEL: Record<CompanionSpecies, string> = SPECIES_NAME

/** What each creature is for. Cinder and Sprout read recorded work; Bolt and Moth are given jobs. */
export const COMPANION_SPECIES_ROLE: Record<CompanionSpecies, string> = {
  cinder: 'Smith. Turns what you kept into hypotheses to test.',
  sprout: 'Seedling. Keeps what is waiting from being forgotten.',
  moth: 'Scout. Finds new hosts under a domain.',
  bolt: 'Watcher. Checks an address and reports when it changes.',
  weevil: 'Code reader. Lists the paths inside a script and reports new ones.',
  rime: 'Skeptic. Tries to break a lead before a triager does.',
  quill: 'Writer. Drafts a report from a confirmed lead.',
}

/** The Grove level at which each creature can be picked. Earned by recorded work; there is no other way to get one. */
export const COMPANION_UNLOCK_LEVEL: Record<CompanionSpecies, number> = { cinder: 1, sprout: 2, moth: 3, bolt: 4, weevil: 5, rime: 6, quill: 7 }

export const speciesUnlocked = (species: CompanionSpecies, groveLevel: number) => groveLevel >= COMPANION_UNLOCK_LEVEL[species]

const PARTS: Record<CompanionSpecies, CreatureParts> = {
  // A forge spirit with a flame on its head.
  cinder: {
    tuft: ['.....ff.....', '....fhff....', '....ffff....'], tuftTall: ['....fhff....', '...ffhhff...', '....ffff....'],
    tuftAlert: ['.....ff...a.', '....fhff..a.', '....ffff....'], tuftLow: ['............', '.....ff.....', '....fhff....'],
    ...ROUND_HEAD, eyes: { open: '.dbbebbebbd.', closed: '.dbddbbddbd.', wide: '.dbeebbeebd.' },
  },
  // A seedling with two leaves.
  sprout: {
    tuft: ['...ff..ff...', '....ffff....', '.....ff.....'], tuftTall: ['..fhf..fhf..', '...ffffff...', '.....ff.....'],
    tuftAlert: ['...ff..ff.a.', '....ffff..a.', '.....ff.....'], tuftLow: ['............', '...ff..ff...', '....ffff....'],
    ...ROUND_HEAD, eyes: { open: '.dbbebbebbd.', closed: '.dbddbbddbd.', wide: '.dbeebbeebd.' },
  },
  // A small machine with an antenna and a visor.
  bolt: {
    tuft: ['.....h......', '.....f......', '.....f......'], tuftTall: ['....hhh.....', '.....f......', '.....f......'],
    tuftAlert: ['.....h....a.', '.....f....a.', '.....f......'], tuftLow: ['............', '.....h......', '.....f......'],
    head: ['..dddddddd..', '..dbbbbbbd..', '.ddbbbbbbdd.'], headAlert: ['..dddddddd.a', '..dbbbbbbd..', '.ddbbbbbbdd.'],
    headArmsUp: ['..dddddddd..', 'd.dbbbbbbd.d', 'dddbbbbbbddd'],
    eyes: { open: '.dbbeeeebbd.', closed: '.dbbddddbbd.', wide: '.dbeeeeeebd.' },
  },
  // A moth: two antennae, wide-set eyes and a wing at each side that lifts when it cheers.
  moth: {
    tuft: ['..f......f..', '...f....f...', '....f..f....'], tuftTall: ['.hf......fh.', '...f....f...', '....f..f....'],
    tuftAlert: ['..f......fa.', '...f....f.a.', '....f..f....'], tuftLow: ['............', '..f......f..', '...ff..ff...'],
    head: ['...dddddd...', 'f.dbbbbbbd.f', 'fdbbbbbbbbdf'], headAlert: ['...dddddd.a.', 'f.dbbbbbbd.f', 'fdbbbbbbbbdf'],
    headArmsUp: ['f..dddddd..f', 'ffdbbbbbbdff', 'fdbbbbbbbbdf'],
    eyes: { open: '.dbebbbbebd.', closed: '.dbdbbbbdbd.', wide: '.dbeebbeebd.' },
  },
  // A weevil: a long snout curling down one side, and a narrow head.
  weevil: {
    tuft: ['........ff..', '.........ff.', '..........f.'], tuftTall: ['.......hff..', '.........ff.', '..........f.'],
    tuftAlert: ['.a......ff..', '.a.......ff.', '..........f.'], tuftLow: ['............', '........ff..', '.........ff.'],
    head: ['....dddd..f.', '...dbbbbdff.', '.dbbbbbbbbd.'], headAlert: ['....dddd..f.', '...dbbbbdff.', '.dbbbbbbbbd.'],
    headArmsUp: ['....dddd..f.', 'd..dbbbbdffd', 'ddbbbbbbbbdd'],
    eyes: { open: '.dbbebbebbd.', closed: '.dbddbbddbd.', wide: '.dbeebbeebd.' },
  },
  // A shard of ice: a pointed crown and one slit of an eye.
  rime: {
    tuft: ['.....hh.....', '....hffh....', '...hffffh...'], tuftTall: ['.....hh.....', '....hhhh....', '...hffffh...'],
    tuftAlert: ['.....hh...a.', '....hffh..a.', '...hffffh...'], tuftLow: ['............', '.....hh.....', '....hffh....'],
    head: ['...dffffd...', '..dbbbbbbd..', '.dbbbbbbbbd.'], headAlert: ['...dffffd.a.', '..dbbbbbbd..', '.dbbbbbbbbd.'],
    headArmsUp: ['...dffffd...', 'd.dbbbbbbd.d', 'ddbbbbbbbbdd'],
    eyes: { open: '.dbbeeeebbd.', closed: '.dbbbddbbbd.', wide: '.dbeeeeeebd.' },
  },
  // A small porcupine: a row of quills standing up along its back.
  quill: {
    tuft: ['..f.f.f.f...', '..f.f.f.f.f.', '.ffffffffff.'], tuftTall: ['..h.h.h.h...', '..f.f.f.f.h.', '.ffffffffff.'],
    tuftAlert: ['..f.f.f.f.a.', '..f.f.f.f.a.', '.ffffffffff.'], tuftLow: ['............', '..f.f.f.f...', '.ffffffffff.'],
    ...ROUND_HEAD, eyes: { open: '.dbbebbebbd.', closed: '.dbddbbddbd.', wide: '.dbeebbeebd.' },
  },
}

const frame = (tuft: string[], head: string[], eyes: string, feet: string[]): SpriteFrame => [...tuft, ...head, eyes, ...BELLY, ...feet]

function framesOf(parts: CreatureParts): Record<CompanionMood, readonly SpriteFrame[]> {
  const { eyes } = parts
  return {
    'needs-you': [frame(parts.tuftAlert, parts.headAlert, eyes.wide, FEET.stand), frame(parts.tuft, parts.head, eyes.wide, FEET.stand)],
    celebrating: [frame(parts.tuftTall, parts.headArmsUp, eyes.open, FEET.tucked), frame(parts.tuft, parts.head, eyes.open, FEET.stand)],
    working: [frame(parts.tuft, parts.head, eyes.open, FEET.left), frame(parts.tuft, parts.head, eyes.open, FEET.stand), frame(parts.tuft, parts.head, eyes.open, FEET.right), frame(parts.tuft, parts.head, eyes.open, FEET.stand)],
    resting: [frame(parts.tuftLow, parts.head, eyes.closed, FEET.tucked), frame(parts.tuftLow, parts.head, eyes.closed, FEET.tucked), frame(parts.tuft, parts.head, eyes.closed, FEET.tucked)],
    // Head down, eyes wide, then a glance up at the mark: something it was given to do keeps going wrong.
    concerned: [frame(parts.tuftLow, parts.headAlert, eyes.wide, FEET.stand), frame(parts.tuftLow, parts.head, eyes.open, FEET.stand), frame(parts.tuftLow, parts.headAlert, eyes.wide, FEET.tucked)],
  }
}

/** Every creature's frames for every mood. A creature or a mood without frames fails the typecheck. */
export const SPECIES_FRAMES: Record<CompanionSpecies, Record<CompanionMood, readonly SpriteFrame[]>> = {
  cinder: framesOf(PARTS.cinder), sprout: framesOf(PARTS.sprout), moth: framesOf(PARTS.moth), bolt: framesOf(PARTS.bolt),
  weevil: framesOf(PARTS.weevil), rime: framesOf(PARTS.rime), quill: framesOf(PARTS.quill),
}

/** The first creature's frames, for places that draw the companion before a choice is known. */
export const COMPANION_FRAMES = SPECIES_FRAMES.cinder

/** Milliseconds each frame holds. Walking is quick, sleeping is slow. */
export const COMPANION_FRAME_MS: Record<CompanionMood, number> = { 'needs-you': 360, celebrating: 240, working: 180, resting: 900, concerned: 520 }

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
