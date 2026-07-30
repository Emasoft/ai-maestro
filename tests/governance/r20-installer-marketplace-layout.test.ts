/**
 * R20.28 — "Five canonical local marketplace folder patterns. The ONLY valid
 * local marketplace folder names under `~/agents/` are exactly these five
 * patterns. No other folder is ever registered as a marketplace, and no
 * additional pattern is ever invented. […] The installer MUST create every
 * folder pattern that is applicable for the installed clients and MUST write a
 * valid manifest inside each — even if the plugins array is currently empty."
 *
 * Guard: `scripts/setup-local-marketplaces.sh` (run by `install-messaging.sh`).
 *
 * WHY THIS TEST IS A SUBPROCESS, AND WHY THE GUARD MOVED TO ITS OWN FILE
 * ---------------------------------------------------------------------
 * R20.28 is a claim about what the installer PUTS ON DISK, so the only honest
 * proof runs the code and looks at the result. Two things made that impossible
 * before today, and both were fixed rather than worked around:
 *
 *   1. An in-process `$HOME` swap cannot contain a process that resolves paths
 *      at exec. The redirect has to be in the SPAWN ENV — `os.homedir()` and
 *      `$HOME` in bash both honour it there.
 *   2. The guard was 180 lines inside the 1,386-line `install-messaging.sh`,
 *      which also shells out to `claude`, to cargo/npm (via the code-analysis
 *      tooling installer), and copies into `~/.local/bin`. Running the whole
 *      installer to observe one block is neither fast nor 0-IMPACT, so the
 *      block was extracted into `scripts/setup-local-marketplaces.sh` — the
 *      same delegation pattern that block already used twice. That also stops
 *      the citation rotting: the guard is a whole FILE now, not a line range.
 *      (The previous citation, `install-messaging.sh:936-1110`, had drifted
 *      ~87 lines and pointed at skill migration and the tooling installer.)
 *
 * THE PRIOR JUDGMENT THIS SUPERSEDES
 * ----------------------------------
 * `r20-marketplace-governance.test.ts` declined to pin R20.28, arguing "a
 * vitest assertion could only grep the script's TEXT, which pins the text and
 * not the behaviour." That was right about grepping and wrong about the only
 * option: a subprocess run under a fake `$HOME` observes the BEHAVIOUR. The
 * five patterns are still pinned at their TypeScript source of truth by that
 * file's R20.1 block; this file pins that the installer actually produces them.
 *
 * CONTAINMENT IS PROVEN POSITIVELY, NOT ASSUMED
 * ---------------------------------------------
 * "The real dir is unchanged" is indistinguishable from "the script never ran",
 * so every layout assertion below reads the FAKE home — those can only pass if
 * the redirect took effect — and `beforeAll` additionally snapshots the real
 * `~/agents` before and after and asserts it is byte-for-byte the same listing.
 * `claude` is a PATH shim in a temp bin dir, so no marketplace is ever
 * registered with the developer's real Claude CLI.
 *
 * WHAT NEUTER A FOUND — TWO PRODUCERS, SO ONE RUN COULD NOT SEE IT
 * ----------------------------------------------------------------
 * On its first run neuter A reddened NOTHING. `migrate-r20-disk-layout.sh`
 * (:135, :269) ALSO creates `custom-marketplace/` and `roles-marketplace/`, so
 * with the migration script present the guard's own `mkdir` is dead weight and
 * deleting it changes nothing. It is load-bearing on exactly one branch — the
 * one the guard itself documents, "migration script not found (fresh install)"
 * — which no test reached. The FRESH-INSTALL describe below runs the guard from
 * a directory that has no migration script, so the else-branch is exercised and
 * the mkdir is the only producer left. This is the "several enabled inputs can
 * produce the same output" trap: a neuter must switch off every producer but
 * the one it names, or it proves nothing.
 *
 * NEUTER RECORD (2026-07-30) — four, complementary:
 *   A. delete `mkdir -p "$ROLES_DIR/roles-marketplace"`
 *      -> only the FRESH-INSTALL test reds (see above); with the migration
 *         script present every other test correctly stays green.
 *   B. drop `kiro` from `for CLIENT in codex gemini kiro opencode`
 *      -> 4 red: per-client coverage, the exact-set, the per-client manifests,
 *         and fresh-install (which asserts every client's core marketplace).
 *   C. make `create_per_client_marketplaces` skip writing the flat
 *      `marketplace.json` -> 2 red: the per-client MANIFEST test and the
 *      re-run test. The DIRECTORIES still exist and every folder-pattern test
 *      correctly stays green — which is what separates "the folder pattern"
 *      from "a valid manifest inside each".
 *   D. invent a Claude core marketplace (`mkdir core-marketplace` +
 *      `setup_local_marketplace "$CORE_DIR" …` after the cleanup)
 *      -> 3 red: the R20.25 core-absence test, the exact-set test, and the
 *         re-run test. One mistake, three detectors.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, copyFileSync, readdirSync, readFileSync, existsSync, rmSync, chmodSync } from 'fs'
import { tmpdir, homedir } from 'os'
import path from 'path'

const REPO = path.resolve(__dirname, '../..')
const GUARD = path.join(REPO, 'scripts/setup-local-marketplaces.sh')

const CLIENTS = ['codex', 'gemini', 'kiro', 'opencode'] as const

/** The exact `*-marketplace` folder set R20.28 permits, per container. */
const CANONICAL: Record<string, string[]> = {
  // (1) Claude role-plugins + (2) per-client role-plugins
  'role-plugins': ['roles-marketplace', ...CLIENTS.map(c => `${c}-roles-marketplace`)],
  // (3) Claude custom plugins + (4) per-client custom plugins
  'custom-plugins': ['custom-marketplace', ...CLIENTS.map(c => `${c}-custom-marketplace`)],
  // (5) per-client core plugin — Claude is ABSENT here by R20.25
  'core-plugins': CLIENTS.map(c => `${c}-core-marketplace`),
}

