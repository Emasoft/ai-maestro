/**
 * R17.24 / TRDD-C455WHV3 — the user-scope plugin WHITELIST for agents.
 *
 * `lib/user-scope-plugin-whitelist.ts` reads the host's user-scope `enabledPlugins` and writes
 * `false` for every non-whitelisted `true` into ONE agent's `.claude/settings.local.json`. That
 * is the whole mechanism: a local `false` overrides a user-scope `true` for that process alone,
 * and nothing at user scope is ever written.
 *
 * WHY THE USER-SCOPE PATH IS INJECTED. The gate's default reads the developer's REAL
 * ~/.claude/settings.json. A test that let it would (a) depend on whatever plugins this machine
 * happens to have and (b) be one bug away from writing the developer's real agent dirs. Every
 * case here passes an explicit fake user file and an explicit fake agent dir under a mkdtemp.
 *
 * WHY THE MIRROR TEST. The whitelist lives in TWO files — lib/ecosystem-constants.ts and its
 * shell mirror scripts/ecosystem-config.sh — and repo names are allowed nowhere else. Two copies
 * drift; the test reads the shell array with its own parser (not the TS constant, which would
 * compare the constant with itself) and asserts order and content are identical.
 *
 * NEUTER RUNS (2026-08-27 — OBSERVED, each reverted after; the file was byte-compared to its
 * backup after every revert):
 *   1. whitelist EMPTIED → 4 reds: 'keeps exactly the five', 'is idempotent', 'merges into an
 *      existing local file', and the shell-mirror test. Two earlier attempts at this run came
 *      back 8/8 GREEN and were both instrument bugs, recorded so the next reader does not
 *      repeat them: (a) the fixture was DERIVED from the constant, so it shrank with it — fixed
 *      by hard-coding THE_FIVE above; (b) the neuter script matched the `]` inside the type
 *      annotation `readonly string[]` and never emptied anything — a `git diff` of the mutated
 *      file, not the test's verdict, is what exposed it.
 *   2. the fail-closed read replaced by `return null` on parse error
 *      → 'fails CLOSED on a corrupt user-scope file' RED, only that one.
 *   3. `res.changed` replaced by a constant `true`
 *      → 'is idempotent' RED, only that one.
 *   4. ONE member (llm-externalizer) dropped from the TS constant, shell untouched
 *      → 3 reds: 'keeps exactly the five', 'is idempotent', and the mirror. The mirror reddening
 *        on a single-member drift is the property that justifies keeping two copies at all.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS } from '@/lib/ecosystem-constants'
import { readAgentPluginWhitelist, writeAgentPluginWhitelist } from '@/lib/agent-plugin-whitelist-store'
import { enforceUserScopePluginWhitelist } from '@/lib/user-scope-plugin-whitelist'

const REPO = path.resolve(__dirname, '..', '..')

/** The five the USER named, HARD-CODED — deliberately not derived from the TS constant. The first
 *  version built the fixture as `[...<the defaults constant>, ...others]`, and the
 *  neuter run that EMPTIED the constant stayed green: the fixture shrank with it, 32 keys still
 *  went false, and every assertion held. A fixture derived from the thing under test cannot see
 *  that thing change. These five are the requirement; the constant is the implementation. */
const THE_FIVE = [
  'ai-maestro-janitor@ai-maestro-plugins',
  'perfect-skill-suggester@emasoft-plugins',
  'claude-plugins-validation@emasoft-plugins',
  'llm-externalizer@emasoft-plugins',
  'ai-maestro-visual-communicator-plugin@ai-maestro-plugins',
]

/** A user scope shaped like the real host on 2026-08-27: the five whitelisted plus a spread of
 *  the host user's own tooling. 37 total, matching the measured count. */
function hostLikeUserScope(): Record<string, boolean> {
  const others = [
    'clangd-lsp@claude-plugins-official', 'claude-code-setup@claude-plugins-official',
    'claude-md-management@claude-plugins-official', 'claude-menu-system@emasoft-plugins',
    'clean-viz@clean-viz-skill', 'code-auditor-agent@emasoft-plugins',
    'code-review@claude-plugins-official', 'code-simplifier@claude-plugins-official',
    'device-screenshot@claude-dev-skills', 'eins78-skills@eins78-marketplace',
    'eli5@claude-community', 'fable-advisor@z13z4ck-plugins', 'git@geoffjay-claude-plugins',
    'github-actions-hardened@github-actions-skill', 'gopls-lsp@claude-plugins-official',
    'huggingface-skills@claude-plugins-official', 'jdtls-lsp@claude-plugins-official',
    'lsp-bash@wookstar-claude-plugins', 'lsp-yaml@wookstar-claude-plugins',
    'open-code-review@open-code-review', 'plugin-dev@claude-plugins-official',
    'ponytail@ponytail', 'pr-review-toolkit@claude-plugins-official',
    'pyright-lsp@claude-plugins-official', 'python-uv@skills-marketplace',
    'rust-analyzer-lsp@claude-plugins-official', 'safe-rm@skills-marketplace',
    'security-guidance@claude-plugins-official', 'skill-creator@claude-plugins-official',
    'swift-lsp@claude-plugins-official', 'typescript-advanced-types@skills-marketplace',
    'typescript-lsp@claude-plugins-official',
  ]
  const ep: Record<string, boolean> = {}
  for (const k of [...THE_FIVE, ...others]) ep[k] = true
  return ep
}

