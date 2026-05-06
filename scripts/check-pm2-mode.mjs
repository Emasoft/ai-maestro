#!/usr/bin/env node
/**
 * Pre-build guard for `yarn build` (R21-style fail-fast in code).
 *
 * Refuses to run if pm2 is currently running `ai-maestro` with
 * NODE_ENV=development. Running `next build` against a live
 * dev-mode server overwrites `.next/` with hashed production
 * chunks; when dev mode then serves the next request, the
 * compiled HTML references dev-style chunk names that no longer
 * exist on disk → every `/_next/static/chunks/*` 404s → blank UI.
 *
 * The fix at boot time is `scripts/start-with-ssh.sh`'s
 * mode-coherence guard, but preventing the broken state
 * altogether is cheaper. This script is the gate.
 *
 * Allowed paths:
 *   - pm2 is not installed → no-op (CI / fresh checkout / Linux dev).
 *   - ai-maestro process is not in the pm2 list → no-op.
 *   - ai-maestro process is online but NODE_ENV ≠ development → allowed
 *     (a prod-mode pm2 is the legitimate target of `yarn build`).
 *   - ai-maestro process is offline → allowed (no live server to corrupt).
 *
 * Refused path:
 *   - ai-maestro process is online AND NODE_ENV=development → exit 1.
 *
 * Bypass: set FORCE_BUILD=1 in the env to skip this check (e.g. a CI
 * runner that knows what it's doing). Manual override is intentional —
 * the guard prevents accidents, not authorised actions.
 */

import { execFileSync } from 'node:child_process'

if (process.env.FORCE_BUILD === '1') {
  console.log('[prebuild-guard] FORCE_BUILD=1 set — skipping pm2 mode coherence check.')
  process.exit(0)
}

let pm2Output
try {
  pm2Output = execFileSync('pm2', ['jlist'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  })
} catch {
  // pm2 is not installed, not in PATH, or the daemon is not running.
  // None of those are a problem — the guard only matters when a live
  // pm2 process could be corrupted by a concurrent build.
  process.exit(0)
}

let processes
try {
  processes = JSON.parse(pm2Output)
} catch {
  console.warn('[prebuild-guard] Could not parse pm2 output — skipping check.')
  process.exit(0)
}

if (!Array.isArray(processes)) {
  process.exit(0)
}

const aiMaestro = processes.find((p) => p && p.name === 'ai-maestro')
if (!aiMaestro) {
  process.exit(0)
}

const status = aiMaestro.pm2_env?.status
const nodeEnv = aiMaestro.pm2_env?.env?.NODE_ENV ?? aiMaestro.pm2_env?.NODE_ENV

if (status !== 'online') {
  // Stopped / errored / waiting — no live server to break.
  process.exit(0)
}

if (nodeEnv === 'production') {
  // Production-mode server is the LEGITIMATE target of `yarn build`.
  // After build, `pm2 restart ai-maestro` picks up the new bundle.
  console.log('[prebuild-guard] pm2 ai-maestro is production-mode — build allowed.')
  process.exit(0)
}

// Anything else — including undefined NODE_ENV (defaults to dev) — is unsafe.
console.error(
  '\n[prebuild-guard] ✗ Refusing to run `yarn build`.\n' +
    `\n  pm2 'ai-maestro' is currently online with NODE_ENV='${nodeEnv ?? 'development (default)'}'\n` +
    `  Running \`next build\` now would overwrite .next/ with production chunks while\n` +
    '  the dev server keeps serving dev-style chunk URLs that the prod build doesn\'t\n' +
    '  emit — the dashboard would 404 every chunk and become unrenderable.\n' +
    '\n  Resolve one of these ways:\n' +
    '    1. Use `npx tsc --noEmit` for TypeScript checks (does NOT touch .next/).\n' +
    '    2. Stop the dev server first: `pm2 stop ai-maestro` → `yarn build` → restart.\n' +
    '    3. Run the build in production mode: `pm2 stop ai-maestro` → `yarn build` →\n' +
    '       `NODE_ENV=production pm2 restart ai-maestro --update-env`.\n' +
    '    4. Bypass for an explicit one-off: `FORCE_BUILD=1 yarn build`\n' +
    '       (the boot-time guard in start-with-ssh.sh will still self-heal on next\n' +
    '       pm2 restart by archiving the .next/ directory).\n'
)
process.exit(1)
