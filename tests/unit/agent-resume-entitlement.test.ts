/**
 * TRDD-KO4TQCJ0 — a new agent at a REUSED workdir must not resume its predecessor's conversation.
 *
 * Claude Code keys transcripts by working-directory PATH, not by agent
 * (`~/.claude/projects/<abs-path-with-slashes-as-dashes>/*.jsonl`), so agent identity never
 * appeared in the probe at all. Delete agent A at `~/agents/alpha`, create agent B at the same
 * path, and B's slug IS A's slug: `--continue` hands B a stranger's conversation, and B looks
 * perfectly healthy while doing the wrong thing next.
 *
 * The gate is an mtime comparison against the agent's own `createdAt`. These tests pin BOTH
 * directions, because either one alone is satisfiable by a broken implementation:
 *   - the predecessor case (must NOT resume) would pass if the probe always answered false;
 *   - the same-agent restart (must STILL resume) is the positive control that forbids that, and is
 *     the behaviour TRDD-NIU5RQ1S shipped, which this must not undo.
 *
 * 0-IMPACT: every case supplies its own `homedir` under `os.tmpdir()`. No test here reads or writes
 * the developer's real `~/.claude/projects/` — that directory is the USER's data, which is the whole
 * reason TRDD-0GCIMQ9F ruled out deleting it and left this card to filter instead.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'

import {
  agentMayResumeConversation,
  conversationSlug,
  decideResume,
  resolveAgentResumeProbe,
  resumeEntitlementEpoch,
} from '@/lib/claude-conversation'

const WORKDIR = '/Users/someone/agents/alpha'

/** Write a transcript into the fixture home and stamp it with an explicit mtime. */
async function writeTranscript(home: string, workdir: string, name: string, mtime: Date) {
  const dir = path.join(home, '.claude', 'projects', conversationSlug(workdir))
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await fsp.writeFile(file, '{}')
  // Explicit, so the comparison is deterministic rather than a race with the wall clock.
  await fsp.utimes(file, mtime, mtime)
}

describe('agentMayResumeConversation — the entitlement gate (TRDD-KO4TQCJ0)', () => {
  let home: string

  beforeEach(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aim-resume-'))
  })

  afterEach(async () => {
    await fsp.rm(home, { recursive: true, force: true })
  })

  it('refuses a transcript written BEFORE the agent existed (the recycled-workdir case)', async () => {
    // Agent A ran here and was deleted; its transcript survives (a soft delete never purges it).
    await writeTranscript(home, WORKDIR, 'agent-a.jsonl', new Date('2026-07-01T10:00:00Z'))
    const agentB = {
      program: 'claude',
      workingDirectory: WORKDIR,
      createdAt: '2026-07-20T09:00:00Z', // created LATER, at the same path
    }
    expect(await agentMayResumeConversation(agentB, { homedir: home })).toBe(false)
  })

  it('still resumes the agent\'s OWN transcript (positive control — TRDD-NIU5RQ1S)', async () => {
    const agent = {
      program: 'claude',
      workingDirectory: WORKDIR,
      createdAt: '2026-07-20T09:00:00Z',
    }
    await writeTranscript(home, WORKDIR, 'own.jsonl', new Date('2026-07-20T11:30:00Z'))
    expect(await agentMayResumeConversation(agent, { homedir: home })).toBe(true)
  })

  it('resumes when ANY transcript is young enough, even beside inherited ones', async () => {
    await writeTranscript(home, WORKDIR, 'agent-a.jsonl', new Date('2026-07-01T10:00:00Z'))
    await writeTranscript(home, WORKDIR, 'agent-a-2.jsonl', new Date('2026-07-02T10:00:00Z'))
    await writeTranscript(home, WORKDIR, 'mine.jsonl', new Date('2026-07-20T11:30:00Z'))
    const agent = { program: 'claude', workingDirectory: WORKDIR, createdAt: '2026-07-20T09:00:00Z' }
    expect(await agentMayResumeConversation(agent, { homedir: home })).toBe(true)
  })

  it('DEGRADES OPEN when the registry row carries no createdAt', async () => {
    // No epoch ⇒ exactly the pre-KO4TQCJ0 answer. Blocking a resume on a missing field would trade
    // a rare wrong resume for a routine lost one, and the lost turn is the costlier failure.
    await writeTranscript(home, WORKDIR, 'whoever.jsonl', new Date('2026-07-01T10:00:00Z'))
    const agent = { program: 'claude', workingDirectory: WORKDIR }
    expect(await agentMayResumeConversation(agent, { homedir: home })).toBe(true)
  })

  it('DEGRADES OPEN when createdAt is unparseable', async () => {
    await writeTranscript(home, WORKDIR, 'whoever.jsonl', new Date('2026-07-01T10:00:00Z'))
    const agent = { program: 'claude', workingDirectory: WORKDIR, createdAt: 'not-a-date' }
    expect(resumeEntitlementEpoch(agent)).toBeUndefined()
    expect(await agentMayResumeConversation(agent, { homedir: home })).toBe(true)
  })

  it('falls back to the first session workdir when the agent has none of its own', async () => {
    await writeTranscript(home, WORKDIR, 'mine.jsonl', new Date('2026-07-20T11:30:00Z'))
    const agent = {
      program: 'claude',
      sessions: [{ workingDirectory: WORKDIR }],
      createdAt: '2026-07-20T09:00:00Z',
    }
    expect(await agentMayResumeConversation(agent, { homedir: home })).toBe(true)
  })

  it('is false with no workdir at all, and false for a client we cannot probe', async () => {
    await writeTranscript(home, WORKDIR, 'mine.jsonl', new Date('2026-07-20T11:30:00Z'))
    expect(await agentMayResumeConversation({ program: 'claude' }, { homedir: home })).toBe(false)
    // A `--continue`-flag builder must not claim a transcript exists for a client whose storage we
    // have never verified. (The BOOT path's opposite answer is pinned below.)
    expect(
      await agentMayResumeConversation(
        { program: 'codex', workingDirectory: WORKDIR, createdAt: '2026-07-20T09:00:00Z' },
        { homedir: home },
      ),
    ).toBe(false)
  })
})

