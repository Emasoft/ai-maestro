import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { WATCHED_ROOTS, watchForLeaks, watchMultipleRoots } from '../helpers/real-state-roots'

describe('real-state-roots helper', () => {
  const dirs: string[] = []

  function mkFixture(): string {
    const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'leak-roots-'))
    dirs.push(d)
    return d
  }

  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop()!
      fs.rmSync(d, { recursive: true, force: true })
    }
  })

  it('a root that does not exist yet is legal — absent-before/absent-after does not throw', () => {
    const root = path.join(mkFixture(), 'never-created')
    const teardown = watchForLeaks(root)
    expect(teardown).not.toThrow()
  })

  it('a root that appears mid-run counts as an addition — absent-before/present-after throws', () => {
    const root = path.join(mkFixture(), 'appears-later')
    const teardown = watchForLeaks(root)
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(root, 'leak.txt'), '')
    expect(teardown).toThrow(/LEAKED/)
  })

  it('WATCHED_ROOTS includes the cross-projects-coordination root', () => {
    // The detector hardcodes os.homedir() with no injection seam, so this cannot drive the
    // real setup() end-to-end without touching the developer's actual $HOME. This pins the
    // one thing that is pinnable without doing that: the exported watched-roots list names
    // the expected path shape. It necessarily recomputes the same join the source does —
    // there is no third, independent way to express "this well-known path" — so it proves
    // the root is DECLARED, not that setup() actually watches it end-to-end (that half is
    // covered by review, same as the setup/watchForLeaks binding noted in the sibling file).
    const want = path.join(os.homedir(), '.claude', 'cross-projects-coordination')
    expect(WATCHED_ROOTS).toContain(want)
  })

  it('watchMultipleRoots catches a leak under the SECOND root, not just the first', () => {
    const rootA = mkFixture()
    const rootB = mkFixture()
    const teardown = watchMultipleRoots([rootA, rootB])
    fs.writeFileSync(path.join(rootB, 'leak.txt'), '')
    expect(teardown).toThrow(/LEAKED/)
  })

  // The statusline-state carve-out (commit e225d5479): the live statusline daemon mints
  // always-newly-named backups/tmp/locks in ~/.aimaestro/statusline-state/ on every ~3s
  // refresh, which the detector read as a test leak. The exemption keys on the REL path
  // `statusline-state/` + non-.json FILE; a fixture subdir named exactly `statusline-state`
  // exercises the same code without touching the developer's real $HOME.

  it('a transient-named file under a statusline-state/ subdir is EXEMPT (does not trip)', () => {
    const root = mkFixture()
    fs.mkdirSync(path.join(root, 'statusline-state'))
    const teardown = watchForLeaks(root)
    fs.writeFileSync(path.join(root, 'statusline-state', 'x.json.lock'), '')
    fs.writeFileSync(path.join(root, 'statusline-state', 'y.json.tmp.12835.1'), '')
    fs.writeFileSync(path.join(root, 'statusline-state', 'z.json.aim-bak-2026-09-28_1954-12835-020441'), '')
    expect(teardown).not.toThrow()
  })

  it('a .json RECORD under statusline-state/ still trips — only the transient surface is exempt', () => {
    const root = mkFixture()
    fs.mkdirSync(path.join(root, 'statusline-state'))
    const teardown = watchForLeaks(root)
    fs.writeFileSync(path.join(root, 'statusline-state', 'session-uuid.json'), '')
    expect(teardown).toThrow(/LEAKED/)
  })

  it('a .json record in a statusline-state/ SUBDIR stays watched — the walk still descends', () => {
    const root = mkFixture()
    fs.mkdirSync(path.join(root, 'statusline-state', 'per-session'), { recursive: true })
    const teardown = watchForLeaks(root)
    fs.writeFileSync(path.join(root, 'statusline-state', 'per-session', 'leak.json'), '')
    expect(teardown).toThrow(/LEAKED/)
  })

  it('the same transient shapes OUTSIDE statusline-state/ still trip — the carve-out does not leak tree-wide', () => {
    const root = mkFixture()
    const teardown = watchForLeaks(root)
    fs.writeFileSync(path.join(root, 'registry.json.aim-bak-2026-09-28_1954-12835-020441'), '')
    expect(teardown).toThrow(/LEAKED/)
  })

  it('a SIBLING dir named statusline-state-* is NOT exempt — the prefix requires the trailing slash', () => {
    const root = mkFixture()
    fs.mkdirSync(path.join(root, 'statusline-state-backup'))
    const teardown = watchForLeaks(root)
    fs.writeFileSync(path.join(root, 'statusline-state-backup', 'leak.json'), '')
    expect(teardown).toThrow(/LEAKED/)
  })
})
