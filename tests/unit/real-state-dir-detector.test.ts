import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { setup } from '../setup/real-state-dir-untouched'
import { watchForLeaks } from '../helpers/real-state-roots'

// WHAT THIS FILE DOES NOT COVER, stated because the filename over-promises: every test below
// drives watchForLeaks() DIRECTLY against a fixture. Nothing here asserts that setup() — the
// function vitest actually registers — is bound to REAL_STATE. Change it to
// watchForLeaks(process.cwd()) tomorrow and all of these stay green while the guard watches the
// wrong directory. That failure mode is INTRODUCED by the split (before it there was no wrong
// root to pass), and proving the binding would require writing into the developer's real state
// dir, which is the one thing this guard exists to forbid. The arity test below pins the other
// half of the split's contract; the root binding is covered by review, not by a test.
describe('watchForLeaks', () => {
  const dirs: string[] = []

  // realpathSync because macOS resolves $TMPDIR through /var -> /private/var; without it the
  // fixture root and the path the walk reports back would be spelled differently.
  function mkFixture(): string {
    const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'leak-detector-'))
    dirs.push(d)
    return d
  }

  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop()!
      fs.rmSync(d, { recursive: true, force: true })
    }
  })

  // The NESTED shape is load-bearing, not incidental: it is exactly what defeated the previous
  // per-suite guard, which compared only top-level names while the writes landed inside an entry
  // that already existed. A non-recursive walk must fail this test and only this one — verified
  // by neuter 2026-09-13 (deleting the recursion reddened this test alone, by name).
  it('throws when a file appears NESTED inside a directory that already existed', () => {
    const root = mkFixture()
    fs.mkdirSync(path.join(root, 'pillar-index'))
    const teardown = watchForLeaks(root)
    fs.writeFileSync(path.join(root, 'pillar-index', 'leak.sqlite'), '')
    let message = ''
    try {
      teardown()
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('LEAKED')
    // Both assertions are required. Under a non-recursive walk with the directory created BEFORE
    // the watch, `added` is empty and nothing throws; but if a future edit moves the mkdirSync
    // after the watch, the directory itself becomes the addition and a bare toThrow() would pass
    // against exactly the bug this test exists for. The path assertion is what survives that.
    expect(message).toContain('pillar-index/leak.sqlite')
  })

  it('stays silent when nothing was written', () => {
    const root = mkFixture()
    const teardown = watchForLeaks(root)
    expect(teardown).not.toThrow()
  })

  it('stays silent when an entry is removed, because only additions are the signal', () => {
    const root = mkFixture()
    const filePath = path.join(root, 'existing.txt')
    fs.writeFileSync(filePath, '')
    const teardown = watchForLeaks(root)
    fs.rmSync(filePath)
    expect(teardown).not.toThrow()
  })

  it('lists at most 20 additions and says how many more there are', () => {
    const root = mkFixture()
    const teardown = watchForLeaks(root)
    for (let i = 0; i < 25; i++) {
      fs.writeFileSync(path.join(root, `leak-${i}.txt`), '')
    }
    let message = ''
    try {
      teardown()
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('...and 5 more')
    // Count entry lines by their own shape, NOT by the two-space indent: the "...and N more"
    // suffix carries the same indent (entries are joined with '\n  ' and the block opens with
    // ':\n  '), so an indent-based count returns 21 on correct code and invites fitting the
    // expected value to the output.
    const listedLines = message.split('\n').filter((l) => /^\s\sleak-\d+\.txt$/.test(l))
    expect(listedLines.length).toBe(20)
  })

  it('ignores a new .DS_Store rather than reporting it as a leak', () => {
    const root = mkFixture()
    const teardown = watchForLeaks(root)
    fs.writeFileSync(path.join(root, '.DS_Store'), '')
    expect(teardown).not.toThrow()
  })

  // setup() is what vitest registers, and vitest calls globalSetup with a GlobalSetupContext as
  // argument 0 — so a `root` parameter with a default would silently bind that object instead of
  // a path. `setup.length` CANNOT pin this: a defaulted parameter does not count toward it, so an
  // arity assertion passes against the exact bug it names (measured 2026-09-13, by neuter).
  //
  // The decoy discriminates: correct code ignores the argument and watches the real state dir, so
  // the write into `decoy` is invisible and nothing names it; buggy code watches `decoy` and the
  // thrown message contains its path. Asserting the ABSENCE of the decoy path rather than silence
  // is deliberate — the real state dir is live, and a daemon write during these milliseconds
  // would throw with real-state paths, which must not fail this test.
  //
  // The POSITIVE CONTROL is what stops that absence assertion being vacuous. `not.toContain` is
  // satisfied by an empty string, so without a control it would also pass against a watchForLeaks
  // that returned a no-op closure. The control proves this fixture CAN produce the forbidden
  // string, so the second assertion's silence means "setup ignored the argument" rather than
  // "nothing was detectable here in the first place".
  //
  // WHAT THE CONTROL DOES NOT COVER: it is itself a watchForLeaks closure, so it certifies
  // watchForLeaks is live — not setup(). Replace setup()'s body with `() => {}` and leave
  // watchForLeaks alone: the control still throws, `message` is still '', and this test still
  // passes. The neuter that WAS run probed a different mutation (setup honouring argument 0).
  // Proving the dead-setup case needs the real state dir to change during the test, which is
  // the one thing this guard exists to forbid, so it stays covered by review rather than a test.
  it('ignores its first argument, because vitest passes a GlobalSetupContext there', () => {
    const decoy = mkFixture()
    const teardown = (setup as unknown as (x: string) => () => void)(decoy)
    const control = watchForLeaks(decoy)
    fs.writeFileSync(path.join(decoy, 'leak.sqlite'), '')

    let controlMessage = ''
    try {
      control()
    } catch (err) {
      controlMessage = (err as Error).message
    }
    expect(controlMessage).toContain(decoy)

    let message = ''
    try {
      teardown()
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).not.toContain(decoy)
  })
})
