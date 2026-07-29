// Warn when the running server is serving a build that predates the code.
//
// WHY THIS EXISTS. On 2026-07-29 a one-line fix to lib/signed-ledger.ts was
// committed and the server restarted. `pm2 restart` replays the EXISTING build,
// so the server kept executing the old compiled code and re-corrupted the ledger
// that had just been repaired — silently, for 20 minutes, while `git log` showed
// the fix present. Nothing anywhere said "you are running stale code".
//
// The trap is that the tree has two halves with different deploy semantics:
//   - server.mjs and lib/*.mjs are loaded by node at runtime -> live on restart
//   - lib/*.ts, app/, services/ are bundled into .next        -> stale until built
// so "I restarted it" is a true statement that means nothing until you know which
// half you touched.
//
// This is deliberately a WARNING, never a refusal: a stale build still serves,
// and a server that refuses to start because someone committed a README would be
// worse than the problem. It is also deliberately CHEAP — two stats, no walk, no
// subprocess — because it runs on every boot.
//
// It lives in .mjs precisely so that IT is never the thing that is stale.

import fs from 'fs'
import path from 'path'

/**
 * Compare the build artifact's age against the last commit.
 *
 * `.git/HEAD` is rewritten on every commit, checkout, and rebase, so its mtime is
 * a good "when did the code last move" proxy that costs one stat. It is a proxy,
 * not a proof: a docs-only commit also moves it. That is the right trade for a
 * warning — the alternative (walking every bundled source file on every boot)
 * costs far more than it is worth, and being told to rebuild after a docs commit
 * is a smaller harm than shipping a fix that never took effect.
 *
 * @param {object} [opts]
 * @param {string} [opts.projectRoot] defaults to cwd
 * @param {(p: string) => {mtimeMs: number}} [opts.stat] injectable for tests
 * @returns {{stale: boolean, reason: string, buildMs: number|null, headMs: number|null}}
 */
export function checkBuildFreshness(opts = {}) {
  const projectRoot = opts.projectRoot ?? process.cwd()
  const stat = opts.stat ?? fs.statSync

  // Never let a diagnostic break a boot. Every failure below resolves to
  // "cannot tell", which is honest and silent — NOT to "fresh", which would be
  // a claim we have no evidence for.
  const unknown = (reason) => ({ stale: false, reason, buildMs: null, headMs: null })

  let buildMs
  try {
    // BUILD_ID is written at the END of a successful build, so it dates the
    // build's completion. The .next directory's own mtime does not: it changes
    // whenever anything inside it is touched, including at serve time.
    buildMs = stat(path.join(projectRoot, '.next', 'BUILD_ID')).mtimeMs
  } catch {
    // No build at all — dev mode (`next dev` compiles on demand) or headless
    // mode (no Next.js). Neither can be stale in the sense this checks.
    return unknown('no-build')
  }

  // `.git/HEAD` is NOT rewritten by a commit — it holds a symbolic ref
  // ("ref: refs/heads/<branch>") that only changes when you switch branches. On
  // this repo it was a MONTH stale while commits landed every few minutes, so
  // using it alone made this checker answer "fresh" about a genuinely stale
  // build — the precise false negative it exists to prevent.
  //
  // `.git/logs/HEAD` (the reflog) is APPENDED on every commit, checkout, reset
  // and merge, so it is the real "when did the code last move". `.git/HEAD` is
  // still consulted, as the max, because it moves on a branch switch that the
  // reflog records at the same instant anyway — keeping both costs one stat and
  // removes a whole class of "which file actually moves?" doubt.
  let headMs = null
  for (const rel of [['.git', 'logs', 'HEAD'], ['.git', 'HEAD']]) {
    try {
      const ms = stat(path.join(projectRoot, ...rel)).mtimeMs
      headMs = headMs === null ? ms : Math.max(headMs, ms)
    } catch {
      // Missing is normal: reflogs can be disabled, and in a linked worktree
      // `.git` is a file. Only ALL of them missing means "not a checkout".
    }
  }
  if (headMs === null) {
    // Not a git checkout (an installed copy, a tarball). Nothing to compare to.
    return unknown('no-git')
  }

  if (headMs > buildMs) {
    return { stale: true, reason: 'build-predates-head', buildMs, headMs }
  }
  return { stale: false, reason: 'fresh', buildMs, headMs }
}

/** Human-readable age, e.g. "4h 48m". */
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/**
 * Emit the warning. Returns the same result so a caller can act on it.
 * @param {(msg: string) => void} [log] defaults to console.warn
 */
export function warnIfBuildStale(opts = {}, log = console.warn) {
  const res = checkBuildFreshness(opts)
  if (res.stale) {
    log(
      `[BUILD] The .next build is ${ago(res.headMs - res.buildMs)} OLDER than the last commit — ` +
        'bundled code (lib/*.ts, app/, services/) is STALE. A restart does NOT rebuild: ' +
        'run `bash scripts/with-node.sh yarn build`. ' +
        '(server.mjs and lib/*.mjs are unaffected — those load at runtime.)',
    )
  }
  return res
}
