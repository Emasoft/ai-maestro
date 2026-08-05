// The daemon → janitor publish channel (TRDD-14HI8ZPR; USER security ruling 2026-08-05).
//
// ── THE RULE THIS IMPLEMENTS ─────────────────────────────────────────────────────────────────────
// Only the daemon integrated into the ai-maestro server may read agent status or run these
// commands, and only while the server is up — with no server there is nothing to validate
// signatures against, so nothing may execute. Janitor processes therefore never call in. They
// RECEIVE, by reading a file the daemon deposited in their OWN project folder.
//
// ── WHY THE PATH IS DERIVED AND NEVER SUPPLIED ───────────────────────────────────────────────────
// Every destination is computed here from the registry and validated with `isUnder(dir,
// AGENTS_ROOT)` before a single byte is written. There is no output-path parameter anywhere in this
// module, and adding one would be the bug: a caller-supplied destination is how fleet data ends up
// in `/tmp`, in a symlinked directory, or on a network mount someone else controls. The USER named
// exactly this risk. If you ever need to publish somewhere new, add a DERIVED target here — never
// an argument.
//
// ── WHY EACH JANITOR GETS A DIFFERENT SLICE ──────────────────────────────────────────────────────
// An agent's janitor guards its OWN session; the fleet-wide view is the daemon's job. So an agent
// workdir receives `agentScopedView` — that agent's own record plus fleet-wide COUNTS, which are
// enough to tell whether the host is healthy and which name nobody. Publishing the full roster into
// every workdir would put a complete map of the fleet (every uuid, name and tmux session name)
// inside every agent's directory, so compromising any single agent would yield the whole fleet.
// Only the ai-maestro install tree — where the JANITOR REPORT renders and which is not an agent
// workdir — receives the full roster.

import * as fs from 'fs'
import * as path from 'path'
import { AGENTS_ROOT, INSTALL_ROOT, isUnder } from '@/lib/workdir-path-policy'
import { agentScopedView, gatherHibernationRoster } from '@/services/agent-hibernation-service'
import type { HibernationRoster } from '@/lib/agent-hibernation'

/** Where a janitor looks, relative to its own project root. Inside the project, never /tmp. */
export const DAEMON_RESPONSES_DIR = path.join('.janitor', 'daemon_responses')

/** The response filename for this query. One file per query kind, so a consumer never parses a mux. */
export const HIBERNATION_RESPONSE_FILE = 'hibernation.json'

/**
 * How stale (SECONDS) a consumer should treat a response before deciding it has no live answer.
 * Deliberately generous relative to the publish cadence so one missed beat is not read as an
 * outage — the same 3x-the-cadence reasoning the janitor's own liveness window uses.
 */
export const RESPONSE_STALE_AFTER_S = 360

/** The envelope every published response carries, so a consumer can tell fresh from stale from absent. */
export interface PublishedResponse<T> {
  /** Schema version. A consumer that does not recognise it must treat the file as ABSENT, not as
   *  data — reading an unknown shape leniently is how a config gets replaced by a nearly-empty
   *  object elsewhere in this codebase. */
  v: 1
  /** Epoch SECONDS. Seconds, not millis: a millis value parses fine and reads as permanently fresh. */
  ts: number
  staleAfterS: number
  producedBy: 'ai-maestro-server-daemon'
  data: T
}

export interface PublishOutcome {
  /** Absolute paths written. */
  written: string[]
  /** Targets deliberately NOT written, with the reason — a refusal must be visible, never silent. */
  refused: { dir: string; reason: string }[]
}

function envelope<T>(data: T, nowS: number): PublishedResponse<T> {
  return { v: 1, ts: nowS, staleAfterS: RESPONSE_STALE_AFTER_S, producedBy: 'ai-maestro-server-daemon', data }
}

