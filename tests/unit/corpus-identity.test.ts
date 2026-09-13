/**
 * `corpusIdentity` is the ONE normalization both the pillar index's
 * `corpusKeyFor` and the kanban index's `defaultKanbanIndexPath` /
 * `isKanbanIndexStale` route through, so a symlinked design root reads as the
 * SAME corpus everywhere.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { corpusIdentity } from '@/lib/corpus-identity'

describe('corpusIdentity', () => {
  it('gives a symlink and its target the same identity', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-identity-'))
    try {
      const real = path.join(tmp, 'realproj')
      fs.mkdirSync(real, { recursive: true })
      const link = path.join(tmp, 'linkproj')
      try {
        fs.symlinkSync(real, link)
      } catch {
        // Platform cannot symlink (e.g. unprivileged Windows) — nothing to assert.
        return
      }
      expect(corpusIdentity(link)).toBe(corpusIdentity(real))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('is deterministic for a path that does not exist on disk', () => {
    const missing = '/definitely/not/here/' + Math.random().toString(36).slice(2)
    expect(() => corpusIdentity(missing)).not.toThrow()
    expect(corpusIdentity(missing)).toBe(corpusIdentity(missing))
  })

  it('gives two different real directories different identities', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-identity-'))
    try {
      const a = path.join(tmp, 'a')
      const b = path.join(tmp, 'b')
      fs.mkdirSync(a, { recursive: true })
      fs.mkdirSync(b, { recursive: true })
      expect(corpusIdentity(a)).not.toBe(corpusIdentity(b))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('agrees with plain path.resolve for a path with no symlink component', () => {
    // Zero corpora on this machine traverse a symlink (measured against every
    // real design/ root found: 11/11 identical) — this pins that the common
    // case is unaffected by adding the realpath step.
    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, 'corpus-identity-keystable-'))
    try {
      expect(corpusIdentity(dir)).toBe(path.resolve(dir))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
