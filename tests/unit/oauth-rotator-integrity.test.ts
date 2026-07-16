import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  sha256Bytes,
  atomicWriteBytes,
  backupAndWrite,
  readOrRestore,
  backupIsConsistent,
} from '@/lib/oauth-rotator/integrity'

// 0-IMPACT: everything happens inside an isolated temp dir; no keychain, no network, no shared
// state. Faithful-port checks — the .bak/.sha256 sidecars + recovery match janitor_integrity.py.

let tmpDir: string
let file: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-integrity-'))
  file = path.join(tmpDir, 'state.json')
})

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('sha256Bytes', () => {
  it('is lowercase hex and matches a known vector', () => {
    // sha256("") — the canonical empty-input digest.
    expect(sha256Bytes(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})

describe('atomicWriteBytes', () => {
  it('writes the exact bytes, owner-only mode, and leaves no tmp behind', () => {
    atomicWriteBytes(file, Buffer.from('hello', 'utf8'))
    expect(fs.readFileSync(file, 'utf8')).toBe('hello')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.readdirSync(tmpDir).some(n => n.includes('.tmp.'))).toBe(false)
  })
})

describe('backupAndWrite + readOrRestore round-trip', () => {
  it('writes primary + .bak + both .sha256 sidecars, and reads the primary back', () => {
    const data = Buffer.from('{"live_email":null,"slots":{}}', 'utf8')
    backupAndWrite(file, data)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.existsSync(file + '.bak')).toBe(true)
    expect(fs.readFileSync(file + '.sha256', 'utf8')).toBe(sha256Bytes(data))
    expect(fs.readFileSync(file + '.bak.sha256', 'utf8')).toBe(sha256Bytes(data))
    expect(readOrRestore(file)!.toString('utf8')).toBe(data.toString('utf8'))
    expect(backupIsConsistent(file)).toBe(true)
  })
})

describe('readOrRestore corruption recovery', () => {
  it('restores the primary from .bak when the primary is corrupt but .bak verifies', () => {
    const good = Buffer.from('GOOD', 'utf8')
    backupAndWrite(file, good)
    // Corrupt ONLY the primary; leave its (now-mismatched) sidecar and the intact .bak pair.
    fs.writeFileSync(file, 'CORRUPT')
    const restored = readOrRestore(file)
    expect(restored!.toString('utf8')).toBe('GOOD')
    // The primary + its sidecar were re-healed from .bak.
    expect(fs.readFileSync(file, 'utf8')).toBe('GOOD')
    expect(fs.readFileSync(file + '.sha256', 'utf8')).toBe(sha256Bytes(good))
  })

  it('returns null when BOTH the primary and .bak are unrecoverable', () => {
    backupAndWrite(file, Buffer.from('GOOD', 'utf8'))
    fs.writeFileSync(file, 'CORRUPT') // primary mismatches its sidecar
    fs.writeFileSync(file + '.bak', 'ALSO-CORRUPT') // .bak now mismatches ITS sidecar too
    expect(readOrRestore(file)).toBeNull()
  })

  it('trusts a primary that has NO sidecar (a pre-integrity / freshly migrated file)', () => {
    fs.writeFileSync(file, 'LEGACY')
    expect(readOrRestore(file)!.toString('utf8')).toBe('LEGACY')
  })

  it('returns null for a wholly absent path', () => {
    expect(readOrRestore(path.join(tmpDir, 'nope.json'))).toBeNull()
  })
})

describe('backupIsConsistent', () => {
  it('is false for a pre-integrity file (no sidecar) and true after backupAndWrite', () => {
    fs.writeFileSync(file, 'x')
    expect(backupIsConsistent(file)).toBe(false)
    backupAndWrite(file, Buffer.from('x', 'utf8'))
    expect(backupIsConsistent(file)).toBe(true)
  })
})
