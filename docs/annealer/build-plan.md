# Annealer build plan

Annealer is a fork of claude-mem. claude-mem already captures the work, sorts it into focus areas, learns rules and
shows it all live in My Work. Annealer does not rebuild any of that. It adds the parts that make the work feel like
something you grow: a tree you can climb into, a companion that reacts to what your agents are doing, things that run
on a schedule so nothing is forgotten, and a look you can make your own.

## Ground rules

1. **Add on, never replace.** New views read the same work model My Work reads. If upstream already has it, link to it.
2. **Nothing invented.** Every number, level and animation comes from a record the worker saved. Time spent and
   tool calls earn nothing.
3. **One definition per state.** A new mood, palette or theme is one list plus `Record<State, …>` tables, so a missing
   case fails the typecheck (see `docs/architecture/state-machines.md`).
4. **Stay mergeable.** New code lives in its own folders (`src/ui/my-work/src/growth`, `companion`, …) and touches
   upstream files as little as possible, so pulling from claude-mem stays cheap.
5. **Leave capture alone.** Nothing here changes hooks, queues, retries or the observer
   (`docs/architecture/observer-lifecycle.md`).

## What claude-mem already ships (do not rebuild)

| Already there | Where |
| --- | --- |
| Capture, memory, search | hooks, worker, SQLite, Chroma |
| Live requests, progress, hand-offs, deliverables | My Work |
| Focus areas with keep / rename / merge / dismiss | My Focus, Suggested |
| Learned rules with approve / edit / reject | My Rules |
| Build story, team board, shared focus pages | My Work, TeamBrain |
| Continue a conversation from the page | request drawer |

## Build order

Each step is one pull request. The commits listed are the plan; a step is done when its tests, the root typecheck
and the bundle build pass.

### 1. Grove and companion (this pull request)

- `Add the growth model: focus areas level up from recorded work`
- `Add the companion's moods and pixel sprites`
- `Make room in the store for the Grove page and companion settings`
- `Add the Grove page and the companion to My Work`
- `Rebuild the My Work bundle`
- `Write down the Annealer build plan`

### 2. Climb into the tree

Click a branch and the tree redraws as that branch alone: requests as limbs, work product as leaves, rules that apply
to it as roots, the asks nobody has started as buds. Click a twig to go one level deeper into its story and evidence.
The current place is in the URL so Back works.

- `Draw one branch as its own tree`
- `Put the Grove's open branch in the URL`
- `Show the rules that apply to a branch as its roots`
- `Show asks nobody started as buds`

### 3. Themes and customization

A theme is a named set of the existing colour tokens, so every current page follows it for free.

- `Let a theme be picked and remembered` (Paper, Dusk, plus Ember: near-black with a red-orange glow)
- `Add a density and motion setting`
- `Let the companion's sprite be swapped` (more creatures, each a frame table like the first)
- `Unlock companion looks at Grove levels` (earned by level, never bought)

### 4. Quests: nothing gets forgotten

The first backend step. A quest is a saved instruction the worker runs on a schedule and reports on in My Work.
It reads saved records; it must not create paid inference on its own (ground rule 5).

- `Add a quest record and its states`
- `Nudge: list open requests with no recorded next step every morning`
- `Loop: re-check a request until its next step is recorded`
- `Show quests on the companion and in the Grove`
- `Research trail: keep one-liners and links a quest found, under its branch`

### 5. Take the wheel

Upstream can already continue a conversation from the page. This step adds the rest of steering.

- `Show what a running agent is doing right now, one line at a time`
- `Add a note to a running request from the page`
- `Pause a request from the page` (only where the platform's hooks allow it; say so plainly where they do not)

### 6. Local models for the reviewer

Security work trips the hosted reviewer's safeguards and the refresh fails. Let the review and title steps run on a
local model (Ollama or LM Studio) when one is set.

- `Let the progress reviewer use a local OpenAI-compatible endpoint`
- `Say which model wrote a review`

### 7. Proof and backup

- `Export a branch as one file: its requests, evidence and level`
- `Keep a dated backup of the Grove's history`
- `Benchmark card: shipped per week and reviewed coverage, per branch`

## How to run this step

```bash
cd src/ui/my-work
npm install
npm run dev            # http://localhost:5173/?source=sample&view=grove for the fixtures
npm test               # growth and companion tests run with the rest
npm run build          # writes the bundle the installed plugin serves
```

With claude-mem installed from this fork, the Grove is the second item in My Work's sidebar.