/**
 * Atomic write (tmp + rename), the `writeServerLiveness` idiom. A reader polling this file must
 * never observe a half-written JSON document — it would parse as garbage or, worse, as a partial
 * object that happens to be valid.
 */
function writeAtomic(dest: string, payload: unknown): void {
  const tmp = `${dest}.tmp.${process.pid}`
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
  fs.renameSync(tmp, dest)
}

/** Timestamped copies live beside the live file, never replacing it. */
export const RESPONSE_ARCHIVE_DIR = 'archive'

/** Keep the newest N archived responses per agent (USER decision 2026-08-05, same bound as the
 *  status-document archive). */
export const RESPONSE_ARCHIVE_KEEP = 50

/**
 * Local time + GMT offset, per the project timestamp rule. Duplicated from
 * `janitor-status-archive.ts` rather than imported so this module keeps its zero-dependency
 * property — it is the one thing that writes into every agent workdir on the host, and a cycle
 * here would be paid on every beat.
 */
function stamp(d: Date): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin < 0 ? '-' : '+'
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(Math.abs(offMin) / 60))}${p(Math.abs(offMin) % 60)}`
  )
}

/**
 * Has the payload actually CHANGED since the last publish?
 *
 * The envelope's `ts` moves on every beat by construction, so comparing whole envelopes would call
 * every beat a change and archive 720 identical files per agent per day. Comparing only `data`
 * makes each archived file mark a REAL transition — an agent hibernated, crashed, or woke — which
 * is the only thing an audit trail of this feed is worth keeping for.
 */
function dataChanged(dest: string, payload: unknown): boolean {
  try {
    const prev = JSON.parse(fs.readFileSync(dest, 'utf8')) as { data?: unknown }
    const next = (payload as { data?: unknown })?.data
    return JSON.stringify(prev?.data) !== JSON.stringify(next)
  } catch {
    // No previous file (or unreadable) — the first publish IS a transition worth recording.
    return true
  }
}

/**
 * An archive filename that cannot collide with one already in `dir`.
 *
 * The stamp resolves to the SECOND, so two transitions inside the same second would compose the
 * same name and the second would silently REPLACE the first. That is the one failure this archive
 * exists to prevent — the USER's requirement is literally "so to not overwriting the last one" —
 * and losing the earlier of two rapid transitions is worse than losing a slow one, because rapid
 * transitions are what an incident looks like. A `-2`, `-3`, … suffix keeps both, and keeps the
 * name sortable and human-readable.
 */
function uniqueArchiveName(dir: string, when: Date): string {
  const base = stamp(when)
  for (let n = 1; n < 1000; n++) {
    const name = `${base}${n === 1 ? '' : `-${n}`}-${HIBERNATION_RESPONSE_FILE}`
    if (!fs.existsSync(path.join(dir, name))) return name
  }
  // 1000 transitions in one second is not a real fleet; fall back rather than loop forever.
  return `${base}-${process.pid}-${HIBERNATION_RESPONSE_FILE}`
}

/** Keep the newest `keep` archived responses in one agent's archive dir. Best-effort. */
function pruneResponseArchive(dir: string, keep: number): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter(f => f.endsWith(`-${HIBERNATION_RESPONSE_FILE}`))
      .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    for (const { f } of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true })
  } catch {
    // Retention is best-effort; failing to prune must never fail a publish.
  }
}

/**
 * Publish one response file into one project root.
 *
 * `projectDir` MUST already be validated by the caller. This function does not accept a destination
 * file path, only a project root, and composes the rest from module constants — so no argument can
 * steer the write outside `<projectDir>/.janitor/daemon_responses/`.
 *
 * The LIVE file keeps its stable name and is overwritten every beat: three cross-repo contracts
 * (`ai-maestro-janitor#194`/`#196`, `ai-maestro-plugin#55`) tell consumers to read exactly that
 * path, so it must not become timestamped. The timestamped copy is ADDITIVE, written into
 * `archive/` only when the payload's `data` actually changed (USER directive 2026-08-05).
 */
