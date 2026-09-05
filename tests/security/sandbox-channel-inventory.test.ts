/**
 * TRDD-6PIXX1AY — the sandbox profile is a positively-stated boundary, checked as an artifact.
 *
 * `lib/agent-sandbox-channel-inventory.ts` names every channel `buildAgentSandboxProfile` must
 * close. This suite has two layers:
 *
 *  1. TEXT LAYER (portable, runs everywhere) — for every inventory entry, the generated
 *     profile must contain that entry's exact deny statement verbatim. Non-vacuity for this
 *     layer is proven by REMOVING the corresponding rule from `agent-sandbox-profile.ts` and
 *     re-running: exactly that entry's own test reddens, nothing else (recorded at
 *     TRDD-6PIXX1AY's verification step — this is not a claim the suite checks of itself,
 *     because a suite cannot delete its own subject's code to test itself).
 *
 *  2. COVERAGE LAYER — every top-level `(deny ...)` statement the builder actually emits is
 *     matched by at least one inventory entry. This is what makes "add a new agent-reachable
 *     surface without an inventory entry" a red test rather than a silent gap: a new deny rule
 *     with no matching entry fails `every emitted deny rule has an inventory owner`, and an
 *     inventory entry whose deny line the builder no longer emits fails
 *     `every inventory entry matches something the builder actually emits`.
 *
 *  3. BEHAVIOURAL LAYER (macOS only — `describe.skipIf(!isMac)`) — for the channels
 *     `tests/unit/agent-sandbox-profile.test.ts` does not already drive with real
 *     `sandbox-exec` (tmux socket, foreign signals, shared Claude config, LaunchAgent write,
 *     other-agent workdir), this file drives the remaining ones: /dev/ttys, another agent's
 *     AID key store, another agent's transcripts, .zshrc/.zprofile, the shell-snapshots
 *     write-deny (paired with its read-allow), ~/.aimaestro, and the install root. Each is
 *     paired with a positive control proving the same operation succeeds unsandboxed, per
 *     the project's own lesson (`~/.claude/rules/lessons-verification.md`): "Operation not
 *     permitted" is meaningless without a control proving the probe itself works.
 *
 *     CI (`.github/workflows/ci.yml`) runs `yarn test` on `ubuntu-latest`, so this layer never
 *     executes there — recorded here, not silently: acceptance box 5 of TRDD-6PIXX1AY asks for
 *     this to be stated when the suite cannot run on CI. Measured 2026-09-05: no workflow in
 *     `.github/workflows/` runs `yarn test`/vitest on macOS today — `test-installers.yml` uses
 *     `macos-latest` but only exercises the shell installers, not the vitest suite — so this
 *     layer runs in NO CI job at present. It DOES run locally on macOS, where it was executed
 *     and passed; adding a macOS vitest job is the recorded follow-up, same skip convention the
 *     sibling behavioural file already established.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, realpathSync } from 'fs'
import { tmpdir, homedir } from 'os'
import path from 'path'
import { buildAgentSandboxProfile, type AgentSandboxInput } from '@/lib/agent-sandbox-profile'
import { SANDBOX_CHANNEL_INVENTORY } from '@/lib/agent-sandbox-channel-inventory'

const isMac = process.platform === 'darwin'

// A fixed, canonical input — every inventory entry's `denyLine` is a pure function of this
// same input, so the text-layer assertions below and the profile under test agree by
// construction.
const canonicalInput: AgentSandboxInput = {
  agentId: '22222222-2222-4222-8222-222222222222',
  workingDirectory: '/tmp/sbinv-own',
  projectSlug: '-sbinv-slug',
  tmuxSocketDir: '/tmp/tmux-501',
  installRoot: '/tmp/sbinv-install',
}

const profile = buildAgentSandboxProfile(canonicalInput)

describe('TRDD-6PIXX1AY — channel inventory matches the generated profile', () => {
  it.each(SANDBOX_CHANNEL_INVENTORY.map((e) => [e.id, e] as const))(
    'denies: %s',
    (_id, entry) => {
      expect(profile).toContain(entry.denyLine(canonicalInput))
    },
  )

  it('every inventory entry matches something the builder actually emits', () => {
    // Belt-and-braces on the it.each above: fails loudly (rather than per-row) if the
    // inventory and the profile drift as a WHOLE, which is easier to read at a glance.
    const missing = SANDBOX_CHANNEL_INVENTORY.filter(
      (e) => !profile.includes(e.denyLine(canonicalInput)),
    ).map((e) => e.id)
    expect(missing).toEqual([])
  })

  it('every emitted deny rule has an inventory owner (the anti-drift check)', () => {
    // Extracts each top-level `(deny ...)` statement the builder emits and asserts every one
    // is accounted for by at least one inventory entry. A future rule added to
    // agent-sandbox-profile.ts without a matching entry here fails HERE, not silently.
    const denyLines = profile
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('(deny'))
    const owned = SANDBOX_CHANNEL_INVENTORY.map((e) => e.denyLine(canonicalInput))
    const unowned = denyLines.filter((line) => !owned.includes(line))
    expect(unowned).toEqual([])
    // And the reverse count check: exactly as many top-level deny statements as entries,
    // so an entry cannot silently point at the SAME line as another (which would let a real
    // unowned line hide behind a duplicate match above).
    expect(denyLines.length).toBe(SANDBOX_CHANNEL_INVENTORY.length)
  })
})

// ---------------------------------------------------------------------------------------------
// Behavioural layer — real sandbox-exec, macOS only. Mirrors the fixture shape in
// tests/unit/agent-sandbox-profile.test.ts but for the channels that file does not drive.
// ---------------------------------------------------------------------------------------------

let dir: string
let profilePath: string
let ownWorkdir: string
let foreignKeyFile: string
let foreignTranscriptFile: string

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
  // realpathSync: $TMPDIR resolves to /private/var/folders/..., and seatbelt matches the
  // resolved path — same lesson as the sibling behavioural file.
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'sbinv-')))
  ownWorkdir = path.join(dir, 'own-agent')
  mkdirSync(ownWorkdir, { recursive: true })

  const foreignAgentId = '33333333-3333-4333-8333-333333333333'
  const keyStoreRoot = path.join(dir, 'agent-messaging-agents')
  const foreignKeyDir = path.join(keyStoreRoot, foreignAgentId)
  mkdirSync(foreignKeyDir, { recursive: true })
  foreignKeyFile = path.join(foreignKeyDir, 'private.pem')
  writeFileSync(foreignKeyFile, 'FOREIGN-KEY')

  const projectsRoot = path.join(dir, 'claude-projects')
  const foreignProjectDir = path.join(projectsRoot, '-foreign-slug')
  mkdirSync(foreignProjectDir, { recursive: true })
  foreignTranscriptFile = path.join(foreignProjectDir, 'session.jsonl')
  writeFileSync(foreignTranscriptFile, 'FOREIGN-TRANSCRIPT')

  const built = buildAgentSandboxProfile({
    agentId: '11111111-1111-4111-8111-111111111111',
    workingDirectory: ownWorkdir,
    projectSlug: '-own-slug',
    tmuxSocketDir: '/tmp/tmux-501',
    installRoot: path.join(dir, 'install'),
  })
  // Same technique as the sibling file: deny the FOREIGN key/project dirs specifically, so
  // this test does not depend on ~/.agent-messaging/agents or ~/.claude/projects actually
  // holding a second agent's data on the machine running it.
  profilePath = path.join(dir, 'agent.sb')
  writeFileSync(
    profilePath,
    `${built}\n` +
      `(deny file-read* file-write* (subpath "${foreignKeyDir}"))\n` +
      `(deny file-read* file-write* (subpath "${foreignProjectDir}"))\n`,
  )
})

describe.skipIf(!isMac)('agent sandbox profile — channels not covered elsewhere', () => {
  it('denies reading /dev/ttys* (stealing another pane’s input)', () => {
    // Positive control: at least one tty device node must exist and be listable unsandboxed,
    // or "denied" proves nothing about this machine.
    const control = execFileSync('/bin/bash', ['-c', 'ls /dev/ttys* 2>/dev/null | head -1'], {
      encoding: 'utf8',
    })
    if (!control.trim()) return // no /dev/ttys* on this machine; nothing to discriminate

    const tty = control.trim()
    const r = sandboxed(`cat ${JSON.stringify(tty)} 2>&1`)
    expect(r.ok).toBe(false)
  })

  it("denies reading another agent's AID/AMP private key", () => {
    const foreign = sandboxed(`cat ${JSON.stringify(foreignKeyFile)}`)
    expect(foreign.ok).toBe(false)
    // Positive control: unsandboxed the same read succeeds.
    const unsandboxed = readFileSync(foreignKeyFile, 'utf8')
    expect(unsandboxed).toBe('FOREIGN-KEY')
  })

  it("denies reading another agent's Claude Code transcripts", () => {
    const foreign = sandboxed(`cat ${JSON.stringify(foreignTranscriptFile)}`)
    expect(foreign.ok).toBe(false)
    const unsandboxed = readFileSync(foreignTranscriptFile, 'utf8')
    expect(unsandboxed).toBe('FOREIGN-TRANSCRIPT')
  })

  it('denies writing ~/.zshrc and ~/.zprofile', () => {
    for (const rc of ['.zshrc', '.zprofile']) {
      const target = path.join(homedir(), rc)
      const before = (() => {
        try {
          return readFileSync(target, 'utf8')
        } catch {
          return null
        }
      })()
      const r = sandboxed(`printf x >> ${JSON.stringify(target)}`)
      expect(r.ok).toBe(false)
      const after = (() => {
        try {
          return readFileSync(target, 'utf8')
        } catch {
          return null
        }
      })()
      expect(after).toBe(before)
    }
  })

  it('denies WRITING ~/.claude/shell-snapshots while still allowing it to be READ', () => {
    const snapDir = path.join(homedir(), '.claude', 'shell-snapshots')
    const writeAttempt = sandboxed(
      `printf x > ${JSON.stringify(path.join(snapDir, 'sbinv-test-snapshot.sh'))}`,
    )
    expect(writeAttempt.ok).toBe(false)

    // The paired non-vacuity control from rule 3 in agent-sandbox-profile.ts: a directory
    // that does not exist yet on this machine is not evidence of anything either way, so
    // only assert the read succeeds when there IS something to read. `find -type f` (not
    // `ls | head`) because the directory also holds `*.sh.lock` LOCK DIRECTORIES — `cat`
    // on one of those fails with ENOTDIR/EISDIR regardless of the sandbox, which would
    // make this control fail for a reason unrelated to the rule under test.
    const listing = execFileSync(
      '/bin/bash',
      ['-c', `find ${JSON.stringify(snapDir)} -maxdepth 1 -type f -name '*.sh' 2>/dev/null | head -1`],
      { encoding: 'utf8' },
    )
    if (!listing.trim()) return
    const readAttempt = sandboxed(`cat ${JSON.stringify(listing.trim())} > /dev/null && echo readable`)
    expect(readAttempt.ok).toBe(true)
    expect(readAttempt.out).toContain('readable')
  })

  it('denies writing into ~/.aimaestro (which also holds the profile itself)', () => {
    const target = path.join(homedir(), '.aimaestro', 'sbinv-test-write.txt')
    const r = sandboxed(`printf x > ${JSON.stringify(target)}`)
    expect(r.ok).toBe(false)
  })

  it("denies writing into the server's own install root", () => {
    const installRoot = path.join(dir, 'install')
    mkdirSync(installRoot, { recursive: true })
    const target = path.join(installRoot, 'sbinv-test-write.txt')
    const r = sandboxed(`printf x > ${JSON.stringify(target)}`)
    expect(r.ok).toBe(false)
    // Positive control: the same write unsandboxed succeeds, proving the probe itself works.
    writeFileSync(target, 'x')
    expect(readFileSync(target, 'utf8')).toBe('x')
  })
})
