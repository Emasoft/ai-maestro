/**
 * The pid-ancestry-to-pane identity walk — TRDD-9JUEJFY3.
 *
 * NOT WIRED TO ANY LIVE CALLER TODAY. Investigated for this card (grep across lib/, services/,
 * app/api/, server.mjs, the headless router): no route or script resolves identity by climbing
 * a ppid chain. Agent-originated calls authenticate with `AID_AUTH`, a credential minted by the
 * server and baked into the tmux session's environment with `-e` at session CREATION
 * (`lib/agent-runtime.ts::createSession`) — inherited by every descendant the session's `claude`
 * process ever forks, because environment inheritance survives fork/exec regardless of whether
 * the intermediate process later dies and the child is reparented. A credential obtained BEFORE
 * detaching needs no continuous process lineage to remain valid; a pid-ancestry walk does.
 *
 * This module exists so that WHEN a caller eventually needs "which agent's pane does this
 * connecting pid ultimately belong to" (the design explored and found necessary-but-insufficient
 * in TRDD-EVO7T245 — a kernel-attested peer pid still has to climb to a pane), it walks through
 * `walkToPane()` — the one choke point that enforces the fail-closed contract below BY
 * CONSTRUCTION, rather than by a convention a future caller could forget under time pressure.
 * That is the literal instruction on TRDD-9JUEJFY3: "there may be no implementation yet; then
 * this card constrains the one that gets written."
 *
 * ── THE VULNERABILITY THIS GUARDS AGAINST ──────────────────────────────────────────────────────
 * On Unix, when an intermediate process in a chain dies, its child is reparented to pid 1
 * (init/launchd) — the chain to the original pane is severed. An attacker can cause this
 * deliberately: spawn a process inside an unrelated tree, kill the intermediate, and the walk
 * from the survivor can no longer reach any pane.
 *
 * THE VULNERABILITY IS NOT THE FAILURE. It is whatever a caller does NEXT. Legitimate agent
 * tooling hits the identical severed-chain shape — `nohup`, `setsid`, any daemonised helper, any
 * process that outlives its spawner — so the natural "fix" once someone reports it as a bug is a
 * fallback: resolve by env var, by cwd, by session name, by process name. EVERY ONE OF THOSE IS
 * FORGEABLE BY THE AGENT SPAWNING THE PROCESS, which converts an unforgeable design into a
 * forgeable one through an ordinary bug fix. `walkToPane()` has no such branch and cannot grow
 * one without deleting the refusal itself — see the comment at the return sites below.
 *
 * ── LEGITIMATE DETACHED CALLERS, ENUMERATED, EACH WITH ITS NON-HEURISTIC PATH ─────────────────
 * (TRDD-9JUEJFY3 acceptance box 3 — searched for every subprocess this repo backgrounds and does
 * not wait for; `nohup`/`&`/`.unref()`-on-a-child-handle across lib/, services/, scripts/.)
 *
 *   1. `scripts/aimaestro-statusline-capture.sh` forks a detached copy of the ingest CLI
 *      (`( … ) </dev/null >/dev/null 2>&1 &`, no `wait`) that POSTs to
 *      `app/api/statusline/ingest`. It needs NO per-agent identity at all: the route is gated by
 *      `lib/peer-address.mjs::isConsolePeer` — a kernel-reported loopback socket address, which
 *      is an ORIGIN check, not an identity claim, and confers no capability (see that route's
 *      own docstring). A severed ancestry cannot forge "connected from 127.0.0.1" the way it can
 *      forge a resolved agent name.
 *   2. Any hook, detector subprocess, or heartbeat-spawned daemon that an agent's `claude`
 *      process forks (e.g. the ai-maestro-janitor plugin's own cron helper) inherits
 *      `AID_AUTH`/`AIMAESTRO_AGENT` from the tmux session environment set at `-e` time — before
 *      any of them exist, let alone detach. Its validity does not depend on the forking process
 *      still being alive; reparenting to pid 1 does not revoke an already-possessed credential.
 *   3. No caller in this repo derives identity from a live pid chain today (confirmed above), so
 *      there is no existing caller to migrate onto `walkToPane()`. A future caller that DOES need
 *      "which pane is this anonymous, credential-less connection ultimately reparented from" (the
 *      TRDD-EVO7T245 peer-credential design) is the one this module is built to constrain.
 *
 * When this module gains a real caller, give it the connected-socket-obtained-before-detaching
 * shape from the card's own guidance, or the credential-inheritance shape already proven above —
 * never a heuristic resolved after the fact.
 *
 * ── TRDD-7YRXXKE8: PID REUSE IS CLOSED AT EVERY HOP, NOT ONLY AT THE LIVE PEER ────────────────
 * TRDD-EVO7T245's "the connection is live, so no recycled pid can answer" reasoning covers the
 * PEER pid only. The ANCESTOR pids the walk touches, and the pane pid the server holds on
 * record, are bare integers the kernel recycles (demonstrated live on macOS: kern.maxproc is
 * 16000 and a fork/wait hammer handed a dead child's pid to a NEW process with a LATER
 * p_starttime). The walk therefore matches on (pid, start-time) PAIRS — see WalkDeps and the
 * pairwise compare inside walkToPane — and a recorded pane pid whose current holder has a
 * different start time REFUSES with reason "recycled" instead of resolving. lib/proc-identity.ts
 * owns the pair semantics; the macOS kernel read (sysctl KERN_PROC_PID → kinfo_proc.p_starttime)
 * is the concrete ProcIdentityDeps.readProcIdentity a caller supplies.
 */