function publishInto(projectDir: string, payload: unknown, outcome: PublishOutcome): void {
  const dest = path.join(projectDir, DAEMON_RESPONSES_DIR, HIBERNATION_RESPONSE_FILE)
  try {
    const changed = dataChanged(dest, payload)
    writeAtomic(dest, payload)
    outcome.written.push(dest)

    if (changed) {
      const dir = path.join(projectDir, DAEMON_RESPONSES_DIR, RESPONSE_ARCHIVE_DIR)
      fs.mkdirSync(dir, { recursive: true })
      writeAtomic(path.join(dir, uniqueArchiveName(dir, new Date())), payload)
      pruneResponseArchive(dir, RESPONSE_ARCHIVE_KEEP)
    }
  } catch (err) {
    // A single unwritable project must never abort the rest of the sweep — one agent with a
    // read-only or vanished workdir would otherwise starve every other janitor on the host.
    outcome.refused.push({ dir: projectDir, reason: `write failed: ${(err as Error)?.message ?? err}` })
  }
}

export interface PublishDeps {
  gather?: typeof gatherHibernationRoster
  /** Epoch SECONDS. Injected so a test is deterministic. */
  now?: () => number
  /** Overridden in tests ONLY, to keep a real home untouched. Never a caller-facing parameter. */
  agentsRoot?: string
  installRoot?: string
  /** Existence check, injected for tests. */
  dirExists?: (dir: string) => boolean
}

/**
 * Compute the roster once and deposit each janitor's entitled slice.
 *
 * NEVER THROWS: it runs unattended on a timer, and a publish failure must not take the server with
 * it. Every skip and every failure is recorded in the outcome so a silent no-op is impossible to
 * mistake for success.
 */
