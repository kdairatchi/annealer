// SPDX-License-Identifier: Apache-2.0

/**
 * Context receipts (Annealer): a record of what a session was told when it
 * started. Upstream decides the context and can preview it, but keeps nothing
 * about what a given session actually received, so there was no way to look
 * back at a session, compare two, or see which memories keep getting sent.
 *
 * A receipt is written by the SessionStart hook from the exact text it hands
 * the agent, whether that text came from the worker or from the on-disk
 * context cache. It is a record of something that already happened:
 *
 * - It starts no inference and is never replayed, retried or backfilled.
 * - It is not a queue. Nothing reads it to decide what to do next.
 * - Writing it must never fail or slow a session: every error is swallowed.
 * - It lives beside the database, not in it, so this fork adds no migration
 *   that could collide with an upstream schema version.
 *
 * The receipt keeps the titles and ids of the memories that were sent, the
 * size of each section and a hash of the text. It does not keep the text.
 */

import { createHash } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'fs';
import { join } from 'path';

/** Where the hook got the text it delivered. One definition; the page words each value. */
export const CONTEXT_RECEIPT_SOURCES = ['worker', 'cache', 'server'] as const;
export type ContextReceiptSource = (typeof CONTEXT_RECEIPT_SOURCES)[number];

export interface ContextReceiptMemory { id: string; title: string }
export interface ContextReceiptSection { title: string; chars: number }

export interface ContextReceipt {
  v: 1;
  /** When the session was handed the text, ISO 8601. */
  at: string;
  /** The platform's own session id; null when the host sent none. */
  sessionId: string | null;
  platform: string;
  projects: string[];
  source: ContextReceiptSource;
  /** How old the cached render was when it was served; null unless `source` is "cache". */
  cacheAgeMs: number | null;
  chars: number;
  /** An estimate at four characters per token, for comparing receipts with each other. */
  tokens: number;
  sections: ContextReceiptSection[];
  /** Memories listed in the text, in the order they appeared. */
  memories: ContextReceiptMemory[];
  /** Earlier-session summaries listed in the text. */
  summaries: number;
  /** First 16 hex characters of the text's SHA-256: two sessions told the same thing share it. */
  hash: string;
}

export const RECEIPTS_FILE = 'context-receipts.jsonl';
/** The file rolls over to `.1` at this size; one older file is kept. */
export const RECEIPTS_MAX_BYTES = 2 * 1024 * 1024;
export const RECEIPT_MEMORIES_MAX = 300;
const RECEIPT_TITLE_MAX = 160;
const RECEIPT_SECTIONS_MAX = 24;

/**
 * `<id> <time> <icon> <title>` or `**<id>** <time> <icon> **<title>**`, as AgentFormatter writes a memory.
 * The time is a clock time (`9:14a`, `14:05`) or `"` for "same as above", and the icon holds no letters or digits,
 * so a sentence that happens to start with a number is not mistaken for a memory.
 */
const MEMORY_ROW = /^(\*\*)?(\d+|[0-9a-f]{8})\1 (?:\d{1,2}:\d{2}(?: ?[ap]m?)?|") [^\sA-Za-z0-9]+ (.+)$/i;
/** `S<id> <request> (<time>)`, as AgentFormatter writes an earlier session. */
const SUMMARY_ROW = /^S(?:\d+|[0-9a-f]{8}) .+\(.+\)$/i;
const HEADING = /^#{1,2} (.+)$/;

export const receiptsDir = (dataDir: string) => join(dataDir, 'annealer');

/** The receipt for one delivered text. Pure: the same text and details always give the same receipt. */
export function receiptOf(text: string, details: {
  at: string; sessionId: string | null; platform: string; projects: readonly string[];
  source: ContextReceiptSource; cacheAgeMs: number | null;
}): ContextReceipt {
  const sections: ContextReceiptSection[] = [];
  const memories: ContextReceiptMemory[] = [];
  const seen = new Set<string>();
  let summaries = 0;
  let current: ContextReceiptSection = { title: '', chars: 0 };
  const close = () => { if (current.chars > 0 && sections.length < RECEIPT_SECTIONS_MAX) sections.push(current); };
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      current = { title: heading[1].trim().slice(0, RECEIPT_TITLE_MAX), chars: 0 };
    }
    current.chars += line.length + 1;
    const memory = MEMORY_ROW.exec(line);
    if (memory && !seen.has(memory[2]) && memories.length < RECEIPT_MEMORIES_MAX) {
      seen.add(memory[2]);
      memories.push({ id: memory[2], title: memory[3].replace(/^\*\*|\*\*$/g, '').trim().slice(0, RECEIPT_TITLE_MAX) });
    } else if (SUMMARY_ROW.test(line)) {
      summaries += 1;
    }
  }
  close();
  return {
    v: 1, at: details.at, sessionId: details.sessionId, platform: details.platform, projects: [...details.projects],
    source: details.source, cacheAgeMs: details.source === 'cache' ? details.cacheAgeMs : null,
    chars: text.length, tokens: Math.ceil(text.length / 4), sections, memories, summaries,
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
  };
}

