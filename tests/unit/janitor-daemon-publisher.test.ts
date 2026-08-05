/**
 * The daemon → janitor publish channel (TRDD-14HI8ZPR; USER security ruling 2026-08-05).
 *
 * WHAT THIS GUARDS. Only the server-integrated daemon may read agent status; janitor processes
 * receive it as a file deposited in their OWN project folder. So this module is a WRITER that takes
 * directories from the registry and puts fleet data in them — which makes "where is it allowed to
 * write" the entire security surface, and containment the property under test.
 *
 * TWO REAL DEFECTS THIS SUITE EXISTS BECAUSE OF, both found while writing it:
 *
 *   1. `isUnder(child, parent)` is a RAW STRING COMPARE — `child.startsWith(parent + sep)`. It does
 *      not normalize, so `<agents>/../../etc` starts with `<agents>/` and sailed straight through
 *      the first version of the gate. Only `checkWorkdirPathPolicy` resolves, and its docstring is
 *      where that is written down.
 *   2. `resolve()` fixes `..` but is purely LEXICAL, so a symlink inside the agents root pointing at
 *      /tmp, another user's home, or a network mount still passed. That is precisely the "malicious
 *      controlled outlet or remote folder" the channel exists to avoid.
 *
 * Both are pinned below, and both would be invisible to a happy-path test.
 *
 * THE POSITIVE CONTROL IS LOAD-BEARING. Every containment assertion here is of the form "nothing was
 * written there". A publisher that writes NOTHING AT ALL satisfies all of them, so without a test
 * proving a legitimate agent does receive its file, this suite would pass against a completely
 * broken channel.
 *
 * NEUTER RUNS (recorded 2026-08-05, via scripts/dev/neuter) — including one that failed first:
 *   · dropping the realpath re-check reddens ONLY the symlink closure. 1 red.
 *   · dropping `path.resolve` before the first `isUnder` reddened NOTHING on the first attempt —
 *     all 12 green. That was a finding about the TEST, not a passing guard. The two checks are NOT
 *     independent: realpath normalizes `..` as well, so removing resolve() only defers the same
 *     refusal by one step, and the traversal closure's assertion (`/outside the agents root/`)
 *     matched the SYMLINK message too, which is a superset of that phrase. Tightened with
 *     `not.toMatch(/via a link/)` so the closure pins WHICH check fired; the same neuter now reds
 *     exactly it.
 *
 * The lesson generalises: when two guards can catch the same input, an assertion on the OUTCOME
 * cannot tell them apart — only an assertion on which one spoke can.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync, readFileSync, readdirSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
  publishHibernationResponses,
  DAEMON_RESPONSES_DIR,
  HIBERNATION_RESPONSE_FILE,
  RESPONSE_STALE_AFTER_S,
} from '@/lib/janitor-daemon-publisher'
import type { HibernationRoster } from '@/lib/agent-hibernation'

let root: string
let agentsRoot: string
let installRoot: string
let outsideRoot: string

/** Build a roster whose agents point wherever the test wants to aim the writer. */
function rosterWith(agents: Array<{ id: string; name: string; wd: string | null }>): HibernationRoster {
  return {
    agents: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      sessionName: a.name,
      workingDirectory: a.wd,
      persisted: false,
      tmux: false,
      state: 'hibernated' as const,
      reason: 'not persisted and no tmux — cleanly hibernated',
    })),
    orphanedPersistedSessions: [],
    counts: { running: 0, hibernated: agents.length, crashed: 0, never_woken: 0, orphaned: 0 },
  }
}

function publish(roster: HibernationRoster) {
  return publishHibernationResponses({
    gather: async () => roster,
    now: () => 1_700_000_000,
    agentsRoot,
    installRoot,
    // real fs existence — the containment checks must run against real inodes, not a fake
  })
}

