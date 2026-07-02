/**
 * TmuxRuntime.createSession — AIMAESTRO_AGENT self-identification flag.
 *
 * Spec: every ai-maestro agent session must carry `AIMAESTRO_AGENT=1` baked
 * into the tmux session environment via `tmux new-session -e KEY=VAL`, so the
 * agent's `claude` (and every child it spawns — hooks, the janitor's detector
 * subprocesses, a heartbeat-spawned daemon) can self-identify as "inside an
 * ai-maestro agent". The flag is injected at the single launch chokepoint
 * (`TmuxRuntime.createSession`) so the invariant "one agent = one claude
 * process tree, all flagged" holds for EVERY launch path — create, wake,
 * restore, help-assistant, haephestos, and any future caller.
 *
 * `execFileAsync = promisify(execFile)` is built at module load, so we mock
 * child_process.execFile BEFORE importing agent-runtime and capture the argv
 * handed to tmux — no real tmux is spawned.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const execFileCalls: Array<{ cmd: string; args: string[] }> = []

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    // promisify(execFile) expects (file, args, callback). Capture argv and
    // resolve immediately so createSession completes without a real tmux.
    execFile: (
      cmd: string,
      args: string[],
      cb: (err: Error | null, res: { stdout: string; stderr: string }) => void,
    ) => {
      execFileCalls.push({ cmd, args })
      cb(null, { stdout: '', stderr: '' })
    },
  }
})

import { TmuxRuntime } from '@/lib/agent-runtime'

describe('TmuxRuntime.createSession — AIMAESTRO_AGENT flag', () => {
  const runtime = new TmuxRuntime()
  // cwd MUST resolve under ~/agents/ to pass validateCwd (R0 boundary).
  const cwd = path.join(os.homedir(), 'agents', 'rt-flag-test')

  beforeEach(() => {
    execFileCalls.length = 0
  })

  function newSessionArgs(): string[] {
    const call = execFileCalls.find((c) => c.cmd === 'tmux' && c.args[0] === 'new-session')
    if (!call) throw new Error('no `tmux new-session` call was captured')
    return call.args
  }

  it('bakes `-e AIMAESTRO_AGENT=1` into new-session even when NO env is passed', async () => {
    await runtime.createSession('rt-flag-noenv', cwd)
    const args = newSessionArgs()
    const i = args.indexOf('AIMAESTRO_AGENT=1')
    expect(i).toBeGreaterThan(-1)
    expect(args[i - 1]).toBe('-e') // the value follows its own `-e` flag
  })

  it('includes AIMAESTRO_AGENT=1 alongside caller-provided env vars', async () => {
    await runtime.createSession('rt-flag-withenv', cwd, {
      AGENT_WORK_DIR: cwd,
      AIM_AGENT_NAME: 'rt-flag-withenv',
    })
    const args = newSessionArgs()
    expect(args).toContain('AIMAESTRO_AGENT=1')
    expect(args).toContain(`AGENT_WORK_DIR=${cwd}`)
    expect(args).toContain('AIM_AGENT_NAME=rt-flag-withenv')
  })

  it('forces AIMAESTRO_AGENT=1 — a caller cannot override it to a falsy value', async () => {
    await runtime.createSession('rt-flag-override', cwd, { AIMAESTRO_AGENT: '0' })
    const args = newSessionArgs()
    expect(args).toContain('AIMAESTRO_AGENT=1')
    expect(args).not.toContain('AIMAESTRO_AGENT=0')
  })
})
