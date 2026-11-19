# Annealer companions

Design for turning the corner pet into a team of working creatures. Nothing here is built yet.
The build order is at the end; the first phase fits a weekend and spends nothing on inference.

Read with [the build plan](build-plan.md). Its ground rules still hold: add on, never replace;
nothing invented; one definition per state; stay mergeable; leave capture alone.

## Decisions that shape everything else

1. **CronLord is the scheduler.** Annealer does not get its own. The worker becomes a CronLord
   client plus a ledger. This replaces the "quests in the worker" half of build-plan step 6 and
   keeps the upstream rule against adding another queue.
2. **A creature is a row, a soul and a set of CronLord jobs.** Its level comes from what happened
   to its output, never from how often it ran.
3. **Two levels, kept apart.** The Grove level is yours and comes from recorded work, as today.
   A creature's level is its own and comes from its leads. Neither feeds the other.
4. **Annealer data lives in its own file**, `<data dir>/annealer/annealer.db`, with its own
   migration table. `claude-mem.db` is opened read-only. Upstream owns that schema and its
   migration numbers; sharing it would break every merge.
5. **Creatures never submit, never send traffic at a target without a scope match, and never
   spend money without a per-creature, per-job-kind opt-in.**

## What I read in CronLord before designing against it

Checked in `kdairatchi/CronLord` at `d1e7268` and `kdairatchi/CronLord-Grimoire`. Read, not run.

| Assumed | What the source says | Consequence |
| --- | --- | --- |
| POST the ritual TOML to `/api/jobs` | `/api/jobs` takes JSON. TOML is the file format for `cronlord.toml`, the Grimoire and GitHub sync | Annealer keeps rituals as TOML and converts the first `[[jobs]]` block to JSON on assign |
| Jobs can be tagged with a creature ID | No tag field. `labels` selects remote workers, so it cannot be reused | Ownership lives in `annealer.db`. Job IDs are `annealer-<creature>-<slug>` and `category = "annealer"` so they are also findable in CronLord's own UI |
| Output comes back through the API | Run rows come from `GET /api/runs?job_id=`. The log is only available as an SSE dump at `/api/runs/:id/log`, with no size limit | The worker reads the stream and keeps at most 16 KB |
| | `webhook_url` posts a JSON body when a run finishes | Optional push later. Polling works whichever side of the VPS each program is on, so it is the default |
| | `kind = "claude"` runs `claude -p` on the scheduler host only, never on a remote worker | Claude jobs run where CronLord runs. Pick that host on purpose |
| | The scheduler appears to compute the next fire from now, so a run missed while it was down is not replayed | Matches the rule here: a missed run is skipped, never backfilled |
| | `retry_count` defaults to 0 | Annealer sets it to 0 explicitly on every job that can spend tokens |

### Fix these in CronLord first

Annealer will hand CronLord shell commands, so its front door matters more than before.

1. **Any web page can create a job.** With no `admin_token`, `POST /api/jobs` is open, and the
   body is parsed as JSON whatever its content type, so a page you visit can send it as a plain
   form-style request with no preflight. A shell job that fires within a minute is code execution.
2. **The HTML form routes have the same hole even with a token.** `POST /jobs` checks a session
   only when GitHub login is configured. With `admin_token` alone it accepts anyone, and there is
   no CSRF token or Origin check.
3. **Grimoire's Claude rituals run with `--dangerously-skip-permissions`.** Point one at a
   finding, a JS bundle or a scraped page and whatever that text says runs with your shell.
4. **Job `env` is stored in plain text**, as the docs already say. No keys go there.

Suggested fixes: refuse writes without a token or session, require `application/json` on
`/api/*`, check `Origin` and `Host` on every write, and bind to loopback or a tailnet address.
Until then, set `admin_token`, configure GitHub login, and keep the port off the public internet.

## 1. Species catalog

Ten species. The three that exist keep their sprites and unlock levels and gain a job.
Every sprite is 12×12 in the creature's palette. Unlocks are deeds, so the roster reflects the
kind of work you actually do.

