/**
 * Unit tests for the `/context` snapshot parser inside
 * `services/sessions-browser/local-context-breakdown.ts` (TRDD-1657a5f4
 * Phase 1, build agent T's Concern 1 fix).
 *
 * The parser (`parseContextFields` → `parseRecordedContextSnapshot`) is not
 * exported, so we drive it through the public entry point
 * `computeLocalContextBreakdown(jsonlPath)`, which reads a real JSONL file
 * off disk (NO mocks — write a temp fixture, run the real service). The
 * captured snapshot is surfaced as `result.recordedSnapshot`.
 *
 * Regression guarded (IN-1 §3 / build agent T Concern 1): modern Claude
 * Code REMOVED the "Autocompact buffer" line from `/context` output. The
 * old parser hard-required that line and returned `null` for the WHOLE
 * snapshot when it was absent — silently killing the recorded-vs-heuristic
 * comparison for every current session. The fix falls back to the published
 * 33_000 constant when the line is gone, and keeps a captured value verbatim
 * when an old session still has it.
 *
 * The fixture content mirrors the ANSI-stripped `/context` stdout captured
 * in the IN-1 report (RECENT sample, claude-opus-4-8, 494k/1m).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { computeLocalContextBreakdown } from '@/services/sessions-browser/local-context-breakdown'

/** Build a `system / local_command` record carrying a `/context` dump. */
function localCommandRecord(contextDump: string, cwd: string): string {
  return JSON.stringify({
    type: 'system',
    subtype: 'local_command',
    cwd,
    timestamp: '2026-05-29T22:41:37.000Z',
    content: contextDump,
  })
}

/**
 * MODERN `/context` output — NO "Autocompact buffer" line (Claude Code
 * 2.1.142+). Header `494k/1m tokens (49%)` + the six surviving buckets.
 */
const MODERN_CONTEXT_DUMP = [
  'Context Usage',
  'claude-opus-4-8',
  '494k/1m tokens (49%)',
  'Estimated usage by category',
  'System prompt: 2.2k tokens (0.2%)',
  'Custom agents: 19.5k tokens (1.9%)',
  'Memory files: 134.2k tokens (13.4%)',
  'Skills: 61.3k tokens (6.1%)',
  'Messages: 338.9k tokens (33.9%)',
  'Free space: 443.9k (44.4%)',
].join('\n')

/**
 * LEGACY `/context` output — the older format that DID print the
 * "Autocompact buffer" line. Used to prove backward compatibility: the
 * captured value (45k) must survive verbatim rather than being replaced
 * by the 33k constant fallback.
 */
const LEGACY_CONTEXT_DUMP = [
  'Context Usage',
  'claude-opus-4-6',
  '91.6k/200k tokens (46%)',
  'Estimated usage by category',
  'System prompt: 2.2k tokens (1.1%)',
  'Custom agents: 8.5k tokens (4.3%)',
  'Memory files: 30.1k tokens (15.1%)',
  'Skills: 12.3k tokens (6.2%)',
  'Messages: 38.5k tokens (19.3%)',
  'Autocompact buffer: 45k tokens (22.5%)',
  'Free space: 62.9k (31.5%)',
].join('\n')

/**
 * A minimal user turn so the file is a realistic multi-line session and
 * `summarizeJsonl` has at least one message to tokenize.
 */
function userTurn(text: string, cwd: string): string {
  return JSON.stringify({
    type: 'user',
    cwd,
    message: { role: 'user', content: text },
    timestamp: '2026-05-29T22:40:00.000Z',
  })
}

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aim-ctx-parser-'))
})

