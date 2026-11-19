// SPDX-License-Identifier: Apache-2.0
//
// What the worker does for companions: hand a ritual to CronLord as a job, put one question to a model through
// CronLord, read the finished runs back, and turn what they printed into leads. It runs only when the page asks.
// There is no timer here, nothing is retried, and a run missed while CronLord was down is never made up for
// (docs/annealer/companions.md).
import {
  cleanParam, composeSoul, enginePaid, fenced, hostInScope, jobIdFor, leadFitsAnswer, opinionsFor, parseLeads, parseList, parseVerdict, runFailed, runFinished,
  SCHEDULE_CRON, shortHash, SPECIES_NAME, VERDICT_LABEL,
  type Ask, type CompanionJob, type CompanionSpecies, type CompanionState, type CronLordStatus, type Lead, type LeadKind, type RunStatus, type Schedule,
} from '../../shared/annealer/companions.js';
import { ANSWER_READ_MAX_BYTES, chatAnswer, CronLordClient, CronLordError, readCronLordConfig, stdoutOf } from './cronlord.js';
import { rituals, type LoadedRitual } from './rituals.js';
import { AnnealerStore, JOBS_KEPT } from './store.js';

/** Why a job or a question was not taken. The page shows `message` as it is. */
export class AssignRefused extends Error {}

export interface AssignRequest { species: CompanionSpecies; ritual: string; params: Record<string, unknown>; schedule: Schedule; branchId: string | null }
export interface AskRequest { species: CompanionSpecies; ritual: string; params: Record<string, unknown>; leadId: string | null }

/** A question nobody answered within this long is given up on, so it cannot sit as "thinking" for ever. */
export const ASK_GIVEN_UP_MS = 20 * 60_000;
/** The most a model may write back. A local server's answer has to fit in what CronLord keeps of a response. */
export const ANSWER_MAX_TOKENS = 1200;
/** Leads handed to a model as material for one question. */
export const MATERIAL_LEADS = 60;
/** What a creature can be asked to read: things found, never things another model wrote about them. */
const MATERIAL_KINDS: readonly LeadKind[] = ['asset', 'change', 'endpoint', 'note'];
/** A schedule line CronLord needs but never uses: these jobs are created switched off and started once by hand. */
const NEVER = '0 0 1 1 *';

/**
 * The Claude CLI with every tool taken away, so text from a target can change what it writes and nothing else. The
 * prompt and the soul arrive as environment variables and are only ever used inside quotes.
 */
export const CLAUDE_COMMAND = `set -eu
CLI="\${ANNEALER_CLAUDE:-claude}"
command -v "$CLI" >/dev/null 2>&1 || { echo "the Claude CLI is not installed on this machine" >&2; exit 127; }
exec "$CLI" -p "$ANNEALER_PROMPT" --model "$ANNEALER_MODEL" --system-prompt "$ANNEALER_SOUL" --strict-mcp-config --tools "" </dev/null
`;

