// SPDX-License-Identifier: Apache-2.0

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { isForeignBrowserRead } from './SettingsRoutes.js';
import { readReceipts } from '../../../../shared/annealer/context-receipts.js';
import { cleanHost, cleanScopePattern, isAnnealerJobId, isCompanionSpecies, isLeadStatus, isSchedule, LEAD_NEXT } from '../../../../shared/annealer/companions.js';
import { resolveDataDir } from '../../../../shared/data-dir.js';
import { AssignRefused, CompanionService } from '../../../annealer/companions.js';
import { CronLordError } from '../../../annealer/cronlord.js';
import { AnnealerStore } from '../../../annealer/store.js';

/** Receipts returned by default, and the most one request may ask for. */
export const RECEIPTS_DEFAULT_LIMIT = 100;
export const RECEIPTS_MAX_LIMIT = 500;

export function receiptsLimit(raw: unknown): number {
  const asked = Number(raw);
  if (!Number.isFinite(asked) || asked < 1) return RECEIPTS_DEFAULT_LIMIT;
  return Math.min(RECEIPTS_MAX_LIMIT, Math.floor(asked));
}

/** The most notes one request may hand over, which is the page's own limit for a browser's trail. */
export const TRAIL_IMPORT_MAX = 300;

/**
 * Annealer's additions to the worker.
 *
 * Context receipts are written by the SessionStart hook (shared/annealer/context-receipts.ts) and only listed here.
 * Companions keep their own database beside claude-mem's and hand their jobs to CronLord (services/annealer).
 *
 * Every route refuses a browser page that is not the worker's own on loopback: these routes read what you are
 * working on, and one of them asks another program to run a shell command.
 */
export class AnnealerRoutes extends BaseRouteHandler {
  private opened: { store: AnnealerStore; companions: CompanionService } | null = null;

  constructor(private dataDir: () => string = resolveDataDir, private given: { store: AnnealerStore; companions: CompanionService } | null = null) {
    super();
  }

  /** Opened on first use, so a worker that never shows the Grove never creates the file. */
  private get annealer(): { store: AnnealerStore; companions: CompanionService } {
    if (this.given) return this.given;
    if (!this.opened) {
      const store = new AnnealerStore(this.dataDir());
      this.opened = { store, companions: CompanionService.forDataDir(this.dataDir(), store) };
    }
    return this.opened;
  }

  setupRoutes(app: express.Application): void {
    app.use('/api/annealer', (req: Request, res: Response, next: express.NextFunction) => {
      if (isForeignBrowserRead(req)) {
        res.status(403).json({ error: 'Forbidden', message: 'Annealer can only be used from the worker\'s own page on this machine.' });
        return;
      }
      next();
    });
    app.get('/api/annealer/context-receipts', this.handleContextReceipts.bind(this));
    app.get('/api/annealer/companions', this.handleCompanions.bind(this));
    app.post('/api/annealer/companions/sync', this.handleSync.bind(this));
    app.post('/api/annealer/jobs', this.handleAssign.bind(this));
    app.post('/api/annealer/jobs/:id/run', this.handleRunNow.bind(this));
    app.delete('/api/annealer/jobs/:id', this.handleRemoveJob.bind(this));
    app.post('/api/annealer/asks', this.handleAsk.bind(this));
    app.post('/api/annealer/souls/:species', this.handleSaveSoul.bind(this));
    app.post('/api/annealer/opinions', this.handleAddOpinion.bind(this));
    app.delete('/api/annealer/opinions/:id', this.handleRemoveOpinion.bind(this));
    app.post('/api/annealer/leads/:id', this.handleDecideLead.bind(this));
    app.post('/api/annealer/scope', this.handleAddScope.bind(this));
    app.delete('/api/annealer/scope/:id', this.handleRemoveScope.bind(this));
    app.get('/api/annealer/trail', this.handleTrail.bind(this));
    app.post('/api/annealer/trail', this.handleAddNotes.bind(this));
    app.post('/api/annealer/trail/:id', this.handleNoteDone.bind(this));
    app.delete('/api/annealer/trail/:id', this.handleRemoveNote.bind(this));
  }

