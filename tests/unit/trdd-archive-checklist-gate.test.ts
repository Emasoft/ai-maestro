/**
 * TRDD-P6MSMQ2I — `POST /api/trdd/[id]/archive --state completed` must refuse a card whose
 * acceptance checklist is missing or unfinished.
 *
 * THE BUG. The terminal-column completion gate (aimaestro-trdd-approval.md §D4 step 5b) says a
 * card enters a terminal column only when its checklist EXISTS (>=1 box) and every box is ticked.
 * That gate was enforced by the LINTER and by nothing else, so the WRITE PATH cheerfully minted
 * exactly the false completion the gate forbids — and `trddgrep validate` then reported a standing
 * ERROR about a card the API had just created. Measured 2026-08-22 (TRDD-798OAHMX e2e): `G6A54OYK`
 * was archived that way and is left in `design/archived/` on purpose as the live reproduction.
 *
 * WHY THE GUARD IS TESTED HERE AND NOT THROUGH HTTP. `rejectIncompleteChecklist` is the whole
 * decision; the route is three lines that call it and return its response. Driving the route would
 * add a sudo token, an auth result and a Next request to a test whose subject is a predicate over a
 * card body — and every one of those could refuse first, which is the trap measured on
 * ai-maestro#114 (five different inputs all returning one 401, proving nothing about any of them).
 *
 * WHY IT REUSES THE LINTER'S COUNTER. The guard calls `countAcceptanceBoxes`, the linter's own
 * function, rather than a lookalike regex. Two spellings of "an acceptance box" would drift, and
 * the drift is silent in the worst direction: the route would admit a card the linter then
 * rejects, which is this bug wearing a different hat. The fenced-block case below pins that
 * specifically — a card DOCUMENTING this rule contains example checkboxes, and a naive counter
 * reads them as real ones.
 *
 * NEUTER RUNS (2026-08-23 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if (boxes.total === 0)/if (false)/   → 2 red / 6 green   (the no-checklist half)
 *       REFUSES completed when the card has no acceptance checklist at all
 *       is not fooled by checkboxes inside a fenced block
 *   s/if (boxes.open > 0)/if (false)/      → 1 red / 7 green   (the unfinished half)
 *       REFUSES completed when a box is still open
 *
 * Complementary: each mutation reds a DISJOINT set, so neither half of the guard is vacuous.
 *
 * The second count was written here as "2 red" BEFORE the run and was wrong — only one closure
 * drives the open-box branch, because the `[~]` card has zero OPEN boxes and so passes under
 * both the guard and its neuter. Recorded rather than quietly corrected: a predicted neuter
 * count reads exactly like a measured one, and this file would have shipped a number nobody
 * had observed. The `[~]` closure pins the counter's `[~]`-is-not-open semantics, not this
 * branch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { rejectIncompleteChecklist } from '@/lib/trdd-authz'

let designDir: string

/** Write a card into tasks/ with an arbitrary body — the body IS the subject here. */
function writeCard(id: string, body: string, column = 'dev'): string {
  const dir = path.join(designDir, 'tasks')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `TRDD-20260823_120000+0200-${id}-archive-gate-fixture.md`)
  fs.writeFileSync(
    file,
    `---
trdd-id: ${id}
title: archive gate fixture
column: ${column}
created: 2026-08-23T12:00:00+0200
updated: 2026-08-23T12:00:00+0200
---

# ${id} — fixture

${body}

## Approval log
`,
  )
  return file
}

/** The guard returns a NextResponse on refusal and null on pass — read the JSON when refused. */
async function verdict(id: string, state: string) {
  const res = rejectIncompleteChecklist(designDir, id, state)
  if (res === null) return { refused: false as const }
  return { refused: true as const, status: res.status, body: await res.json() }
}

beforeEach(() => {
  designDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-archive-gate-'))
})
afterEach(() => {
  fs.rmSync(designDir, { recursive: true, force: true })
})

describe('archive route — terminal completion gate (TRDD-P6MSMQ2I)', () => {
  it('REFUSES completed when the card has no acceptance checklist at all', async () => {
    // This is the exact shape that produced G6A54OYK: a body with prose and zero boxes.
    writeCard('AAAA1111', '## Problem\n\nSome prose, and not a single checkbox anywhere.')
    const v = await verdict('AAAA1111', 'completed')
    expect(v.refused).toBe(true)
    expect(v.refused && v.status).toBe(409)
    expect(v.refused && v.body.error).toBe('trdd_terminal_without_checklist')
  })

  it('REFUSES completed when a box is still open', async () => {
    writeCard('BBBB2222', '## Acceptance\n\n- [x] the first thing\n- [ ] the second thing')
    const v = await verdict('BBBB2222', 'completed')
    expect(v.refused).toBe(true)
    expect(v.refused && v.status).toBe(409)
    expect(v.refused && v.body.error).toBe('trdd_terminal_with_open_box')
    // The message must name the count, so the refusal tells the caller what to fix.
    expect(v.refused && v.body.message).toMatch(/1 of 2/)
  })

  it('ALLOWS completed when every box is ticked', async () => {
    writeCard('CCCC3333', '## Acceptance\n\n- [x] done\n- [x] also done')
    expect((await verdict('CCCC3333', 'completed')).refused).toBe(false)
  })

  it('ALLOWS completed when the only open-looking boxes are [~] deliberate no-ops', async () => {
    // `[~]` counts toward total but not toward open — a decision, not an obligation.
    writeCard('DDDD4444', '## Acceptance\n\n- [x] done\n- [~] deliberately not doing this')
    expect((await verdict('DDDD4444', 'completed')).refused).toBe(false)
  })

  it('does NOT gate cancelled — abandoned work is not required to be finished', async () => {
    writeCard('EEEE5555', '## Acceptance\n\n- [ ] never finished, and that is the point')
    expect((await verdict('EEEE5555', 'cancelled')).refused).toBe(false)
  })

  it('does NOT gate superseded — overtaken work is not required to be finished', async () => {
    writeCard('FFFF6666', '## Acceptance\n\n- [ ] overtaken by a newer card')
    expect((await verdict('FFFF6666', 'superseded')).refused).toBe(false)
  })

  it('is not fooled by checkboxes inside a fenced block', async () => {
    // A card that DOCUMENTS this rule contains example checkboxes. Counting those as real
    // ones would let a card with no genuine checklist archive as completed — the exact bug.
    writeCard('GGGG7777', '## Problem\n\nThe gate looks for lines like:\n\n```\n- [x] an example\n```\n\nand there is no real checklist here.')
    const v = await verdict('GGGG7777', 'completed')
    expect(v.refused).toBe(true)
    expect(v.refused && v.body.error).toBe('trdd_terminal_without_checklist')
  })

  it('defers a missing card to archiveTrdd rather than answering 404 itself', async () => {
    // One condition, one owner: forking "not found" across two layers is how two callers
    // end up disagreeing about what a missing card means.
    expect((await verdict('ZZZZ9999', 'completed')).refused).toBe(false)
  })
})
