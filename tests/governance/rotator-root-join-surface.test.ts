/**
 * TRDD-N83OXS8G — pin WHAT this project joins onto the rotator root.
 *
 * The canonical rotator root's `profiles` entry is a SYMLINK to the janitor's live cookie store
 * (measured on disk 2026-08-27). So the store is not in another tree: it hangs off the root this
 * project already writes into, ONE path segment away. A single `path.join(rotatorRoot(),
 * 'profiles', …)` would write the real cookies for every account, and it would look like every
 * other line in these files.
 *
 * A memory note recorded that no such join exists. That was a MEASUREMENT, and a measurement rots
 * — the whole point of this file is to make it a standing check instead, so the day someone adds
 * a segment they have to say so here rather than discover it from a peer's corrupted vault.
 *
 * This is a TEXT scan and therefore a proxy: it cannot see a segment built from a variable, and
 * `root` is a name, not a thing — its first run proved both by flagging four joins onto roots that
 * have nothing to do with the rotator (TRDD zones, the browser-profile base). So the unreadable
 * joins are not ignored and not asserted empty; they are ENUMERATED and reviewed, each with what
 * it resolves to. A NEW one reddens this file and gets a human, which is the only honest handling
 * of a surface a regex cannot read.
 */
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO = path.resolve(__dirname, '..', '..')

/** Every literal segment this project joins onto a rotator root. Adding one is a deliberate act. */
const ALLOWED = [
  'active-alerts.json',
  'cookie-leg-since.json',
  'live-identity.json',
  'opt-in.flag',
  'slots',
  'state.json',
  'tick-completed.ts',
].sort()

/**
 * Joins whose segment is a variable, each resolved BY HAND. Only the first is a rotator root.
 *
 * The other four are why the bare `root` arm cannot be trusted on its own: `root` is a variable
 * NAME shared by unrelated subsystems, so matching it finds the TRDD zone root and the
 * browser-profile base as readily as the rotator's. They are listed rather than filtered out,
 * because a filter that removed them would also remove a future rotator join that happened to
 * live in one of those files.
 */
const DYNAMIC_REVIEWED = [
  // ROTATOR root. LOG_BASENAME is a module const = 'rotator.log' (decision-log.ts).
  'lib/oauth-rotator/decision-log.ts: join(root, LOG_BASENAME)',
  // NOT a rotator root — the cold-cache path, root is a cache dir.
  'lib/cold-cache-clear.ts: join(root, names[names.length - 1])',
  // NOT a rotator root — `root` is ~/Library/Application Support, `rel` a browser dir
  // (discoverBrowserProfiles). This is the owner's real browser tree, not the rotator's.
  'lib/oauth-rotator/reauth-drive.ts: join(root, rel)',
  // NOT a rotator root — the TRDD design root; `zone` is tasks/proposals/archived/refused.
  'lib/pillar/store.ts: join(root, zone)',
  'lib/trdd-create.ts: join(root, zone)',
].sort()

/** Every tracked source file — not just `lib/**\/*.ts`. Half this runtime is `.mjs`. */
function sources(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
  return out.toString('utf-8').split('\0').filter(Boolean)
    .filter(f => /\.(ts|tsx|mjs|cjs|js)$/.test(f))
    .filter(f => !f.startsWith('tests/'))
}

/** `path.join(<root-ish>, X)` where root-ish is a rotator root accessor or a bare `root` variable. */
const JOIN = /(?:path\.)?join\(\s*(rotatorRoot\(\)|canonicalRotatorRoot\(\)|legacyRotatorRoot\(\)|root)\s*,\s*([^)]*)/g

function scan() {
  const literal = new Set<string>()
  const dynamic: string[] = []
  let files = 0
  for (const f of sources()) {
    const src = execFileSync('git', ['show', `:${f}`], { cwd: REPO, maxBuffer: 16 * 1024 * 1024 }).toString('utf-8')
    files++
    if (!src.includes('otatorRoot') && !/join\(\s*root\s*,/.test(src)) continue
    for (const m of src.matchAll(JOIN)) {
      const arg = m[2].trim()
      const lit = arg.match(/^'([^']+)'|^"([^"]+)"/)
      if (lit) literal.add(lit[1] ?? lit[2]!)
      else dynamic.push(`${f}: join(${m[1]}, ${arg.slice(0, 60)})`)
    }
  }
  return { literal: [...literal].sort(), dynamic, files }
}

describe('what this project joins onto the rotator root', () => {
  const { literal, dynamic, files } = scan()

  it('actually scanned the tracked sources (guards against a silently empty scan)', () => {
    expect(files).toBeGreaterThan(200)
    expect(literal.length).toBeGreaterThan(0) // the joins exist; a zero here means the regex broke
  })

  it('joins ONLY the known segments — and never `profiles`, which is the live cookie store', () => {
    expect(literal).not.toContain('profiles')
    expect(literal).toEqual(ALLOWED)
  })

  it('every join this scan cannot read is one that has been reviewed', () => {
    expect(
      dynamic.sort(),
      'a dynamic segment is invisible to a text scan. If it joins onto a ROTATOR root, resolve it ' +
        'by hand and either add the literal to ALLOWED or stop it; if it joins onto some other ' +
        `root, add it to DYNAMIC_REVIEWED with what it resolves to:\n${dynamic.join('\n')}`,
    ).toEqual(DYNAMIC_REVIEWED)
  })
})