| # | Species | Sprite | Role | Unlocks when |
| --- | --- | --- | --- | --- |
| 1 | **Cinder** | Ember with two eyes, flickering crown (exists) | Hypothesis smith | Start |
| 2 | **Sprout** | Seedling, two leaves (exists) | Keeper | Grove level 2 |
| 3 | **Bolt** | Boxy machine, antenna (exists) | Watcher | Grove level 4 |
| 4 | **Moth** | Grey wings, two feathered antennae, pale eye-spots | Scout | First focus area with a named target |
| 5 | **Weevil** | Round beetle, long snout, six one-pixel legs | Code reader | First JS bundle or repo fed to any creature |
| 6 | **Rime** | Ice shard with a single slit eye, frost pixels shed below | Skeptic | First shipped request |
| 7 | **Whorl** | Snail, shell drawn as three stacked rings | Archivist | 25 recorded sessions |
| 8 | **Heron** | Tall, one leg, long beak pointing down | Advisory watcher | First advisory lead kept |
| 9 | **Magpie** | Black and white, one bright pixel in the beak | Footprint collector | Three targets on the tree |
| 10 | **Quill** | Small porcupine, spines double as pen strokes | Report writer | First finding marked validated |

Each creature below lists its ability at level 1, the second at level 6, the two forms it can
take at level 10, the deed evolution also needs, and its soul fragment.

**Cinder, hypothesis smith.** Turns recon into ranked attack hypotheses, each with the cheapest
test that would kill it. At 6: reforges a hypothesis Rime killed into its nearest live neighbour.
Evolves into *Crucible* (takes one confirmed bug and derives the variants worth testing on the
same target) or *Bellows* (takes one confirmed bug and finds the other targets where it could
repeat). Deed: 5 hypotheses confirmed.
> You propose attacks. Rank them, commit to the order, and give each one the single cheapest test that would prove it wrong. Dead hypotheses are normal; vague ones are not.

**Sprout, keeper.** Finds requests with no next step, reminders that are due and work going
stale. This is today's tune-up, and it needs no model. At 6: a morning brief built from recorded
state. Evolves into *Canopy* (weekly retro: what shipped, what rotted, what repeated) or
*Taproot* (watches My Rules and says which ones recorded work keeps breaking). Deed: 20 nudges
that ended in a recorded next step.
> You keep things from being forgotten. One ask at a time, the smallest one that unblocks the most. Never invent a task; point at one that is already recorded.

**Bolt, watcher.** Checks endpoints, bundles and ports on a schedule and reports differences.
Shell only. At 6: summarises a diff with a local model. Evolves into *Dynamo* (correlates one
change across targets, such as a shared vendor bundle) or *Relay* (keeps watching from a second
host and reports when the two disagree). Deed: 10 change leads kept.
> You report changes. Timestamp, what changed, before and after. No adjectives and no guesses about why.

**Moth, scout.** Passive recon: new subdomains, certificate logs, scope changes on the program
page. At 6: checks every new asset against scope before any other creature may use it. Evolves
into *Luna* (ranks new assets by how unlike the known estate they are) or *Sphinx* (tracks what
disappeared, which is where forgotten hosts turn up). Deed: 3 assets it found ended up in a
shipped finding.
> You find surface. Report the asset, where you saw it, when, and whether it is in scope. If scope is unclear, say unclear and stop.

**Weevil, code reader.** Reads JS bundles and repos for secrets, sinks, hidden routes and
source-to-sink paths. At 6: compares two versions of a bundle and reports only what is new.
Evolves into *Borer* (follows one value across files to its sink) or *Deathwatch* (reads patches
and advisories and says what the fix reveals). Deed: 5 code leads confirmed.
> You read code. Every claim carries a file and a line and quotes the code. If you did not see the line, you do not make the claim.

**Rime, skeptic.** Tries to disprove a finding: what would make it a false positive, a duplicate
or out of scope, and what evidence is missing. At 6: checks severity against the program's policy
and checks past work for duplicates. Evolves into *Verdict* (a pre-submission gate with a written
pass or fail) or *Hoarfrost* (re-tests old findings to see if they still reproduce). Deed: 10
kills you agreed with and a kill accuracy of 70% or better.
> You try to break findings before a triager does. Ask for the reproducing request. List what would make this wrong. Never congratulate, and say plainly when you cannot break it.

**Whorl, archivist.** Surfaces past work that bears on what you are doing now, using claude-mem's
existing search. It adds no index of its own. At 6: proposes opinions with their evidence for you
to confirm. Evolves into *Ammonite* (patterns across targets: which bug class paid on which
stack) or *Nautilus* (reconstructs how a past finding was reached, step by step). Deed: 10
surfaced memories that were used.
> You remember. Cite the session and the date for everything. When there is no record, say "no record" and nothing more.