describe('resolveAgentResumeProbe — the boot-path shape (TRDD-KO4TQCJ0)', () => {
  let home: string

  beforeEach(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), 'aim-resume-boot-'))
  })

  afterEach(async () => {
    await fsp.rm(home, { recursive: true, force: true })
  })

  it('returns null for an unverified client, so decideResume still resumes it (USER 2026-07-25)', async () => {
    const agent = { program: 'codex', workingDirectory: WORKDIR, createdAt: '2026-07-20T09:00:00Z' }
    expect(resolveAgentResumeProbe(agent, { homedir: home })).toBeNull()
    // The load-bearing consequence: a null probe means the CALLER decides, not a filesystem guess.
    const decision = await decideResume('resume --last', resolveAgentResumeProbe(agent, { homedir: home }))
    expect(decision).toEqual({ resume: true, verb: 'resume --last' })
  })

  it('binds the entitlement epoch, so the boot path refuses an inherited transcript', async () => {
    await writeTranscript(home, WORKDIR, 'agent-a.jsonl', new Date('2026-07-01T10:00:00Z'))
    const agentB = { program: 'claude', workingDirectory: WORKDIR, createdAt: '2026-07-20T09:00:00Z' }
    const decision = await decideResume('--continue', resolveAgentResumeProbe(agentB, { homedir: home }))
    expect(decision).toEqual({ resume: false, reason: 'no-transcript' })
  })

  it('still resumes the agent\'s own transcript on the boot path (positive control)', async () => {
    await writeTranscript(home, WORKDIR, 'own.jsonl', new Date('2026-07-20T11:30:00Z'))
    const agent = { program: 'claude', workingDirectory: WORKDIR, createdAt: '2026-07-20T09:00:00Z' }
    const decision = await decideResume('--continue', resolveAgentResumeProbe(agent, { homedir: home }))
    expect(decision).toEqual({ resume: true, verb: '--continue' })
  })
})

/**
 * THE STRUCTURAL GUARD, and the reason this card built a helper instead of editing five call sites.
 *
 * `hasPriorConversation` takes a bare workdir, so any production caller of it is a site that has
 * silently dropped the agent's identity — and a fix hand-replicated across N sites is a coverage
 * question, not an edit: N-1 of N is indistinguishable from N, because every existing test still
 * passes (lesson `4520ef9a`). This test makes that impossible to reintroduce by hand.
 */
describe('no production code may probe transcripts without an agent (TRDD-KO4TQCJ0)', () => {
  const ROOTS = ['lib', 'services', 'app', 'scripts']
  const OWNER = path.join('lib', 'claude-conversation.ts')

  async function walk(dir: string, out: string[] = []): Promise<string[]> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        await walk(full, out)
      } else if (/\.(ts|tsx|mjs)$/.test(e.name)) {
        out.push(full)
      }
    }
    return out
  }

  it('only lib/claude-conversation.ts names hasPriorConversation', async () => {
    const root = process.cwd()
    const files = (await Promise.all(ROOTS.map((r) => walk(path.join(root, r))))).flat()

    // Non-vacuity: a walk that found nothing would make every assertion below pass silently.
    expect(files.length).toBeGreaterThan(100)

    const offenders: string[] = []
    let ownerSeen = false
    for (const file of files) {
      const rel = path.relative(root, file)
      const src = await fsp.readFile(file, 'utf-8')
      if (!src.includes('hasPriorConversation')) continue
      if (rel === OWNER) {
        ownerSeen = true
        continue
      }
      offenders.push(rel)
    }

    // Positive control: the scan really does see the symbol where it is defined. Without this, an
    // extension typo or a broken walk would report "clean" about a set it never read.
    expect(ownerSeen).toBe(true)
    expect(offenders).toEqual([])
  })
})