/**
 * Append one receipt. Called from the SessionStart hook, so it is one small
 * synchronous write and it never throws: a session must start whether or not
 * its receipt could be saved. Returns whether it was written.
 */
export function appendReceipt(dataDir: string, receipt: ContextReceipt): boolean {
  try {
    const dir = receiptsDir(dataDir);
    const file = join(dir, RECEIPTS_FILE);
    mkdirSync(dir, { recursive: true });
    if (existsSync(file) && statSync(file).size > RECEIPTS_MAX_BYTES) renameSync(file, `${file}.1`);
    appendFileSync(file, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Receipts are off when ANNEALER_CONTEXT_RECEIPTS is "off", "0" or "false". */
export const receiptsEnabled = (env: Record<string, string | undefined> = process.env) =>
  !['off', '0', 'false'].includes(String(env.ANNEALER_CONTEXT_RECEIPTS ?? '').trim().toLowerCase());

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

/** One saved line read back safely. Anything that is not a receipt is dropped, and no field is trusted as typed. */
export function parseReceipt(line: string): ContextReceipt | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) return null;
  if (!CONTEXT_RECEIPT_SOURCES.includes(raw.source as ContextReceiptSource)) return null;
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    v: 1, at: raw.at, sessionId: typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId.slice(0, 200) : null,
    platform: text(raw.platform, 60), projects: list(raw.projects).filter((entry) => typeof entry === 'string').slice(0, 20).map((entry) => String(entry).slice(0, 300)),
    source: raw.source as ContextReceiptSource, cacheAgeMs: raw.source === 'cache' && typeof raw.cacheAgeMs === 'number' ? count(raw.cacheAgeMs) : null,
    chars: count(raw.chars), tokens: count(raw.tokens),
    sections: list(raw.sections).slice(0, RECEIPT_SECTIONS_MAX).map((entry) => ({ title: text((entry as ContextReceiptSection)?.title, RECEIPT_TITLE_MAX), chars: count((entry as ContextReceiptSection)?.chars) })),
    memories: list(raw.memories).slice(0, RECEIPT_MEMORIES_MAX).map((entry) => ({ id: text((entry as ContextReceiptMemory)?.id, 40), title: text((entry as ContextReceiptMemory)?.title, RECEIPT_TITLE_MAX) })).filter((entry) => entry.id),
    summaries: count(raw.summaries), hash: text(raw.hash, 16),
  };
}

/** The newest receipts, newest first, from the current file and the one rolled-over file. */
export function readReceipts(dataDir: string, limit: number): ContextReceipt[] {
  const file = join(receiptsDir(dataDir), RECEIPTS_FILE);
  const receipts: ContextReceipt[] = [];
  for (const path of [file, `${file}.1`]) {
    if (receipts.length >= limit) break;
    let lines: string[];
    try {
      lines = readFileSync(path, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (let index = lines.length - 1; index >= 0 && receipts.length < limit; index -= 1) {
      if (!lines[index]) continue;
      const receipt = parseReceipt(lines[index]);
      if (receipt) receipts.push(receipt);
    }
  }
  return receipts;
}