**Heron, advisory watcher.** Matches new CVEs, releases and disclosed reports to the stacks on
your tree. At 6: writes a patch-diff brief for an advisory. Evolves into *Bittern* (finds which
of your targets still run the affected version) or *Egret* (tracks which advisories turned into
public exploits). Deed: 3 advisory leads that led to a request.
> You watch the stream and strike rarely. Report an advisory only when it matches a stack on the tree, and name the match.

**Magpie, footprint collector.** Public footprint of in-scope organisations: acquisitions, public
repos, stack hints in job posts, disclosed reports. At 6: links a company's public repos to its
running assets. Evolves into *Bowerbird* (assembles a target dossier) or *Jay* (watches a
footprint for changes). Deed: 5 footprint leads kept. Limits that are not configurable: public
sources only, organisations only, no contact with anyone, no pretexting.
> You collect what an organisation has left in public. One source link per item. People are not targets; you never contact anyone.

**Quill, report writer.** Drafts a report from a validated finding using recorded evidence only.
At 6: fits the draft to a platform's template and writes the severity rationale. Evolves into
*Scribe* (drafts replies to triage questions from the evidence) or *Ledger* (keeps a submission
log and its outcomes). Deed: 3 drafts shipped.
> You write reports a triager can reproduce in five minutes. Plain words, numbered steps, no adjectives. Mark every step you could not verify from the evidence as [unverified].

A team is three active creatures. Cinder, Rime and Quill cover propose, break and write. Moth,
Weevil and Cinder cover find, read and propose. The others stay on the tree at rest.

## 2. Soul architecture

A soul is assembled when a job is assigned, by a pure function, from four layers in a fixed
order under a token budget:

```ts
composeSoul(species, overrides, opinions, job): string
```

| Layer | Source | Who can change it |
| --- | --- | --- |
| Species fragment | Shipped in code, versioned | Nobody at run time |
| Overrides | Role text, tone, catchphrase on the `companion` row | You |
| Opinions | Top few held opinions matching the job's target, stack or bug class | Born from outcomes; you confirm, edit or retire them |
| Task context | claude-mem's existing search | Upstream |

**Opinions** are the only learned part. An opinion has a scope (target, stack or bug class), a
sentence, the lead that is its evidence, and a status. It is created in two ways: a lead resolves
(the SSRF attempt on a target was marked a dead end), or you state one. A creature may propose
an opinion; it does not hold until you confirm it. A contradicted opinion is retired, never
edited in place, so the history stays honest. The memory view lists every opinion a creature
holds and lets you delete any of them.

**What a soul never stores:** a judgment about you. No personality notes, no mood history.

### Mood

One list, one word table, one pure function.

```ts
const COMPANION_MOODS = ['needs-you', 'celebrating', 'working', 'resting',
  'on-a-roll', 'wary', 'stuck', 'night-watch', 'unheard', 'concerned'] as const
```

| Mood | Input |
| --- | --- |
| needs-you, celebrating, working, resting | As today |
| on-a-roll | Three or more leads in a row kept or confirmed |
| wary | Three or more in a row dismissed or wrong |
| stuck | Friction signal (below) |
| night-watch | Local hour between 23 and 5 while work is being recorded |
| unheard | Its last five leads were neither kept nor dismissed |
| concerned | Its last two CronLord runs failed or timed out |

Mood changes voice, sprite and weather. It never changes what a job does or what XP is worth.

**Friction** is measured from things that can be checked: the same command failing three times
in twenty minutes, or a session past three hours with no new work product. I recommend against
reading your messages for frustration. That is a guess about your state of mind, it would be
wrong often, and stored it becomes a fact about you that nobody verified. The signal is held in
memory and not written down.

## 3. Jobs

A job is a Grimoire ritual assigned to a creature. The ritual's TOML is the definition.
Annealer adds four fields of its own, kept in `annealer.db` because CronLord has nowhere for them:

| Field | Values | Meaning |
| --- | --- | --- |
| `reach` | `read`, `touch`, `write` | `read` uses public sources. `touch` sends traffic to a target. `write` changes files outside the job's own folder |
| `gate` | `auto`, `ask` | Whether a run's leads appear directly or wait for you |
| `spends` | `nothing`, `local`, `paid` | Shell and local models are free. `kind = "claude"` and hosted APIs are paid |
| `output` | `trail`, `request`, `file` | Where leads go |

### Assign flow

1. You pick a ritual in the creature's panel and fill its parameters (for example `TARGET`).
2. The worker validates: target matches the scope list if `reach` is `touch`; `paid` is opted in
   for this creature and this ritual; today's budget is not spent.
