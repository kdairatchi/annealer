import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { AnnealerRoutes, RECEIPTS_DEFAULT_LIMIT, RECEIPTS_MAX_LIMIT, receiptsLimit } from '../../src/services/worker/http/routes/AnnealerRoutes.js';
import { appendReceipt, receiptOf } from '../../src/shared/annealer/context-receipts.js';

describe('GET /api/annealer/context-receipts', () => {
  let dir: string;
  let server: Server;
  let base: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'annealer-routes-'));
    const app = express();
    new AnnealerRoutes(() => dir).setupRoutes(app);
    server = await new Promise<Server>((resolve) => { const started = app.listen(0, '127.0.0.1', () => resolve(started)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const save = (sessionId: string) => appendReceipt(dir, receiptOf('1042 9:14a 🔵 A memory', { at: '2026-11-18T10:00:00.000Z', sessionId, platform: 'claude-code', projects: ['p'], source: 'worker', cacheAgeMs: null }));

  it('lists receipts newest first, and an empty list when none were written', async () => {
    expect(await (await fetch(`${base}/api/annealer/context-receipts`)).json()).toEqual({ receipts: [] });
    save('one'); save('two'); save('three');
    const body = await (await fetch(`${base}/api/annealer/context-receipts?limit=2`)).json() as { receipts: { sessionId: string; memories: unknown[] }[] };
    expect(body.receipts.map((receipt) => receipt.sessionId)).toEqual(['three', 'two']);
    expect(body.receipts[0].memories).toEqual([{ id: '1042', title: 'A memory' }]);
  });

  it('refuses a page on another site', async () => {
    save('one');
    const response = await fetch(`${base}/api/annealer/context-receipts`, { headers: { Origin: 'https://example.com' } });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain('A memory');
  });

  it('keeps the limit within bounds', () => {
    expect([receiptsLimit(undefined), receiptsLimit('abc'), receiptsLimit('0'), receiptsLimit('-3')]).toEqual(Array(4).fill(RECEIPTS_DEFAULT_LIMIT));
    expect([receiptsLimit('7.9'), receiptsLimit('99999')]).toEqual([7, RECEIPTS_MAX_LIMIT]);
  });
});