let home: string
let userFile: string
let agentDir: string
/** The whitelist STORE, injected everywhere. Absent by default = the five defaults apply. Never
 *  the developer's real ~/.aimaestro/system-settings.json. */
let storeFile: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'))
  userFile = path.join(home, 'user-settings.json')
  storeFile = path.join(home, 'system-settings.json')
  agentDir = path.join(home, 'agents', 'a1')
  fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true })
})

/** Every gate call in this file goes through here so no case can forget the store path. */
const gate = (dir: string, user: string) => enforceUserScopePluginWhitelist(dir, user, storeFile)

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

function localEnabled(): Record<string, boolean> {
  const p = path.join(agentDir, '.claude', 'settings.local.json')
  return (JSON.parse(fs.readFileSync(p, 'utf8')).enabledPlugins ?? {}) as Record<string, boolean>
}

describe('R17.24 — the user-scope plugin whitelist gate', () => {
  it('keeps exactly the whitelisted five and switches off every other user-scope plugin', async () => {
    const userScope = hostLikeUserScope()
    expect(Object.keys(userScope)).toHaveLength(37)
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: userScope }))

    const r = await gate(agentDir,userFile)
    expect(r.ok).toBe(true)
    expect(r.wrote).toBe(true)
    expect(r.disabled).toHaveLength(32)

    const local = localEnabled()
    for (const k of THE_FIVE) {
      // Whitelisted keys are never WRITTEN — absent locally, so user scope's `true` stands.
      // Asserted against THE_FIVE, not the constant: this is the line that reds when the
      // constant loses a member.
      expect(local, `${k} must not be touched`).not.toHaveProperty(k)
    }
    for (const k of r.disabled) expect(local[k], k).toBe(false)
    expect(Object.values(local).filter(v => v === false)).toHaveLength(32)
  })

  it('never writes the user-scope file (the IRON rule, asserted by bytes, not intention)', async () => {
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: hostLikeUserScope() }, null, 2))
    const before = fs.readFileSync(userFile)
    await gate(agentDir,userFile)
    expect(fs.readFileSync(userFile).equals(before)).toBe(true)
  })

  it('is idempotent: a second pass over an already-enforced agent writes nothing', async () => {
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: hostLikeUserScope() }))
    const first = await gate(agentDir,userFile)
    expect(first.wrote).toBe(true)
    const localPath = path.join(agentDir, '.claude', 'settings.local.json')
    const bytes = fs.readFileSync(localPath)
    const mtime = fs.statSync(localPath).mtimeMs

    const second = await gate(agentDir,userFile)
    expect(second.wrote).toBe(false)
    expect(second.disabled).toEqual([])
    expect(second.alreadyDisabled).toHaveLength(32)
    expect(fs.readFileSync(localPath).equals(bytes)).toBe(true)
    expect(fs.statSync(localPath).mtimeMs).toBe(mtime)
  })

  it('merges into an existing local file: the agent\'s own local plugins survive untouched', async () => {
    const localPath = path.join(agentDir, '.claude', 'settings.local.json')
    fs.writeFileSync(localPath, JSON.stringify({
      enabledPlugins: { 'ai-maestro-plugin@ai-maestro-plugins': true, 'ai-maestro-programmer-agent@ai-maestro-plugins': true },
      permissions: { allow: ['Bash(ls:*)'] },
    }))
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': true, 'ai-maestro-janitor@ai-maestro-plugins': true } }))

    await gate(agentDir,userFile)
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'))
    expect(local.enabledPlugins['ai-maestro-plugin@ai-maestro-plugins']).toBe(true)
    expect(local.enabledPlugins['ai-maestro-programmer-agent@ai-maestro-plugins']).toBe(true)
    expect(local.enabledPlugins['ponytail@ponytail']).toBe(false)
    expect(local.enabledPlugins).not.toHaveProperty('ai-maestro-janitor@ai-maestro-plugins')
    expect(local.permissions).toEqual({ allow: ['Bash(ls:*)'] })
  })

  it('treats a MISSING user-scope file as a pristine host: ok, nothing to do, no local file created', async () => {
    const r = await gate(agentDir,path.join(home, 'does-not-exist.json'))
    expect(r).toEqual({ ok: true, disabled: [], alreadyDisabled: [], wrote: false })
    expect(fs.existsSync(path.join(agentDir, '.claude', 'settings.local.json'))).toBe(false)
  })

  it('fails CLOSED on a corrupt user-scope file rather than reading it as "no plugins"', async () => {
    fs.writeFileSync(userFile, '{ this is not json')
    const r = await gate(agentDir,userFile)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/cannot read user-scope settings/)
    expect(r.wrote).toBe(false)
    expect(fs.existsSync(path.join(agentDir, '.claude', 'settings.local.json'))).toBe(false)
  })

  it('leaves a plugin the user already disabled at user scope alone (only `true` is governed)', async () => {
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': false, 'code-review@claude-plugins-official': true } }))
    const r = await gate(agentDir,userFile)
    expect(r.disabled).toEqual(['code-review@claude-plugins-official'])
    expect(localEnabled()).not.toHaveProperty('ponytail@ponytail')
  })
})