export async function publishHibernationResponses(deps: PublishDeps = {}): Promise<PublishOutcome> {
  const outcome: PublishOutcome = { written: [], refused: [] }
  const gather = deps.gather ?? gatherHibernationRoster
  const nowS = (deps.now ?? (() => Math.floor(Date.now() / 1000)))()
  const installRoot = deps.installRoot ?? INSTALL_ROOT
  const dirExists = deps.dirExists ?? ((d: string) => fs.existsSync(d))

  // TWO roots, because there are two checks and each must compare like with like.
  //
  // The lexical check compares `resolve(dir)` against the RESOLVED root; the physical check compares
  // `realpath(dir)` against the REALPATHED root. Mixing them is not a style detail — `~/agents` can
  // itself be a symlink (on macOS every `/var/folders/...` path is one, via `/private/var`), so
  // comparing a lexical child against a realpathed root refuses every legitimate write. A gate that
  // always refuses is as broken as one that always allows; it just fails quietly, which is worse.
  const agentsRootLexical = path.resolve(deps.agentsRoot ?? AGENTS_ROOT)
  let agentsRootReal = agentsRootLexical
  try {
    agentsRootReal = fs.realpathSync(agentsRootLexical)
  } catch {
    /* the agents root need not exist yet — the per-agent existence check below still gates writes */
  }

  let roster: HibernationRoster
  try {
    roster = await gather()
  } catch (err) {
    outcome.refused.push({ dir: '<all>', reason: `roster gather failed: ${(err as Error)?.message ?? err}` })
    return outcome
  }

  for (const agent of roster.agents) {
    const dir = agent.workingDirectory
    if (!dir) {
      outcome.refused.push({ dir: `<agent ${agent.agentId}>`, reason: 'no working directory recorded' })
      continue
    }
    // ── THE GATE. Three checks, and each catches something the others cannot. ────────────────────
    // A workdir outside ~/agents/ is not a place this server writes to, whatever the registry says:
    // a corrupted or hand-edited row must not be able to aim the writer at an arbitrary directory.
    //
    // 1. RESOLVE FIRST. `isUnder` is a raw string compare (`child.startsWith(parent + sep)`) — it
    //    does NOT normalize. `~/agents/../../etc` starts with `~/agents/` and would sail straight
    //    through an unresolved check. Only `checkWorkdirPathPolicy` resolves, and its docstring
    //    says why; this module has to do it itself.
    // 2. EXISTS, before realpath (which throws on a missing path) and before any write. Do not
    //    materialise a tree for an agent whose folder is gone — that is how a deleted agent's
    //    directory gets re-created by the very thing meant to observe it (the 2026-07-25 regrowth).
    // 3. REALPATH, and re-check. `resolve` neutralizes `..` but is purely lexical, so a SYMLINK
    //    inside ~/agents/ pointing at /tmp, at another user's home, or at a network mount would
    //    still pass. That is exactly the "malicious controlled outlet or remote folder" this whole
    //    channel exists to avoid, so containment is asserted against the real inode path.
    const resolved = path.resolve(dir)
    if (!isUnder(resolved, agentsRootLexical)) {
      outcome.refused.push({ dir, reason: `outside the agents root (${agentsRootLexical})` })
      continue
    }
    if (!dirExists(resolved)) {
      outcome.refused.push({ dir, reason: 'working directory does not exist' })
      continue
    }
    let real: string
    try {
      real = fs.realpathSync(resolved)
    } catch (err) {
      outcome.refused.push({ dir, reason: `cannot resolve real path: ${(err as Error)?.message ?? err}` })
      continue
    }
    if (!isUnder(real, agentsRootReal)) {
      outcome.refused.push({ dir, reason: `resolves outside the agents root via a link (${real})` })
      continue
    }
    const view = agentScopedView(roster, agent.agentId)
    if (!view) {
      outcome.refused.push({ dir, reason: 'agent not present in its own roster (should be impossible)' })
      continue
    }
    publishInto(real, envelope(view, nowS), outcome)
  }

  // The install tree gets the FULL roster: it is where the JANITOR REPORT renders, it is not an
  // agent workdir, and it is already the server's own directory — publishing the fleet view to
  // itself grants nothing it does not already hold.
  if (dirExists(installRoot)) {
    publishInto(installRoot, envelope(roster, nowS), outcome)
  }

  return outcome
}

/** Default 2 min — the cadence the janitor's own session-liveness beat runs at, so a consumer never
 *  waits longer for an answer than it waits between its own checks. 0 disables. */
const DEFAULT_INTERVAL_MS = Number(process.env.AIM_JANITOR_PUBLISH_INTERVAL_MS) || 120_000

/**
 * Start the periodic publisher. Returns a stop function, or null when disabled (interval <= 0).
 * Same shape as `startServerLiveness` / `startFleetLivenessWatchdog`: writes ONCE immediately so the
 * file exists the instant the server is up, then on the interval, with the timer `unref`'d so it
 * never holds the process open at shutdown.
 */
export function startJanitorResponsePublisher(
  opts: { intervalMs?: number; log?: (msg: string) => void } = {},
): (() => void) | null {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!intervalMs || intervalMs <= 0) return null
  const log = opts.log ?? ((m: string) => console.warn(m))

  const beat = () => {
    void publishHibernationResponses()
      .then((o) => {
        // Stay quiet on a healthy sweep; a line per beat forever is noise nobody reads. A refusal is
        // reported because a janitor that never receives a file is otherwise indistinguishable from
        // one whose host is simply idle.
        if (o.refused.length) {
          log(`[JanitorPublish] ${o.written.length} written; ${o.refused.length} refused: ${o.refused
            .map((r) => `${r.dir} (${r.reason})`)
            .join('; ')}`)
        }
      })
      .catch((err) => log(`[JanitorPublish] publish failed (non-fatal): ${(err as Error)?.message ?? err}`))
  }

  beat()
  const timer = setInterval(beat, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
