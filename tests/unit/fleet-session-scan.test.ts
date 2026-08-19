import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CLAUDE_SUBCOMMANDS,
  classifySessionAge,
  findJanitorRoot,
  gatherJanitorSessions,
  isReplInvocation,
  makeRegistryRootFilter,
  normalizeTty,
  parsePsClaude,
  parseTmuxPanes,
  projectSlug,
  SESSION_ACTIVE_FRESH_S,
  SESSION_STALE_S,
  transcriptAgeS,
} from '@/lib/fleet-session-scan'
import { scanFleetLiveness, type FleetScanDeps } from '@/lib/fleet-liveness'

// TRDD-99LV0U4I — the second fleet population. The parsers are a port of the janitor's
// `fleet_scan.py`; the fixtures below are the shapes a real `ps` / `tmux` on this host prints
// (captured 2026-08-19: 21 claude sessions, 2 of them registered agents under ~/agents/).

const PS = [
  '92150 s002     claude --add-dir /tmp --continue --dangerously-skip-permissions --model fable --effort high',
  '37441 s035     claude --agent testbot',
  '  812 ??       /Users/x/.local/share/claude/versions/2.1.221 daemon run',
  '  813 ??       claude plugin marketplace update',
  '  814 s040     claude bg-spare',
  '  815 s041     /usr/bin/python3 /Users/x/.claude/plugins/cache/foo/claude-plugins-validation/x.py',
  '  816 s042     node /Users/x/Code/claude-something/index.js',
  'garbage line without a pid',
  '  817 s043     /Users/x/.local/share/claude/versions/2.1.221 --model sonnet',
  '  818 ??       claude',
].join('\n')

describe('isReplInvocation — position-1 verb test (janitor TRDD-R3D5YRQJ semantics)', () => {
  it('bare `claude` and flag-first argv are sessions', () => {
    expect(isReplInvocation('claude')).toBe(true)
    expect(isReplInvocation('claude --agent foo')).toBe(true)
  })
  it('every listed one-shot verb is excluded, including the hidden ones', () => {
    for (const v of CLAUDE_SUBCOMMANDS) expect(isReplInvocation(`claude ${v} whatever`)).toBe(false)
    expect(CLAUDE_SUBCOMMANDS.has('daemon')).toBe(true)
    expect(CLAUDE_SUBCOMMANDS.has('bg-spare')).toBe(true)
  })
  it('an UNKNOWN first token is a session (including beats excluding)', () => {
    expect(isReplInvocation('claude frobnicate')).toBe(true)
  })
})

describe('parsePsClaude — ps -eo pid=,tty=,command= → sessions only', () => {
  it('keeps interactive sessions (basename claude OR versioned launcher), drops one-shot verbs, helpers and garbage', () => {
    const got = parsePsClaude(PS)
    expect(got.map((p) => p.pid)).toEqual([92150, 37441, 817, 818])
  })
  it('normalizes the tty: ps prints s002, lsof/tmux print /dev/ttys002, both must key equal', () => {
    const got = parsePsClaude(PS)
    expect(got[0].tty).toBe('ttys002')
    expect(got.find((p) => p.pid === 818)?.tty).toBe('')
    expect(normalizeTty('/dev/ttys002')).toBe('ttys002')
    expect(normalizeTty('??')).toBe('')
  })
  it('never substring-matches `claude` (plugin names, .claude paths) — the cache-prune predicate', () => {
    expect(parsePsClaude(PS).map((p) => p.pid)).not.toContain(815)
    expect(parsePsClaude(PS).map((p) => p.pid)).not.toContain(816)
  })
})

describe('parseTmuxPanes', () => {
  it('maps normalized tty → pane id and skips malformed rows', () => {
    const m = parseTmuxPanes('/dev/ttys035 %361\n/dev/ttys037 %2\nbroken\n\n')
    expect(m.get('ttys035')).toBe('%361')
    expect(m.get('ttys037')).toBe('%2')
    expect(m.size).toBe(2)
  })
})