afterAll(async () => {
  // The temp dir is throwaway test scratch we created this run — plain rm.
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFixture(name: string, lines: string[]): Promise<string> {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, lines.join('\n') + '\n', 'utf8')
  return p
}

describe('/context parser — modern snapshot without "Autocompact buffer" line', () => {
  it('still yields a non-null recordedSnapshot (the regression fix)', async () => {
    // cwd points at an EMPTY temp dir, so no plugins/skills are discovered
    // and the heuristic path stays deterministic — we only assert on the
    // recorded snapshot here.
    const jsonl = await writeFixture('modern.jsonl', [
      userTurn('hello', tmpDir),
      localCommandRecord(MODERN_CONTEXT_DUMP, tmpDir),
    ])
    const result = await computeLocalContextBreakdown(jsonl)
    expect(result.recordedSnapshot).not.toBeNull()
  })

  it('falls back to the 33000 autocompact-buffer constant when the line is absent', async () => {
    const jsonl = await writeFixture('modern2.jsonl', [
      userTurn('hi there', tmpDir),
      localCommandRecord(MODERN_CONTEXT_DUMP, tmpDir),
    ])
    const result = await computeLocalContextBreakdown(jsonl)
    expect(result.recordedSnapshot?.autocompactBuffer).toBe(33_000)
  })

  it('parses the surviving buckets + the header total/limit verbatim', async () => {
    const jsonl = await writeFixture('modern3.jsonl', [
      userTurn('q', tmpDir),
      localCommandRecord(MODERN_CONTEXT_DUMP, tmpDir),
    ])
    const snap = (await computeLocalContextBreakdown(jsonl)).recordedSnapshot
    expect(snap).not.toBeNull()
    // 2.2k → 2200, 134.2k → 134200, 338.9k → 338900 (parseTokenStr rounding).
    expect(snap?.systemPrompt).toBe(2_200)
    expect(snap?.memory).toBe(134_200)
    expect(snap?.messages).toBe(338_900)
    // Header "494k/1m tokens" → total 494000, recorded model limit 1,000,000.
    expect(snap?.total).toBe(494_000)
    expect(snap?.modelContextLimit).toBe(1_000_000)
    // The model id is captured with the [1m] suffix stripped by the parser.
    expect(snap?.modelId).toBe('claude-opus-4-8')
  })
})

describe('/context parser — legacy snapshot WITH "Autocompact buffer" line', () => {
  it('still parses to a non-null recordedSnapshot (backward compatible)', async () => {
    const jsonl = await writeFixture('legacy.jsonl', [
      userTurn('old session', tmpDir),
      localCommandRecord(LEGACY_CONTEXT_DUMP, tmpDir),
    ])
    const result = await computeLocalContextBreakdown(jsonl)
    expect(result.recordedSnapshot).not.toBeNull()
  })

  it('keeps the captured autocompact-buffer value verbatim (45k, NOT the 33k fallback)', async () => {
    // `??` (not `||`) was used precisely so a genuinely-captured value
    // overrides the constant — this asserts that intent.
    const jsonl = await writeFixture('legacy2.jsonl', [
      userTurn('old session 2', tmpDir),
      localCommandRecord(LEGACY_CONTEXT_DUMP, tmpDir),
    ])
    const snap = (await computeLocalContextBreakdown(jsonl)).recordedSnapshot
    expect(snap?.autocompactBuffer).toBe(45_000)
    expect(snap?.modelContextLimit).toBe(200_000)
  })
})

describe('/context parser — no captured snapshot at all', () => {
  it('returns recordedSnapshot=null when the session never ran /context', async () => {
    const jsonl = await writeFixture('none.jsonl', [
      userTurn('just a chat', tmpDir),
      JSON.stringify({
        type: 'assistant',
        cwd: tmpDir,
        message: { role: 'assistant', content: 'a reply' },
        timestamp: '2026-05-29T22:41:00.000Z',
      }),
    ])
    const result = await computeLocalContextBreakdown(jsonl)
    expect(result.recordedSnapshot).toBeNull()
    // The heuristic path still produces a usable breakdown object.
    expect(typeof result.modelContextLimit).toBe('number')
  })
})
