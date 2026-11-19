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
/** A model's answer arrives in the log too. CronLord keeps 32 KB of an http response and stamps every line. */
export const ANSWER_READ_MAX_BYTES = 96 * 1024;

export interface CronLordConfig {
  url: string; token: string | null
  /** An OpenAI-compatible server's base address, as the machine that runs CronLord reaches it. Ends in `/v1`. */
  localModelUrl: string | null
}

function cleanBase(value: unknown, keepPath = false): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return null;
    return keepPath ? `${url.origin}${url.pathname.replace(/\/+$/, '')}` : url.origin;
  } catch {
    return null;
  }
}

/**
 * ANNEALER_CRONLORD_URL, ANNEALER_CRONLORD_TOKEN and ANNEALER_LOCAL_MODEL_URL win; otherwise
 * `<data dir>/annealer/cronlord.json` (`{"url": "...", "token": "...", "localModelUrl": "..."}`). A file that others
 * on the machine can read is refused when it holds a token.
 */
export function readCronLordConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): CronLordConfig | null {
  const fromEnv = cleanBase(env.ANNEALER_CRONLORD_URL);
  if (fromEnv) return { url: fromEnv, token: env.ANNEALER_CRONLORD_TOKEN?.trim() || null, localModelUrl: cleanBase(env.ANNEALER_LOCAL_MODEL_URL, true) };
  const file = join(dataDir, 'annealer', CRONLORD_CONFIG_FILE);
  try {
    if (!existsSync(file)) return null;
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { url?: unknown; token?: unknown; localModelUrl?: unknown };
    const url = cleanBase(saved.url);
    if (!url) return null;
    const token = typeof saved.token === 'string' && saved.token.trim() ? saved.token.trim() : null;
    if (token && process.platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) return null;
    return { url, token, localModelUrl: cleanBase(env.ANNEALER_LOCAL_MODEL_URL ?? saved.localModelUrl, true) };
  } catch {
    return null;
  }
}

export interface CronLordRun { id: string; status: RunStatus; startedAt: number | null; finishedAt: number | null }
export interface NewCronLordJob {
  id: string; name: string; description: string; kind: 'shell' | 'http'; schedule: string; command: string; env: Record<string, string>; timeoutSec: number
  /** False for a job that is only ever started by hand: it keeps its schedule line and never fires on it. */
  enabled: boolean
}

export class CronLordError extends Error {
  constructor(message: string, readonly status: number | null) { super(message); }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class CronLordClient {
  constructor(private config: CronLordConfig, private fetchImpl: Fetch = fetch) {}

  get localModelUrl(): string | null { return this.config.localModelUrl; }

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
        id: job.id, name: job.name, description: job.description, category: 'annealer', kind: job.kind, schedule: job.schedule, timezone: 'UTC',
        command: job.command, env: job.env, timeout_sec: job.timeoutSec, max_concurrent: 1, retry_count: 0, enabled: job.enabled, executor: 'local',
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

  /** The start of a finished run's log, as CronLord's event stream sends it. Stops reading at `max` bytes. */
  async log(runId: string, max = LOG_READ_MAX_BYTES): Promise<string> {
    const response = await this.call(`/api/runs/${encodeURIComponent(runId)}/log`, { headers: { Accept: 'text/event-stream' } });
    if (!response.ok || !response.body) throw new CronLordError(`CronLord answered ${response.status}`, response.status);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let read = 0;
    try {
      while (read < max) {
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
    return read >= max ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  }
}

/** What a job printed, without CronLord's stamps: the text of every stdout line, in order. */
export function stdoutOf(log: string): string {
  const lines: string[] = [];
  for (const raw of log.split('\n')) {
    const line = raw.startsWith('data: ') ? raw.slice(6) : raw;
    const match = /^\S+ stdout ?(.*)$/.exec(line);
    if (match) lines.push(match[1]);
  }
  return lines.join('\n');
}

/** The reply inside an OpenAI-compatible chat completion that CronLord logged, or null when it is not one. */
export function chatAnswer(log: string): string | null {
  try {
    const body = JSON.parse(stdoutOf(log)) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? content : null;
  } catch {
    return null;
  }
}
