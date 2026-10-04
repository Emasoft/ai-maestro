/**
 * (pid, start-time) process identity — TRDD-7YRXXKE8.
 *
 * A bare pid is not an identity: macOS recycles pids aggressively (kern.maxproc = 16000 on
 * this class of machine), so a pid the server recorded for a dead pane can be answered, some
 * time later, by a completely unrelated process. TRDD-7YRXXKE8 demonstrated the race live on
 * macOS 25.6.0: a child pid was handed to a NEW process after ~15k fork/wait cycles, and the
 * new holder had a LATER p_starttime. The kernel-side truth is the pair (pid, p_starttime):
 * the start time is fixed at fork and cannot be held by two processes at once, so "same pid
 * AND same start time" is a same-process claim, and a recorded pair whose pid now belongs to
 * a later-started process is a RECYCLED record — refuse, never match.
 */

/** A process identity: the pid plus the kernel start time that pins it to one lifetime. */
export interface ProcIdentity {
  pid: number
  /** Seconds since boot (the monotonic clock p_starttime uses) when the process started. */
  startSeconds: number
  /** Microseconds component of p_starttime, for exactness across same-second forks. */
  startMicroseconds: number
}

export interface ProcIdentityDeps {
  /** Kernel read of (pid, p_starttime); null when the pid does not currently exist. */
  readProcIdentity(pid: number): ProcIdentity | null
}

/** The two identities denote the same process only when pid AND start time both match. */
export function sameProcess(a: ProcIdentity, b: ProcIdentity): boolean {
  return a.pid === b.pid && a.startSeconds === b.startSeconds && a.startMicroseconds === b.startMicroseconds
}

/**
 * Is the recorded identity still the process it was taken from?
 *
 * Three cases, and only the first may say yes:
 *  - same pid, same start time  -> the original process, still alive;
 *  - same pid, LATER start time -> the pid was recycled: the recorded process is gone and the
 *    current holder is a stranger. REFUSE (this is the TRDD-7YRXXKE8 attack shape: a foreign
 *    process inside an unrelated tree inheriting a dead pane s identity).
 *  - pid unreadable             -> the process exited: refuse.
 */
export function recordedProcessStillMatches(
  recorded: ProcIdentity,
  deps: ProcIdentityDeps,
): boolean {
  const current = deps.readProcIdentity(recorded.pid)
  if (current === null) return false
  return sameProcess(recorded, current)
}
