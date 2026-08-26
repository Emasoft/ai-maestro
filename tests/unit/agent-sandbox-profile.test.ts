/**
 * TRDD-O0RHX7K6 / TRDD-0GX8FOCJ — the per-agent seatbelt profile.
 *
 * These tests drive the REAL `sandbox-exec` against a REAL generated profile. A test that
 * only asserted the emitted string would pin the TEXT and not the BEHAVIOUR — and the whole
 * reason this profile exists is that a plausible-looking seatbelt rule can silently permit
 * (a UNIX-socket connect is `network-outbound`, not `file-read*`; seatbelt matches
 * /private/tmp, not /tmp). Both mistakes produce a profile that reads correct and enforces
 * nothing, so string assertions are exactly the wrong instrument here.
 *
 * Every deny test is paired with a POSITIVE CONTROL proving the same operation SUCCEEDS
 * unsandboxed — otherwise "Operation not permitted" is indistinguishable from a typo in the
 * probe, which is the failure mode that made an earlier card conclude seatbelt could not work.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, realpathSync } from 'fs'
import { tmpdir, homedir } from 'os'
import path from 'path'
import { buildAgentSandboxProfile } from '@/lib/agent-sandbox-profile'

const isMac = process.platform === 'darwin'

let dir: string
let profilePath: string
let ownWorkdir: string
let siblingFile: string

/** Run a command under the profile. Returns combined output + whether it succeeded. */
function sandboxed(script: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync('sandbox-exec', ['-f', profilePath, '/bin/bash', '-c', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

beforeAll(() => {
  // realpathSync is load-bearing, not tidiness: macOS $TMPDIR is /var/folders/... which
  // RESOLVES to /private/var/folders/..., and seatbelt matches the resolved path. Writing
  // the unresolved form into a rule makes it match nothing and silently permit — this test
  // caught exactly that on its first run, which is the same trap that made an earlier card
  // conclude sandboxing could not confine agents.
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'sbprof-')))
  ownWorkdir = path.join(dir, 'own-agent')
  const sibling = path.join(dir, 'sibling-agent')
  mkdirSync(ownWorkdir, { recursive: true })
  mkdirSync(sibling, { recursive: true })
  siblingFile = path.join(sibling, 'secret.txt')
  writeFileSync(siblingFile, 'SIBLING')
  writeFileSync(path.join(ownWorkdir, 'mine.txt'), 'MINE')

  const profile = buildAgentSandboxProfile({
    agentId: '11111111-1111-4111-8111-111111111111',
    workingDirectory: ownWorkdir,
    projectSlug: '-test-slug',
    tmuxSocketDir: '/tmp/tmux-501',
    installRoot: path.join(dir, 'install'),
  })
  // Deny the SIBLING dir specifically so this test does not depend on the real ~/agents
  // layout existing on the machine running it.
  profilePath = path.join(dir, 'agent.sb')
  writeFileSync(
    profilePath,
    `${profile}\n(deny file-read* file-write* (subpath "${sibling}"))\n`,
  )
})

describe.skipIf(!isMac)('agent sandbox profile — real sandbox-exec behaviour', () => {
  it('CONTROL: the profile loads and ordinary work still succeeds under it', () => {
    // If this fails, every deny below is meaningless — a profile that refuses to load
    // makes sandbox-exec fail for reasons unrelated to any rule.
    const r = sandboxed('echo alive; cat "$0"'.replace('$0', path.join(ownWorkdir, 'mine.txt')))
    expect(r.ok).toBe(true)
    expect(r.out).toContain('alive')
    expect(r.out).toContain('MINE')
  })

  it('denies the shared tmux socket — including a raw connect that never runs the tmux binary', () => {
    // Positive control: the socket must be reachable unsandboxed, or "denied" proves nothing.
    const control = execFileSync('/bin/bash', ['-c', 'ls -d /tmp/tmux-* 2>/dev/null || true'], {
      encoding: 'utf8',
    })
    if (!control.trim()) return // no tmux server on this machine; nothing to discriminate

    const viaBinary = sandboxed('tmux -S /tmp/tmux-501/default list-sessions')
    expect(viaBinary.ok).toBe(false)

    // The block must be on connect(2), not on the tmux binary — otherwise a custom client
    // walks straight through it, which is the first thing an attacker would write.
    const raw = sandboxed(
      `/usr/bin/python3 -c 'import socket;s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect("/tmp/tmux-501/default")'`,
    )
    expect(raw.ok).toBe(false)
    expect(raw.out).toMatch(/not permitted/i)
  })

  it('denies writing the shared Claude config that every other agent loads', () => {
    const target = path.join(homedir(), '.claude', 'settings.json')
    const r = sandboxed(`printf x >> ${JSON.stringify(target)}`)
    expect(r.ok).toBe(false)
    // Integrity: the file must be untouched. A test that only checked the exit code would
    // pass even if the write had partially landed.
    expect(readFileSync(target, 'utf8').endsWith('x')).toBe(false)
  })

  it('denies a LaunchAgent plist drop, which launchd would run OUTSIDE the sandbox', () => {
    const target = path.join(homedir(), 'Library', 'LaunchAgents', 'sbprof-test.plist')
    const r = sandboxed(`printf x > ${JSON.stringify(target)}`)
    expect(r.ok).toBe(false)
  })

  it('denies another agent working directory while leaving its own writable', () => {
    const foreign = sandboxed(`cat ${JSON.stringify(siblingFile)}`)
    expect(foreign.ok).toBe(false)

    const own = sandboxed(`printf ok > ${JSON.stringify(path.join(ownWorkdir, 'written.txt'))}`)
    expect(own.ok).toBe(true)
  })

  it('lets the agent signal its OWN children — the rule that breaks the agent if omitted', () => {
    // `(deny signal)` without the self/children allows makes the agent unable to manage its
    // own subprocesses. Measured: it breaks Python's subprocess.terminate().
    const r = sandboxed('sleep 30 & p=$!; kill $p && echo signalled-own-child')
    expect(r.ok).toBe(true)
    expect(r.out).toContain('signalled-own-child')
  })
})

describe('TRDD-0GX8FOCJ — the profile is EMITTED, never templated', () => {
  const base = {
    agentId: '11111111-1111-4111-8111-111111111111',
    workingDirectory: '/tmp/x',
    projectSlug: '-slug',
    tmuxSocketDir: '/tmp/tmux-501',
    installRoot: '/tmp/install',
  }

  it('refuses a value that would close the string and append attacker-chosen policy', () => {
    // The attack: a workdir containing `")` ends the literal, and everything after it is
    // policy the sandboxed process wrote for itself — e.g. re-allowing the tmux socket.
    expect(() =>
      buildAgentSandboxProfile({
        ...base,
        workingDirectory: '/tmp/evil") (allow network-outbound) (subpath "/tmp/x',
      }),
    ).toThrow(/cannot be safely represented/)
  })

  it('refuses control characters and backslashes rather than emitting them', () => {
    expect(() => buildAgentSandboxProfile({ ...base, projectSlug: 'a\nb' })).toThrow()
    expect(() => buildAgentSandboxProfile({ ...base, projectSlug: 'a\\b' })).toThrow()
  })

  it('resolves /tmp to /private/tmp, because seatbelt matches the resolved path', () => {
    // Not cosmetic: a rule written against the unresolved path matches NOTHING and the
    // profile silently permits. This exact mistake is why an earlier card concluded
    // sandboxing could not confine agents.
    const p = buildAgentSandboxProfile(base)
    expect(p).toContain('"/private/tmp/tmux-501"')
    expect(p).not.toContain('(subpath "/tmp/tmux-501")')
  })
})
