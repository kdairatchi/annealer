// A branch's trail: notes, links and reminders the owner leaves there, and the leads from a companion's job that the
// owner chose to keep. On the local worker the trail is kept by the worker, so it is the same in every browser; the
// fixtures and the hosted page keep it in the browser, as before.
import { useState } from 'react'
import { ExternalLinkIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { interpolate, useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { branchTrail, TRAIL_TEXT_MAX, trailLink } from '@/growth/trail'
import type { TrailHandle } from '@/growth/use-trail'

export function Trail({ branchId, trail, today, kept }: { branchId: string; trail: TrailHandle; today: string; /** Where the notes are kept. */ kept: 'worker' | 'browser' }) {
  const { t } = useI18n()
  const { notes, add: onAdd, toggle: onToggle, remove: onRemove } = trail
  const [text, setText] = useState('')
  const [link, setLink] = useState('')
  const [remindOn, setRemindOn] = useState('')
  const mine = branchTrail(notes, branchId)
  const badLink = link.trim() !== '' && trailLink(link) === null
  const add = () => {
    if (!text.trim() || badLink) return
    onAdd({ branchId, text, link: link || undefined, remindOn: remindOn || undefined })
    setText(''); setLink(''); setRemindOn('')
  }
  return (
    <div className="space-y-3 border-t pt-4 lg:col-span-2">
      <div>
        <p className="section-label">{t('Trail')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(kept === 'worker'
          ? 'Notes, links and reminders you leave on this branch, and the leads you kept from a companion’s job. Kept by the worker, so every browser sees them. A reminder shows in the Tune-up on its day.'
          : 'Notes, links and reminders you leave on this branch. Kept in this browser. A reminder shows in the Tune-up on its day, while this page is open.')}</p>
      </div>
      {trail.inBrowser > 0 && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs">
          <span>{interpolate(t(trail.inBrowser === 1 ? 'This browser still holds {count} note from before the worker kept the trail.' : 'This browser still holds {count} notes from before the worker kept the trail.'), { count: trail.inBrowser })}</span>
          <Button size="xs" variant="outline" onClick={trail.moveFromBrowser}><UploadIcon />{t('Move them to the worker')}</Button>
        </p>
      )}
      {trail.error && <p role="alert" className="text-sm text-attention-foreground">{trail.error}</p>}
      <form className="grid gap-2 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_11rem_auto]" onSubmit={(event) => { event.preventDefault(); add() }}>
        <div className="space-y-1">
          <Label htmlFor="trail-text" className="text-xs">{t('Note')}</Label>
          <Input id="trail-text" value={text} maxLength={TRAIL_TEXT_MAX} placeholder={t('A one-liner, a finding, something to retest')} onChange={(event) => setText(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trail-link" className="text-xs">{t('Link (optional)')}</Label>
          <Input id="trail-link" type="url" inputMode="url" value={link} aria-invalid={badLink} aria-describedby={badLink ? 'trail-link-error' : undefined} placeholder="https://" onChange={(event) => setLink(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trail-remind" className="text-xs">{t('Remind on (optional)')}</Label>
          <Input id="trail-remind" type="date" value={remindOn} min={today} onChange={(event) => setRemindOn(event.target.value)} />
        </div>
        <Button type="submit" size="sm" disabled={!text.trim() || badLink}><PlusIcon />{t('Add')}</Button>
        {badLink && <p id="trail-link-error" className="text-xs text-destructive sm:col-span-2 xl:col-span-4">{t('That is not a web link. Start it with https:// or leave it empty.')}</p>}
      </form>
      {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t('Nothing on this branch’s trail yet.')}</p> : (
        <ul className="divide-y border-t">
          {mine.map((note) => {
            const due = !note.done && note.remindOn !== null && note.remindOn <= today
            return (
              <li key={note.id} className="flex items-start gap-3 py-2">
                <input type="checkbox" id={`trail-${note.id}`} checked={note.done} onChange={() => onToggle(note.id)} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`trail-${note.id}`} className={cn('block text-sm break-words', note.done && 'text-muted-foreground line-through')}>{note.text}</label>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {note.link && <a href={note.link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLinkIcon className="size-3" />{new URL(note.link).host}</a>}
                    {note.remindOn && <span className={cn(due && 'font-medium text-attention-foreground')}>{interpolate(t(due ? 'Due {day}' : 'Reminder {day}'), { day: note.remindOn })}</span>}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={interpolate(t('Delete the note “{text}”'), { text: note.text.slice(0, 40) })} onClick={() => onRemove(note.id)}><Trash2Icon /></Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
