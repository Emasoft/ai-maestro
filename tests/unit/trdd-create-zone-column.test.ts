/**
 * TRDD-MWKCBLQN — a mandate author could mint `column: proposal` straight into
 * tasks/: VALID_COLUMNS admits the bracket values, so the old check only refused a
 * column outside the whole vocabulary, never a column belonging in a different zone.
 * The fix cross-checks the resolved zone against `expectedZone(column, {})`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createTrdd } from '@/lib/trdd-create'

let design: string
beforeEach(() => { design = mkdtempSync(path.join(tmpdir(), 'trddcreate-zone-')) })
afterEach(() => { rmSync(design, { recursive: true, force: true }) })

describe('createTrdd — zone/column mismatch at mint', () => {
  it('a mandate author cannot mint column: proposal into tasks/ — the bug', () => {
    expect(() => createTrdd(design, {
      title: 'owner-authored but wrongly columned', taskType: 'feature',
      authorAuthority: 'user', author: 'owner', column: 'proposal',
    })).toThrow(/proposal.*belongs in zone "proposals"/)
  })

  it('a mandate author minting an ordinary working column still lands in tasks/', () => {
    const r = createTrdd(design, {
      title: 'ordinary mandate', taskType: 'feature',
      authorAuthority: 'user', author: 'owner', column: 'dev',
    })
    expect(r.zone).toBe('tasks')
    expect(r.column).toBe('dev')
  })

  it('a below-floor author still lands column: proposal in proposals/ — the already-correct path', () => {
    const r = createTrdd(design, {
      title: 'needs approval', taskType: 'feature',
      minApproval: 'manager', authorAuthority: 'none', author: 'member-1',
    })
    expect(r.zone).toBe('proposals')
    expect(r.column).toBe('proposal')
  })

  it('also refuses column: complete, which archives — a wider effect than the reported bug', () => {
    // createTrdd writes no `release-via`, so expectedZone('complete', {}) is
    // 'archived'. Refusing is CORRECT per the rule, but it is a behaviour change
    // beyond the `proposal` case the card reported, so it gets its own pin rather
    // than riding along unnoticed on the fix for something else.
    expect(() => createTrdd(design, {
      title: 'born complete', taskType: 'feature',
      authorAuthority: 'user', author: 'owner', column: 'complete',
    })).toThrow(/complete.*belongs in zone "archived"/)
  })

  it('still allows column: planned, a bracket value that legitimately lives in tasks/', () => {
    // Guards against over-refusing: `planned` is in BRACKET_COLUMNS but is NOT a
    // working column, so expectedZone returns null and the mint must proceed.
    const r = createTrdd(design, {
      title: 'planned mandate', taskType: 'feature',
      authorAuthority: 'user', author: 'owner', column: 'planned',
    })
    expect(r.zone).toBe('tasks')
    expect(r.column).toBe('planned')
  })
})
