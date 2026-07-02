#!/usr/bin/env node
/**
 * Pre-run guard for the bare-`tsx` entry points (`dev`, `start`,
 * `headless`, `headless:prod`) — the belt-and-braces for audit I1
 * (TRDD-47a35ba2 §C).
 *
 * Native deps (node-pty, better-sqlite3) are compiled against a Node
 * ABI. On Node >= 26 they throw `ERR_DLOPEN_FAILED` at require time,
 * which crash-loops the server. `scripts/start-with-ssh.sh` (the
 * pm2/prod launcher) already pins a <26 keg, and CI forces Node 22 —
 * but the four `yarn` scripts call `tsx server.mjs` under whatever
 * `node` is first on PATH, so on a box whose default node is >= 26
 * they reproduce the original crash. `engines` is advisory only
 * (no `engine-strict`), so it does not stop them. This guard does.
 *
 * Allowed:  Node major 22-25  → exit 0 (silent).
 * Refused:  Node major >= 26  → exit 1 with the fix instructions.
 * Warned:   Node major < 22   → warn (below the engines floor) but allow.
 *
 * Bypass: FORCE_NODE=1 skips the check (an operator who knows the
 * box has working native builds for a newer ABI). The guard prevents
 * accidents, not authorised actions — same contract as check-pm2-mode.
 */

if (process.env.FORCE_NODE === '1') {
  console.log('[prerun-guard] FORCE_NODE=1 set — skipping Node-version check.')
  process.exit(0)
}

const major = Number(process.versions.node.split('.')[0])

if (Number.isNaN(major)) {
  // Can't determine the version — don't block; let the runtime decide.
  process.exit(0)
}

if (major >= 26) {
  console.error(
    '\n[prerun-guard] ✗ Refusing to start under Node ' + process.versions.node + '.\n' +
      '\n  AI Maestro\'s native deps (node-pty, better-sqlite3) have no prebuilt ABI for\n' +
      '  Node >= 26 and throw ERR_DLOPEN_FAILED at require time → the server crash-loops.\n' +
      '\n  Use a Node 22-25 runtime, then retry:\n' +
      '    1. `nvm use` (repo ships .nvmrc=22), or\n' +
      '    2. PATH="/opt/homebrew/opt/node@22/bin:$PATH" yarn <script>, or\n' +
      '    3. install a <26 node and make it the default `node`.\n' +
      '\n  Bypass for an explicit one-off (only if you have working native builds):\n' +
      '    FORCE_NODE=1 yarn <script>\n'
  )
  process.exit(1)
}

if (major < 22) {
  console.warn(
    '[prerun-guard] ⚠ Node ' + process.versions.node + ' is below the engines floor (>=22). ' +
      'Proceeding, but 22-25 is the supported range.'
  )
}

process.exit(0)
