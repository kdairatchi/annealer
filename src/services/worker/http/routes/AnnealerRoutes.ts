// SPDX-License-Identifier: Apache-2.0

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { isForeignBrowserRead } from './SettingsRoutes.js';
import { readReceipts } from '../../../../shared/annealer/context-receipts.js';
import { resolveDataDir } from '../../../../shared/data-dir.js';

/** Receipts returned by default, and the most one request may ask for. */
export const RECEIPTS_DEFAULT_LIMIT = 100;
export const RECEIPTS_MAX_LIMIT = 500;

export function receiptsLimit(raw: unknown): number {
  const asked = Number(raw);
  if (!Number.isFinite(asked) || asked < 1) return RECEIPTS_DEFAULT_LIMIT;
  return Math.min(RECEIPTS_MAX_LIMIT, Math.floor(asked));
}

/**
 * Annealer's additions to the worker. Read-only: the context receipts are
 * written by the SessionStart hook (shared/annealer/context-receipts.ts) and
 * only listed here, so My Work can show what each session was told.
 */
export class AnnealerRoutes extends BaseRouteHandler {
  constructor(private dataDir: () => string = resolveDataDir) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/annealer/context-receipts', this.handleContextReceipts.bind(this));
  }

  private handleContextReceipts = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    // Receipts name memories and projects, so another site's page may not read them.
    if (isForeignBrowserRead(req)) {
      res.status(403).json({ error: 'Forbidden', message: 'Context receipts cannot be read from another browser page.' });
      return;
    }
    res.json({ receipts: readReceipts(this.dataDir(), receiptsLimit(req.query.limit)) });
  });
}