describe('R17.24 — the DEFAULTS constant and its shell mirror agree', () => {
  it('scripts/ecosystem-config.sh DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS equals the TS array, in order', () => {
    const sh = fs.readFileSync(path.join(REPO, 'scripts', 'ecosystem-config.sh'), 'utf8')
    // Parsed here, not sourced: sourcing would execute the script. The array is one quoted
    // stamp per line between `NAME=(` and the closing `)`.
    const m = sh.match(/DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS=\(\n([\s\S]*?)\n\)/)
    expect(m, 'shell mirror array not found').toBeTruthy()
    const shellList = (m as RegExpMatchArray)[1]
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => l.replace(/^"|"$/g, ''))
    expect(shellList).toEqual([...DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS])
    // Both copies are also pinned to the REQUIREMENT, so "TS and shell agree" cannot be
    // satisfied by both drifting the same way (e.g. both emptied).
    expect([...DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS]).toEqual(THE_FIVE)
    expect(shellList).toEqual(THE_FIVE)
  })
})

/**
 * The whitelist is a SETTING (USER correction 2026-08-27): the five are defaults, the effective
 * list lives in the store, and the gate reads the store — never the constant. These cases pin
 * the three semantics the store header promises: absent key → defaults; present key → verbatim,
 * EVEN IF EMPTY (an operator who cleared it decided something); corrupt → refuse, never defaults.
 */
describe('R17.24 — the whitelist is configurable: the store, and the gate reading it', () => {
  it('an absent key yields the five defaults, flagged as default', async () => {
    const r = await readAgentPluginWhitelist(storeFile)
    expect(r.isDefault).toBe(true)
    expect(r.list).toEqual(THE_FIVE)
  })

  it('a written list is read back verbatim (deduped), flagged as configured', async () => {
    await writeAgentPluginWhitelist([...THE_FIVE, 'ponytail@ponytail', 'ponytail@ponytail'], storeFile)
    const r = await readAgentPluginWhitelist(storeFile)
    expect(r.isDefault).toBe(false)
    expect(r.list).toEqual([...THE_FIVE, 'ponytail@ponytail'])
  })

  it('an EMPTY configured list is honoured — it is not mistaken for "unconfigured"', async () => {
    await writeAgentPluginWhitelist([], storeFile)
    const r = await readAgentPluginWhitelist(storeFile)
    expect(r.isDefault).toBe(false)
    expect(r.list).toEqual([])
  })

  it('rejects a key that is not name@marketplace', async () => {
    await expect(writeAgentPluginWhitelist(['not-a-key'], storeFile)).rejects.toThrow(/invalid plugin key/)
    expect(fs.existsSync(storeFile)).toBe(false)
  })

  it('the GATE reads the configured list: a plugin ADDED via the store is no longer switched off', async () => {
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: hostLikeUserScope() }))
    await writeAgentPluginWhitelist([...THE_FIVE, 'ponytail@ponytail'], storeFile)

    const r = await gate(agentDir, userFile)
    expect(r.ok).toBe(true)
    expect(r.disabled).toHaveLength(31)
    expect(r.disabled).not.toContain('ponytail@ponytail')
    expect(localEnabled()).not.toHaveProperty('ponytail@ponytail')
  })

  it('the GATE honours an EMPTY configured list: every user-scope plugin is switched off', async () => {
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: hostLikeUserScope() }))
    await writeAgentPluginWhitelist([], storeFile)
    const r = await gate(agentDir, userFile)
    expect(r.disabled).toHaveLength(37)
  })

  it('the GATE fails CLOSED on a corrupt store rather than silently using the defaults', async () => {
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: hostLikeUserScope() }))
    fs.writeFileSync(storeFile, '{ not json')
    const r = await gate(agentDir, userFile)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/cannot read .*system-settings\.json/)
    expect(fs.existsSync(path.join(agentDir, '.claude', 'settings.local.json'))).toBe(false)
  })
})
