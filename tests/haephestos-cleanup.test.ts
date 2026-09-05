/**
 * Haephestos cleanup-route regression test (TRDD-E5AAE555).
 *
 * User directive: "haephestos folder must be deleted and cleaned up after
 * each session ... only the folder can remain, but its content must be
 * gone." POST /api/agents/creation-helper/cleanup/route.ts is the route that
 * enforces this. This test drives the REAL route against a REAL, sandboxed
 * filesystem (a temp dir substituted for $HOME) — never the developer's
 * actual ~/agents/haephestos/ — and never mocks `fs`/`fs/promises`, per the
 * TRDD's own risk mitigation (§7: "Sandbox via /tmp/haephestos-test-<pid>/
 * with mocked HOME; restore HOME in teardown").
 *
 * Mocks (non-fs only):
 *   - `@/lib/route-auth` — enforceSystemOwner bypass (auth is not what this
 *     test is about; same pattern as tests/integration/haephestos-pipeline.test.ts)
 *   - `child_process` execFile — the route also does `tmux kill-session
 *     -t _aim-creation-helper`. Left un-mocked, this would reach out to the
 *     REAL tmux server on the machine running the test and could kill an
 *     actually-running Haephestos session that happens to share that name.
 *     The route already tolerates the call failing (try/catch, "session
 *     didn't exist" is fine), so stubbing it to reject is behaviourally
 *     equivalent to "no such session" and keeps the test's blast radius to
 *     the sandboxed HOME only.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('@/lib/route-auth', () => ({
  enforceSystemOwner: vi.fn(() => null),
}))

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_cmd: string, _args: string[], cb: (err: Error) => void) => {
    cb(new Error('no such session (stubbed — real tmux is never touched by this test)'))
  }),
}))

vi.mock('child_process', async () => ({
  ...(await vi.importActual<typeof import('child_process')>('child_process')),
  execFile: execFileMock,
}))

import { POST } from '@/app/api/agents/creation-helper/cleanup/route'
import { NextRequest } from 'next/server'

function makeCleanupRequest(): NextRequest {
  return new NextRequest(
    new URL('/api/agents/creation-helper/cleanup', 'http://localhost:23000'),
    { method: 'POST' },
  )
}

let sandboxHome: string
let originalHome: string | undefined

beforeEach(() => {
  originalHome = process.env.HOME
  // Real temp dir, never the developer's real $HOME — this is the whole
  // point of the sandbox: the cleanup route reads process.env.HOME to
  // compute ~/agents/haephestos, so pointing HOME here means the route's
  // real filesystem code runs against a throwaway tree.
  sandboxHome = mkdtempSync(join(tmpdir(), 'haephestos-cleanup-test-'))
  process.env.HOME = sandboxHome
  execFileMock.mockClear()
})

afterEach(() => {
  process.env.HOME = originalHome
  rmSync(sandboxHome, { recursive: true, force: true })
})

describe('Haephestos cleanup route — TRDD-E5AAE555', () => {
  test('wipes ~/agents/haephestos/ content but leaves the folder itself', async () => {
    const workDir = join(sandboxHome, 'agents', 'haephestos')
    mkdirSync(workDir, { recursive: true })
    const artifactPath = join(workDir, 'fakeartifact.txt')
    writeFileSync(artifactPath, 'leftover draft content from a prior session')

    // Positive control — prove the seed actually landed before asserting
    // the route removed it. Without this, a route that never touched the
    // filesystem at all would pass the "is empty" assertion below just as
    // well as a correctly-implemented one.
    expect(existsSync(artifactPath)).toBe(true)

    const res = await POST(makeCleanupRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cleaned).toBe(true)

    // The folder must still exist ("only the folder can remain")...
    expect(existsSync(workDir)).toBe(true)
    // ...and be empty ("its content must be gone").
    expect(readdirSync(workDir)).toEqual([])
    expect(existsSync(artifactPath)).toBe(false)
  })

  test('is idempotent when ~/agents/haephestos/ does not exist yet (first-ever run)', () => {
    // No workDir pre-seeded at all — the route must still succeed and end
    // with an existing, empty folder, never throw on a missing source dir.
    const workDir = join(sandboxHome, 'agents', 'haephestos')
    expect(existsSync(workDir)).toBe(false)

    return POST(makeCleanupRequest()).then(async (res) => {
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.cleaned).toBe(true)
      expect(existsSync(workDir)).toBe(true)
      expect(readdirSync(workDir)).toEqual([])
    })
  })

  test('attempts to kill the tmux session (real tmux is never reached — stubbed)', async () => {
    await POST(makeCleanupRequest())
    expect(execFileMock).toHaveBeenCalled()
    const [cmd, args] = execFileMock.mock.calls[0] as unknown as [string, string[]]
    expect(cmd).toBe('tmux')
    expect(args).toEqual(['kill-session', '-t', '_aim-creation-helper'])
  })
})
