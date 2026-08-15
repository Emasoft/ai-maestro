/**
 * Server-triggered EXTERNALIZED COMPACTION — run the janitor's zero-turn shrink for a named
 * agent (TRDD-DSQUWKVI; USER directive 2026-08-15).
 *
 * WHAT IT TRIGGERS. `external_handoff_clear.py` composes a link-only handoff into the target
 * project's `.janitor/state/agent-handoff.md` from ON-DISK facts (TRDD `## STATE` blocks, git
 * log, the findings ledger), optionally upgrading the prose through the `llm-ext` CLI at $0,
 * then types `/clear` plus a verified bootstrap chain (`/janitor-arm`, `/janitor-resume`) into
 * that project's recorded pane. There is NO model turn anywhere in the path — which is the
 * whole point, since `/compact` pays a full-price sampling step over the very context it is
 * trying to shrink.
 *
 * WHY A SUBPROCESS AND NOT A PANE INJECTION. Both exist and they are not rivals:
 *
 *   - the ATTENDED path injects `/janitor-externalized-compaction` (see `agent-commands.ts`),
 *     which needs the agent's REPL to be responsive and at idle to consume the keystroke;
 *   - THIS path runs the script directly, so it works on an agent that can no longer act for
 *     itself — and a wedged agent is exactly when a shrink is needed.
 *
 * The pane is not a problem for the subprocess form: `external_handoff_clear.py:402` resolves
 * it via `fleet_restart.recorded_terminal(str(root))`, i.e. from the `--project-root` PASSED
 * IN (`<root>/.janitor/state/terminal-identity.json`). Verified first-hand in the shipped
 * 3.3.3 cache, not taken from a report — an earlier version of this work asserted the
 * opposite and was wrong.
 *
 * WHAT THIS MODULE DOES NOT DECIDE. Every veto stays in the janitor's script, which owns the
 * only state that can answer them: `active-waiting` (a resume or BACKGROUND AGENT is in
 * flight), `NO_RECORDED_PANE`, `HANDOFF_NOT_CONCISE`, the opt-in gate. This module NEVER
 * passes `--force`: forcing relaxes two TRIGGER terms and cannot get past a safety veto
 * anyway, so a caller that wanted it would be asking for something the flag does not do.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'

/** The janitor's plugin cache root — versioned dirs, newest wins (the same auto-roll the
 *  janitor's own dispatcher stub performs, so a plugin update needs no change here). */
function janitorCacheRoot(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'cache', 'ai-maestro-plugins', 'ai-maestro-janitor')
}

/** Compare two version dir names NUMERICALLY, segment by segment. Lexicographic sorting picks
 *  `3.3.9` over `3.3.10`, which would silently pin the fleet to an older script the day a
 *  two-digit patch ships. Non-numeric segments sort last (they are not releases). */
export function compareVersionDirs(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : Number.NaN))
  const av = parse(a)
  const bv = parse(b)
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const x = av[i] ?? -1
    const y = bv[i] ?? -1
    if (Number.isNaN(x) && Number.isNaN(y)) continue
    if (Number.isNaN(x)) return -1
    if (Number.isNaN(y)) return 1
    if (x !== y) return x - y
  }
  return 0
}

/**
 * The newest cached `external_handoff_clear.py`, or null when the janitor is not installed.
 *
 * Requires the FILE to exist, not merely the version dir: a partially-extracted or older
 * cache entry that lacks the script must not be selected and then fail at spawn time with a
 * confusing ENOENT. Never throws — an unreadable cache reads as "not available", which is the
 * fail-safe direction for a capability that ends in a `/clear`.
 */
export function resolveExternalClearScript(): string | null {
  let entries: string[]
  try {
    entries = fs.readdirSync(janitorCacheRoot())
  } catch {
    return null
  }
  const candidates = entries
    .map((v) => ({ v, script: path.join(janitorCacheRoot(), v, 'scripts', 'external_handoff_clear.py') }))
    .filter((c) => {
      try {
        return fs.statSync(c.script).isFile()
      } catch {
        return false
      }
    })
    .sort((x, y) => compareVersionDirs(y.v, x.v))
  return candidates[0]?.script ?? null
}

