// SPDX-License-Identifier: Apache-2.0
//
// Annealer's own database: `<data dir>/annealer/annealer.db`. It sits beside claude-mem's database and never inside
// it, because upstream owns that schema and its migration numbers.
//
// CronLord owns jobs and runs. This file only holds what ties them to a companion: which jobs are whose, the leads
// their runs printed, what the owner decided about each lead, and the trail notes. Nothing here is replayed and
// nothing here starts a job.
import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  cleanHost, cleanLongText, cleanSoul, cleanText, COMPANION_SPECIES, DEFAULT_SOUL, DETAIL_MAX, hostInScope, isAskState, isCompanionSpecies, isEngine, isLeadKind,
  isLeadStatus, isSchedule, LEAD_POINTS, LEAD_TEXT_MAX, OPINION_MAX, runStatusOf, sharesCredit, SOURCE_SHARE, SOURCES_CREDITED,
  type Ask, type AskState, type CompanionJob, type CompanionSpecies, type Engine, type Lead, type LeadKind, type LeadStatus, type Opinion, type RunStatus,
  type Schedule, type ScopeEntry, type Soul, type XpEvent,
} from '../../shared/annealer/companions.js';

export const ANNEALER_DB_FILE = 'annealer.db';
export const TRAIL_TEXT_MAX = 280;
/** Notes kept across all branches. Past this, a new note is refused until one is deleted; nothing is dropped silently. */
export const TRAIL_KEPT = 1000;
/** Leads listed for the page. Older ones stay in the file. */
export const LEADS_LISTED = 200;
export const SCOPE_KEPT = 200;
export const JOBS_KEPT = 50;
export const OPINIONS_KEPT = 300;
/** Questions listed for the page. */
export const ASKS_LISTED = 20;