3. The worker builds the job JSON. The `command` is copied from the ritual verbatim. Parameters
   go in `env`. Nothing you or a model typed is ever spliced into a shell command.
4. `POST /api/jobs` with `id = annealer-<creature>-<slug>`, `category = "annealer"`,
   `retry_count = 0`, a `timeout_sec`, and `enabled = true`.
5. The worker polls `GET /api/runs?job_id=` for jobs it owns, remembers the last run it saw, and
   for each new finished run reads up to 16 KB of the log.
6. Lines of the form `ANNEALER-LEAD {json}` become leads. Everything else is the output preview.
   A run with no lead line updates status and writes nothing, so "no change" stays quiet.

The worker holds the CronLord URL and token in a settings file readable only by you. The page
talks to the worker, never to CronLord, and cannot change the URL.

### Species to rituals

| Creature | Existing rituals | New rituals to write |
| --- | --- | --- |
| Moth | `subdomain-monitor`, a generalised `wildcard-sub-delta` | `scope-page-diff` |
| Bolt | `http-uptime-check`, `port-baseline-diff`, `ssl-expiry-watch`, a generalised `js-endpoint-diff` | |
| Heron | `rss-to-jsonl`, `github-release-watch`, `nuclei-template-update`, `h1-disclosed-sweep` | `stack-match` |
| Weevil | `gitleaks-scan`, `claude-repo-audit`, `ollama-local-summary` | `bundle-read` |
| Whorl | `claude-vault-summary`, `daily-activity-digest` | |
| Cinder | `llm-cli-any` | `hypotheses-from-recon` |
| Rime | | `finding-validator` |
| Quill | `caido-project-export` | `report-draft` |
| Magpie | `h1-disclosed-sweep` | `org-footprint` |
| Sprout | `ntfy-habit-reminder` | None needed; its job is a pure function |

New rituals are ordinary Grimoire files in `rituals/annealer/` and can be contributed back.

### Rules for jobs that call a model

- `kind = "claude"`, not a shell line that calls `claude`. The prompt is then one argument and
  never passes through a shell.
- No `--dangerously-skip-permissions` and no `bypassPermissions`. A job that reads target content
  gets no tools at all; its output is text.
- Target content goes in as a file path in `env`, and the soul tells the creature that file is
  data. Handoffs between creatures pass structured lead fields, not free text.
- Claude models are named by alias (`haiku`, `sonnet`, `opus`). Local model names are whatever
  you typed. No dated ID is a default anywhere.
- A run that fails on quota or login is recorded as failed and dropped. Nothing is queued to try
  again, and a later success does not trigger a catch-up.

### Tiers

```ts
pickTier(job, setup): 'session' | 'cronlord' | 'cloud'
```

| Tier | Chosen when | Cost |
| --- | --- | --- |
| Session cron | The job only matters while this session is open, or needs what is in the session | None |
| CronLord | Everything else. The default | Free for shell and local models; tokens for Claude |
| Cloud routine | The job must run while every machine that hosts CronLord is off, and you allowed cloud | Tokens every run |

Two limits to design around. Session crons and cloud routines are created by Claude Code, not by
the worker, so Annealer ships a skill that creates them and the panel can only show them once
their output arrives. A cloud routine cannot reach a CronLord on your LAN or loopback, so its
result needs somewhere to land, such as a private repo CronLord already syncs. With CronLord on
the always-on VPS, the cloud tier is rarely the cheapest answer to anything.

## 4. Leveling

The curve is the Grove's own function, reused: `levelFloor(n) = 50 · n · (n − 1) / 2`.

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| XP | 0 | 50 | 150 | 300 | 500 | 750 | 1,050 | 1,400 | 1,800 | 2,250 |

XP is a ledger of events. Level is derived from the sum and never stored.

| Event | XP | Who gets it |
| --- | --- | --- |
| Lead kept | +5 | Its author |
| Lead became a request | +15 | Its author |
| Hypothesis or code lead confirmed by you | +40 | Its author |
| Finding shipped | +60 | Every creature in the lead chain, up to three |
| Program accepted the report | +100 | Same |
| Rime's kill, and you agreed | +25 | Rime |
| Prediction right / wrong | +10 / −10, doubled when it said "high" | Its author |
| Lead dismissed as noise | −2 | Its author |
| Lead marked false positive | −8 | Its author |
| Report closed as not applicable | −30 | Rime if it passed it, Quill if it drafted it |
| Report closed as duplicate | −10 | Rime, if its duplicate check passed it |
| Rime killed a finding that was later accepted | −40 | Rime |
| Runs, tokens, messages, petting, advice you ignored | 0 | |

