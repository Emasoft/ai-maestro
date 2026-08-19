// lib/chat-state-path.ts — THE one resolver from an agent cwd to the hook's chat-state file.
// Measured 2026-08-19 (TRDD-O8NCNRWO live e2e): three server-side md5 mirrors of the hook's
// hashCwd read a file that had not existed since the hook went sha256 on 2026-05-08. What this
// file pins, against a REAL tmp dir (0-IMPACT: never the developer's ~/.aimaestro):
//   - the hook's published index.json wins over any derivation (the hook owns the mapping);
//   - no index → the hook's CURRENT derivation, sha256(cwd)[:16];
//   - the md5-era path is never the answer (positive control: md5 ≠ sha256 for the fixture cwd);
//   - a malformed index value is ignored, not trusted.
// Neuter: flip hashCwdLikeHook back to md5 → the sha256 + never-md5 tests red.

import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { chatStateFileFor, hashCwdLikeHook } from '@/lib/chat-state-path'

const CWD = '/Users/someone/agents/test-agent'
// Derived from the RULE (the hook's documented derivation), never by calling the code under test.
const SHA = crypto.createHash('sha256').update(CWD).digest('hex').substring(0, 16)
const MD5 = crypto.createHash('md5').update(CWD).digest('hex').substring(0, 16)

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-state-path-'))
})

describe('chatStateFileFor', () => {
  it('positive control: the fixture cwd hashes differently under md5 and sha256', () => {
    expect(MD5).not.toBe(SHA)
  })
  it('with no index, resolves to the sha256 derivation — the hook\'s current algorithm', () => {
    expect(chatStateFileFor(CWD, dir)).toBe(path.join(dir, `${SHA}.json`))
    expect(hashCwdLikeHook(CWD)).toBe(SHA)
  })
  it('never resolves to the md5-era path (the 2026-05-08 → 2026-08-19 regression)', () => {
    fs.writeFileSync(path.join(dir, `${MD5}.json`), '{"subagentCount":3}') // the relic exists
    expect(chatStateFileFor(CWD, dir)).not.toBe(path.join(dir, `${MD5}.json`))
  })
  it("the hook's index.json mapping wins over derivation", () => {
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ [CWD]: 'fedcba9876543210', '/other': SHA }))
    expect(chatStateFileFor(CWD, dir)).toBe(path.join(dir, 'fedcba9876543210.json'))
  })
  it('a malformed or missing index entry falls back to derivation (never trusts junk)', () => {
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ [CWD]: '../escape', '/x': 'abc' }))
    expect(chatStateFileFor(CWD, dir)).toBe(path.join(dir, `${SHA}.json`))
    fs.writeFileSync(path.join(dir, 'index.json'), '{not json')
    expect(chatStateFileFor(CWD, dir)).toBe(path.join(dir, `${SHA}.json`))
    expect(chatStateFileFor('/never/indexed', dir)).toBe(path.join(dir, `${hashCwdLikeHook('/never/indexed')}.json`))
  })
})
