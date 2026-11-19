// SPDX-License-Identifier: Apache-2.0
//
// The rituals a companion can be given. A ritual is a CronLord-Grimoire file: TOML with one `[[jobs]]` block, which
// CronLord and the Grimoire read as they read any other. Annealer adds an `[annealer]` table that both ignore: which
// creature owns the ritual, whether it touches the target, and the parameters it needs.
//
// The command is never built from anything typed on the page or printed by a job. It is copied from here verbatim,
// and the parameters reach it as environment variables after cleanParam has checked them.
import {
  cleanText, isAnswerShape, isCompanionSpecies, isLeadKind, isParamType, isReach, isReads, type AnswerShape, type Ritual, type RitualParam,
} from '../../shared/annealer/companions.js';

/** New hosts under a root domain, from passive sources. Adapted from the Grimoire's `security/subdomain-monitor`. */
const SUBDOMAIN_WATCH = `
[annealer]
owner = "moth"
reach = "read"
lead  = "asset"
needs = "subfinder"

[[annealer.params]]
name        = "TARGET"
label       = "Root domain"
type        = "domain"
placeholder = "example.com"

[[jobs]]
id          = "subdomain-watch"
name        = "Subdomain watch"
description = "Lists a root domain's subdomains from passive sources and reports the ones that were not there last time."
category    = "annealer"
kind        = "shell"
schedule    = "7 5 * * *"
timezone    = "UTC"
enabled     = false
timeout_sec = 900

command = '''
set -eu
: "\${TARGET:?root domain}"
: "\${ANNEALER_JOB:?job id}"
command -v subfinder >/dev/null 2>&1 || { echo "subfinder is not installed on this machine"; exit 127; }
DIR="\${ANNEALER_STATE:-$HOME/.annealer/rituals}/$ANNEALER_JOB"
mkdir -p "$DIR"
cd "$DIR"
subfinder -d "$TARGET" -silent -all > raw.txt
sort -u raw.txt > new.txt
if [ ! -f baseline.txt ]; then
  cp new.txt baseline.txt
  echo "baseline: $(wc -l < baseline.txt) hosts"
  exit 0
fi
comm -13 baseline.txt new.txt > added.txt
if [ -s added.txt ]; then
  while IFS= read -r host; do printf 'ANNEALER-LEAD asset %s\\n' "$host"; done < added.txt
  sort -u baseline.txt new.txt > merged.txt
  mv merged.txt baseline.txt
else
  echo "no change"
fi
'''
`;

/** One address, fetched without following redirects. Reports a change of status code or body. */
const ENDPOINT_WATCH = `
[annealer]
owner = "bolt"
reach = "touch"
lead  = "change"
needs = "curl"

[[annealer.params]]
name        = "URL"
label       = "Address to watch"
type        = "url"
placeholder = "https://app.example.com/main.js"

[[jobs]]
id          = "endpoint-watch"
name        = "Endpoint watch"
description = "Fetches one address and reports when its status code or its body is different from last time."
category    = "annealer"
kind        = "shell"
schedule    = "7 */6 * * *"
timezone    = "UTC"
enabled     = false
timeout_sec = 60

command = '''
set -eu
: "\${URL:?address}"
: "\${ANNEALER_JOB:?job id}"
command -v curl >/dev/null 2>&1 || { echo "curl is not installed on this machine"; exit 127; }
DIR="\${ANNEALER_STATE:-$HOME/.annealer/rituals}/$ANNEALER_JOB"
mkdir -p "$DIR"
cd "$DIR"
code=$(curl -sS --proto '=http,https' --max-redirs 0 --max-time 20 --max-filesize 5000000 -o body.new -w '%{http_code}' -- "$URL") || { echo "the request failed"; exit 1; }
sum=$(sha256sum body.new | cut -d' ' -f1)
size=$(wc -c < body.new | tr -d ' ')
rm -f body.new
if [ ! -f state.txt ]; then
  printf '%s %s %s\\n' "$code" "$sum" "$size" > state.txt
  echo "baseline: HTTP $code, $size bytes"
  exit 0
fi
read -r old_code old_sum old_size < state.txt
if [ "$code" != "$old_code" ]; then
  printf 'ANNEALER-LEAD change status went from %s to %s\\n' "$old_code" "$code"
elif [ "$sum" != "$old_sum" ]; then
  printf 'ANNEALER-LEAD change body changed, HTTP %s, %s bytes then, %s now\\n' "$code" "$old_size" "$size"
else
  echo "no change"
fi
printf '%s %s %s\\n' "$code" "$sum" "$size" > state.txt
'''
`;