let FAKE_HOME = ''
let FAKE_BIN = ''
let realAgentsBefore: string[] = []

/** Run the installer's marketplace step with $HOME + PATH redirected. */
function runGuard(home: string): string {
  return execFileSync('bash', [GUARD], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, PATH: `${FAKE_BIN}:${process.env.PATH ?? ''}` },
    timeout: 60_000,
  })
}

const listRealAgents = (): string[] => {
  const dir = path.join(homedir(), 'agents')
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

const marketplaceDirs = (container: string): string[] =>
  readdirSync(path.join(FAKE_HOME, 'agents', container))
    .filter(n => n.endsWith('-marketplace'))
    .sort()

const readJson = (...seg: string[]) =>
  JSON.parse(readFileSync(path.join(FAKE_HOME, 'agents', ...seg), 'utf-8'))

beforeAll(() => {
  FAKE_HOME = mkdtempSync(path.join(tmpdir(), 'r20-28-home-'))
  FAKE_BIN = mkdtempSync(path.join(tmpdir(), 'r20-28-bin-'))

  // A `claude` that answers but does nothing: the guard registers the two
  // Claude container marketplaces and probes `marketplace list`. Shimming it
  // keeps the developer's real Claude CLI untouched AND keeps the run offline.
  const shim = path.join(FAKE_BIN, 'claude')
  writeFileSync(shim, '#!/bin/sh\nexit 0\n')
  chmodSync(shim, 0o755)

  realAgentsBefore = listRealAgents()
  runGuard(FAKE_HOME)
})

afterAll(() => {
  for (const d of [FAKE_HOME, FAKE_BIN]) if (d) rmSync(d, { recursive: true, force: true })
})

describe('R20.28 — the installer creates exactly the five canonical marketplace patterns', () => {
  it('wrote into the FAKE home, and left the real ~/agents untouched', () => {
    // The positive half FIRST: if the $HOME redirect had not taken effect this
    // directory would not exist, and every assertion below would be vacuous.
    expect(existsSync(path.join(FAKE_HOME, 'agents'))).toBe(true)
    expect(listRealAgents()).toEqual(realAgentsBefore)
  })

  it('(1) creates the Claude role-plugins marketplace subdir', () => {
    expect(existsSync(path.join(FAKE_HOME, 'agents/role-plugins/roles-marketplace'))).toBe(true)
  })

  it('(3) creates the Claude custom-plugins marketplace subdir', () => {
    expect(existsSync(path.join(FAKE_HOME, 'agents/custom-plugins/custom-marketplace'))).toBe(true)
  })

  it('(2)(4)(5) creates a per-client marketplace for every client, in all three containers', () => {
    for (const [container, kind] of [['role-plugins', 'roles'], ['custom-plugins', 'custom'], ['core-plugins', 'core']]) {
      for (const client of CLIENTS) {
        const dir = path.join(FAKE_HOME, 'agents', container, `${client}-${kind}-marketplace`)
        expect(existsSync(dir), `${container}/${client}-${kind}-marketplace`).toBe(true)
      }
    }
  })

  it('invents NO additional pattern — the marketplace folder set is exactly the canonical one', () => {
    // "No other folder is ever registered as a marketplace, and no additional
    // pattern is ever invented" is the half a per-pattern existence check
    // cannot see: it needs set EQUALITY, not membership.
    for (const [container, expected] of Object.entries(CANONICAL)) {
      expect(marketplaceDirs(container), container).toEqual([...expected].sort())
    }
  })

  it('R20.25 — core-plugins gets NO Claude marketplace, only per-client ones', () => {
    expect(existsSync(path.join(FAKE_HOME, 'agents/core-plugins/.claude-plugin'))).toBe(false)
    expect(marketplaceDirs('core-plugins')).not.toContain('core-marketplace')
  })
})

describe('R20.28 — "a valid manifest inside each, even if the plugins array is empty"', () => {
  it('the two Claude marketplaces carry a CONTAINER-level manifest naming themselves', () => {
    for (const [container, name] of [
      ['role-plugins', 'ai-maestro-local-roles-marketplace'],
      ['custom-plugins', 'ai-maestro-local-custom-marketplace'],
    ]) {
      const mf = readJson(container, '.claude-plugin/marketplace.json')
      expect(mf.name, container).toBe(name)
      expect(Array.isArray(mf.plugins), `${container} plugins`).toBe(true)
    }
  })

  it('the Claude marketplace SUBDIR carries no flat manifest — the container one is the manifest', () => {
    // The discriminator between the two halves of the rule's last sentence: a
    // flat manifest here would mean the Claude marketplace was registered at
    // the subfolder, which is exactly what R20.28 forbids.
    for (const [container, sub] of [['role-plugins', 'roles-marketplace'], ['custom-plugins', 'custom-marketplace']]) {
      expect(existsSync(path.join(FAKE_HOME, 'agents', container, sub, 'marketplace.json')), `${container}/${sub}`).toBe(false)
    }
  })

  it('every per-client marketplace carries a FLAT, valid, self-naming manifest', () => {
    for (const [container, kind] of [['role-plugins', 'roles'], ['custom-plugins', 'custom'], ['core-plugins', 'core']]) {
      for (const client of CLIENTS) {
        const mf = readJson(container, `${client}-${kind}-marketplace`, 'marketplace.json')
        expect(mf.name, `${container}/${client}`).toBe(`ai-maestro-local-${client}-${kind}-marketplace`)
        expect(mf.plugins, `${container}/${client} plugins`).toEqual([])
      }
    }
  })

  it('every container has its .abstract IR hub', () => {
    for (const container of Object.keys(CANONICAL)) {
      expect(existsSync(path.join(FAKE_HOME, 'agents', container, '.abstract')), container).toBe(true)
    }
  })
})

describe('R20.28 — the layout survives a re-run', () => {
  it('a second install keeps every folder and manifest, and adds nothing', () => {
    // "MUST create every folder pattern" is a claim about every run, not the
    // first: a re-run that wiped the flat manifests, or that invented a Claude
    // core marketplace on the second pass, would violate the rule while
    // passing every assertion above.
    const home = mkdtempSync(path.join(tmpdir(), 'r20-28-rerun-'))
    try {
      runGuard(home)
      const first = readdirSync(path.join(home, 'agents/core-plugins')).sort()
      runGuard(home)
      expect(readdirSync(path.join(home, 'agents/core-plugins')).sort()).toEqual(first)
      const mf = JSON.parse(readFileSync(path.join(home, 'agents/core-plugins/codex-core-marketplace/marketplace.json'), 'utf-8'))
      expect(mf.name).toBe('ai-maestro-local-codex-core-marketplace')
      expect(existsSync(path.join(home, 'agents/core-plugins/.claude-plugin'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('R20.28 — a FRESH install, with no R20 migration script to lean on', () => {
  it('still creates the two Claude marketplace subdirs', () => {
    // The guard resolves the migration script next to ITSELF, so a copy in a
    // directory without it takes the documented "not found (fresh install)"
    // branch. That is the only configuration in which the guard's own
    // `mkdir -p .../roles-marketplace` is the sole producer — with the
    // migration script present, migrate-r20-disk-layout.sh:135/:269 creates
    // both subdirs too, and deleting the guard's mkdir changes nothing.
    const bare = mkdtempSync(path.join(tmpdir(), 'r20-28-bare-'))
    const home = mkdtempSync(path.join(tmpdir(), 'r20-28-fresh-'))
    try {
      copyFileSync(GUARD, path.join(bare, 'setup-local-marketplaces.sh'))
      copyFileSync(path.join(REPO, 'scripts/ecosystem-config.sh'), path.join(bare, 'ecosystem-config.sh'))
      expect(existsSync(path.join(bare, 'migrate-r20-disk-layout.sh'))).toBe(false)

      const out = execFileSync('bash', [path.join(bare, 'setup-local-marketplaces.sh')], {
        encoding: 'utf-8',
        env: { ...process.env, HOME: home, PATH: `${FAKE_BIN}:${process.env.PATH ?? ''}` },
        timeout: 60_000,
      })
      // Prove the branch was actually taken, not that the run merely succeeded.
      expect(out).toContain('migration script not found')

      expect(existsSync(path.join(home, 'agents/role-plugins/roles-marketplace'))).toBe(true)
      expect(existsSync(path.join(home, 'agents/custom-plugins/custom-marketplace'))).toBe(true)
      // …and the rest of the layout is unaffected by the missing migration.
      for (const client of CLIENTS) {
        expect(existsSync(path.join(home, 'agents/core-plugins', `${client}-core-marketplace`)), client).toBe(true)
      }
    } finally {
      for (const d of [bare, home]) rmSync(d, { recursive: true, force: true })
    }
  })
})

describe('R20.28 — install-messaging.sh still runs the guard', () => {
  it('the installer delegates to scripts/setup-local-marketplaces.sh', () => {
    // The extraction is only safe while the installer still calls it. Without
    // this, deleting the delegation would leave every test above green against
    // a script nothing runs.
    const installer = readFileSync(path.join(REPO, 'install-messaging.sh'), 'utf-8')
    expect(installer).toContain('scripts/setup-local-marketplaces.sh')
  })
})
