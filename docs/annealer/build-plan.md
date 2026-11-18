# Annealer build plan

Annealer is a fork of claude-mem. claude-mem already captures the work, sorts it into focus areas, learns rules and
shows it all live in My Work. Annealer does not rebuild any of that. It adds the parts that make the work feel like
something you grow: a tree you can climb into, a companion that reacts to what your agents are doing, a record of
what each session was actually told, things that run on a schedule so nothing is forgotten, and a look you can make
your own.

## Ground rules

1. **Add on, never replace.** New views read the same work model My Work reads. If upstream already has it, link to it.
2. **Nothing invented.** Every number, level and animation comes from a record the worker saved. Time spent and
   tool calls earn nothing.
3. **One definition per state.** A new mood, palette or theme is one list plus `Record<State, …>` tables, so a missing
   case fails the typecheck (see `docs/architecture/state-machines.md`).
4. **Stay mergeable.** New code lives in its own folders (`src/ui/my-work/src/growth`, `companion`, …) and touches
   upstream files as little as possible, so pulling from claude-mem stays cheap.
5. **Leave capture alone.** Nothing here changes hooks, queues, retries or the observer
   (`docs/architecture/observer-lifecycle.md`). A step that writes a new record says so and adds no paid inference.

## What claude-mem already ships (do not rebuild)

Checked against the source on 2026-11-18.

| Already there | Where |
| --- | --- |
| Capture, memory, search | hooks, worker, SQLite, Chroma |
| Context built for each session under a token budget | `src/services/context` (`ContextBuilder`, `ContextBudget`) |
| A preview of the context a project would get, and its settings | classic viewer, Context settings (`/api/context/preview`) |
| Per-folder `CLAUDE.md` context files | `docs/public/usage/folder-context.mdx` |
| Session list and session detail | classic viewer at `/viewer` |
| Live requests, progress, hand-offs, deliverables | My Work |
| Focus areas with keep / rename / merge / dismiss | My Focus, Suggested |
| Learned rules with approve / edit / reject | My Rules |
| Build story, team board, shared focus pages | My Work, TeamBrain |
| Continue a conversation from the page | request drawer |
| Telegram alerts and session wrap-ups | modes |
| Local and third-party models for observation extraction (Ollama, LM Studio, …) | OpenAI-compatible provider |
| Automatic database snapshots and restore | Backups |
| Memory and work-state export / import | Export/Import |

## Where things stand

| Step | Status |
| --- | --- |
| 1. Grove and companion | Built, in pull request #1 |
| 2. Climb into the tree | Started: a picked branch turns to face you and is kept in the URL |
| Tune-up (self-improvement session) | Built, in pull request #1 |
| 3. Context receipts | Not started |
| 4. Sessions on the tree | Not started |
| 5. Themes and customization | Not started (companion name and colours are done) |
| 6. Quests | Not started |
| 7. Take the wheel | Not started |
| 8. Reviewer on security work | Not started; needs a finding first |
| 9. Proof | Started: the benchmark table and daily growth snapshots are built |

Step 1 has been run only on the sample fixtures in headless Chromium. Before anything else, run it against a real
`~/.claude-mem` database, on a phone, and in Safari and Firefox.

## Build order

Each step is one pull request. The commits listed are the plan; a step is done when its tests, the root typecheck
and the bundle build pass. Steps 3, 4, 6 and 7 change the worker, so they also need a run against real data.

### 1. Grove and companion (pull request #1)

- `Add the growth model: focus areas level up from recorded work`
- `Add the companion's moods and pixel sprites`
- `Make room in the store for the Grove page and companion settings`
- `Add the Grove page and the companion to My Work`
- `Write down the Annealer build plan`
- `Place the Grove's tree in space`
- `Remember whether the Grove is drawn in 3D or flat`
- `Draw the Grove in 3D: turn it, pick a branch, pick a twig`
- `Keep the Grove's open branch in the URL`
- `Measure each branch: benchmarks, and a snapshot of the tree each day`
- `Add the tune-up: the steps that would grow the tree right now`
- `Add the Tune-up and Benchmarks panels to the Grove`

The tune-up is the self-improvement session. It lists what is recorded as waiting (a question to answer, a version
to check, a request with no next step, rules and focus areas to decide, open work nobody reviewed) and walks through
it one step at a time. A step leaves the list when the work changes, not when a button is pressed.

Upstream's own self-improvement is separate and untouched: rules learned from how you work (My Rules), and memories
that get stronger each time the work confirms them again (`src/services/reinforcement`).

