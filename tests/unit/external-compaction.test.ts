/**
 * TRDD-DSQUWKVI — the server-side trigger for the janitor's zero-turn externalized compaction.
 *
 * The theme of this file is that MOST OUTCOMES ARE NOT FAULTS. `active-waiting` (a resume or a
 * background agent is in flight) is the design working; `DISABLED` is an un-set opt-in. A
 * runner that surfaced those as exceptions would get them logged as errors and retried, which
 * is how a correct refusal becomes an incident. So every documented token is driven, and the
 * two that must never read as failure are asserted by name.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  compareVersionDirs,
  parseExternalCompactionOutput,
  resolveStablePython,
  runExternalCompaction,
} from '@/lib/external-compaction'

const SCRIPT = '/fake/cache/ai-maestro-janitor/9.9.9/scripts/external_handoff_clear.py'
const PY = '/opt/py/bin/python3.13'
/** A probe that answers for one candidate only — mirrors a real host, where most of the
 *  candidate names do not exist. */
const probeFor = (name: string) => (cmd: string) => (cmd === name ? PY : null)

describe('compareVersionDirs — NUMERIC, because lexicographic pins the fleet to an old script', () => {
  it('orders 3.3.10 above 3.3.9 (the case string sorting gets wrong)', () => {
    expect(compareVersionDirs('3.3.10', '3.3.9')).toBeGreaterThan(0)
    expect(['3.3.9', '3.3.10', '3.4.0'].sort((a, b) => compareVersionDirs(b, a))[0]).toBe('3.4.0')
  })

  it('sorts non-release dirs LAST — a stray dir must never outrank a real version', () => {
    expect(compareVersionDirs('3.3.3', 'next')).toBeGreaterThan(0)
    expect(compareVersionDirs('next', '3.3.3')).toBeLessThan(0)
  })
})

describe('parseExternalCompactionOutput — every documented token', () => {
  it('CLEAR_CHAIN_SPAWNED is the ONLY outcome that reads as fired', () => {
    const o = parseExternalCompactionOutput('CLEAR_CHAIN_SPAWNED trigger=idle\n')
    expect(o.status).toBe('fired')
    expect(o.fired).toBe(true)
  })

  it('a HOLD is not a failure, and it carries its WHY — active-waiting protects running work', () => {
    const o = parseExternalCompactionOutput('VERDICT HOLD trigger=- why=active-waiting\n')
    expect(o.status).toBe('held')
    expect(o.why).toBe('active-waiting')
    expect(o.fired).toBe(false)
    // The whole point: a resume or a background agent is IN FLIGHT. Clearing now would strand
    // it. The response is to wait — never to force, which cannot pass a safety veto anyway.
  })

  it.each([
    ['NO_RECORDED_PANE cannot bootstrap after /clear — declining', 'no-pane'],
    ['HANDOFF_NOT_CONCISE too-many-lines,pasted-content', 'handoff-too-fat'],
    ['DISABLED set CLAUDE_PLUGIN_OPTION_EXTERNAL_IDLE_CLEAR_ENABLED=1 to opt in', 'disabled'],
    ['NO_JANITOR_STATE /some/project', 'no-janitor-state'],
    ['DRY_RUN would clear via tmux (812B handoff)', 'dry-run'],
  ])('maps %s', (line, status) => {
    const o = parseExternalCompactionOutput(line)
    expect(o.status).toBe(status)
    expect(o.fired).toBe(false)
  })

  it('unknown text is `error` — never silently a success, never silently a hold', () => {
    expect(parseExternalCompactionOutput('Traceback (most recent call last):').status).toBe('error')
    expect(parseExternalCompactionOutput('').status).toBe('error')
  })

  it('reads the FIRST NON-EMPTY line — a leading blank line must not erase the verdict', () => {
    expect(parseExternalCompactionOutput('\n\nCLEAR_CHAIN_SPAWNED trigger=idle').status).toBe('fired')
  })
})

describe('resolveStablePython — the uv gotcha', () => {
  it('prefers an explicit minor over bare python3 (macOS fronts 3.9, which the script refuses)', () => {
    expect(resolveStablePython({ probePython: probeFor('python3.12') })).toBe(PY)
    // Probe order is the assertion: if bare `python3` were tried first we would pin whatever
    // PATH happens to front.
    const seen: string[] = []
    resolveStablePython({ probePython: (c) => { seen.push(c); return c === 'python3' ? PY : null } })
    expect(seen[0]).toMatch(/^python3\.\d+$/)
    expect(seen[seen.length - 1]).toBe('python3')
  })

  it('returns null when nothing satisfies the floor — the caller must NOT fall back to uv', () => {
    expect(resolveStablePython({ probePython: () => null })).toBeNull()
  })
})

