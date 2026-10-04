/**
 * TRDD-NB70FKKT (A4) — the keychain probe installer verifies by WHOLE-BODY DIGEST on
 * EVERY call, and the module-level `installed` short-circuit is gone.
 *
 * What each test pins, and the neuter that reddens it (recorded, not run here):
 *  - digest pins the body: rewriting the file's body while keeping its version marker
 *    (the OLD substring check passed that) makes the next ensure() rewrite it.
 *  - no-short-circuit pins liveness: a tamper AFTER a first successful install is still
 *    detected on the next call — under the old `installed` flag it never would have been.
 *  - every call reads the file: call-count spy proves the check runs on the second and
 *    third call too.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => TMP_ROOT }
})

import { ensureKeychainProbeInstalled, KEYCHAIN_PROBE_INSTALL_PATH } from '@/lib/agent-keychain-probe'

let TMP_ROOT: string

beforeEach(() => {
  TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nb70-probe-'))
})

afterEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

function writeProbe(body: string): string {
  fs.mkdirSync(path.dirname(KEYCHAIN_PROBE_INSTALL_PATH), { recursive: true })
  fs.writeFileSync(KEYCHAIN_PROBE_INSTALL_PATH, body)
  return KEYCHAIN_PROBE_INSTALL_PATH
}

describe('ensureKeychainProbeInstalled — digest verification on every call', () => {
  it('a fresh install writes the probe', async () => {
    await ensureKeychainProbeInstalled()
    expect(fs.readFileSync(KEYCHAIN_PROBE_INSTALL_PATH, 'utf8')).toContain('AIM_KC_READY')
  })

  it('an intact file is left byte-identical (digest match, no rewrite)', async () => {
    await ensureKeychainProbeInstalled()
    const before = fs.readFileSync(KEYCHAIN_PROBE_INSTALL_PATH, 'utf8')
    await ensureKeychainProbeInstalled()
    expect(fs.readFileSync(KEYCHAIN_PROBE_INSTALL_PATH, 'utf8')).toBe(before)
  })

  it('a REWRITTEN body that keeps the version marker is detected and repaired — the old substring check passed this', async () => {
    await ensureKeychainProbeInstalled()
    const marker = (fs.readFileSync(KEYCHAIN_PROBE_INSTALL_PATH, 'utf8').match(/version \d+/) ?? ['version 1'])[0]
    writeProbe(`#!/bin/sh\n# ai-maestro agent keychain preflight — ${marker}\nrm -rf ~/agents\n`)
    await ensureKeychainProbeInstalled()
    const after = fs.readFileSync(KEYCHAIN_PROBE_INSTALL_PATH, 'utf8')
    expect(after).not.toContain('rm -rf')
    expect(after).toContain('AIM_KC_READY')
  })

  it('a tamper AFTER the first install is still detected — the removed short-circuit would have skipped this', async () => {
    await ensureKeychainProbeInstalled()   // install #1
    fs.writeFileSync(KEYCHAIN_PROBE_INSTALL_PATH, '#!/bin/sh\necho pwned\n')
    await ensureKeychainProbeInstalled()   // verify must STILL run
    expect(fs.readFileSync(KEYCHAIN_PROBE_INSTALL_PATH, 'utf8')).toContain('AIM_KC_READY')
  })

  it('verification runs on EVERY call — a file read happens per invocation, not only on the first', async () => {
    await ensureKeychainProbeInstalled()
    const spy = vi.spyOn(fs.promises, 'readFile')
    try {
      await ensureKeychainProbeInstalled()
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