/**
 * A STABLE python3 ≥ 3.11, or null.
 *
 * ⚠ THIS IS THE `uv run` GOTCHA, AND IT IS THE REASON THIS FUNCTION EXISTS. The script's
 * shebang is `uv run --script`, and the janitor's skill invokes it that way — which is correct
 * IN A SESSION and wrong HERE. The chain's real work happens in a DETACHED CHILD that
 * `clear_trigger` spawns as `[sys.executable, clear_trigger.py, ...]`. Under `uv run`,
 * `sys.executable` is an EPHEMERAL interpreter uv mints per run, so on macOS the TCC
 * Automation grant can never attach to a stable client and every keystroke injection is
 * DENIED — the shrink appears to fire and nothing is ever typed. Handing the script a stable
 * interpreter makes the detached child stable too.
 *
 * The script declares `requires-python = ">=3.11"` and NO dependencies, so a plain interpreter
 * is sufficient — there is no uv-managed environment to miss.
 */
export function resolveStablePython(deps?: ExternalCompactionDeps): string | null {
  const probe = deps?.probePython ?? defaultProbePython
  // Explicit minor versions first: `python3` alone is whatever the PATH happens to front, and
  // on macOS that is frequently the 3.9 system build, which the script refuses.
  for (const cand of ['python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3']) {
    const resolved = probe(cand)
    if (resolved) return resolved
  }
  return null
}

/** Ask a candidate interpreter for its own absolute path, but ONLY if it satisfies the
 *  script's floor. Returning `sys.executable` (not the name we probed) is what pins a stable
 *  path rather than one that re-resolves through PATH in the child. */