describe('runExternalCompaction', () => {
  const ok = { scriptPath: SCRIPT, probePython: probeFor('python3.13'), run: async () => 'CLEAR_CHAIN_SPAWNED trigger=idle' }

  it('passes the agent workdir as --project-root AND as the child-only CLAUDE_PROJECT_DIR', async () => {
    const run = vi.fn(async () => 'CLEAR_CHAIN_SPAWNED trigger=idle')
    const out = await runExternalCompaction({ projectRoot: '/Users/x/agents/bot' }, { ...ok, run })
    expect(out.fired).toBe(true)
    const [python, args, env] = run.mock.calls[0] as unknown as [string, string[], NodeJS.ProcessEnv]
    expect(python).toBe(PY) // a STABLE interpreter, never `uv`
    expect(args[0]).toBe(SCRIPT)
    expect(args).toContain('--project-root')
    expect(args[args.indexOf('--project-root') + 1]).toBe('/Users/x/agents/bot')
    // Unset, the chain writes the resume marker into the WRONG tree and the cleared session
    // waits forever for a marker that never arrives.
    expect(env.CLAUDE_PROJECT_DIR).toBe('/Users/x/agents/bot')
    // ...and the server's own env is not mutated to achieve it.
    expect(process.env.CLAUDE_PROJECT_DIR).not.toBe('/Users/x/agents/bot')
  })

  it('NEVER passes --force: it cannot pass a safety veto, so offering it would only mislead', async () => {
    const run = vi.fn(async () => 'CLEAR_CHAIN_SPAWNED trigger=idle')
    await runExternalCompaction({ projectRoot: '/Users/x/agents/bot', onResume: true, dryRun: true }, { ...ok, run })
    const [, args] = run.mock.calls[0] as unknown as [string, string[]]
    expect(args).not.toContain('--force')
    expect(args).toContain('--on-resume')
    expect(args).toContain('--dry-run')
  })

  it('strips VIRTUAL_ENV — an inherited pointer at a parent ephemeral env makes uv refuse to run', async () => {
    const run = vi.fn(async () => 'CLEAR_CHAIN_SPAWNED trigger=idle')
    const prev = process.env.VIRTUAL_ENV
    process.env.VIRTUAL_ENV = '/tmp/ephemeral-venv'
    try {
      await runExternalCompaction({ projectRoot: '/Users/x/agents/bot' }, { ...ok, run })
    } finally {
      if (prev === undefined) delete process.env.VIRTUAL_ENV
      else process.env.VIRTUAL_ENV = prev
    }
    const [, , env] = run.mock.calls[0] as unknown as [string, string[], NodeJS.ProcessEnv]
    expect(env.VIRTUAL_ENV).toBeUndefined()
  })

  it('a RELATIVE projectRoot is refused — it would resolve against the SERVER cwd', async () => {
    const run = vi.fn(async () => 'CLEAR_CHAIN_SPAWNED')
    const out = await runExternalCompaction({ projectRoot: 'agents/bot' }, { ...ok, run })
    expect(out.status).toBe('error')
    expect(out.fired).toBe(false)
    expect(run).not.toHaveBeenCalled() // refused BEFORE spawning anything
  })

  it('no cached script → unavailable, and nothing is spawned', async () => {
    const run = vi.fn(async () => 'CLEAR_CHAIN_SPAWNED')
    const out = await runExternalCompaction({ projectRoot: '/Users/x/agents/bot' }, { ...ok, scriptPath: null, run })
    expect(out.status).toBe('unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  it('no stable python → unavailable rather than a uv fallback (the TCC denial is silent)', async () => {
    const run = vi.fn(async () => 'CLEAR_CHAIN_SPAWNED')
    const out = await runExternalCompaction(
      { projectRoot: '/Users/x/agents/bot' },
      { scriptPath: SCRIPT, probePython: () => null, run },
    )
    expect(out.status).toBe('unavailable')
    expect(out.line).toMatch(/uv/)
    expect(run).not.toHaveBeenCalled()
  })

  it('a HOLD propagates as a non-throwing outcome — a correct refusal is not an incident', async () => {
    const out = await runExternalCompaction(
      { projectRoot: '/Users/x/agents/bot' },
      { ...ok, run: async () => 'VERDICT HOLD trigger=- why=active-waiting' },
    )
    expect(out.status).toBe('held')
    expect(out.why).toBe('active-waiting')
  })

  it('a spawn failure becomes `error`, never an unhandled rejection', async () => {
    const out = await runExternalCompaction(
      { projectRoot: '/Users/x/agents/bot' },
      { ...ok, run: async () => { throw new Error('ENOENT') } },
    )
    expect(out.status).toBe('error')
    expect(out.line).toMatch(/ENOENT/)
  })
})
