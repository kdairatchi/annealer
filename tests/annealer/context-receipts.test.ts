import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendReceipt, parseReceipt, readReceipts, receiptOf, receiptsDir, receiptsEnabled, RECEIPTS_FILE, RECEIPTS_MAX_BYTES,
} from '../../src/shared/annealer/context-receipts.js';
import { renderAgentFullObservation, renderAgentSummaryItem, renderAgentTableRow } from '../../src/services/context/formatters/AgentFormatter.js';
import { ModeManager } from '../../src/services/domain/ModeManager.js';

const details = { at: '2026-11-18T10:00:00.000Z', sessionId: 'sess-1', platform: 'claude-code', projects: ['annealer'], source: 'worker' as const, cacheAgeMs: null };
const TEXT = [
  'claude-mem status line',
  '',
  '# Recent work',
  '### Nov 17',
  '1042 9:14a 🔵 OAuth redirect is exploitable on /callback',
  '1043 " 🟣 Decided to keep the scan gate',
  '**1050** 2:05p 🔴 **Fixed the stale build check**',
  'detail line that is not a memory',
  '~120t',
  'S77 Audit the checkout bypass (Nov 16, 4:10p)',
  '## Rules and tools',
  'See RULES-AND-TOOLS.md',
].join('\n');

describe('context receipts', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'annealer-receipts-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads the memories, summaries and sections out of the delivered text', () => {
    const receipt = receiptOf(TEXT, details);
    expect(receipt.memories).toEqual([
      { id: '1042', title: 'OAuth redirect is exploitable on /callback' },
      { id: '1043', title: 'Decided to keep the scan gate' },
      { id: '1050', title: 'Fixed the stale build check' },
    ]);
    expect(receipt.summaries).toBe(1);
    expect(receipt.sections.map((section) => section.title)).toEqual(['', 'Recent work', 'Rules and tools']);
    expect(receipt.sections.reduce((sum, section) => sum + section.chars, 0)).toBe(TEXT.length + 1);
    expect([receipt.chars, receipt.tokens]).toEqual([TEXT.length, Math.ceil(TEXT.length / 4)]);
    expect(receipt.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(receiptOf(TEXT, details)).toEqual(receipt);
    expect(receiptOf(`${TEXT}!`, details).hash).not.toBe(receipt.hash);
  });

  it('recognises the rows exactly as the agent formatter writes them', () => {
    ModeManager.getInstance().loadMode('code');
    const config = { showReadTokens: true, showWorkTokens: false } as never;
    const observation = { id: 314, title: 'Scope is three subdomains', type: 'discovery' } as never;
    const text = [
      renderAgentTableRow(observation, '9:14 AM', config),
      ...renderAgentFullObservation({ id: 315, title: 'Second one', type: 'decision' } as never, '', null, config),
      renderAgentTableRow({ id: 316, title: 'Afternoon one', type: 'bugfix' } as never, '2:05 PM', config),
      ...renderAgentSummaryItem({ id: 9, request: 'Earlier session' }, 'Nov 16'),
    ].join('\n');
    const receipt = receiptOf(text, details);
    expect(receipt.memories).toEqual([{ id: '314', title: 'Scope is three subdomains' }, { id: '315', title: 'Second one' }, { id: '316', title: 'Afternoon one' }]);
    expect(receipt.summaries).toBe(1);
  });

  it('a memory listed twice is counted once, and prose that starts with a number is not a memory', () => {
    const receipt = receiptOf(['1042 9:14a 🔵 First', '1042 9:15a 🔵 First again', '3 things to do today', '2026 was a long year for this repo'].join('\n'), details);
    expect(receipt.memories.map((memory) => memory.id)).toEqual(['1042']);
  });

  it('only a cache read carries a cache age', () => {
    expect(receiptOf(TEXT, { ...details, source: 'cache', cacheAgeMs: 4200 }).cacheAgeMs).toBe(4200);
    expect(receiptOf(TEXT, { ...details, source: 'worker', cacheAgeMs: 4200 }).cacheAgeMs).toBeNull();
  });

  it('appends one line per receipt and reads them back newest first', () => {
    expect(appendReceipt(dir, receiptOf(TEXT, details))).toBe(true);
    expect(appendReceipt(dir, receiptOf(TEXT, { ...details, at: '2026-11-18T11:00:00.000Z', sessionId: 'sess-2' }))).toBe(true);
    const file = join(receiptsDir(dir), RECEIPTS_FILE);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(statSync(file).mode & 0o077).toBe(0);
    expect(readReceipts(dir, 10).map((receipt) => receipt.sessionId)).toEqual(['sess-2', 'sess-1']);
    expect(readReceipts(dir, 1).map((receipt) => receipt.sessionId)).toEqual(['sess-2']);
    expect(JSON.stringify(readReceipts(dir, 10))).not.toContain('detail line that is not a memory');
  });

  it('rolls the file over when it is full and still reads the older one', () => {
    const file = join(receiptsDir(dir), RECEIPTS_FILE);
    appendReceipt(dir, receiptOf(TEXT, { ...details, sessionId: 'old' }));
    appendFileSync(file, `${' '.repeat(RECEIPTS_MAX_BYTES)}\n`);
    appendReceipt(dir, receiptOf(TEXT, { ...details, sessionId: 'new' }));
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(file).size).toBeLessThan(10_000);
    expect(readReceipts(dir, 10).map((receipt) => receipt.sessionId)).toEqual(['new', 'old']);
  });

  it('never throws when it cannot write, and reading a missing folder is empty', () => {
    const blocked = join(dir, 'a-file');
    writeFileSync(blocked, 'x');
    expect(appendReceipt(blocked, receiptOf(TEXT, details))).toBe(false);
    expect(readReceipts(join(dir, 'nowhere'), 10)).toEqual([]);
  });

  it('drops saved lines that are not receipts and trusts no field as typed', () => {
    expect(parseReceipt('not json')).toBeNull();
    expect(parseReceipt('{"v":2}')).toBeNull();
    expect(parseReceipt(JSON.stringify({ ...receiptOf(TEXT, details), source: 'guess' }))).toBeNull();
    expect(parseReceipt(JSON.stringify({ ...receiptOf(TEXT, details), at: 'yesterday' }))).toBeNull();
    const odd = parseReceipt(JSON.stringify({ v: 1, at: details.at, source: 'worker', sessionId: 7, projects: 'x', chars: -5, tokens: 'many', sections: [{ title: 9 }], memories: [{ id: '', title: 'x' }, { id: '5', title: 5 }], summaries: null }))!;
    expect(odd).toEqual({ v: 1, at: details.at, sessionId: null, platform: '', projects: [], source: 'worker', cacheAgeMs: null, chars: 0, tokens: 0, sections: [{ title: '', chars: 0 }], memories: [{ id: '5', title: '' }], summaries: 0, hash: '' });
  });

  it('is on unless switched off', () => {
    expect(receiptsEnabled({})).toBe(true);
    for (const off of ['off', '0', 'false', ' OFF ']) expect(receiptsEnabled({ ANNEALER_CONTEXT_RECEIPTS: off })).toBe(false);
    expect(receiptsEnabled({ ANNEALER_CONTEXT_RECEIPTS: 'on' })).toBe(true);
  });
});
