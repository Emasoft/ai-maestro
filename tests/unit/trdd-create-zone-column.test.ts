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
})