/** The paths and addresses quoted inside one script. Reports the ones that were not there last time. */
const SCRIPT_ENDPOINTS = `
[annealer]
owner = "weevil"
reach = "touch"
lead  = "endpoint"
needs = "curl"

[[annealer.params]]
name        = "URL"
label       = "Script to read"
type        = "url"
placeholder = "https://app.example.com/assets/main.js"

[[jobs]]
id          = "script-endpoints"
name        = "Script endpoints"
description = "Fetches one script and lists the paths and addresses quoted inside it. Reports the ones that were not there last time."
category    = "annealer"
kind        = "shell"
schedule    = "7 5 * * *"
timezone    = "UTC"
enabled     = false
timeout_sec = 90

command = '''
set -eu
: "\${URL:?address}"
: "\${ANNEALER_JOB:?job id}"
command -v curl >/dev/null 2>&1 || { echo "curl is not installed on this machine"; exit 127; }
DIR="\${ANNEALER_STATE:-$HOME/.annealer/rituals}/$ANNEALER_JOB"
mkdir -p "$DIR"
cd "$DIR"
curl -sS --proto '=http,https' --max-time 30 --max-filesize 20000000 -o body.js -- "$URL" || { echo "the request failed"; exit 1; }
# Quoted paths, then full addresses. Only letters, digits and URL marks can match, so nothing found here can carry shell syntax.
grep -aoE '"/[A-Za-z0-9_.~/{}:%-]{2,160}"' body.js > found.txt || true
grep -aoE "'/[A-Za-z0-9_.~/{}:%-]{2,160}'" body.js >> found.txt || true
grep -aoE 'https?://[A-Za-z0-9.-]{3,120}(/[A-Za-z0-9_.~/{}:%-]{0,160})?' body.js >> found.txt || true
rm -f body.js
tr -d "'" < found.txt | tr -d '"' | grep -E '[A-Za-z]{2}' | sort -u > new.txt || true
if [ ! -f baseline.txt ]; then
  cp new.txt baseline.txt
  echo "baseline: $(wc -l < baseline.txt | tr -d ' ') paths"
  exit 0
fi
comm -13 baseline.txt new.txt > added.txt
if [ -s added.txt ]; then
  head -n 40 added.txt | while IFS= read -r path; do printf 'ANNEALER-LEAD endpoint %s\\n' "$path"; done
  sort -u baseline.txt new.txt > merged.txt
  mv merged.txt baseline.txt
else
  echo "no change"
fi
'''
`;

/**
 * Rituals a model runs. The \`[[jobs]]\` block is still a job CronLord could run as it is (the Claude CLI with the
 * task as its prompt). Annealer adds the creature's soul and the material to read, takes every tool away, and sends
 * it to whichever engine that creature thinks with.
 */
const HYPOTHESES = `
[annealer]
owner  = "cinder"
reach  = "read"
lead   = "hypothesis"
runner = "model"
reads  = "target-leads"
answer = "list"

[[annealer.params]]
name        = "TARGET"
label       = "Target"
type        = "domain"
placeholder = "example.com"

[[annealer.params]]
name        = "NOTES"
label       = "Anything else it should know"
type        = "text"
optional    = true
placeholder = "Stack, auth model, what you already tried"

[[jobs]]
id          = "hypotheses"
name        = "Hypotheses"
description = "Reads what you kept about a target and proposes attack hypotheses, each with the cheapest test that would prove it wrong."
category    = "annealer"
kind        = "claude"
schedule    = "0 0 1 1 *"
enabled     = false
timeout_sec = 300

command = '''
The data holds assets, endpoints and changes the operator kept for one target in a bug bounty programme they are authorised to test.
Propose at most 8 attack hypotheses worth testing, most promising first.
Format: a numbered list. Each item's first line is the hypothesis in one sentence. Under it, two indented lines:
  Test: the cheapest single test that would prove it wrong.
  Because: the line of the data that suggests it.
Only use hosts and paths that appear in the data. If the data supports fewer than 8, give fewer. No introduction and no closing remarks.
'''
`;

const CHALLENGE = `
[annealer]
owner  = "rime"
reach  = "read"
lead   = "verdict"
runner = "model"
reads  = "one-lead"
answer = "verdict"

[[annealer.params]]
name        = "NOTES"
label       = "Evidence you have"
type        = "text"
optional    = true
placeholder = "The request that reproduces it, the response, what you checked"

[[jobs]]
id          = "challenge"
name        = "Challenge"
description = "Tries to break one lead: what would make it a false positive, a duplicate or out of scope, and what evidence is missing."
category    = "annealer"
kind        = "claude"
schedule    = "0 0 1 1 *"
enabled     = false
timeout_sec = 300

command = '''
The data holds one finding or hypothesis, what it was built from, and any evidence the operator gave.
Try to break it as a triager would.
First line, exactly one of:
VERDICT: breaks
VERDICT: stands
Use "breaks" only if something in the data makes it wrong, a duplicate, or out of scope. If you merely lack evidence, the verdict is "stands" and you say what is missing.
Then a numbered list of at most 6 points, strongest first: what would make this a false positive, a known duplicate class, or out of scope, and exactly what evidence would settle each.
No introduction and no closing remarks.
'''
`;