  private handleContextReceipts = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    res.json({ receipts: readReceipts(this.dataDir(), receiptsLimit(req.query.limit)) });
  });

  /** Answers a refusal in words the page can show, and a CronLord failure as a bad gateway. */
  private async answering(res: Response, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (error instanceof AssignRefused) { res.status(400).json({ error: 'Refused', message: error.message }); return; }
      if (error instanceof CronLordError) { res.status(502).json({ error: 'CronLord', message: `CronLord did not accept that: ${error.message}.` }); return; }
      throw error;
    }
  }

  private handleCompanions = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.annealer.companions.state());
  });

  private handleSync = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    const { companions } = this.annealer;
    const result = await companions.sync();
    res.json({ ...result, state: await companions.state() });
  });

  private handleAssign = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const params = body.params !== null && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params as Record<string, unknown> : {};
    if (!isCompanionSpecies(body.species) || typeof body.ritual !== 'string' || !isSchedule(body.schedule)) {
      res.status(400).json({ error: 'Refused', message: 'A job needs a creature, a ritual and a schedule.' });
      return;
    }
    const { species, ritual, schedule } = body;
    const branchId = typeof body.branchId === 'string' && body.branchId.trim() ? body.branchId.trim().slice(0, 200) : null;
    await this.answering(res, async () => {
      res.status(201).json({ job: await this.annealer.companions.assign({ species, ritual, schedule, params, branchId }) });
    });
  });

  private handleRunNow = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    await this.answering(res, async () => {
      if (!isAnnealerJobId(id) || !(await this.annealer.companions.runNow(id))) { res.status(404).json({ error: 'Not found' }); return; }
      res.status(202).json({ queued: true });
    });
  });

  private handleRemoveJob = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    await this.answering(res, async () => {
      if (!isAnnealerJobId(id) || !(await this.annealer.companions.remove(id))) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ removed: true });
    });
  });

  private handleDecideLead = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const status = (req.body as { status?: unknown } | undefined)?.status;
    if (!isLeadStatus(status)) { res.status(400).json({ error: 'Refused', message: 'That is not something a lead can be.' }); return; }
    const { store } = this.annealer;
    const current = store.lead(String(req.params.id));
    if (!current) { res.status(404).json({ error: 'Not found' }); return; }
    // A lead moves one step at a time: it cannot be accepted by a program before it was confirmed and reported.
    if (current.status !== status && !LEAD_NEXT[current.status].includes(status)) { res.status(400).json({ error: 'Refused', message: 'A lead cannot go straight from where it is to that.' }); return; }
    const lead = store.decideLead(current.id, status, new Date().toISOString());
    if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ lead, ledger: store.ledger() });
  });

  private handleAsk = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const params = body.params !== null && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params as Record<string, unknown> : {};
    if (!isCompanionSpecies(body.species) || typeof body.ritual !== 'string') { res.status(400).json({ error: 'Refused', message: 'A question needs a creature and a ritual.' }); return; }
    const { species, ritual } = body;
    const leadId = typeof body.leadId === 'string' && /^\d{1,12}$/.test(body.leadId) ? body.leadId : null;
    await this.answering(res, async () => {
      res.status(202).json({ ask: await this.annealer.companions.ask({ species, ritual, params, leadId }) });
    });
  });

  private handleSaveSoul = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const species = req.params.species;
    if (!isCompanionSpecies(species)) { res.status(404).json({ error: 'Not found' }); return; }
    const { store } = this.annealer;
    res.json({ soul: store.saveSoul(species, req.body, new Date().toISOString()), souls: store.souls() });
  });

  private handleAddOpinion = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const target = typeof body.target === 'string' && body.target.trim() ? cleanHost(body.target) : '';
    if (!isCompanionSpecies(body.species) || target === null) { res.status(400).json({ error: 'Refused', message: 'An opinion needs a creature, and its target is a plain domain or nothing.' }); return; }
    const { store } = this.annealer;
    const opinion = store.addOpinion(body.species, target, body.text, typeof body.leadId === 'string' ? body.leadId : null, new Date().toISOString());
    if (!opinion) { res.status(400).json({ error: 'Refused', message: 'Write the opinion in a sentence. If the list is full, delete one first.' }); return; }
    res.status(201).json({ opinions: store.opinions() });
  });

  private handleRemoveOpinion = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    const { store } = this.annealer;
    if (Number.isInteger(id)) store.removeOpinion(id);
    res.json({ opinions: store.opinions() });
  });

  private handleAddScope = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const pattern = cleanScopePattern((req.body as { pattern?: unknown } | undefined)?.pattern);
    if (!pattern) { res.status(400).json({ error: 'Refused', message: 'Enter a domain such as example.com, or *.example.com for it and everything under it.' }); return; }
    const { store } = this.annealer;
    if (!store.addScope(pattern, new Date().toISOString())) { res.status(400).json({ error: 'Refused', message: 'The scope list is full. Remove an entry first.' }); return; }
    res.status(201).json({ scope: store.scope() });
  });

  private handleRemoveScope = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    const { store } = this.annealer;
    if (Number.isInteger(id)) store.removeScope(id);
    res.json({ scope: store.scope() });
  });

  private handleTrail = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    res.json({ notes: this.annealer.store.trail() });
  });

  /** Adds one note, or hands over the notes a browser had been keeping. Only ever called by a button. */
  private handleAddNotes = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const notes = (req.body as { notes?: unknown } | undefined)?.notes;
    if (!Array.isArray(notes) || notes.length === 0 || notes.length > TRAIL_IMPORT_MAX) {
      res.status(400).json({ error: 'Refused', message: `Send between 1 and ${TRAIL_IMPORT_MAX} notes.` });
      return;
    }
    const { store } = this.annealer;
    const result = store.addNotes(notes.filter((note): note is Record<string, unknown> => note !== null && typeof note === 'object') as never, new Date().toISOString());
    res.status(201).json({ ...result, notes: store.trail() });
  });

  private handleNoteDone = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { store } = this.annealer;
    store.setNoteDone(String(req.params.id), (req.body as { done?: unknown } | undefined)?.done === true);
    res.json({ notes: store.trail() });
  });

  private handleRemoveNote = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { store } = this.annealer;
    store.removeNote(String(req.params.id));
    res.json({ notes: store.trail() });
  });
}