const responsePath = (dir: string) => path.join(dir, DAEMON_RESPONSES_DIR, HIBERNATION_RESPONSE_FILE)

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'aim-janitor-publish-'))
  agentsRoot = path.join(root, 'agents')
  installRoot = path.join(root, 'install')
  outsideRoot = path.join(root, 'outside')
  mkdirSync(agentsRoot, { recursive: true })
  mkdirSync(installRoot, { recursive: true })
  mkdirSync(outsideRoot, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('publishHibernationResponses — containment', () => {
  it('POSITIVE CONTROL: a legitimate agent workdir receives its file', async () => {
    // Without this, every "nothing was written" assertion below passes against a publisher that
    // writes nothing at all.
    const wd = path.join(agentsRoot, 'good')
    mkdirSync(wd, { recursive: true })
    const o = await publish(rosterWith([{ id: 'a1', name: 'good', wd }]))
    expect(existsSync(responsePath(wd))).toBe(true)
    // The recorded path is the REALPATH, deliberately: the publisher writes to the resolved inode
    // so the destination it reports is the one containment was actually asserted against, not a
    // lexical alias of it. On macOS every tmpdir is such an alias (/var → /private/var).
    expect(o.written).toContain(responsePath(realpathSync(wd)))
    expect(o.refused).toHaveLength(0)
  })

  it('a workdir OUTSIDE the agents root is refused, and nothing is written there', async () => {
    const o = await publish(rosterWith([{ id: 'a1', name: 'stray', wd: outsideRoot }]))
    expect(existsSync(responsePath(outsideRoot))).toBe(false)
    expect(o.refused.map((r) => r.reason).join()).toMatch(/outside the agents root/)
    expect(o.written).not.toContain(responsePath(outsideRoot))
  })

  it('DEFECT 1 — a `..` traversal that string-prefixes the agents root is refused BY THE LEXICAL CHECK', async () => {
    // `<agentsRoot>/../outside` literally starts with `<agentsRoot>` + sep, so an unresolved
    // `isUnder` check accepts it. This is the exact input that escaped the first implementation.
    const traversal = path.join(agentsRoot, '..', 'outside')
    const o = await publish(rosterWith([{ id: 'a1', name: 'sneaky', wd: traversal }]))
    expect(existsSync(responsePath(outsideRoot))).toBe(false)
    expect(o.written).toHaveLength(1) // the install root only
    const reason = o.refused.map((r) => r.reason).join()
    expect(reason).toMatch(/outside the agents root/)
    // ...AND it must be the LEXICAL check that caught it, not the realpath one downstream.
    //
    // Without this second assertion the closure is vacuous with respect to `path.resolve`: realpath
    // ALSO normalizes `..`, so removing the resolve() merely defers the same refusal one step, and
    // the reason string still contains "outside the agents root" (the symlink message is a
    // superset of it). Measured — neutering resolve() with only the loose assertion left all 12
    // green. Pinning WHICH check fired is what makes the two independently testable.
    expect(reason).not.toMatch(/via a link/)
  })

  it('DEFECT 2 — a SYMLINK out of the agents root is refused', async () => {
    // Lexically inside, physically elsewhere: `resolve()` cannot see this, only realpath can.
    const link = path.join(agentsRoot, 'looks-legit')
    symlinkSync(outsideRoot, link)
    const o = await publish(rosterWith([{ id: 'a1', name: 'looks-legit', wd: link }]))
    expect(existsSync(responsePath(outsideRoot))).toBe(false)
    expect(o.refused.map((r) => r.reason).join()).toMatch(/via a link/)
  })

  it('a workdir that does not exist is refused, and the tree is NOT created', async () => {
    // Materialising a tree for a vanished agent is how a deleted agent's directory gets re-created
    // by the very thing meant to observe it (the 2026-07-25 regrowth incident).
    const gone = path.join(agentsRoot, 'deleted-agent')
    const o = await publish(rosterWith([{ id: 'a1', name: 'deleted-agent', wd: gone }]))
    expect(existsSync(gone)).toBe(false)
    expect(o.refused.map((r) => r.reason).join()).toMatch(/does not exist/)
  })

  it('an agent with no recorded workdir is refused, not defaulted', async () => {
    const o = await publish(rosterWith([{ id: 'a1', name: 'nowhere', wd: null }]))
    expect(o.refused.map((r) => r.reason).join()).toMatch(/no working directory/)
  })

  it('one bad agent never starves the others — the sweep continues', async () => {
    const good = path.join(agentsRoot, 'good')
    mkdirSync(good, { recursive: true })
    const o = await publish(
      rosterWith([
        { id: 'bad', name: 'stray', wd: outsideRoot },
        { id: 'ok', name: 'good', wd: good },
      ]),
    )
    expect(existsSync(responsePath(good))).toBe(true)
    expect(o.refused).toHaveLength(1)
  })
})

describe('publishHibernationResponses — least privilege', () => {
  it('an agent workdir gets its OWN record and fleet COUNTS, never another agent', async () => {
    const mine = path.join(agentsRoot, 'mine')
    const theirs = path.join(agentsRoot, 'theirs')
    mkdirSync(mine, { recursive: true })
    mkdirSync(theirs, { recursive: true })
    await publish(
      rosterWith([
        { id: 'a-mine', name: 'mine', wd: mine },
        { id: 'a-theirs', name: 'theirs', wd: theirs },
      ]),
    )
    const body = readFileSync(responsePath(mine), 'utf-8')
    expect(body).toContain('a-mine')
    // The whole point: compromising one agent must not yield a map of the fleet.
    expect(body).not.toContain('a-theirs')
    expect(body).not.toContain('theirs')
    expect(JSON.parse(body).data.counts).toBeDefined()
  })

  it('the install root gets the FULL roster — it is not an agent workdir', async () => {
    const mine = path.join(agentsRoot, 'mine')
    mkdirSync(mine, { recursive: true })
    await publish(rosterWith([{ id: 'a-mine', name: 'mine', wd: mine }]))
    const body = JSON.parse(readFileSync(responsePath(installRoot), 'utf-8'))
    expect(body.data.agents).toHaveLength(1)
    expect(body.data).toHaveProperty('orphanedPersistedSessions')
  })
})

describe('publishHibernationResponses — envelope and robustness', () => {
  it('stamps a versioned envelope with epoch SECONDS and a staleness window', async () => {
    const wd = path.join(agentsRoot, 'good')
    mkdirSync(wd, { recursive: true })
    await publish(rosterWith([{ id: 'a1', name: 'good', wd }]))
    const env = JSON.parse(readFileSync(responsePath(wd), 'utf-8'))
    expect(env).toMatchObject({ v: 1, ts: 1_700_000_000, staleAfterS: RESPONSE_STALE_AFTER_S })
    // SECONDS, not millis: a millis value parses fine and reads as fresh for ~55,000 years.
    expect(String(env.ts)).toHaveLength(10)
  })

  it('leaves no .tmp file behind — the write is atomic', async () => {
    const wd = path.join(agentsRoot, 'good')
    mkdirSync(wd, { recursive: true })
    await publish(rosterWith([{ id: 'a1', name: 'good', wd }]))
    const files = readdirSync(path.join(wd, DAEMON_RESPONSES_DIR))
    expect(files).toEqual([HIBERNATION_RESPONSE_FILE])
  })

  it('a failing gather is RECORDED, never thrown — it runs unattended on a timer', async () => {
    const o = await publishHibernationResponses({
      gather: async () => {
        throw new Error('registry unreadable')
      },
      agentsRoot,
      installRoot,
    })
    expect(o.written).toHaveLength(0)
    expect(o.refused.map((r) => r.reason).join()).toMatch(/registry unreadable/)
  })
})
