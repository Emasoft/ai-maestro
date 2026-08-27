/**
 * TRDD-I8UC56GZ — the acceptance-checklist walker, as a LEAF module.
 *
 * There were TWO of these. `countAcceptanceBoxes` in `lib/trdd-doctor.ts` decides whether
 * a card may enter a terminal column; `checkTrddBox` in `lib/trdd-store.ts` decides which
 * box the caller's ordinal N addresses. They were written from each other by READING, and
 * they had already diverged in two ways before the first release:
 *
 *   - the doctor's starts AFTER the frontmatter; the store's started at line 0, so a
 *     `- [ ]` above the closing fence would have shifted every ordinal by one;
 *   - the doctor's returns NOTHING for a card whose frontmatter never closes (it cannot
 *     tell body from head, so it declines to guess); the store's would have walked the
 *     whole malformed file and ticked something.
 *
 * Either divergence produces the same user-visible failure: a caller ticks box N, the
 * gate counts a different box N, and the card sits un-archivable with every visible box
 * ticked. Two implementations of one predicate is the exact drift this card exists to
 * remove — so there is now one, and both callers derive from it.
 *
 * A leaf on purpose: `trdd-doctor` imports `trdd-store`, so anything shared between them
 * that is not a leaf closes a cycle. This module imports nothing.
 */

/**
 * Where the body starts: after the closing `---`, or line 0 when there is no frontmatter
 * at all. `null` means the frontmatter OPENS and never closes — the one case where body
 * and head cannot be told apart, and the honest answer is to decline rather than guess.
 */
export function bodyStartIndex(lines: readonly string[]): number | null {
  if (lines[0]?.trimEnd() !== '---') return 0
  const close = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---')
  return close === -1 ? null : close + 1
}

export interface AcceptanceBox {
  /** 0-based index into the ORIGINAL lines array — what a writer needs to rewrite it. */
  index: number
  /** The character between the brackets: ' ' open, or x/X/~ closed. */
  mark: string
  /** The line split around the mark, so a caller can rewrite only the mark. */
  prefix: string
  suffix: string
}

/**
 * Every acceptance checkbox in the body, in document order.
 *
 * Fenced code is skipped: a card that DOCUMENTS a checkbox in an example is not making a
 * promise, and counting it would make the terminal gate unsatisfiable by construction.
 */
export function acceptanceBoxes(lines: readonly string[]): AcceptanceBox[] {
  const start = bodyStartIndex(lines)
  if (start === null) return []
  const boxes: AcceptanceBox[] = []
  let inFence = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^(\s*[-*]\s\[)([ xX~])(\].*)$/)
    if (!m) continue
    boxes.push({ index: i, mark: m[2], prefix: m[1], suffix: m[3] })
  }
  return boxes
}

/** The gate's view: how many boxes, and how many still open. */
export function countAcceptanceBoxes(body: string): { total: number; open: number } {
  const boxes = acceptanceBoxes(body.split('\n'))
  return { total: boxes.length, open: boxes.filter((b) => b.mark === ' ').length }
}
