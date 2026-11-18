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
| 1. Grove and companion | Built and merged (pull request #1) |
| 2. Climb into the tree | Built: climb into a branch, rules as roots, unstarted asks as buds |
| Tune-up (self-improvement session) | Built and merged |
| 3. Context receipts | Not started. Changes the worker; needs a run on real data |
| 4. Sessions on the tree | Not started. Changes the worker; needs a run on real data |
| 5. Themes and customization | Built: accent colours, motion setting, three companion creatures unlocked by level |
| 6. Quests | Partly built: the trail (notes, links, reminders) in the browser. Scheduled runs need the worker |
| 7. Take the wheel | Not started. Changes the worker; needs a run on real data |
| 8. Reviewer on security work | Answered from the source: a setting already exists (see step 8) |
| 9. Proof | Partly built: benchmark table and daily snapshots. The rest needs the worker |

Everything built so far has been run only on the sample fixtures in headless Chromium. Before anything else, run it
against a real `~/.claude-mem` database, on a phone, and in Safari and Firefox.

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

Built:

- `Draw one branch as its own tree, with buds and roots` (requests as limbs, work product as leaves)
- Rules are the whole tree's roots, not a branch's: a rule is scoped to everywhere or to a repo, never to a focus
  area, so tying one to a branch would be invented. Solid roots are rules that are on, dashed ones are waiting.
- Asks nobody started are hollow rings: on their branch in the whole tree, up the trunk once climbed into.

Left:

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

Built:

- `Add accent colours, a motion setting and two more companion creatures` (five accents written over the theme's
  primary tokens, each tested to keep the shipped orange's contrast; Calm motion; Sprout at level 2, Bolt at level 4)

Left:

- `Let a branch be given its own colour`
- `Add a density setting`
- A full third theme (new background and surface tokens) was not built: the accent covers the colour, and a new
  theme has to pass upstream's contrast rules token by token.

### 6. Quests: nothing gets forgotten

A quest is a saved instruction the worker runs on a schedule and reports on in My Work. It reads saved records.
It must not start paid inference by itself: a quest that needs an agent turn waits for you to press the button.

Built, in the browser only:

- `Add the trail: notes, links and reminders on a branch` (a due reminder is the first step of the tune-up; only
  http and https links are kept; it can remind you only while the page is open)

Left, all in the worker:

- `Move the trail into the worker, so it follows you across browsers`
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

On security work the My Work refresh can fail with the agent's own safeguards, and the refresh stops.

Found in `src/services/work-view/refresh-task.ts`: the refresh runs on a logged-in agent CLI by default, and
upstream already has a setting to change that. `CLAUDE_MEM_WORK_VIEW_AGENT=api` makes the refresh use the API
provider that `CLAUDE_MEM_PROVIDER` selects, including `openai-compatible` (Ollama, LM Studio). It spends that
provider's credit, which is why it is opt-in. This was read from the source and has not been run.

- `Try the refresh on a local model with those two settings, and record what happened here`
- `Say plainly on the page when a review was refused, and point at the setting`
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