const iso = (seconds: number | null) => (seconds === null ? null : new Date(seconds * 1000).toISOString());
const line = (lead: Lead) => `- [${lead.kind}] ${lead.text}${lead.target ? ` (${lead.target})` : ''}`;

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
    const client = this.client();
    return {
      cronlord: await this.cronlordStatus(),
      souls: this.store.souls(),
      opinions: this.store.opinions(),
      asks: this.store.asks(),
      // Whether Claude is installed where CronLord runs cannot be known from here; a question finds out.
      engines: { none: true, local: !!client?.localModelUrl, claude: client !== null },
      rituals: [...rituals().values()].map((entry) => entry.ritual),
      jobs: this.store.jobs().map(({ lastRunSeen: _seen, ...job }): CompanionJob => job),
      leads: this.store.leads(),
      ledger: this.store.ledger(),
      scope: this.store.scope(),
    };
  }

  private ritualFor(id: string, species: CompanionSpecies, runner: LoadedRitual['job']['runner']): LoadedRitual {
    const entry = rituals().get(id);
    if (!entry) throw new AssignRefused('That ritual does not exist.');
    if (entry.ritual.owner !== species) throw new AssignRefused('That ritual belongs to another creature.');
    if (entry.job.runner !== runner) throw new AssignRefused(runner === 'shell' ? 'That ritual is a question to a model, not a job on a schedule.' : 'That ritual is a job on a schedule, not a question.');
    return entry;
  }

  /** Each parameter checked. A ritual that sends requests to its target needs the host on the scope list. */
  private params(entry: LoadedRitual, given: Record<string, unknown>): { values: Record<string, string>; target: string } {
    const values: Record<string, string> = {};
    let target = '';
    const patterns = this.store.scope().map((scope) => scope.pattern);
    for (const param of entry.ritual.params) {
      const raw = given[param.name];
      if (param.optional && (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim()))) continue;
      const cleaned = cleanParam(param.type, raw);
      if (!cleaned) {
        throw new AssignRefused(param.type === 'domain' ? `${param.label}: enter a plain domain, such as example.com.`
          : param.type === 'url' ? `${param.label}: enter a full http or https address on a named host.` : `${param.label}: write something here.`);
      }
      if (entry.ritual.reach === 'touch' && !hostInScope(cleaned.host, patterns)) throw new AssignRefused(`${cleaned.host} is not on the scope list. Add it there first; this ritual sends requests to it.`);
      values[param.name] = cleaned.value;
      if (param.type !== 'text') target ||= cleaned.value;
    }
    return { values, target };
  }

  /** Checks the parameters, creates the job in CronLord, and only then remembers it. */
  async assign(request: AssignRequest): Promise<CompanionJob> {
    const entry = this.ritualFor(request.ritual, request.species, 'shell');
    if (entry.job.runner !== 'shell') throw new AssignRefused('That ritual is not a shell job.');
    const { values: env, target } = this.params(entry, request.params);
    const client = this.client();
    if (!client) throw new AssignRefused('CronLord is not set up, so there is nothing to run the job.');
    const id = jobIdFor(request.species, entry.ritual.id, env);
    if (!this.store.job(id) && this.store.jobs().length >= JOBS_KEPT) throw new AssignRefused(`There are already ${JOBS_KEPT} jobs. Remove one first.`);
    await client.upsertJob({
      id, kind: 'shell', enabled: true, name: `${entry.ritual.name}: ${target}`.slice(0, 120), description: `Annealer, ${request.species}. ${entry.ritual.description}`.slice(0, 300),
      schedule: SCHEDULE_CRON[request.schedule], command: entry.job.command, env: { ...env, ANNEALER_JOB: id }, timeoutSec: entry.job.timeoutSec,
    });
    this.store.saveJob({ id, species: request.species, ritual: entry.ritual.id, target, schedule: request.schedule, branchId: request.branchId }, this.now().toISOString());
    const { lastRunSeen: _seen, ...saved } = this.store.job(id)!;
    return saved;
  }

  /**
   * Puts one question to the creature's model. The soul, the task and the material are fixed here, before anything
   * is sent; the model gets no tools, and what it writes back is kept as text. Asked once: if it fails, it has failed.
   */
  async ask(request: AskRequest): Promise<Ask> {
    const entry = this.ritualFor(request.ritual, request.species, 'model');
    if (entry.job.runner !== 'model') throw new AssignRefused('That ritual is not a question.');
    const { ritual, job } = entry;
    const name = SPECIES_NAME[request.species];
    const soul = this.store.souls()[request.species];
    if (soul.engine === 'none') throw new AssignRefused(`${soul.name || name} has no model to think with. Choose one under Soul.`);
    if (enginePaid(soul.engine) && !soul.paidRituals.includes(ritual.id)) throw new AssignRefused(`${ritual.name} is not allowed to spend on ${soul.engine === 'claude' ? 'Claude' : 'a paid model'} yet. Allow it under Soul.`);
    const now = this.now();
    if (this.store.asksOn(request.species, now.toISOString().slice(0, 10)) >= soul.runsPerDay) throw new AssignRefused(`${soul.name || name} has been asked ${soul.runsPerDay} times today, which is its limit. Raise it under Soul or wait until tomorrow.`);

    const { values, target: paramTarget } = this.params(entry, request.params);
    let target = paramTarget;
    let material: string;
    let sources: string[];
    if (ritual.reads === 'target-leads') {
      const kept = this.store.keptAbout(target, MATERIAL_KINDS, MATERIAL_LEADS);
      if (kept.length === 0) throw new AssignRefused(`Nothing is kept about ${target} yet. Keep some leads from a job first; they are what ${soul.name || name} reads.`);
      material = kept.map(line).join('\n');
      sources = kept.map((lead) => lead.id);
    } else if (ritual.reads === 'one-lead') {
      const lead = request.leadId === null ? null : this.store.lead(request.leadId);
      if (!lead) throw new AssignRefused('That lead does not exist.');
      if (!leadFitsAnswer(job.answer, lead)) throw new AssignRefused(job.answer === 'document' ? 'A report is drafted from a lead you marked confirmed.' : 'Only a lead you kept or confirmed can be challenged.');
      const built = this.store.ancestors(lead.id);
      material = [`Finding (${lead.kind}): ${lead.text}`, lead.detail, built.length > 0 ? `Built from:\n${built.map(line).join('\n')}` : ''].filter(Boolean).join('\n');
      target = lead.target;
      sources = [lead.id];
    } else {
      material = '';
      sources = [];
    }
    if (values.NOTES) material = [material, `Operator's notes:\n${values.NOTES}`].filter(Boolean).join('\n\n');

    const client = this.client();
    if (!client) throw new AssignRefused('CronLord is not set up, so there is nothing to carry the question.');
    const system = composeSoul(request.species, name, soul, opinionsFor(this.store.opinions(), request.species, target));
    const prompt = `${job.task}\n\nTarget: ${target || 'not given'}\n\n${fenced(material)}`;
    // The same question may be put twice; each time is its own job and its own count against the day.
    let id = '';
    do { id = `annealer-${request.species}-${ritual.id}-${shortHash(`${prompt}\n${now.toISOString()}\n${Math.random()}`)}`; } while (this.store.hasAsk(id));
    const about = { id, enabled: false, schedule: NEVER, name: `${name} · ${ritual.name}: ${target}`.slice(0, 120), description: `Annealer, one question to ${request.species}. Removed once it is read.`, timeoutSec: job.timeoutSec };
    if (soul.engine === 'local') {
      if (!client.localModelUrl) throw new AssignRefused('The worker has no address for a local model. Add localModelUrl to its CronLord settings file.');
      if (!soul.model) throw new AssignRefused(`Say which local model ${soul.name || name} uses, under Soul.`);
      await client.upsertJob({
        ...about, kind: 'http', env: {},
        command: JSON.stringify({
          method: 'POST', url: `${client.localModelUrl}/chat/completions`, headers: { 'Content-Type': 'application/json' }, expect_status: 200, follow: false,
          body: JSON.stringify({ model: soul.model, stream: false, temperature: 0.3, max_tokens: ANSWER_MAX_TOKENS, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
        }),
      });
    } else {
      await client.upsertJob({ ...about, kind: 'shell', command: CLAUDE_COMMAND, env: { ANNEALER_PROMPT: prompt, ANNEALER_SOUL: system, ANNEALER_MODEL: soul.model } });
    }
    // Remembered before it is started, so a question that did start is always counted against the day.
    this.store.addAsk({ id, species: request.species, ritual: ritual.id, target, engine: soul.engine, sources }, now.toISOString());
    try {
      await client.runNow(id);
    } catch (error) {
      this.store.settleAsk(id, 'failed', 'CronLord did not start it.');
      await client.deleteJob(id).catch(() => {});
      throw error;
    }
    return this.store.asks().find((ask) => ask.id === id)!;
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

  /** Turns one answer into leads, in the shape its ritual asked for. */
  private answerLeads(entry: LoadedRitual, answer: string): { text: string; detail: string }[] {
    if (entry.job.runner !== 'model') return [];
    const lines = answer.split('\n').map((text) => text.trim()).filter(Boolean);
    if (entry.job.answer === 'list') {
      const items = parseList(answer);
      return items.length > 0 ? items : [{ text: lines[0] ?? '', detail: answer }];
    }
    if (entry.job.answer === 'verdict') {
      const verdict = parseVerdict(answer);
      const first = parseList(answer, 1)[0]?.text ?? '';
      return [{ text: first ? `${VERDICT_LABEL[verdict]}: ${first}` : VERDICT_LABEL[verdict], detail: answer }];
    }
    return [{ text: (lines[0] ?? '').replace(/^#+\s*/, ''), detail: lines.slice(1).join('\n') }];
  }

  /** Reads the answers to questions that are still waiting. Each is settled once, and its job is removed from CronLord. */
  private async readAsks(client: CronLordClient): Promise<{ added: number; failed: number }> {
    let added = 0;
    let failed = 0;
    for (const ask of this.store.asks('waiting')) {
      const entry = rituals().get(ask.ritual);
      const settle = async (state: 'answered' | 'failed', note: string) => {
        this.store.settleAsk(ask.id, state, note);
        await client.deleteJob(ask.id).catch(() => {});
      };
      try {
        const run = (await client.runs(ask.id, 5)).find((candidate) => runFinished(candidate.status));
        if (!run) {
          if (this.now().getTime() - Date.parse(ask.createdAt) > ASK_GIVEN_UP_MS) await settle('failed', 'No run finished in time.');
          continue;
        }
        if (!entry || entry.job.runner !== 'model') { await settle('failed', 'Its ritual is not in this build.'); continue; }
        if (run.status !== 'success') { await settle('failed', runFailed(run.status) ? 'The run failed. Its log is in CronLord until the job is removed.' : 'The run was stopped.'); continue; }
        const log = await client.log(run.id, ANSWER_READ_MAX_BYTES);
        const answer = ask.engine === 'local' ? chatAnswer(log) : stdoutOf(log).trim() || null;
        if (!answer) { await settle('failed', 'The answer could not be read. It may have been longer than CronLord keeps.'); continue; }
        const ids = this.store.addModelLeads(ask.species, run.id, ask.target, entry.ritual.lead, this.answerLeads(entry, answer), this.store.askSources(ask.id), iso(run.finishedAt) ?? this.now().toISOString());
        added += ids.length;
        await settle('answered', ids.length === 1 ? '1 lead' : `${ids.length} leads`);
      } catch (error) {
        failed += 1;
        if (error instanceof CronLordError && error.status === null) break;
      }
    }
    return { added, failed };
  }

  /**
   * Reads each job's recent runs and saves the leads of the finished ones it has not read before, then reads the
   * answers to waiting questions. One job failing to answer does not stop the others. Returns how many leads were new.
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
        if (error instanceof CronLordError && error.status === null) return { added, failed: failed + jobs.length - index - 1 };
      }
    }
    const asks = await this.readAsks(client);
    return { added: added + asks.added, failed: failed + asks.failed };
  }
}
