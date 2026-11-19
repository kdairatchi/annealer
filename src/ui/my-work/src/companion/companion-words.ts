// Small things the Companions panel's parts all say the same way.
import { COMPANION_SPECIES_LABEL } from './companion-sprites.ts'
import type { CompanionSpecies, CompanionState } from '../../../../shared/annealer/companions.ts'

const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
/** A time as the panel shows it, or null when there is none to show. */
export const shortTime = (at: string | null) => { const date = at ? new Date(at) : null; return date && !Number.isNaN(date.getTime()) ? when.format(date) : null }

/** How a part of the panel reports what just happened, in a sentence. */
export type Say = (text: string, failed?: boolean) => void

/** The name a creature goes by: the one you gave it, or its species. */
export const creatureName = (state: CompanionState, species: CompanionSpecies, t: (text: string) => string) => state.souls[species].name || t(COMPANION_SPECIES_LABEL[species])