import { sameProcess, type ProcIdentity } from '@/lib/proc-identity'

/** An orphaned child is reparented to init (macOS launchd, Linux pid 1). */
const REPARENT_PID = 1

/** Defensive bound against a pathological or forged chain (a cycle, an absurdly deep tree). */
const DEFAULT_MAX_HOPS = 64

export interface WalkDeps {
  /**
   * Returns `pid`'s parent pid, or `null` when `pid` can no longer be read (already exited).
   * TRDD-7YRXXKE8: this and every other pid touchpoint in the walk is paired with a kernel
   * start time — a bare ppid answer about a RECYCLED pid is worthless, so real deps must read
   * the pair atomically (on macOS: one sysctl(KERN_PROC_PID) returns both).
   */
  getParentPid(pid: number): number | null
  /**
   * TRDD-7YRXXKE8: pids recorded for panes are stored as (pid, start-time) pairs, and the
   * match is PAIRWISE — `pid` alone is never accepted. `readRecordedPane(pid)` returns the
   * recorded start time for the pane record holding this pid (or null when the pid is not on
   * record); the walk matches only when the CURRENT process at `pid` carries exactly that
   * start time. A recycled pid therefore REFUSES instead of resolving, no matter which tree
   * the new holder lives in.
   */
  readRecordedPane(pid: number): ProcIdentity | null
  /** Kernel read of the CURRENT (pid, start-time) pair; null when pid does not exist. */
  readProcIdentity(pid: number): ProcIdentity | null
}

export type WalkResult =
  | { ok: true; panePid: number; hops: number }
  | {
      ok: false
      reason: 'severed' | 'unreadable' | 'hop-limit' | 'recycled'
      hops: number
    }

/**
 * Climb the ppid chain from `startPid` looking for a recorded pane, matching on (pid,
 * start-time) PAIRS — TRDD-7YRXXKE8.
 *
 * FAIL CLOSED, NO FALLBACK — TRDD-9JUEJFY3. Every exit that is not the explicit pairwise match
 * returns `ok: false`. DO NOT add an `else` branch to any of the refusal sites below that
 * resolves identity by env var, cwd, session name, or process name — that is precisely the
 * bug-fix shape TRDD-9JUEJFY3 exists to forbid: it looks like closing a false-positive report
 * from legitimate detached tooling, and it is actually handing an attacker a forgeable
 * substitute for the one thing this walk was built to make unforgeable. A legitimate caller
 * that hits one of these refusals needs a real credential obtained before it detached (see the
 * enumeration above), not a softer walk.
 *
 * TRDD-7YRXXKE8 adds the pairwise rule: a match on the bare pid would let a RECYCLED pid
 * (kernel handed the dead pane's pid to a new process, demonstrated on macOS) resolve to the
 * dead pane's identity. The match therefore requires `readProcIdentity(pid)` to return exactly
 * the recorded pair; any mismatch refuses with `recycled` and never walks past the recorded
 * pane — the first recorded pane pid in a live ancestry IS the pane or the chain is broken.
 */
export function walkToPane(startPid: number, deps: WalkDeps, opts: { maxHops?: number } = {}): WalkResult {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS
  let pid = startPid

  for (let hops = 0; hops <= maxHops; hops++) {
    if (pid === REPARENT_PID) {
      // Reached init without ever matching a known pane — an intermediate process in the chain
      // died and this pid was reparented. REFUSE. See the file-level comment: no fallback.
      return { ok: false, reason: 'severed', hops }
    }

    // TRDD-7YRXXKE8: the match is on the (pid, start-time) PAIR, never the bare pid. The pane
    // record carries the start time captured when the pane was registered; the CURRENT process
    // at this pid must still be that same lifetime. When the recorded pane's pid was recycled,
    // the current holder has a LATER start time and the pairwise compare refuses it — a foreign
    // process cannot inherit a dead pane's identity by landing on its pid. A refused recycle is
    // NOT a reason to walk further: pid values above the recorded pane in a live tree are the
    // recorded pane itself or nothing.
    const recorded = deps.readRecordedPane(pid)
    if (recorded !== null) {
      const current = deps.readProcIdentity(pid)
      if (current !== null && sameProcess(recorded, current)) {
        return { ok: true, panePid: pid, hops }
      }
      // Recorded pane pid now held by a different lifetime (recycled) or gone entirely:
      // REFUSE — see the file-level comment, no fallback, no "try the next hop".
      return { ok: false, reason: 'recycled', hops }
    }

    const parent = deps.getParentPid(pid)
    if (parent === null) {
      // The process at `pid` vanished mid-walk (already exited under us) — indistinguishable
      // from an attacker racing the walk with a kill. REFUSE. See the file-level comment.
      return { ok: false, reason: 'unreadable', hops }
    }

    pid = parent
  }

  // Walked past maxHops without reaching pid 1 or a match — a pathological or forged chain
  // (e.g. a cycle a malicious `getParentPid` could construct). REFUSE. See the file-level
  // comment: this is a refusal site too, not a place to "just try a little harder".
  return { ok: false, reason: 'hop-limit', hops: maxHops }
}