function defaultProbePython(cmd: string): string | null {
  const { execFileSync } = require('child_process') as typeof import('child_process')
  try {
    const out = execFileSync(
      cmd,
      ['-c', 'import sys;print(sys.executable if sys.version_info>=(3,11) else "")'],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const p = String(out).trim()
    return p.length > 0 ? p : null
  } catch {
    return null
  }
}

/** The documented first-word outcomes of `external_handoff_clear.py`. */
export type ExternalCompactionStatus =
  | 'fired'            // CLEAR_CHAIN_SPAWNED — the chain is queued at the agent's pane
  | 'held'             // VERDICT HOLD … — a trigger term or a safety veto; see `why`
  | 'no-pane'          // NO_RECORDED_PANE — it could not bootstrap back, so it declined
  | 'handoff-too-fat'  // HANDOFF_NOT_CONCISE — capture state into TRDDs/wikimem, do not force
  | 'disabled'         // DISABLED — the opt-in env flag is unset
  | 'no-janitor-state' // NO_JANITOR_STATE — that project is not armed
  | 'dry-run'          // DRY_RUN — nothing changed; the composed handoff follows on stdout
  | 'unavailable'      // we could not even invoke it (no script / no interpreter)
  | 'error'            // it ran and said something we do not recognise

export interface ExternalCompactionOutcome {
  status: ExternalCompactionStatus
  /** The script's own first line, verbatim — the audit surface. Empty when unavailable. */
  line: string
  /** Parsed from `why=…` on a HOLD, when present. `active-waiting` is the common one. */
  why?: string
  /** True only for `fired`. Convenience so callers cannot mis-read a HOLD as success —
   *  the failure this guards is real: most outcomes here are NOT faults, so a caller
   *  branching on "did it throw?" would read every correct refusal as a success. */
  fired: boolean
}

export interface ExternalCompactionDeps {
  /** Injected for tests: resolve a python candidate to a stable absolute path, or null. */
  probePython?: (cmd: string) => string | null
  /** Injected for tests: run the script. Resolves with stdout even on a non-zero exit — the
   *  script reports its refusals on STDOUT, and treating exit status as the verdict would
   *  collapse "declined correctly" into "crashed". */
  run?: (script: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>
  scriptPath?: string | null
}

/** Map the script's leading token to a typed status. Unknown text is `error` — never silently
 *  a success, and never silently a hold either. */
export function parseExternalCompactionOutput(stdout: string): ExternalCompactionOutcome {
  const line = (stdout.split('\n').find((l) => l.trim().length > 0) ?? '').trim()
  const token = line.split(/\s+/)[0] ?? ''
  const why = /(?:^|\s)why=([^\s]+)/.exec(line)?.[1]
  const of = (status: ExternalCompactionStatus): ExternalCompactionOutcome => ({
    status,
    line,
    ...(why ? { why } : {}),
    fired: status === 'fired',
  })
  switch (token) {
    case 'CLEAR_CHAIN_SPAWNED':
      return of('fired')
    case 'VERDICT':
      return of('held')
    case 'NO_RECORDED_PANE':
      return of('no-pane')
    case 'HANDOFF_NOT_CONCISE':
      return of('handoff-too-fat')
    case 'DISABLED':
      return of('disabled')
    case 'NO_JANITOR_STATE':
      return of('no-janitor-state')
    case 'DRY_RUN':
      return of('dry-run')
    default:
      return of('error')
  }
}

export interface ExternalCompactionRequest {
  /** The AGENT's working directory — becomes `--project-root` AND the child's
   *  `CLAUDE_PROJECT_DIR`. Must be absolute: a relative path would resolve against the
   *  SERVER's cwd, which is the one directory this must never mean. */
  projectRoot: string
  /** `--on-resume` relaxes the long-idle TRIGGER term for a just-loaded session, which can
   *  never satisfy it. Not a veto override. */
  onResume?: boolean
  /** `--dry-run` composes and prints the handoff, changing nothing. */
  dryRun?: boolean
}

/**
 * Fire (or correctly decline) an externalized compaction for one agent.
 *
 * NEVER THROWS on a refusal, and that is the contract that matters: `active-waiting` — a
 * resume or background agent is in flight — is the design WORKING, and `DISABLED` is an
 * un-set opt-in rather than a fault. A caller that learned about those through an exception
 * would log them as errors and, worse, might retry them.
 */
export async function runExternalCompaction(
  req: ExternalCompactionRequest,
  deps: ExternalCompactionDeps = {},
): Promise<ExternalCompactionOutcome> {
  if (!path.isAbsolute(req.projectRoot)) {
    return { status: 'error', line: `refused: projectRoot must be absolute (got ${req.projectRoot})`, fired: false }
  }
  const script = deps.scriptPath !== undefined ? deps.scriptPath : resolveExternalClearScript()
  if (!script) {
    return { status: 'unavailable', line: 'no cached external_handoff_clear.py — the janitor plugin is not installed', fired: false }
  }
  const python = resolveStablePython(deps)
  if (!python) {
    return { status: 'unavailable', line: 'no stable python3 >= 3.11 — refusing to invoke via uv (ephemeral sys.executable breaks the detached chain)', fired: false }
  }

  const args = [script, '--project-root', req.projectRoot]
  if (req.onResume) args.push('--on-resume')
  if (req.dryRun) args.push('--dry-run')

  // CHILD-ONLY env. Mutating our own `process.env` would poison a long-lived server process
  // for every other subsystem; and leaving CLAUDE_PROJECT_DIR unset entirely is worse than
  // either — the chain would write its resume marker into the wrong tree, and the cleared
  // agent would then wait forever for a marker that never arrives.
  //
  // VIRTUAL_ENV is stripped for the same reason the janitor's own `detached_uv_env()` strips
  // it: an inherited pointer at a parent's ephemeral env makes uv refuse to run at all.
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: req.projectRoot }
  delete env.VIRTUAL_ENV

  const run = deps.run ?? defaultRun
  try {
    return parseExternalCompactionOutput(await run(python, args, env))
  } catch (e) {
    return { status: 'error', line: `invocation failed: ${(e as Error).message}`, fired: false }
  }
}

/** Resolve with stdout regardless of exit status — see `ExternalCompactionDeps.run`. */
function defaultRun(python: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(python, args, { env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (stdout && String(stdout).trim().length > 0) return resolve(String(stdout))
      if (err) return reject(err)
      resolve(String(stdout ?? ''))
    })
  })
}