The 3D tree is drawn on a plain canvas with the projection in `growth/tree-3d.ts`. No 3D library was added: the tree
is a few hundred line segments, and a library would have been most of the bundle.

### 2. Climb into the tree

Picking a branch already turns the tree to face it, moves the camera in, and puts the branch in the URL. This step
goes further: the tree redraws as that branch alone.

- `Draw one branch as its own tree` (requests as limbs, work product as leaves)
- `Show the rules that apply to a branch as its roots` (approved rules only; waiting ones as pale roots)
- `Show asks nobody started as buds`
- `Pick a leaf to open that file, commit or pull request`
- `Let the companion walk the ground under the tree`

### 3. Context receipts

This is the context-engineering step. Upstream decides what each session is told and can preview it, but it keeps
no record of what a given session was actually given. So today you cannot look back at a session and see its
context, compare two sessions, or tell which memories keep getting sent.

A receipt is a small saved record written when context is built: which memories went in, how big each section was,
the token count and the budget. It is a record of something that already happened. It triggers no model call and is
never replayed (ground rule 5).

- `Save a receipt when a session's context is built`
- `Show a request's context receipts in its drawer` (what the agent was told, by section, with sizes)
- `Compare what two sessions were given`
- `Show the memories sent most often, and the requests they went to`
- `Pin or mute a memory for one focus area` (pinned is always offered there, muted never is)
- `Show context weight on the Grove` (a branch's roots deepen with the saved context its sessions drew on)
- `Flag context that is sent every session and never read back` (a memory the agent received but never searched,
  cited or built on; a prompt to mute it)

Open question before the first commit: whether a receipt belongs in the existing database or beside it. Read
`ContextBuilder` and the migration rules first.

### 4. Sessions on the tree

Sessions exist in the classic viewer. My Work is organised by request, and nothing connects the two on screen.

- `List the sessions behind a request in its drawer` (agent, device, start, length, link to the session page)
- `Show a branch's sessions as growth rings` (one ring per week that had sessions; pick a ring to list them)
- `Mark where a session picked up from an earlier one`

### 5. Themes and customization

A theme is a named set of the existing colour tokens, so every current page follows it for free.

- `Let a theme be picked and remembered` (Paper and Dusk as today, plus Ember: near-black with a red-orange glow)
- `Add a density and motion setting`
- `Let the companion's sprite be swapped` (more creatures, each a frame table like the first)
- `Unlock companion looks at Grove levels` (earned by level, never bought)
- `Let a branch be given its own colour`

### 6. Quests: nothing gets forgotten

A quest is a saved instruction the worker runs on a schedule and reports on in My Work. It reads saved records.
It must not start paid inference by itself: a quest that needs an agent turn waits for you to press the button.

- `Add a quest record and its states`
- `Nudge: list open requests with no recorded next step every morning`
- `Loop: re-check a request until its next step is recorded`
- `Show quests on the companion and in the Grove`
- `Research trail: keep the one-liners and links you save, under their branch`
- `Send a quest's report through the existing Telegram alerts`

### 7. Take the wheel

Upstream can already continue a conversation from the page. This step adds the rest of steering.

- `Show what a running agent is doing right now, one line at a time`
- `Add a note to a running request from the page`
- `Pause a request from the page` (only where the platform's hooks allow it; say so plainly where they do not)

### 8. Reviewer on security work

On security work the learning run can fail with the agent's own safeguards, and the refresh stops. Upstream already
lets observation extraction run on a local or third-party model. Whether the My Work learning run can use that
setting is not known yet; it runs through the agent's command line.

- `Find out which model path the learning run uses, and write it down here`
- then one of: `Let the learning run use the configured provider`, or `Say plainly when a review was refused and why`
- `Say which model wrote a review`

### 9. Proof

Backups and export already exist upstream, so this step only adds what is missing and links to the rest.

The benchmark table is built: per branch, the share shipped, reviewed and checked, average reviewed progress, and
counts of requests with no next step or waiting on you. So is a snapshot of the tree for each day the Grove is
opened, kept in the browser, because the worker keeps no history of it.

- `Save the daily snapshot in the worker, so it does not depend on one browser`
- `Shipped per week, per branch` (needs a recorded ship date on each request)
- `Link Backups and Export from the Grove`
- `Export one branch as a file: its requests, evidence and level`

## How to run it

```bash
cd src/ui/my-work
npm install
npm run dev            # http://localhost:5173/?source=sample&view=grove for the fixtures
npm test               # growth, 3D and companion tests run with the rest
npm run build          # writes the bundle the installed plugin serves
```

With claude-mem installed from this fork, the Grove is the second item in My Work's sidebar.
