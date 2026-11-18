// The companion: a small pixel creature in the corner that shows, at a glance, what the recorded work is doing.
// It walks while an agent is working, waves when something waits on you, cheers for a minute after a recorded ship,
// and sleeps when nothing moves. Clicking it says why in one sentence and opens the request it is about.
// Its level is the Grove's level, so it grows only when recorded work does.
import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRightIcon, SproutIcon } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toGrove } from '@/growth/growth-model'
import { NEXT_STEP_NOT_RECORDED } from '@/live/to-work-model'
import { useRecentChanges, useStore, useWorkModel } from '@/store'
import { COMPANION_MOOD_LABEL, companionStatus, type CompanionMood } from './companion-mood'
import {
  COMPANION_COLORS, COMPANION_FRAME_MS, COMPANION_FRAMES, COMPANION_NAME_MAX, COMPANION_PALETTE_LABEL, COMPANION_PALETTES,
  SPRITE_SIZE, type CompanionPalette, type SpriteFrame, type SpritePixel,
} from './companion-sprites'

/** One frame, drawn as crisp squares so it stays pixel art at any size. */
export function Sprite({ frame, palette, className }: { frame: SpriteFrame; palette: CompanionPalette; className?: string }) {
  const colors = COMPANION_COLORS[palette]
  return (
    <svg viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`} shapeRendering="crispEdges" aria-hidden="true" className={className}>
      {frame.flatMap((row, y) => [...row].map((pixel, x) => pixel === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={colors[pixel as SpritePixel]} />))}
    </svg>
  )
}

/** Steps through a mood's frames. With reduced motion it holds the first frame. */
function useFrame(mood: CompanionMood): SpriteFrame {
  const still = useReducedMotion()
  const frames = COMPANION_FRAMES[mood]
  const [cycle, setCycle] = useState({ mood, step: 0 })
  // A new mood starts from its first frame.
  if (cycle.mood !== mood) setCycle({ mood, step: 0 })
  useEffect(() => {
    if (still) return
    const timer = window.setInterval(() => setCycle((current) => ({ mood: current.mood, step: current.step + 1 })), COMPANION_FRAME_MS[mood])
    return () => window.clearInterval(timer)
  }, [mood, still])
  return frames[(cycle.mood === mood && !still ? cycle.step : 0) % frames.length]
}

/** How the sprite moves along its strip in each mood. A mood without a motion fails the typecheck. */
const STRIP_MOTION: Record<CompanionMood, { x: number[]; y: number[]; seconds: number }> = {
  'needs-you': { x: [0, 0], y: [0, -5, 0], seconds: 0.7 },
  celebrating: { x: [0, 0], y: [0, -10, 0], seconds: 0.5 },
  working: { x: [0, 44, 0], y: [0, 0], seconds: 6 },
  resting: { x: [0, 0], y: [0, 0], seconds: 1 },
}

export function Companion({ onOpenRequest, onOpenGrove }: { onOpenRequest: (requestId: string) => void; onOpenGrove: () => void }) {
  const { t } = useI18n()
  const { requests, focusAreas, otherAsks } = useWorkModel()
  const changes = useRecentChanges()
  const companion = useStore((state) => state.view.companion)
  const setCompanion = useStore.use.setCompanion()
  const still = useReducedMotion()
  // The cheer ends on the clock, so the clock runs only while there is a change that could still be cheered.
  const now = useNow(changes.length > 0)
  const status = useMemo(() => companionStatus(requests, changes, now, NEXT_STEP_NOT_RECORDED), [requests, changes, now])
  const level = useMemo(() => toGrove(focusAreas, requests, otherAsks.length, NEXT_STEP_NOT_RECORDED).level, [focusAreas, requests, otherAsks])
  const frame = useFrame(status.mood)
  // The field holds what is being typed; a saved (cleaned) name replaces it.
  const [name, setName] = useState(companion.name)
  const [savedName, setSavedName] = useState(companion.name)
  if (savedName !== companion.name) { setSavedName(companion.name); setName(companion.name) }
  if (!companion.shown) return null
  const move = STRIP_MOTION[status.mood]

  return (
    <div className="pointer-events-none fixed right-3 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] z-20 md:right-5 md:bottom-5">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="bare" aria-label={`${companion.name}: ${t(COMPANION_MOOD_LABEL[status.mood])}. ${status.line}`}
            className="pointer-events-auto relative flex h-16 w-44 items-end justify-start rounded-xl border border-border/70 bg-card/90 px-2 pb-1.5 font-normal shadow-panel backdrop-blur-sm transition-colors hover:border-accent-border">
            {/* The ground it walks on. */}
            <span aria-hidden="true" className="absolute inset-x-2 bottom-1.5 h-px bg-border" />
            <motion.span
              className="relative block size-10"
              animate={still ? undefined : { x: move.x, y: move.y }}
              transition={{ duration: move.seconds, repeat: Infinity, ease: status.mood === 'working' ? 'linear' : 'easeInOut' }}
            >
              <Sprite frame={frame} palette={companion.palette} className="size-10" />
            </motion.span>
            <span className="absolute top-1.5 right-2 text-right leading-tight">
              <span className="block font-mono text-[10px] tracking-wider text-muted-foreground">LV {level}</span>
              <span className={cn('block text-[10px] font-medium', status.mood === 'needs-you' ? 'text-attention-foreground' : status.mood === 'working' ? 'text-working-foreground' : status.mood === 'celebrating' ? 'text-shipped-foreground' : 'text-idle-foreground')}>{t(COMPANION_MOOD_LABEL[status.mood])}</span>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="pointer-events-auto w-72 space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <Sprite frame={frame} palette={companion.palette} className="size-12 shrink-0" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{companion.name}</p>
              <p className="font-mono text-[11px] tracking-wider text-muted-foreground">LV {level} · {t(COMPANION_MOOD_LABEL[status.mood])}</p>
            </div>
          </div>
          <p className="text-muted-foreground">{status.line}</p>
          <div className="flex flex-wrap gap-2">
            {status.requestId && <Button size="sm" onClick={() => onOpenRequest(status.requestId!)}>{t('Open request')}<ArrowRightIcon /></Button>}
            <Button size="sm" variant="outline" onClick={onOpenGrove}><SproutIcon />{t('Open the Grove')}</Button>
          </div>
          <div className="space-y-2 border-t pt-3">
            <div className="space-y-1">
              <Label htmlFor="companion-name" className="text-xs">{t('Name')}</Label>
              <Input id="companion-name" value={name} maxLength={COMPANION_NAME_MAX} onChange={(event) => setName(event.target.value)} onBlur={() => setCompanion({ name })}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} className="h-8" />
            </div>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium">{t('Colours')}</legend>
              <div className="flex gap-1.5">
                {COMPANION_PALETTES.map((palette) => (
                  <Button key={palette} variant="bare" aria-pressed={companion.palette === palette} title={t(COMPANION_PALETTE_LABEL[palette])} onClick={() => setCompanion({ palette })}
                    className={cn('flex size-9 items-center justify-center rounded-lg border bg-card transition-colors', companion.palette === palette ? 'border-primary' : 'border-control-edge hover:border-accent-border')}>
                    <Sprite frame={COMPANION_FRAMES.working[1]} palette={palette} className="size-6" />
                    <span className="sr-only">{t(COMPANION_PALETTE_LABEL[palette])}</span>
                  </Button>
                ))}
              </div>
            </fieldset>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t('The Grove can bring it back.')}</p>
              <Button size="sm" variant="outline" onClick={() => setCompanion({ shown: false })}>{t('Hide')}</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
