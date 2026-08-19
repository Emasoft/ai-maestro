import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// TRDD-17K0SHDQ (W-D probe finding, 2026-08-19): the six amp-kanban-*.sh CLIs sent NO
// Authorization header at all — every `curl` to `$API/api/...` carried only Content-Type — so
// the whole kanban family 401'd (`auth_required`) for every agent once the server dropped its
// localhost exemption. Measured live from a registered MANAGER's server-spawned session with a
// valid AID_AUTH in its env. The fix routes every API curl through `get_auth_args` (the ONE
// resolution order every aimaestro-* CLI uses) via the `_KANBAN_AUTH` array.
//
// WHY A SOURCE-SHAPE GUARD and not a spawn test: the scripts refuse to run without an AMP
// identity (the R32 gate in amp-helper.sh), which a unit test cannot and must not fabricate.
// The behavioural proof is the live probe itself (recorded on the card); this guard pins the
// invariant that made the defect possible — an API curl site without the auth array.

const REPO = path.resolve(__dirname, '../..')
const SCRIPTS = ['archive', 'create-task', 'edit', 'get', 'list', 'move'].map((v) => `amp-kanban-${v}.sh`)
const AUTH_TOKEN = '${_KANBAN_AUTH[@]+"${_KANBAN_AUTH[@]}"}'

/** Every `curl ` invocation line (continuation lines joined) that targets the ai-maestro API. */
function apiCurlSites(src: string): string[] {
  const joined = src.replace(/\\\n\s*/g, ' ')
  return joined
    .split('\n')
    .filter((l) => /\bcurl\s/.test(l) && !/^\s*#/.test(l))
    .filter((l) => /\$API\/api\/|\$URL\b/.test(l))
}

describe('amp-kanban-*.sh — every API curl carries the auth array', () => {
  for (const name of SCRIPTS) {
    it(`${name}: sources common.sh, builds _KANBAN_AUTH via get_auth_args, and passes it to every API curl`, () => {
      const src = fs.readFileSync(path.join(REPO, 'scripts', name), 'utf8')
      expect(src).toMatch(/shell-helpers\/common\.sh/)
      expect(src).toMatch(/^get_auth_args _KANBAN_AUTH$/m)
      const sites = apiCurlSites(src)
      // non-vacuity: each script has the team-id lookup AND its main call
      expect(sites.length).toBeGreaterThanOrEqual(2)
      for (const s of sites) expect(s, `unauthenticated API curl in ${name}: ${s.slice(0, 120)}`).toContain(AUTH_TOKEN)
    })
  }

  it('positive control — the extractor sees an unauthenticated site (the pre-fix shape)', () => {
    const preFix = 'RESPONSE=$(curl -s -w "\\n%{http_code}" --connect-timeout 5 --max-time 15 \\\n    -X POST "$API/api/teams/$TEAM_ID/tasks" \\\n    -H "Content-Type: application/json")\n'
    const sites = apiCurlSites(preFix)
    expect(sites).toHaveLength(1)
    expect(sites[0]).not.toContain(AUTH_TOKEN)
  })
})
