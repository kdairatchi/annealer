// SPDX-License-Identifier: Apache-2.0
//
// What the worker does for companions: hand a ritual to CronLord as a job, read that job's finished runs back, and
// turn what they printed into leads. It runs only when the page asks. There is no timer here, nothing is retried,
// and a run missed while CronLord was down is never made up for (docs/annealer/companions.md).
import {
  cleanParam, hostInScope, jobIdFor, parseLeads, runFinished, SCHEDULE_CRON,
  type CompanionJob, type CompanionSpecies, type CompanionState, type CronLordStatus, type RunStatus, type Schedule,
} from '../../shared/annealer/companions.js';
import { CronLordClient, CronLordError, readCronLordConfig } from './cronlord.js';
import { rituals } from './rituals.js';
import { AnnealerStore, JOBS_KEPT } from './store.js';

/** Why a job could not be given. The page shows `message` as it is. */
export class AssignRefused extends Error {}

export interface AssignRequest { species: CompanionSpecies; ritual: string; params: Record<string, unknown>; schedule: Schedule; branchId: string | null }

const iso = (seconds: number | null) => (seconds === null ? null : new Date(seconds * 1000).toISOString());

export class CompanionService {
  constructor(private store: AnnealerStore, private client: () => CronLordClient | null, private now: () => Date = () => new Date()) {}

  static forDataDir(dataDir: string, store: AnnealerStore): CompanionService {
    return new CompanionService(store, () => {
      const config = readCronLordConfig(dataDir);
      return config ? new CronLordClient(config) : null;
    });
  }

  private async cronlordStatus(): Promise<CronLordStatus> {
    const client = this.client();
    return client ? client.status() : { state: 'not-set-up', url: null, version: null, open: false };
  }

  async state(): Promise<CompanionState> {
    return {
      cronlord: await this.cronlordStatus(),
      rituals: [...rituals().values()].map((entry) => entry.ritual),
      jobs: this.store.jobs().map(({ lastRunSeen: _seen, ...job }): CompanionJob => job),
      leads: this.store.leads(),
      ledger: this.store.ledger(),
      scope: this.store.scope(),
    };
  }

  /**
   * Checks the parameters, creates the job in CronLord, and only then remembers it. A ritual that sends requests to
   * its target is refused unless the target's host is on the scope list.
   */
  async assign(request: AssignRequest): Promise<CompanionJob> {
    const entry = rituals().get(request.ritual);
    if (!entry) throw new AssignRefused('That ritual does not exist.');
    const { ritual, job } = entry;
    if (ritual.owner !== request.species) throw new AssignRefused('That ritual belongs to another creature.');
    const env: Record<string, string> = {};
    let target = '';
    const patterns = this.store.scope().map((scope) => scope.pattern);
    for (const param of ritual.params) {
      const cleaned = cleanParam(param.type, request.params[param.name]);
      if (!cleaned) throw new AssignRefused(param.type === 'domain' ? `${param.label}: enter a plain domain, such as example.com.` : `${param.label}: enter a full http or https address on a named host.`);
      if (ritual.reach === 'touch' && !hostInScope(cleaned.host, patterns)) throw new AssignRefused(`${cleaned.host} is not on the scope list. Add it there first; this ritual sends requests to it.`);
      env[param.name] = cleaned.value;
      target ||= cleaned.value;
    }
    const client = this.client();
    if (!client) throw new AssignRefused('CronLord is not set up, so there is nothing to run the job.');
    const id = jobIdFor(request.species, ritual.id, env);
    if (!this.store.job(id) && this.store.jobs().length >= JOBS_KEPT) throw new AssignRefused(`There are already ${JOBS_KEPT} jobs. Remove one first.`);
    await client.upsertJob({
      id, name: `${ritual.name}: ${target}`.slice(0, 120), description: `Annealer, ${request.species}. ${ritual.description}`.slice(0, 300),
      schedule: SCHEDULE_CRON[request.schedule], command: job.command, env: { ...env, ANNEALER_JOB: id }, timeoutSec: job.timeoutSec,
    });
    this.store.saveJob({ id, species: request.species, ritual: ritual.id, target, schedule: request.schedule, branchId: request.branchId }, this.now().toISOString());
    const { lastRunSeen: _seen, ...saved } = this.store.job(id)!;
    return saved;
  }

  /** Removes the job from CronLord, then forgets it. A job CronLord no longer has is simply forgotten. */
  async remove(id: string): Promise<boolean> {
    if (!this.store.job(id)) return false;
    const client = this.client();
    if (!client) throw new AssignRefused('CronLord is not set up, so the job cannot be removed from it.');
    try {
      await client.deleteJob(id);
    } catch (error) {
      if (!(error instanceof CronLordError) || error.status !== 404) throw error;
    }
    this.store.removeJob(id);
    return true;
  }

  async runNow(id: string): Promise<boolean> {
    if (!this.store.job(id)) return false;
    const client = this.client();
    if (!client) throw new AssignRefused('CronLord is not set up.');
    await client.runNow(id);
    return true;
  }

  /**
   * Reads each job's recent runs and saves the leads of the finished ones it has not read before. One job failing to
   * answer does not stop the others. Returns how many leads were new.
   */
  async sync(): Promise<{ added: number; failed: number }> {
    const client = this.client();
    if (!client) return { added: 0, failed: 0 };
    let added = 0;
    let failed = 0;
    const jobs = this.store.jobs();
    for (const [index, job] of jobs.entries()) {
      try {
        const runs = await client.runs(job.id);
        const finished = runs.filter((run) => runFinished(run.status));
        const seenAt = finished.findIndex((run) => run.id === job.lastRunSeen);
        // Oldest first, so a lead keeps the order it happened in.
        const unread = finished.slice(0, seenAt === -1 ? finished.length : seenAt).reverse();
        let lastRead: string | null = null;
        for (const run of unread) {
          if (run.status === 'success') {
            const { leads } = parseLeads(await client.log(run.id));
            added += this.store.addLeads(job, run.id, leads, iso(run.finishedAt) ?? this.now().toISOString());
          }
          lastRead = run.id;
        }
        const recent: { status: RunStatus; at: string | null }[] = finished.slice(0, 5).map((run) => ({ status: run.status, at: iso(run.finishedAt ?? run.startedAt) }));
        this.store.markRuns(job.id, lastRead, recent);
      } catch (error) {
        failed += 1;
        // No answer at all: the rest would each wait out the same timeout, so they are counted and left for next time.
        if (error instanceof CronLordError && error.status === null) { failed += jobs.length - index - 1; break; }
      }
    }
    return { added, failed };
  }
}