- A hypothesis that dies costs Cinder nothing. Proposing is its job; only false confidence costs.
- Losses are capped at 60 a day per creature. XP cannot go below zero. A level can drop; an
  evolution cannot be undone.
- **Chain bonus:** when the leads behind a shipped finding came from two or more creatures, each
  gets 25% more. It is computed from the links between leads, so equipping a team earns nothing
  by itself.
- **Evolution** needs level 10 and the species deed. You choose one of the two forms.
- **Tempering** is the prestige step. After evolving, every further 1,000 XP earns one temper, up
  to three. Each temper picks one narrow trait, such as a stack, a bug class or a platform, that
  gets its matching opinions loaded first.

Bounty amounts are not recorded. Accepted is enough to score on.

## 5. The world

The Grove is already the map. The tree gives every limb as a segment, so a creature's position
is a point on one.

**Posts.** Moth at branch tips, where new assets appear as buds. Weevil on twigs. Cinder at the
forks. Rime at the base of the trunk, where everything bound for a report passes. Whorl in the
roots. Bolt on the highest limb. Heron at the pool below. Magpie in a nest on the branch of its
target. Quill beside the trunk. Sprout walks to whichever twig lacks a next step.

**Handoffs.** When one creature's lead becomes another's input, a one-pixel parcel travels the
limbs between them. It is drawn only when the link exists in the ledger.

**Weather.** Night by your local hour. Rain while the friction signal is up. Clear light for the
rest of the day after a ship. Frost on a twig Rime killed. All of it follows the calm motion
setting, and none of it asks for anything.

**Interactions.**

| Action | What it does |
| --- | --- |
| Pet | A reaction frame. Worth nothing, and the panel says so |
| Feed | Drop a file or URL on a creature to open its job with that input. Shows cost before it runs |
| Spar | Replays one of your resolved findings with the outcome hidden. The creature predicts and is scored against what happened. Capped at 20 XP a day |
| Trial | Cinder argues a finding is real, Rime argues it is not. Three rounds, each claim must cite evidence, you rule. The ruling writes opinions and XP. Token cost is shown before it starts |
| Badges | Derived from the ledger and hung on the branch where they were earned |

## 6. Settings

```ts
interface CompanionSettings {
  name: string                    // up to 24 characters
  catchphrase: string             // up to 80
  species: Species
  palette: Palette
  form: 'base' | EvolvedForm      // chosen once at level 10
  tempers: TemperTrait[]          // up to 3
  active: boolean                 // one of the three on duty
  soul: { preset: SoulPreset | null; role: string; tone: Tone }   // role up to 600 characters
  engine: { kind: Engine; model: string }       // 'none' | 'claude' | 'ollama' | 'lm-studio' | 'codex'
  paidRituals: string[]           // rituals allowed to spend, one by one
  budget: { tokensPerDay: number; runsPerDay: number; secondsPerRun: number }
  autonomy: 'off' | 'ask' | 'auto-read'         // 'touch' and 'write' always ask
  jobs: { ritual: string; schedule: string; timezone: string; params: Record<string, string>;
          gate: Gate; output: Output; enabled: boolean }[]
}
```

Shared across creatures: the CronLord URL and token (file only), the scope list, whether cloud
routines are allowed, weather on or off, and the friction signal on or off.

The panel also has a **memory view** (opinions, with delete), a **ledger view** (every XP event
and the lead behind it) and **export**.

**Export** writes `<name>.companion.json` holding species, name, catchphrase, palette, form,
tempers and soul text. It leaves out opinions, targets, the ledger, engine, budgets, jobs and
autonomy. **Import** treats the file as a prompt written by a stranger: it shows the soul text
for you to read, caps its length, and the creature arrives at level 1 with no jobs and autonomy
off.

## 7. Data model

`<data dir>/annealer/annealer.db`. CronLord owns jobs and runs; Annealer stores only what links
them to creatures.

