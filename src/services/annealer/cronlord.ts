// SPDX-License-Identifier: Apache-2.0
//
// The worker's side of CronLord (github.com/kdairatchi/CronLord), the scheduler that runs every companion job.
// Annealer has no scheduler of its own: it creates jobs there, reads their runs back, and nothing else.
//
// The address and token come from the environment or from a file only the owner can read. The page cannot set
// either, so a page cannot point the worker at another host.
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { runStatusOf, type CronLordStatus, type RunStatus } from '../../shared/annealer/companions.js';

export const CRONLORD_CONFIG_FILE = 'cronlord.json';
/** No call to CronLord may hold a page request open for longer than this. */
export const CRONLORD_TIMEOUT_MS = 5000;
/** The most of one run's log the worker reads. CronLord sends the whole file. */
export const LOG_READ_MAX_BYTES = 16 * 1024;

export interface CronLordConfig { url: string; token: string | null }

function cleanBase(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * ANNEALER_CRONLORD_URL and ANNEALER_CRONLORD_TOKEN win; otherwise `<data dir>/annealer/cronlord.json`
 * (`{"url": "...", "token": "..."}`). A file that others on the machine can read is refused when it holds a token.
 */
export function readCronLordConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): CronLordConfig | null {
  const fromEnv = cleanBase(env.ANNEALER_CRONLORD_URL);
  if (fromEnv) return { url: fromEnv, token: env.ANNEALER_CRONLORD_TOKEN?.trim() || null };
  const file = join(dataDir, 'annealer', CRONLORD_CONFIG_FILE);
  try {
    if (!existsSync(file)) return null;
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { url?: unknown; token?: unknown };
    const url = cleanBase(saved.url);
    if (!url) return null;
    const token = typeof saved.token === 'string' && saved.token.trim() ? saved.token.trim() : null;
    if (token && process.platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) return null;
    return { url, token };
  } catch {
    return null;
  }
}

export interface CronLordRun { id: string; status: RunStatus; startedAt: number | null; finishedAt: number | null }
export interface NewCronLordJob {
  id: string; name: string; description: string; schedule: string; command: string; env: Record<string, string>; timeoutSec: number
}

export class CronLordError extends Error {
  constructor(message: string, readonly status: number | null) { super(message); }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class CronLordClient {
  constructor(private config: CronLordConfig, private fetchImpl: Fetch = fetch) {}

  private async call(path: string, init: RequestInit = {}, withToken = true): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
    if (withToken && this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
    try {
      // A redirect could carry the token to another host.
      return await this.fetchImpl(`${this.config.url}${path}`, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(CRONLORD_TIMEOUT_MS) });
    } catch (error) {
      throw new CronLordError(error instanceof Error ? error.message : 'CronLord did not answer', null);
    }
  }

  private async json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.call(path, init);
    if (!response.ok) throw new CronLordError(`CronLord answered ${response.status}`, response.status);
    return response.json();
  }

  /** Whether CronLord is there, takes this token, and would also take a request with no token at all. */
  async status(): Promise<CronLordStatus> {
    const base = { url: this.config.url, version: null, open: false };
    let version: string | null = null;
    try {
      const health = await this.call('/healthz', {}, false);
      if (!health.ok) return { ...base, state: 'unreachable' };
      const body = await health.json() as { version?: unknown };
      version = typeof body.version === 'string' ? body.version.slice(0, 20) : null;
    } catch {
      return { ...base, state: 'unreachable' };
    }
    try {
      const bare = await this.call('/api/jobs', {}, false);
      if (bare.ok) return { url: this.config.url, version, open: true, state: 'connected' };
      const authed = this.config.token ? await this.call('/api/jobs') : bare;
      return { url: this.config.url, version, open: false, state: authed.ok ? 'connected' : 'refused' };
    } catch {
      return { ...base, version, state: 'unreachable' };
    }
  }

  /**
   * Creates the job, or replaces the one with the same id. Never retried by CronLord: a failed run is recorded and
   * left, and the next one happens at its scheduled time.
   */
  async upsertJob(job: NewCronLordJob): Promise<void> {
    await this.json('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: job.id, name: job.name, description: job.description, category: 'annealer', kind: 'shell', schedule: job.schedule, timezone: 'UTC',
        command: job.command, env: job.env, timeout_sec: job.timeoutSec, max_concurrent: 1, retry_count: 0, enabled: true, executor: 'local',
      }),
    });
  }

  async deleteJob(id: string): Promise<void> {
    await this.json(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async runNow(id: string): Promise<void> {
    await this.json(`/api/jobs/${encodeURIComponent(id)}/run`, { method: 'POST' });
  }

  /** A job's most recent runs, newest first. */
  async runs(jobId: string, limit = 20): Promise<CronLordRun[]> {
    const body = await this.json(`/api/runs?job_id=${encodeURIComponent(jobId)}&limit=${limit}`);
    if (!Array.isArray(body)) return [];
    const seconds = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    return body.flatMap((entry: { id?: unknown; job_id?: unknown; status?: unknown; started_at?: unknown; finished_at?: unknown }) =>
      typeof entry?.id === 'string' && entry.job_id === jobId
        ? [{ id: entry.id.slice(0, 80), status: runStatusOf(entry.status), startedAt: seconds(entry.started_at), finishedAt: seconds(entry.finished_at) }]
        : []);
  }

  /** The start of a finished run's log, as CronLord's event stream sends it. Stops reading at LOG_READ_MAX_BYTES. */
  async log(runId: string): Promise<string> {
    const response = await this.call(`/api/runs/${encodeURIComponent(runId)}/log`, { headers: { Accept: 'text/event-stream' } });
    if (!response.ok || !response.body) throw new CronLordError(`CronLord answered ${response.status}`, response.status);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let read = 0;
    try {
      while (read < LOG_READ_MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      throw new CronLordError(error instanceof Error ? error.message : 'the log could not be read', null);
    } finally {
      reader.cancel().catch(() => {});
    }
    // A cut-off last line is dropped, so half a lead is never read as a whole one.
    return read >= LOG_READ_MAX_BYTES ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  }
}