const REPORT_DRAFT = `
[annealer]
owner  = "quill"
reach  = "read"
lead   = "draft"
runner = "model"
reads  = "one-lead"
answer = "document"

[[annealer.params]]
name        = "NOTES"
label       = "Steps and evidence"
type        = "text"
placeholder = "What you did, in order, and what came back"

[[jobs]]
id          = "report-draft"
name        = "Report draft"
description = "Drafts a report from one confirmed lead and the steps you give it. It only writes; sending is yours."
category    = "annealer"
kind        = "claude"
schedule    = "0 0 1 1 *"
enabled     = false
timeout_sec = 300

command = '''
The data holds one confirmed finding, what it was built from, and the operator's own steps and evidence.
Write a bug bounty report draft from it.
First line: the title, with no label in front of it.
Then these sections, each headed by its name on its own line: Summary, Steps to reproduce, Impact, Not verified.
Steps are numbered and each one is something a triager can do. Use only what is in the data. Anything you had to assume goes under Not verified, never in the steps.
No severity score, no remediation advice, no closing remarks.
'''
`;

export const RITUAL_FILES: readonly string[] = [SUBDOMAIN_WATCH, ENDPOINT_WATCH, SCRIPT_ENDPOINTS, HYPOTHESES, CHALLENGE, REPORT_DRAFT];

/** What it takes to carry a ritual out, beyond what the page is told about it. */
export type RitualJob =
  | { runner: 'shell'; command: string; timeoutSec: number }
  | { runner: 'model'; task: string; answer: AnswerShape; timeoutSec: number };
export interface LoadedRitual { ritual: Ritual; job: RitualJob }

type Table = Record<string, unknown>;
const table = (value: unknown): Table | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Table) : null);
const text = (value: unknown, max = 200) => cleanText(value, max);

/** One ritual file, or null when it is missing something a job needs. Only the first `[[jobs]]` block is read, as CronLord does. */
export function parseRitual(source: string): LoadedRitual | null {
  let doc: Table | null;
  try { doc = table(Bun.TOML.parse(source)); } catch { return null; }
  const job = table(Array.isArray(doc?.jobs) ? doc.jobs[0] : null);
  const extra = table(doc?.annealer);
  if (!job || !extra) return null;
  const id = typeof job.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(job.id) ? job.id : '';
  const command = typeof job.command === 'string' ? job.command : '';
  const runner = extra.runner === undefined ? 'shell' : extra.runner;
  // A shell ritual is a shell job; a model ritual is written as a Claude job. Nothing else is taken.
  if (!id || !command.trim() || (runner !== 'shell' && runner !== 'model') || job.kind !== (runner === 'shell' ? 'shell' : 'claude')) return null;
  if (!isCompanionSpecies(extra.owner) || !isReach(extra.reach) || !isLeadKind(extra.lead)) return null;
  const reads = extra.reads === undefined ? 'nothing' : extra.reads;
  if (!isReads(reads) || (runner === 'shell' && reads !== 'nothing')) return null;
  const params: RitualParam[] = [];
  for (const entry of Array.isArray(extra.params) ? extra.params : []) {
    const param = table(entry);
    const name = typeof param?.name === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(param.name) ? param.name : '';
    // ANNEALER_ names belong to the worker. Free text is for a model to read and is never handed to a shell.
    if (!param || !name || name.startsWith('ANNEALER_') || !isParamType(param.type) || (runner === 'shell' && param.type === 'text')) return null;
    params.push({ name, label: text(param.label, 60) || name, type: param.type, placeholder: text(param.placeholder, 120), optional: runner === 'model' && param.optional === true });
  }
  if (params.length === 0) return null;
  const timeoutSec = typeof job.timeout_sec === 'number' && job.timeout_sec > 0 ? Math.min(3600, Math.floor(job.timeout_sec)) : 600;
  const ritual: Ritual = {
    id, name: text(job.name, 60) || id, description: text(job.description, 300), owner: extra.owner, reach: extra.reach, lead: extra.lead,
    needs: text(extra.needs, 60), params, runner, reads, answer: runner === 'model' && isAnswerShape(extra.answer) ? extra.answer : null,
  };
  if (runner === 'shell') return { ritual, job: { runner, command, timeoutSec } };
  if (!isAnswerShape(extra.answer)) return null;
  return { ritual, job: { runner, task: command.trim().slice(0, 4000), answer: extra.answer, timeoutSec } };
}

let loaded: Map<string, LoadedRitual> | null = null;
export function rituals(): Map<string, LoadedRitual> {
  loaded ??= new Map(RITUAL_FILES.map(parseRitual).filter((entry): entry is LoadedRitual => entry !== null).map((entry) => [entry.ritual.id, entry]));
  return loaded;
}
