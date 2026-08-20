/**
 * TRDD-40DYBI4T — server-side minting. The load-bearing claims:
 *   - the mandate rule decides the ZONE from the author's authority, never from a flag;
 *   - a forced id collision re-rolls rather than overwriting or failing;
 *   - the minted file parses as a real v2 card (the store's own parser is the oracle);
 *   - a colon title is refused (grep-first frontmatter rule).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createTrdd, mintTrddId, idTaken } from '@/lib/trdd-create'
import { parseTrddFile } from '@/lib/trdd-store'

let design: string
beforeEach(() => { design = mkdtempSync(path.join(tmpdir(), 'trddcreate-')) })
afterEach(() => { rmSync(design, { recursive: true, force: true }) })

describe('createTrdd', () => {
  it('an author AT the floor mints a MANDATE in tasks/ with the full approval record', () => {
    const r = createTrdd(design, {
      title: 'a manager-floor card', taskType: 'feature',
      minApproval: 'manager', authorAuthority: 'manager', author: 'amama',
    })
    expect(r.zone).toBe('tasks')
    expect(r.column).toBe('backburner')
    const parsed = parseTrddFile(r.file, 'tasks')
    expect(parsed).not.toBeNull()
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).toMatch(/^mandate: true$/m)
    expect(text).toMatch(/^approved: true$/m)
    expect(text).toMatch(/MANDATE issued by amama/)
  })

  it('an author BELOW the floor lands in proposals/ as column proposal — the flag cannot override', () => {
    const r = createTrdd(design, {
      title: 'needs the manager', taskType: 'feature',
      minApproval: 'manager', authorAuthority: 'none', author: 'member-1',
      column: 'dev', // the attempted override the routing must ignore
    })
    expect(r.zone).toBe('proposals')
    expect(r.column).toBe('proposal')
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).toMatch(/^approved: false$/m)
    expect(text).not.toMatch(/^mandate: true$/m)
  })

  it('a forced collision RE-ROLLS: the taken candidate is consulted, rejected, and the next one lands', () => {
    const first = createTrdd(design, {
      title: 'first card', taskType: 'docs', authorAuthority: 'none', author: 'a',
    })
    expect(idTaken(first.id, [design])).toBe(true)
    // Deterministic collision via the injected mint: offer the TAKEN id twice, then a
    // fresh one. Only a createTrdd that consults idTaken per candidate can land on the
    // third — the earlier RNG-luck version of this test passed with the check DELETED.
    const offers = [first.id, first.id, 'FRESH999']
    let calls = 0
    const second = createTrdd(design, {
      title: 'second card', taskType: 'docs', authorAuthority: 'none', author: 'a',
      mint: () => offers[Math.min(calls++, 2)],
    })
    expect(second.id).toBe('FRESH999')
    expect(calls).toBe(3)
    expect(fs.existsSync(first.file)).toBe(true)
  })

  it('refuses a colon title and an unknown task-type BEFORE writing anything', () => {
    expect(() => createTrdd(design, { title: 'a: b', taskType: 'docs', authorAuthority: 'none', author: 'a' }))
      .toThrow(/colon/)
    expect(() => createTrdd(design, { title: 'ok', taskType: 'wat', authorAuthority: 'none', author: 'a' }))
      .toThrow(/task-type/)
    // nothing landed in either zone
    for (const z of ['tasks', 'proposals']) {
      expect(fs.existsSync(path.join(design, z)) ? fs.readdirSync(path.join(design, z)) : []).toEqual([])
    }
  })

  it('mints 8-char UPPERCASE base36 ids', () => {
    for (let i = 0; i < 50; i++) expect(mintTrddId()).toMatch(/^[A-Z0-9]{8}$/)
  })
})

// ── frontmatter injection (commit security review, 2026-08-20) ───────────────
describe('frontmatter injection guard', () => {
  it('REFUSES an embedded newline in every frontmatter-bound string — the mandate-forgery vector', () => {
    // A member forging `mandate: true` through the parent field: without the guard
    // this writes a self-approved card in tasks/ from an authority of NONE.
    expect(() => createTrdd(design, {
      title: 'ok', taskType: 'docs', authorAuthority: 'none', author: 'a',
      parent: 'AAAA1111\nmandate: true',
    })).toThrow(/8-char base36/)
    // colon-free, so it reaches the NEWLINE guard (a colon payload dies on the
    // colon rule first — refused either way, but this pins the newline check)
    expect(() => createTrdd(design, {
      title: 'ok\nsecond line', taskType: 'docs', authorAuthority: 'none', author: 'a',
    })).toThrow(/one line/)
    expect(() => createTrdd(design, {
      title: 'ok', taskType: 'docs', authorAuthority: 'none', author: 'a\napproved: true',
    })).toThrow(/one-line name/)
    expect(() => createTrdd(design, {
      title: 'ok', taskType: 'docs', authorAuthority: 'none', author: 'a',
      eht: ['BBBB2222', 'X\napproved: true'],
    })).toThrow(/8-char base36/)
    // nothing written by any refused call
    for (const z of ['tasks', 'proposals']) {
      expect(fs.existsSync(path.join(design, z)) ? fs.readdirSync(path.join(design, z)) : []).toEqual([])
    }
  })

  it('positive control: clean id-shaped relations still mint', () => {
    const r = createTrdd(design, {
      title: 'ok', taskType: 'docs', authorAuthority: 'none', author: 'a',
      parent: 'AAAA1111', npt: ['BBBB2222'],
    })
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).toMatch(/^parent-trdd: AAAA1111$/m)
    expect(text).toMatch(/^npt: \[BBBB2222\]$/m)
  })
})