describe('findJanitorRoot / projectSlug / transcriptAgeS / classifySessionAge', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fss-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('walks UP to the nearest .janitor dir, bounded; null when none', () => {
    const root = path.join(tmp, 'proj.v2')
    fs.mkdirSync(path.join(root, '.janitor'), { recursive: true })
    fs.mkdirSync(path.join(root, 'a', 'b', 'c'), { recursive: true })
    expect(findJanitorRoot(path.join(root, 'a', 'b', 'c'))).toBe(root)
    expect(findJanitorRoot(path.join(tmp, 'elsewhere'))).toBeNull()
    expect(findJanitorRoot(null)).toBeNull()
  })
  it('slug dashes EVERY non-alphanumeric char (dots and underscores too — the janitor memory_scopes SSOT)', () => {
    expect(projectSlug('/Users/x/Code/perfect-skill-suggester/2.2.2')).toBe('-Users-x-Code-perfect-skill-suggester-2-2-2')
    expect(projectSlug('/tmp/4vmcr_496')).toBe('-tmp-4vmcr-496')
  })
  it('transcriptAgeS reads the NEWEST *.jsonl under ~/.claude/projects/<slug>/ (injected home), null when absent', () => {
    const root = path.join(tmp, 'my_proj')
    const tdir = path.join(tmp, 'home', '.claude', 'projects', projectSlug(root))
    fs.mkdirSync(tdir, { recursive: true })
    const now = 1_000_000
    fs.writeFileSync(path.join(tdir, 'old.jsonl'), '')
    fs.utimesSync(path.join(tdir, 'old.jsonl'), now - 5000, now - 5000)
    fs.writeFileSync(path.join(tdir, 'new.jsonl'), '')
    fs.utimesSync(path.join(tdir, 'new.jsonl'), now - 100, now - 100)
    fs.writeFileSync(path.join(tdir, 'ignored.txt'), '')
    fs.utimesSync(path.join(tdir, 'ignored.txt'), now - 1, now - 1)
    expect(transcriptAgeS(root, now, path.join(tmp, 'home'))).toBe(100)
    expect(transcriptAgeS(path.join(tmp, 'no-such'), now, path.join(tmp, 'home'))).toBeNull()
  })
  it('classifies: <5min active, <15min alive, ≥15min stale, null unknown (never stale)', () => {
    expect(classifySessionAge(SESSION_ACTIVE_FRESH_S - 1)).toBe('active')
    expect(classifySessionAge(SESSION_ACTIVE_FRESH_S)).toBe('alive')
    expect(classifySessionAge(SESSION_STALE_S - 1)).toBe('alive')
    expect(classifySessionAge(SESSION_STALE_S)).toBe('stale')
    expect(classifySessionAge(null)).toBe('unknown')
  })
})

