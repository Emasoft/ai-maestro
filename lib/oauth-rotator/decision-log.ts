// The SHARED rotation decision log — `<rotatorRoot()>/rotator.log`.
//
// Both daemons write it: the janitor's `scripts/oauth_rotator/rotator.py::_log` (which created it
// and still owns it) and, from here, the ai-maestro server. One file, because the two daemons make
// interleaved decisions about the SAME live credential and a reader trying to reconstruct "why did
// rotation not happen at 03:00" needs them in one timeline, in order. Two logs would force that
// correlation onto a human at exactly the moment they are already debugging.
//
// WHY THIS MODULE APPENDS AND NEVER TRIMS — the load-bearing rule, do not "improve" it away.
// rotator.py bounds the file by read-all + rewrite:
//
//     with LOG_FILE.open("a") as fh: fh.write(...)      # append
//     if LOG_FILE.stat().st_size > _LOG_MAX_BYTES:
//         tail = LOG_FILE.read_bytes()[-_LOG_KEEP_BYTES:]   # READ
//         tmp.write_bytes(tail); os.replace(tmp, LOG_FILE)  # REWRITE
//
// Any append landing between that READ and that REWRITE is silently destroyed. With a single
// writer the window is harmless — the writer is the only one appending. With two it is real data
// loss, and it would eat OUR lines, because the janitor is the one trimming. So the contract is
// asymmetric on purpose: **N processes may APPEND, exactly ONE may REWRITE.** The janitor keeps
// the rewrite; we never take it. A second trimmer would not halve the risk, it would square it —
// two read-modify-write cycles racing each other lose whole spans, not single lines.
// (The remaining exposure — our appends landing inside the janitor's own trim window — is theirs
// to close by switching to rename-based rotation; filed as Emasoft/ai-maestro-janitor#177. Until
// then the worst case is losing recent lines at a ~256 KB boundary, never a corrupt file.)
//
// WHY A SINGLE `appendFileSync` IS SAFE WITHOUT A CROSS-LANGUAGE LOCK. It opens with O_APPEND,
// under which POSIX makes the seek-to-end and the write atomic with respect to other appenders —
// so concurrent Python and Node appends interleave as whole records rather than overwriting each
// other. That guarantee is what removes the need for a shared lock, and a shared lock is exactly
// what we could not have had anyway: the janitor's Python lockdirs and any in-process Node mutex
// are different physical objects, so "both take a lock" would exclude nobody. One record per
// write() is therefore not a style choice, it is the whole concurrency design — which is why
// `sanitize()` below strips newlines rather than trusting callers.
//
// SECURITY — inherited verbatim from rotator.py's own contract, because we share its file and its
// trust boundary (under the janitor's user-only, gitignored DATA dir): callers pass DECISIONS —
// account emails, usage percentages, credential fingerprints — and NEVER a token value. There is
// no redaction pass here; the rule is enforced at the call site, as it is on the Python side.

import * as fs from 'fs'
import * as path from 'path'
import { rotatorRoot } from './slots'

const LOG_BASENAME = 'rotator.log'

/** Tags every line this process writes, so a reader can tell the two daemons apart at a glance.
 * The janitor writes bare kinds (`auto:`, `beacon:`, `capture:`); ours are `aim-server/<kind>:` —
 * still `word:`-shaped, so the file stays uniformly parseable, but never ambiguous about origin. */
const SOURCE = 'aim-server'

/** One record must fit one line and stay modest. The cap matters beyond tidiness: rotator.py's
 * trim realigns on the first `\n` in the retained tail, so a record that is not exactly one line
 * corrupts the boundary it lands on. */
const MAX_MESSAGE_CHARS = 2000

/** `2026-08-02T18:55:07+0200` — byte-identical in shape to rotator.py's
 * `time.strftime("%Y-%m-%dT%H:%M:%S%z")`, so both daemons' lines sort and read as one timeline.
 * Local time with a numeric offset, deliberately NOT `toISOString()` (which is UTC + `Z` and would
 * make the shared file's timestamps disagree with each other). */
export function rotatorLogStamp(d: Date, offsetMinutesEastOfUtc?: number): string {
  const pad = (n: number): string => String(Math.abs(Math.trunc(n))).padStart(2, '0')
  // The offset is injectable ONLY so a test can pin a half-hour zone (India, Newfoundland) without
  // depending on the runner's own: a test that reads getTimezoneOffset() to build its expectation
  // is circular, and on a whole-hour CI box it would pass against a formatter that drops the
  // minutes entirely. Production always passes undefined and takes the ambient zone.
  const offsetMin = offsetMinutesEastOfUtc ?? -d.getTimezoneOffset() // %z's sign convention: east positive
  const sign = offsetMin < 0 ? '-' : '+'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offsetMin / 60)}${pad(offsetMin % 60)}`
  )
}

/** The absolute path of the shared log. Exported so callers can NAME it to the user: an alert that
 * says "check rotator.log" without a path is not actionable — the file lives under a plugin data
 * dir nobody memorises. */
export function rotatorLogPath(root: string = rotatorRoot()): string {
  return path.join(root, LOG_BASENAME)
}

/** Collapse to exactly one line and bound it. See MAX_MESSAGE_CHARS for why one line is required
 * rather than merely preferred. */
function sanitize(s: string): string {
  const flat = s.replace(/[\r\n]+/g, ' ').trim()
  return flat.length > MAX_MESSAGE_CHARS ? `${flat.slice(0, MAX_MESSAGE_CHARS - 1)}…` : flat
}

/**
 * Append one decision to the shared rotator log.
 *
 * BEST-EFFORT BY DESIGN — returns false instead of throwing. This is an observability side-channel;
 * a full disk or a permission change must never take down a rotation decision that is otherwise
 * proceeding correctly. That mirrors rotator.py, whose `_log` swallows OSError for the same reason.
 * The boolean is returned rather than discarded so a caller that genuinely needs to know (a test,
 * or a diagnostic that wants to say "logging is broken too") can ask.
 *
 * @param kind  short category, e.g. `tick` | `alert` | `absorb` — joined as `aim-server/<kind>:`
 * @param message a DECISION, never a token value (see the SECURITY note at the top of this file)
 */
export function appendRotatorLog(
  kind: string,
  message: string,
  opts: { root?: string; now?: Date } = {},
): boolean {
  try {
    const root = opts.root ?? rotatorRoot()
    // The janitor normally creates this dir, but the server can reach a decision worth recording
    // before the janitor has ever run on a fresh machine — and a log that silently does nothing
    // until some other component happens to run first is the failure this file exists to fix.
    fs.mkdirSync(root, { recursive: true })
    const line = `${rotatorLogStamp(opts.now ?? new Date())} ${SOURCE}/${sanitize(kind)}: ${sanitize(message)}\n`
    fs.appendFileSync(rotatorLogPath(root), line, { encoding: 'utf8', mode: 0o644 })
    return true
  } catch {
    return false
  }
}
