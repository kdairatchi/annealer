// SPDX-License-Identifier: Apache-2.0
//
// The rituals a companion can be given. A ritual is a CronLord-Grimoire file: TOML with one `[[jobs]]` block, which
// CronLord and the Grimoire read as they read any other. Annealer adds an `[annealer]` table that both ignore: which
// creature owns the ritual, whether it touches the target, and the parameters it needs.
//
// The command is never built from anything typed on the page or printed by a job. It is copied from here verbatim,
// and the parameters reach it as environment variables after cleanParam has checked them.
import {
  cleanText, isCompanionSpecies, isLeadKind, isParamType, isReach, type Ritual, type RitualParam,
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

export const RITUAL_FILES: readonly string[] = [SUBDOMAIN_WATCH, ENDPOINT_WATCH];

/** What CronLord needs to run a ritual, beyond what the page is told about it. */
export interface RitualJob { command: string; kind: string; timeoutSec: number }
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
  // Shell only for now: a ritual that calls a model needs the opt-in and budget that come with souls.
  if (!id || !command.trim() || job.kind !== 'shell') return null;
  if (!isCompanionSpecies(extra.owner) || !isReach(extra.reach) || !isLeadKind(extra.lead)) return null;
  const params: RitualParam[] = [];
  for (const entry of Array.isArray(extra.params) ? extra.params : []) {
    const param = table(entry);
    const name = typeof param?.name === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(param.name) ? param.name : '';
    // These two belong to the worker.
    if (!param || !name || name.startsWith('ANNEALER_') || !isParamType(param.type)) return null;
    params.push({ name, label: text(param.label, 60) || name, type: param.type, placeholder: text(param.placeholder, 120) });
  }
  if (params.length === 0) return null;
  const timeout = typeof job.timeout_sec === 'number' && job.timeout_sec > 0 ? Math.min(3600, Math.floor(job.timeout_sec)) : 600;
  return {
    ritual: { id, name: text(job.name, 60) || id, description: text(job.description, 300), owner: extra.owner, reach: extra.reach, lead: extra.lead, needs: text(extra.needs, 60), params },
    job: { command, kind: 'shell', timeoutSec: timeout },
  };
}

let loaded: Map<string, LoadedRitual> | null = null;
export function rituals(): Map<string, LoadedRitual> {
  loaded ??= new Map(RITUAL_FILES.map(parseRitual).filter((entry): entry is LoadedRitual => entry !== null).map((entry) => [entry.ritual.id, entry]));
  return loaded;
}