describe('gatherJanitorSessions — composition with injected I/O (no real ps/tmux/lsof)', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fss-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function fixture() {
    const devRoot = path.join(tmp, 'plugin-dev')
    const agentRoot = path.join(tmp, 'agents', 'testbot')
    const bareRoot = path.join(tmp, 'no-janitor-here')
    for (const r of [devRoot, agentRoot]) fs.mkdirSync(path.join(r, '.janitor'), { recursive: true })
    fs.mkdirSync(bareRoot, { recursive: true })
    const home = path.join(tmp, 'home')
    const now = 2_000_000
    const tdir = path.join(home, '.claude', 'projects', projectSlug(devRoot))
    fs.mkdirSync(tdir, { recursive: true })
    fs.writeFileSync(path.join(tdir, 's.jsonl'), '')
    fs.utimesSync(path.join(tdir, 's.jsonl'), now - SESSION_STALE_S - 1, now - SESSION_STALE_S - 1)
    const cwd: Record<number, string> = { 100: path.join(devRoot, 'sub'), 200: agentRoot, 300: bareRoot }
    const deps = {
      nowS: () => now,
      ps: async () => '100 s001 claude --continue\n200 s002 claude --agent testbot\n300 s003 claude\n',
      tmuxPanes: async () => '/dev/ttys002 %7\n',
      cwdOf: async (pid: number) => cwd[pid] ?? null,
      homeDir: home,
    }
    return { devRoot, agentRoot, deps }
  }

  it('reports janitor-armed sessions tagged origin janitor-session, with tmux pane + stale class; skips non-janitor cwds', async () => {
    const { devRoot, agentRoot, deps } = fixture()
    const got = await gatherJanitorSessions(deps)
    expect(got.map((s) => s.pid).sort()).toEqual([100, 200])
    const dev = got.find((s) => s.pid === 100)!
    expect(dev).toMatchObject({ origin: 'janitor-session', projectRoot: devRoot, class: 'stale', tmuxPane: null })
    expect(dev.transcriptAgeS).toBe(SESSION_STALE_S + 1)
    const agent = got.find((s) => s.pid === 200)!
    expect(agent).toMatchObject({ projectRoot: agentRoot, tmuxPane: '%7', class: 'unknown' })
  })

  it('a REGISTERED agent root is filtered out (it is origin registry, covered by the agent scan) — nested cwd included', async () => {
    const { devRoot, agentRoot, deps } = fixture()
    const got = await gatherJanitorSessions({ ...deps, isRegistryRoot: makeRegistryRootFilter([agentRoot, null, '']) })
    expect(got.map((s) => s.pid)).toEqual([100])
    // and the filter itself: equal OR inside, never a sibling with a shared prefix
    const f = makeRegistryRootFilter([agentRoot])
    expect(f(agentRoot)).toBe(true)
    expect(f(path.join(agentRoot, 'deeper'))).toBe(true)
    expect(f(agentRoot + '-sibling')).toBe(false)
    expect(f(devRoot)).toBe(false)
  })
})

describe('scanFleetLiveness — the second population threads through the snapshot (detect-only)', () => {
  function deps(over: Partial<FleetScanDeps> = {}): FleetScanDeps {
    return {
      listAgents: () => [{ id: 'a1', name: 'alpha', workingDirectory: '/agents/alpha' }],
      getStatus: async () => ({ hasSession: true, exists: true, timeSinceActivityMs: 60 * 60_000 }),
      getHookNotification: () => ({ status: 'idle', notificationType: 'idle_prompt' }),
      actuationBlocked: () => ({ blocked: false, reason: null }),
      ...over,
    }
  }

  it('registry agents carry origin registry; sessions carry origin janitor-session; recoveryTargets stay registry-only', async () => {
    let seenFilter: ((r: string) => boolean) | null = null
    const snap = await scanFleetLiveness(
      deps({
        listJanitorSessions: async (isRegistryRoot) => {
          seenFilter = isRegistryRoot
          return [
            { origin: 'janitor-session', pid: 9, tty: 'ttys009', tmuxPane: null, projectRoot: '/Code/dev', transcriptAgeS: 99_999, class: 'stale' },
          ]
        },
      }),
      1,
    )
    expect(snap.agents.every((a) => a.origin === 'registry')).toBe(true)
    expect(snap.sessions).toHaveLength(1)
    expect(snap.sessions![0].origin).toBe('janitor-session')
    // a stale non-agent session is NOT a recovery target — the ids here are registry agentIds only
    expect(snap.recoveryTargets).toEqual(['a1'])
    // the filter handed to the discoverer is built from the registry workdirs
    expect(seenFilter!('/agents/alpha/sub')).toBe(true)
    expect(seenFilter!('/Code/dev')).toBe(false)
  })

  it('without a discoverer the snapshot carries NO sessions key (the pre-99LV0U4I shape), and a throwing discoverer yields [] rather than failing the scan', async () => {
    const a = await scanFleetLiveness(deps(), 1)
    expect('sessions' in a).toBe(false)
    const b = await scanFleetLiveness(
      deps({
        listJanitorSessions: async () => {
          throw new Error('lsof exploded')
        },
      }),
      1,
    )
    expect(b.sessions).toEqual([])
    expect(b.agents).toHaveLength(1)
  })
})