```sql
CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE companion (
  id TEXT PRIMARY KEY, species TEXT NOT NULL, name TEXT NOT NULL, catchphrase TEXT NOT NULL DEFAULT '',
  palette TEXT NOT NULL, form TEXT NOT NULL DEFAULT 'base', tempers TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 0,
  soul_preset TEXT, soul_role TEXT NOT NULL DEFAULT '', soul_tone TEXT NOT NULL DEFAULT 'plain',
  engine TEXT NOT NULL DEFAULT 'none', model TEXT NOT NULL DEFAULT '',
  paid_rituals TEXT NOT NULL DEFAULT '[]',
  tokens_per_day INTEGER NOT NULL DEFAULT 0, runs_per_day INTEGER NOT NULL DEFAULT 24,
  seconds_per_run INTEGER NOT NULL DEFAULT 600,
  autonomy TEXT NOT NULL DEFAULT 'ask', created_at TEXT NOT NULL
);

CREATE TABLE companion_job (
  cronlord_job_id TEXT PRIMARY KEY,            -- annealer-<creature>-<slug>
  companion_id TEXT NOT NULL REFERENCES companion(id),
  ritual TEXT NOT NULL, reach TEXT NOT NULL, gate TEXT NOT NULL, spends TEXT NOT NULL,
  output TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'cronlord',
  last_run_seen TEXT, last_status TEXT, last_seen_at TEXT
);

CREATE TABLE lead (
  id TEXT PRIMARY KEY, companion_id TEXT NOT NULL REFERENCES companion(id),
  cronlord_run_id TEXT, parent_lead_id TEXT REFERENCES lead(id),
  kind TEXT NOT NULL, body TEXT NOT NULL, target TEXT, source_url TEXT,
  confidence TEXT, status TEXT NOT NULL DEFAULT 'new', request_id TEXT,
  created_at TEXT NOT NULL, resolved_at TEXT
);

CREATE TABLE xp_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT, companion_id TEXT NOT NULL REFERENCES companion(id),
  at TEXT NOT NULL, kind TEXT NOT NULL, points INTEGER NOT NULL, lead_id TEXT REFERENCES lead(id)
);

CREATE TABLE opinion (
  id TEXT PRIMARY KEY, companion_id TEXT NOT NULL REFERENCES companion(id),
  scope_kind TEXT NOT NULL, scope_value TEXT NOT NULL, body TEXT NOT NULL,
  evidence_lead_id TEXT REFERENCES lead(id), status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL, confirmed_at TEXT, retired_at TEXT
);

CREATE TABLE scope (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, pattern TEXT NOT NULL,
  in_scope INTEGER NOT NULL, source_url TEXT, checked_at TEXT NOT NULL
);

CREATE TABLE trail_note (                      -- moved out of localStorage
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
  link TEXT, due_at TEXT, done INTEGER NOT NULL DEFAULT 0,
  companion_id TEXT REFERENCES companion(id), lead_id TEXT REFERENCES lead(id), created_at TEXT NOT NULL
);
```

Every status and kind column has one `as const` list in code with a word table beside it. Level,
badges, streaks and mood are derived and have no column. The one-time move of trail notes from
the browser is an explicit button, not something that runs at startup.

## 8. Build order

| Phase | What ships | Inference |
| --- | --- | --- |
| **1. A weekend** | `annealer.db`; trail notes in the worker; CronLord client (settings file, list, assign, poll, read log); a jobs panel on the creature; Bolt and Moth assignable with `http-uptime-check` and `subdomain-monitor`; leads you can keep or dismiss; the XP ledger; `concerned` mood | None |
| 2. Souls | `composeSoul`, overrides, engine setting, local-model rituals for Weevil and Cinder, memory view, opinions you confirm | Local only |
| 3. Outcomes | Confirm, ship and program outcomes on leads; predictions; XP loss; Rime and `finding-validator`; Quill and `report-draft`; paid opt-in and budgets | Paid, opt-in |
| 4. The world | Roster of three, posts on the tree, parcels, weather, the remaining moods, evolution sprites | None |
| 5. Reach | The skill for session crons and cloud routines, export and import, tempering, spar and trial | Mixed |

Before phase 1: close the two CronLord write holes above.

Every phase keeps the existing checks: pure functions under `node --test`, the root typecheck,
the bundle build, and a test that a CronLord outage cannot cause a later, unrequested paid run.

## Open questions

- Where CronLord runs. On the VPS it never sleeps but `claude` jobs then need a logged-in CLI
  there. On the workstation it sleeps when you do.
- Whether the VPS and the workstation each get a claude-mem worker, and if so which one holds
  `annealer.db`.
- Whether program outcomes are entered by hand or read from a platform. By hand first.