export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE companion_job (
     id TEXT PRIMARY KEY, species TEXT NOT NULL, ritual TEXT NOT NULL, target TEXT NOT NULL, schedule TEXT NOT NULL,
     branch_id TEXT, last_run_seen TEXT, recent TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
   );
   CREATE TABLE lead (
     id INTEGER PRIMARY KEY AUTOINCREMENT, species TEXT NOT NULL, job_id TEXT, run_id TEXT NOT NULL, kind TEXT NOT NULL,
     body TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, resolved_at TEXT,
     UNIQUE (run_id, kind, body)
   );
   CREATE INDEX lead_status ON lead (status, id);
   CREATE TABLE xp_event (
     id INTEGER PRIMARY KEY AUTOINCREMENT, species TEXT NOT NULL, at TEXT NOT NULL, points INTEGER NOT NULL,
     lead_id INTEGER NOT NULL UNIQUE REFERENCES lead(id) ON DELETE CASCADE
   );
   CREATE TABLE scope (id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT NOT NULL UNIQUE, added_at TEXT NOT NULL);
   CREATE TABLE trail_note (
     id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, body TEXT NOT NULL, link TEXT, remind_on TEXT,
     done INTEGER NOT NULL DEFAULT 0, lead_id INTEGER UNIQUE REFERENCES lead(id) ON DELETE SET NULL, created_at TEXT NOT NULL
   );
   CREATE INDEX trail_branch ON trail_note (branch_id);`,
  // Souls, opinions and questions to a model. The ledger now holds one entry per lead per creature, so a creature
  // whose lead fed a reported one can be credited beside its author.
  `ALTER TABLE lead ADD COLUMN detail TEXT NOT NULL DEFAULT '';
   CREATE TABLE lead_source (
     lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE, source_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
     PRIMARY KEY (lead_id, source_id)
   );
   CREATE TABLE xp_event_next (
     id INTEGER PRIMARY KEY AUTOINCREMENT, species TEXT NOT NULL, at TEXT NOT NULL, points INTEGER NOT NULL,
     lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE, UNIQUE (lead_id, species)
   );
   INSERT INTO xp_event_next (id, species, at, points, lead_id) SELECT id, species, at, points, lead_id FROM xp_event;
   DROP TABLE xp_event;
   ALTER TABLE xp_event_next RENAME TO xp_event;
   CREATE TABLE soul (species TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE opinion (
     id INTEGER PRIMARY KEY AUTOINCREMENT, species TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
     lead_id INTEGER REFERENCES lead(id) ON DELETE SET NULL, created_at TEXT NOT NULL
   );
   CREATE TABLE ask (
     id TEXT PRIMARY KEY, species TEXT NOT NULL, ritual TEXT NOT NULL, target TEXT NOT NULL, engine TEXT NOT NULL,
     sources TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'waiting', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
   );`,
];

export interface TrailNote { id: string; branchId: string; text: string; link: string | null; remindOn: string | null; done: boolean; createdAt: string }
export interface NewTrailNote { id: string; branchId: string; text: string; link?: unknown; remindOn?: unknown; done?: unknown; createdAt?: unknown }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_ID = /^[A-Za-z0-9-]{6,64}$/;

/** A link only if it is plain http or https. The same rule the page applies before it sends one. */
export function trailLink(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function toLead(row: Record<string, unknown> | null): Lead | null {
  if (!row || !isCompanionSpecies(row.species) || !isLeadKind(row.kind) || !isLeadStatus(row.status)) return null;
  return {
    id: String(row.id), species: row.species, jobId: typeof row.job_id === 'string' ? row.job_id : null, kind: row.kind,
    text: String(row.body), target: String(row.target), status: row.status, createdAt: String(row.created_at),
    detail: typeof row.detail === 'string' ? row.detail : '',
    sources: typeof row.sources === 'string' && row.sources ? row.sources.split(',') : [],
  };
}

const LEAD_ROWS = `SELECT l.*, (SELECT group_concat(source_id) FROM lead_source WHERE lead_id = l.id) AS sources FROM lead l`;

export class AnnealerStore {
  private db: Database;

  /** `dataDir` is claude-mem's data folder; pass `:memory:` for a store that lives only as long as the object. */
  constructor(dataDir: string) {
    if (dataDir === ':memory:') {
      this.db = new Database(':memory:');
    } else {
      const dir = join(dataDir, 'annealer');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, ANNEALER_DB_FILE);
      this.db = new Database(file, { create: true });
      // Leads name targets, so the file is the owner's alone, like the receipts beside it.
      try { chmodSync(file, 0o600); } catch { /* Not every filesystem has modes. */ }
      this.db.exec('PRAGMA journal_mode = WAL');
    }
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const done = (this.db.query('SELECT MAX(version) AS version FROM schema_version').get() as { version: number | null }).version ?? 0;
    MIGRATIONS.slice(done).forEach((sql, index) => {
      this.db.transaction(() => {
        this.db.exec(sql);
        this.db.query('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(done + index + 1, new Date().toISOString());
      })();
    });
  }

  close(): void { this.db.close(); }

  // --- Jobs -----------------------------------------------------------------------------------------------------

  jobs(): (CompanionJob & { lastRunSeen: string | null })[] {
    const rows = this.db.query('SELECT * FROM companion_job ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.flatMap((row) => {
      if (!isCompanionSpecies(row.species) || !isSchedule(row.schedule)) return [];
      let recent: { status: RunStatus; at: string | null }[] = [];
      try {
        const saved: unknown = JSON.parse(String(row.recent));
        if (Array.isArray(saved)) recent = saved.slice(0, 5).map((entry: { status?: unknown; at?: unknown }) => ({ status: runStatusOf(entry?.status), at: typeof entry?.at === 'string' ? entry.at : null }));
      } catch { /* An unreadable history is an empty one. */ }
      return [{
        id: String(row.id), species: row.species, ritual: String(row.ritual), target: String(row.target), schedule: row.schedule,
        branchId: typeof row.branch_id === 'string' ? row.branch_id : null, recent, createdAt: String(row.created_at),
        lastRunSeen: typeof row.last_run_seen === 'string' ? row.last_run_seen : null,
      }];
    });
  }

  job(id: string) { return this.jobs().find((job) => job.id === id) ?? null; }

  saveJob(job: { id: string; species: CompanionSpecies; ritual: string; target: string; schedule: Schedule; branchId: string | null }, now: string): void {
    this.db.query(`INSERT INTO companion_job (id, species, ritual, target, schedule, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET schedule = excluded.schedule, branch_id = excluded.branch_id`)
      .run(job.id, job.species, job.ritual, job.target, job.schedule, job.branchId, now);
  }

  /** Forgets the job. Its leads stay, with no job to point at, because the decisions about them still count. */
  removeJob(id: string): void {
    this.db.transaction(() => {
      this.db.query('UPDATE lead SET job_id = NULL WHERE job_id = ?').run(id);
      this.db.query('DELETE FROM companion_job WHERE id = ?').run(id);
    })();
  }

  markRuns(id: string, lastRunSeen: string | null, recent: { status: RunStatus; at: string | null }[]): void {
    this.db.query('UPDATE companion_job SET last_run_seen = COALESCE(?, last_run_seen), recent = ? WHERE id = ?').run(lastRunSeen, JSON.stringify(recent.slice(0, 5)), id);
  }

  // --- Leads and the ledger -------------------------------------------------------------------------------------

  /** Saves a run's leads once. Reading the same run again adds nothing. */
  addLeads(job: { id: string; species: CompanionSpecies; target: string }, runId: string, leads: readonly { kind: LeadKind; text: string }[], now: string): number {
    const insert = this.db.query('INSERT OR IGNORE INTO lead (species, job_id, run_id, kind, body, target, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let added = 0;
    this.db.transaction(() => {
      for (const lead of leads) {
        const text = cleanText(lead.text, LEAD_TEXT_MAX);
        if (text && isLeadKind(lead.kind)) added += insert.run(job.species, job.id, runId, lead.kind, text, job.target, now).changes;
      }
    })();
    return added;
  }

  leads(): Lead[] {
    // Undecided first, then the most recent decisions.
    const rows = this.db.query(`${LEAD_ROWS} ORDER BY (l.status = 'new') DESC, l.id DESC LIMIT ?`).all(LEADS_LISTED) as Record<string, unknown>[];
    return rows.flatMap((row) => { const lead = toLead(row); return lead ? [lead] : []; });
  }

  lead(id: string): Lead | null {
    const key = Number(id);
    return Number.isInteger(key) ? toLead(this.db.query(`${LEAD_ROWS} WHERE l.id = ?`).get(key) as Record<string, unknown> | null) : null;
  }

  /** The leads a lead was built from, and theirs, nearest first. Stops at three steps back. */
  ancestors(id: string): Lead[] {
    const found = new Map<string, Lead>();
    let layer = [id];
    for (let depth = 0; depth < 3 && layer.length > 0; depth += 1) {
      const next: string[] = [];
      for (const current of layer) {
        for (const source of this.lead(current)?.sources ?? []) {
          const lead = found.has(source) || source === id ? null : this.lead(source);
          if (lead) { found.set(source, lead); next.push(source); }
        }
      }
      layer = next;
    }
    return [...found.values()];
  }

  /** What the owner kept about a target and the hosts under it, newest first: the material a model is given. */
  keptAbout(domain: string, kinds: readonly LeadKind[], limit: number): Lead[] {
    const rows = this.db.query(`${LEAD_ROWS} WHERE l.status IN ('kept', 'confirmed', 'shipped', 'accepted') ORDER BY l.id DESC LIMIT 2000`).all() as Record<string, unknown>[];
    const hostOf = (target: string) => { try { return cleanHost(target) ?? cleanHost(new URL(target).hostname) ?? ''; } catch { return ''; } };
    return rows.flatMap((row) => { const lead = toLead(row); return lead && kinds.includes(lead.kind) && hostInScope(hostOf(lead.target), [domain, `*.${domain}`]) ? [lead] : []; }).slice(0, limit);
  }

  /** Saves what a model wrote, once per run, with the leads it was built from. Returns the new leads' ids. */
  addModelLeads(species: CompanionSpecies, runId: string, target: string, kind: LeadKind, items: readonly { text: string; detail: string }[], sources: readonly string[], now: string): string[] {
    const insert = this.db.query('INSERT OR IGNORE INTO lead (species, job_id, run_id, kind, body, target, detail, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)');
    const link = this.db.query('INSERT OR IGNORE INTO lead_source (lead_id, source_id) VALUES (?, ?)');
    const ids: string[] = [];
    this.db.transaction(() => {
      for (const item of items) {
        const text = cleanText(item.text, LEAD_TEXT_MAX);
        if (!text) continue;
        const done = insert.run(species, runId, kind, text, target, cleanLongText(item.detail, DETAIL_MAX), now);
        if (done.changes === 0) continue;
        const id = Number(done.lastInsertRowid);
        for (const source of sources) { const key = Number(source); if (Number.isInteger(key) && key !== id) link.run(id, key); }
        ids.push(String(id));
      }
    })();
    return ids;
  }

  /**
   * Records how far a lead got, and what that is worth. The lead's author has one ledger entry for it, replaced each
   * time, so the entry is always the worth of where the lead stands now and `new` takes it back. When the lead was
   * reported or accepted, each other creature whose lead it was built from gets a share. A kept lead from a job
   * that was given a branch is also left on that branch's trail.
   */
  decideLead(id: string, status: LeadStatus, now: string): Lead | null {
    const key = Number(id);
    if (!Number.isInteger(key)) return null;
    return this.db.transaction(() => {
      const row = this.db.query('SELECT l.*, j.branch_id FROM lead l LEFT JOIN companion_job j ON j.id = l.job_id WHERE l.id = ?').get(key) as Record<string, unknown> | null;
      if (!row || !isCompanionSpecies(row.species)) return null;
      const author = row.species;
      this.db.query('UPDATE lead SET status = ?, resolved_at = ? WHERE id = ?').run(status, status === 'new' ? null : now, key);
      this.db.query('DELETE FROM xp_event WHERE lead_id = ?').run(key);
      const pay = this.db.query('INSERT INTO xp_event (species, at, points, lead_id) VALUES (?, ?, ?, ?)');
      if (LEAD_POINTS[status] !== 0) pay.run(author, now, LEAD_POINTS[status], key);
      if (sharesCredit(status)) {
        const others = [...new Set(this.ancestors(String(key)).map((lead) => lead.species))].filter((species) => species !== author).slice(0, SOURCES_CREDITED);
        for (const species of others) pay.run(species, now, Math.round(LEAD_POINTS[status] * SOURCE_SHARE), key);
      }
      if (status !== 'new' && status !== 'dismissed' && typeof row.branch_id === 'string' && this.trailCount() < TRAIL_KEPT) {
        this.db.query('INSERT OR IGNORE INTO trail_note (id, branch_id, body, lead_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(`lead-${key}`, row.branch_id, cleanText(`${row.target}: ${row.body}`, TRAIL_TEXT_MAX), key, now);
      } else if (status === 'new' || status === 'dismissed') {
        // An unfinished note the lead left goes with the decision; one you already ticked off stays.
        this.db.query('DELETE FROM trail_note WHERE lead_id = ? AND done = 0').run(key);
      }
      return this.lead(String(key));
    })();
  }

  ledger(): Record<CompanionSpecies, XpEvent[]> {
    const ledger = Object.fromEntries(COMPANION_SPECIES.map((species) => [species, [] as XpEvent[]])) as Record<CompanionSpecies, XpEvent[]>;
    for (const row of this.db.query('SELECT species, at, points FROM xp_event ORDER BY id').all() as { species: unknown; at: string; points: number }[]) {
      if (isCompanionSpecies(row.species)) ledger[row.species].push({ at: row.at, points: row.points });
    }
    return ledger;
  }

  // --- Souls and opinions ---------------------------------------------------------------------------------------

  souls(): Record<CompanionSpecies, Soul> {
    const souls = Object.fromEntries(COMPANION_SPECIES.map((species) => [species, { ...DEFAULT_SOUL }])) as Record<CompanionSpecies, Soul>;
    for (const row of this.db.query('SELECT species, body FROM soul').all() as { species: unknown; body: string }[]) {
      if (!isCompanionSpecies(row.species)) continue;
      try { souls[row.species] = cleanSoul(JSON.parse(row.body)); } catch { /* An unreadable soul is the default one. */ }
    }
    return souls;
  }

  /** Saves a soul after cleaning it, and returns what was saved. */
  saveSoul(species: CompanionSpecies, soul: unknown, now: string): Soul {
    const cleaned = cleanSoul(soul);
    this.db.query('INSERT INTO soul (species, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(species) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
      .run(species, JSON.stringify(cleaned), now);
    return cleaned;
  }

  opinions(): Opinion[] {
    return (this.db.query('SELECT * FROM opinion ORDER BY id DESC').all() as Record<string, unknown>[]).flatMap((row) => isCompanionSpecies(row.species)
      ? [{ id: Number(row.id), species: row.species, target: String(row.target), text: String(row.body), leadId: row.lead_id === null ? null : String(row.lead_id), createdAt: String(row.created_at) }]
      : []);
  }

  /** An opinion you wrote or confirmed. `target` is a domain, or '' for everywhere. Null when it is empty or the list is full. */
  addOpinion(species: CompanionSpecies, target: string, text: unknown, leadId: string | null, now: string): Opinion | null {
    const body = cleanText(text, OPINION_MAX);
    if (!body || (this.db.query('SELECT COUNT(*) AS count FROM opinion').get() as { count: number }).count >= OPINIONS_KEPT) return null;
    const lead = leadId !== null && this.lead(leadId) ? Number(leadId) : null;
    const done = this.db.query('INSERT INTO opinion (species, target, body, lead_id, created_at) VALUES (?, ?, ?, ?, ?)').run(species, target, body, lead, now);
    return this.opinions().find((opinion) => opinion.id === Number(done.lastInsertRowid)) ?? null;
  }

  removeOpinion(id: number): void { this.db.query('DELETE FROM opinion WHERE id = ?').run(id); }

  // --- Questions to a model -------------------------------------------------------------------------------------

  asks(state?: AskState): Ask[] {
    const rows = (state
      ? this.db.query('SELECT * FROM ask WHERE state = ? ORDER BY created_at DESC').all(state)
      : this.db.query('SELECT * FROM ask ORDER BY created_at DESC LIMIT ?').all(ASKS_LISTED)) as Record<string, unknown>[];
    return rows.flatMap((row) => isCompanionSpecies(row.species) && isEngine(row.engine) && isAskState(row.state)
      ? [{ id: String(row.id), species: row.species, ritual: String(row.ritual), target: String(row.target), engine: row.engine, state: row.state, note: String(row.note), createdAt: String(row.created_at) }]
      : []);
  }

  hasAsk(id: string): boolean { return this.db.query('SELECT 1 FROM ask WHERE id = ?').get(id) !== null; }

  askSources(id: string): string[] {
    const row = this.db.query('SELECT sources FROM ask WHERE id = ?').get(id) as { sources: string } | null;
    try { const list: unknown = JSON.parse(row?.sources ?? '[]'); return Array.isArray(list) ? list.map(String) : []; } catch { return []; }
  }

  addAsk(ask: { id: string; species: CompanionSpecies; ritual: string; target: string; engine: Engine; sources: readonly string[] }, now: string): void {
    this.db.query('INSERT INTO ask (id, species, ritual, target, engine, sources, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ask.id, ask.species, ask.ritual, ask.target, ask.engine, JSON.stringify(ask.sources), now);
  }

  settleAsk(id: string, state: AskState, note: string): void { this.db.query('UPDATE ask SET state = ?, note = ? WHERE id = ?').run(state, cleanText(note, 200), id); }

  /** Questions a creature was asked on one day (`YYYY-MM-DD`), whatever became of them. The daily limit counts these. */
  asksOn(species: CompanionSpecies, day: string): number {
    return (this.db.query('SELECT COUNT(*) AS count FROM ask WHERE species = ? AND substr(created_at, 1, 10) = ?').get(species, day) as { count: number }).count;
  }

  // --- Scope ----------------------------------------------------------------------------------------------------

  scope(): ScopeEntry[] { return this.db.query('SELECT id, pattern FROM scope ORDER BY pattern').all() as ScopeEntry[]; }

  /** False when the list is full. Adding a pattern that is already there changes nothing and is not an error. */
  addScope(pattern: string, now: string): boolean {
    if ((this.db.query('SELECT COUNT(*) AS count FROM scope').get() as { count: number }).count >= SCOPE_KEPT) return false;
    this.db.query('INSERT OR IGNORE INTO scope (pattern, added_at) VALUES (?, ?)').run(pattern, now);
    return true;
  }

  removeScope(id: number): void { this.db.query('DELETE FROM scope WHERE id = ?').run(id); }

  // --- Trail ----------------------------------------------------------------------------------------------------

  private trailCount(): number { return (this.db.query('SELECT COUNT(*) AS count FROM trail_note').get() as { count: number }).count; }

  trail(): TrailNote[] {
    return (this.db.query('SELECT * FROM trail_note ORDER BY created_at').all() as Record<string, unknown>[]).map((row) => ({
      id: String(row.id), branchId: String(row.branch_id), text: String(row.body), link: typeof row.link === 'string' ? row.link : null,
      remindOn: typeof row.remind_on === 'string' ? row.remind_on : null, done: row.done === 1, createdAt: String(row.created_at),
    }));
  }

  /** Adds notes the owner wrote. Returns how many were new; a note whose id is already there is left as it is. */
  addNotes(notes: readonly NewTrailNote[], now: string): { added: number; full: boolean } {
    const insert = this.db.query('INSERT OR IGNORE INTO trail_note (id, branch_id, body, link, remind_on, done, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let added = 0;
    let full = false;
    this.db.transaction(() => {
      let count = this.trailCount();
      for (const note of notes) {
        const text = cleanText(note.text, TRAIL_TEXT_MAX);
        const branchId = cleanText(note.branchId, 200);
        if (!text || !branchId || typeof note.id !== 'string' || !NOTE_ID.test(note.id) || note.id.startsWith('lead-')) continue;
        if (count >= TRAIL_KEPT) { full = true; break; }
        const createdAt = typeof note.createdAt === 'string' && !Number.isNaN(Date.parse(note.createdAt)) ? new Date(note.createdAt).toISOString() : now;
        const changes = insert.run(note.id, branchId, text, trailLink(note.link), typeof note.remindOn === 'string' && DAY.test(note.remindOn) ? note.remindOn : null, note.done === true ? 1 : 0, createdAt).changes;
        added += changes;
        count += changes;
      }
    })();
    return { added, full };
  }

  setNoteDone(id: string, done: boolean): void { this.db.query('UPDATE trail_note SET done = ? WHERE id = ?').run(done ? 1 : 0, id); }
  removeNote(id: string): void { this.db.query('DELETE FROM trail_note WHERE id = ?').run(id); }
}
