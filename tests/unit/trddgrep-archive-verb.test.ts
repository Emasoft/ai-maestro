/**
 * TRDD-4NISAY49 — `trddgrep archive`, the first CLI write verb that AUTHORIZES the
 * caller before it writes, because the act it performs is IRREVERSIBLE (an archived
 * card can never be un-archived, TRDD-MQE5D28T D8).
 *
 * These spawn the real CLI, because the exit code, the authorization decision and the
 * on-disk layout are contracts of the BINARY — nothing that imports the library can
 * observe any of the three. `$HOME` is redirected per spawn (jailed), and a real
 * registry.json / teams.json / governance.json fixture is written under it so the
 * MANAGER / CHIEF-OF-STAFF / AID-authorship paths run through the REAL loaders
 * (`lib/agent-registry.ts`, `lib/team-registry.ts`, `lib/governance.ts`), not a mock —
 * a subprocess never sees `vi.mock`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync, execFileSync } from 'child_process'
import { generateSessionSecret } from '@/lib/session-secret'

const REPO = process.cwd()
let root: string
let design: string
let fakeHome: string

const MANAGER_UUID = '11111111-1111-4111-8111-111111111111'
const COS_A_UUID = '22222222-2222-4222-8222-222222222222'
const COS_B_UUID = '33333333-3333-4333-8333-333333333333'
const AUTHOR_UUID = '44444444-4444-4444-8444-444444444444'
const OTHER_UUID = '55555555-5555-4555-8555-555555555555'

function cliWith(extraEnv: Record<string, string>, ...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join('scripts', 'trddgrep.mjs'), ...args, '--design-dir', design],
    {
      cwd: REPO, encoding: 'utf-8',
      env: { ...process.env, TRDD_DEBUG: '', HOME: fakeHome, AID_AUTH: '', USER: 'os-login-sentinel', ...extraEnv },
    },
  )
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
const cli = (...args: string[]) => cliWith({}, ...args)

const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf-8' })

const AIM_DIR = () => path.join(fakeHome, '.aimaestro')

function writeRegistry(rows: Array<Record<string, unknown>>) {
  const dir = path.join(AIM_DIR(), 'agents')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(rows))
}
function writeTeams(teams: Array<Record<string, unknown>>) {
  const dir = path.join(AIM_DIR(), 'teams')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'teams.json'), JSON.stringify({ teams }))
}
function writeGovernance(managerId: string | null) {
  fs.mkdirSync(AIM_DIR(), { recursive: true })
  fs.writeFileSync(
    path.join(AIM_DIR(), 'governance.json'),
    JSON.stringify({ version: 1, userName: 'test-owner', managerId, passwordSet: false }),
  )
}
function agentRow(id: string, name: string, governanceTitle: string, secretHash?: string) {
  return {
    id, name, governanceTitle,
    createdAt: '2026-01-01T00:00:00Z',
    workingDirectory: `/tmp/agents/${name}`,
    ...(secretHash ? { metadata: { sessionSecretHash: secretHash } } : {}),
  }
}

/** A v2-shaped TRDD filename, matching `trddIdFromFilename`'s TRDD_V2_FILENAME_RE. */
function fileFor(zone: string, id: string, slug = 'a-seeded-card') {
  return path.join(design, zone, `TRDD-20260101_000000+0000-${id}-${slug}.md`)
}

function seedCard(opts: {
  zone: 'proposals' | 'tasks' | 'archived'
  id: string
  column: string
  assignee?: string
  createdBy?: string
  blockedBy?: string[]
  acceptance?: string // raw markdown appended under a checklist heading
  extraFrontmatter?: string
}): string {
  const fm = [
    `trdd-id: ${opts.id}`,
    `title: a seeded card ${opts.id}`,
    `column: ${opts.column}`,
    `created: 2026-01-01T00:00:00+0000`,
    `updated: 2026-01-01T00:00:00+0000`,
    `task-type: feature`,
    opts.assignee ? `assignee: ${opts.assignee}` : null,
    opts.createdBy ? `created-by: ${opts.createdBy}` : null,
    opts.blockedBy ? `blocked-by: [${opts.blockedBy.join(', ')}]` : null,
    opts.extraFrontmatter ?? null,
  ].filter((l): l is string => l !== null).join('\n')
  const body = `\n# a seeded card\n\nbody.\n${opts.acceptance ?? ''}`
  const file = fileFor(opts.zone, opts.id)
  fs.writeFileSync(file, `---\n${fm}\n---\n${body}`)
  return file
}

const DONE_CHECKLIST = '\n## Acceptance\n\n- [x] done\n'
const OPEN_CHECKLIST = '\n## Acceptance\n\n- [ ] not done\n'

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'trddgrep-archive-'))
  design = path.join(root, 'design')
  fakeHome = path.join(root, 'home')
  fs.mkdirSync(fakeHome)
  for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
    fs.mkdirSync(path.join(design, z), { recursive: true })
  }
  fs.mkdirSync(path.join(design, 'requirements'), { recursive: true })
  fs.mkdirSync(path.join(design, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(design, 'requirements', 'PRRD.md'), '---\nproject-id: fixture-project\n---\n\n# PRRD\n')
  git('init', '-q', '.')
  git('config', 'user.email', 't@example.invalid')
  git('config', 'user.name', 'test')
  git('add', '-A')
  git('commit', '-qm', 'seed corpus skeleton')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('trddgrep archive — case 1: `user` archives a failed card as-is', () => {
  it('keeps column failed, sets status archived, moves into archived/, records the approval log line', () => {
    seedCard({ zone: 'tasks', id: 'AAAAAAAA', column: 'failed', assignee: `w#${AUTHOR_UUID}`, createdBy: `w#${AUTHOR_UUID}`, acceptance: DONE_CHECKLIST })
    git('add', '-A'); git('commit', '-qm', 'seed failed card')

    const r = cli('archive', 'AAAAAAAA', '--approver', 'user')
    expect(r.status, r.stderr).toBe(0)
    expect(fs.existsSync(fileFor('tasks', 'AAAAAAAA'))).toBe(false)
    const text = fs.readFileSync(fileFor('archived', 'AAAAAAAA'), 'utf-8')
    expect(text).toMatch(/^column: failed$/m)
    expect(text).toMatch(/^status: archived$/m)
    expect(text).toMatch(/## Approval log/)
    expect(text).toMatch(/ARCHIVED \(column kept: failed\) by user/)
  })
})

describe('trddgrep archive — case 2: a blocked card kept as-is, blocker terminal-done (stale)', () => {
  // `checkNode`'s `danglingBlocker` fires only when the REFERENCED blocker's column is
  // in TERMINAL_DONE (lib/trdd-graph.ts ~L388: `!archived && TERMINAL_DONE.has(bd.column)`).
  // A still-open blocker (column: dev) can never trigger it — that shape made the original
  // fixture vacuous: `checkNode`'s `archived` flag (`const archived = false`) could be
  // deleted entirely and this test would stay green either way. Use a blocker that IS
  // terminal-done (`complete`), which is exactly the shape the rule exists to catch, and
  // add a positive control proving the same shape DOES raise the finding when the blocked
  // card is left open (not archived) — that is what proves the archive test is non-vacuous.
  it('keeps blocked-by, and `trddgrep validate` reports no finding for the archived card', () => {
    seedCard({ zone: 'archived', id: 'BBBBBBBB', column: 'superseded' }) // stale terminal-done blocker (TERMINAL_DONE but not SHIPPED — avoids also firing BLOCKER-RELEASED)
    seedCard({ zone: 'tasks', id: 'CCCCCCCC', column: 'blocked', assignee: `w#${AUTHOR_UUID}`, createdBy: `w#${AUTHOR_UUID}`, blockedBy: ['TRDD-BBBBBBBB'], extraFrontmatter: 'pre-block-column: dev' })
    git('add', '-A'); git('commit', '-qm', 'seed blocked card')

    const r = cli('archive', 'CCCCCCCC', '--approver', 'user')
    expect(r.status, r.stderr).toBe(0)
    const text = fs.readFileSync(fileFor('archived', 'CCCCCCCC'), 'utf-8')
    expect(text).toMatch(/^column: blocked$/m)
    expect(text).toMatch(/blocked-by:\s*\[TRDD-BBBBBBBB\]/)

    const v = cli('validate', '--porcelain')
    expect(v.stdout + v.stderr).not.toMatch(/CCCCCCCC/)
  })

  it('positive control: the SAME shape left open (not archived) DOES raise danglingBlocker', () => {
    seedCard({ zone: 'archived', id: 'BBBBBBBB', column: 'superseded' })
    seedCard({ zone: 'tasks', id: 'CCCCCCCC', column: 'blocked', assignee: `w#${AUTHOR_UUID}`, createdBy: `w#${AUTHOR_UUID}`, blockedBy: ['TRDD-BBBBBBBB'] })
    git('add', '-A'); git('commit', '-qm', 'seed blocked card, no archive')

    const v = cli('validate', '--porcelain')
    expect(v.stdout + v.stderr).toMatch(/CCCCCCCC/)
    expect(v.stdout + v.stderr).toMatch(/GRAPH-DANGLING-BLOCKER/)
  })
})

describe('trddgrep archive — case 2b: a non-blocked column carrying blocked-by, kept as-is', () => {
  // The sibling shape of the same gate: `blockedNotBlocked` fires when a card's column is
  // NOT `blocked` while it still carries a `blocked-by:` (lib/trdd-graph.ts ~L382). Archiving
  // it as-is must suppress the finding the same way case 2 does for `danglingBlocker`.
  it('keeps blocked-by and column, and `trddgrep validate` reports no finding for the archived card', () => {
    seedCard({ zone: 'tasks', id: 'FFFFFFFF', column: 'dev' }) // still-open blocker; irrelevant to this gate
    seedCard({ zone: 'tasks', id: 'GGGGGGGG', column: 'dev', assignee: `w#${AUTHOR_UUID}`, createdBy: `w#${AUTHOR_UUID}`, blockedBy: ['TRDD-FFFFFFFF'] })
    git('add', '-A'); git('commit', '-qm', 'seed non-blocked card carrying blocked-by')

    const r = cli('archive', 'GGGGGGGG', '--approver', 'user')
    expect(r.status, r.stderr).toBe(0)
    const text = fs.readFileSync(fileFor('archived', 'GGGGGGGG'), 'utf-8')
    expect(text).toMatch(/^column: dev$/m)
    expect(text).toMatch(/blocked-by:\s*\[TRDD-FFFFFFFF\]/)

    const v = cli('validate', '--porcelain')
    expect(v.stdout + v.stderr).not.toMatch(/GGGGGGGG/)
  })

  it('positive control: the SAME shape left open (not archived) DOES raise blockedNotBlocked', () => {
    seedCard({ zone: 'tasks', id: 'FFFFFFFF', column: 'dev' })
    seedCard({ zone: 'tasks', id: 'GGGGGGGG', column: 'dev', assignee: `w#${AUTHOR_UUID}`, createdBy: `w#${AUTHOR_UUID}`, blockedBy: ['TRDD-FFFFFFFF'] })
    git('add', '-A'); git('commit', '-qm', 'seed non-blocked card, no archive')

    const v = cli('validate', '--porcelain')
    expect(v.stdout + v.stderr).toMatch(/GGGGGGGG/)
    expect(v.stdout + v.stderr).toMatch(/GRAPH-BLOCKED-NOT-BLOCKED/)
  })
})

describe('trddgrep archive — case 3: `--as completed` refused with an unchecked box', () => {
  it('refuses, and the file is byte-identical', () => {
    const file = seedCard({ zone: 'tasks', id: 'DDDDDDDD', column: 'dev', assignee: `w#${AUTHOR_UUID}`, createdBy: `w#${AUTHOR_UUID}`, acceptance: OPEN_CHECKLIST })
    git('add', '-A'); git('commit', '-qm', 'seed unfinished card')
    const before = fs.readFileSync(file, 'utf-8')

    const r = cli('archive', 'DDDDDDDD', '--approver', 'user', '--as', 'completed')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/unchecked/)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
    expect(fs.existsSync(fileFor('archived', 'DDDDDDDD'))).toBe(false)
  })
})

describe('trddgrep archive — case 4: complete, release-via publish, in tasks/', () => {
  it('archives as-is (release-via publish means still in tasks/ pre-archive)', () => {
    seedCard({
      zone: 'tasks', id: 'EEEEEEEE', column: 'complete', assignee: `w#${AUTHOR_UUID}`, createdBy: `w#${AUTHOR_UUID}`,
      acceptance: DONE_CHECKLIST, extraFrontmatter: 'release-via: publish',
    })
    git('add', '-A'); git('commit', '-qm', 'seed complete/publish card')

    const r = cli('archive', 'EEEEEEEE', '--approver', 'user')
    expect(r.status, r.stderr).toBe(0)
    const text = fs.readFileSync(fileFor('archived', 'EEEEEEEE'), 'utf-8')
    expect(text).toMatch(/^column: complete$/m)
    expect(text).toMatch(/^status: archived$/m)
  })
})

describe('trddgrep archive — case 5: a proposal, legacy created-by, main-agent identity', () => {
  it('main-agent@fixture-project archives it (corpus has a PRRD); an explicit name#uuid --approver is refused', () => {
    seedCard({ zone: 'proposals', id: 'FFFFFFFF', column: 'proposal', createdBy: 'legacy-label' })
    git('add', '-A'); git('commit', '-qm', 'seed proposal, legacy created-by')

    const r1 = cli('archive', 'FFFFFFFF', '--approver', 'main-agent@fixture-project')
    expect(r1.status, r1.stderr).toBe(0)
    expect(fs.existsSync(fileFor('archived', 'FFFFFFFF'))).toBe(true)
  })

  it('an explicit --approver name#uuid is refused — self-declared, unverifiable', () => {
    seedCard({ zone: 'proposals', id: 'GGGGGGGG', column: 'proposal', createdBy: 'legacy-label' })
    git('add', '-A'); git('commit', '-qm', 'seed second proposal')

    const r = cli('archive', 'GGGGGGGG', '--approver', `bob#${OTHER_UUID}`)
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/AID_AUTH/)
    expect(fs.existsSync(fileFor('proposals', 'GGGGGGGG'))).toBe(true)
    expect(fs.existsSync(fileFor('archived', 'GGGGGGGG'))).toBe(false)
  })
})

describe('trddgrep archive — case 6: through AID_AUTH, a proposal’s author', () => {
  it('the AID-resolved author succeeds; a non-author AID is refused', () => {
    const authorSecret = generateSessionSecret()
    const otherSecret = generateSessionSecret()
    writeRegistry([
      agentRow(AUTHOR_UUID, 'author-agent', 'member', authorSecret.secretHash),
      agentRow(OTHER_UUID, 'other-agent', 'member', otherSecret.secretHash),
    ])
    writeGovernance(null)
    writeTeams([])

    seedCard({ zone: 'proposals', id: 'HHHHHHHH', column: 'proposal', createdBy: `author-agent#${AUTHOR_UUID}` })
    git('add', '-A'); git('commit', '-qm', 'seed proposal for AID author test')

    const denied = cliWith({ AID_AUTH: otherSecret.secret }, 'archive', 'HHHHHHHH')
    expect(denied.status).toBe(2)
    expect(fs.existsSync(fileFor('proposals', 'HHHHHHHH'))).toBe(true)

    const ok = cliWith({ AID_AUTH: authorSecret.secret }, 'archive', 'HHHHHHHH')
    expect(ok.status, ok.stderr).toBe(0)
    expect(fs.existsSync(fileFor('archived', 'HHHHHHHH'))).toBe(true)
  })
})

describe('trddgrep archive — case 7: through AID_AUTH, a failed card — MANAGER vs non-MANAGER', () => {
  it('MANAGER succeeds; a non-MANAGER agent is refused', () => {
    const mgrSecret = generateSessionSecret()
    const memberSecret = generateSessionSecret()
    writeRegistry([
      agentRow(MANAGER_UUID, 'the-manager', 'manager', mgrSecret.secretHash),
      agentRow(OTHER_UUID, 'a-member', 'member', memberSecret.secretHash),
    ])
    writeGovernance(MANAGER_UUID)
    writeTeams([])

    seedCard({ zone: 'tasks', id: 'IIIIIIII', column: 'failed', assignee: `author#${AUTHOR_UUID}`, createdBy: `author#${AUTHOR_UUID}`, acceptance: DONE_CHECKLIST })
    git('add', '-A'); git('commit', '-qm', 'seed failed card for MANAGER test')

    const denied = cliWith({ AID_AUTH: memberSecret.secret }, 'archive', 'IIIIIIII')
    expect(denied.status).toBe(2)
    expect(fs.existsSync(fileFor('tasks', 'IIIIIIII'))).toBe(true)

    const ok = cliWith({ AID_AUTH: mgrSecret.secret }, 'archive', 'IIIIIIII')
    expect(ok.status, ok.stderr).toBe(0)
    expect(fs.existsSync(fileFor('archived', 'IIIIIIII'))).toBe(true)
  })
})

describe('trddgrep archive — case 8: through AID_AUTH, a failed card — team COS vs other-team COS', () => {
  it('the assignee’s team COS succeeds; another team’s COS is refused', () => {
    const cosASecret = generateSessionSecret()
    const cosBSecret = generateSessionSecret()
    writeRegistry([
      agentRow(COS_A_UUID, 'cos-a', 'chief-of-staff', cosASecret.secretHash),
      agentRow(COS_B_UUID, 'cos-b', 'chief-of-staff', cosBSecret.secretHash),
      agentRow(AUTHOR_UUID, 'team-a-member', 'member'),
    ])
    writeGovernance(null)
    writeTeams([
      { id: 'team-a', agentIds: [AUTHOR_UUID], chiefOfStaffId: COS_A_UUID, type: 'closed' },
      { id: 'team-b', agentIds: [], chiefOfStaffId: COS_B_UUID, type: 'closed' },
    ])

    seedCard({ zone: 'tasks', id: 'JJJJJJJJ', column: 'failed', assignee: `team-a-member#${AUTHOR_UUID}`, createdBy: `team-a-member#${AUTHOR_UUID}`, acceptance: DONE_CHECKLIST })
    git('add', '-A'); git('commit', '-qm', 'seed failed card for COS test')

    const deniedOtherCos = cliWith({ AID_AUTH: cosBSecret.secret }, 'archive', 'JJJJJJJJ')
    expect(deniedOtherCos.status).toBe(2)
    expect(fs.existsSync(fileFor('tasks', 'JJJJJJJJ'))).toBe(true)

    const ok = cliWith({ AID_AUTH: cosASecret.secret }, 'archive', 'JJJJJJJJ')
    expect(ok.status, ok.stderr).toBe(0)
    expect(fs.existsSync(fileFor('archived', 'JJJJJJJJ'))).toBe(true)
  })
})

describe('trddgrep archive — case 9: an already-archived card is refused', () => {
  it('refuses — archived cards are immutable, definitive history', () => {
    seedCard({ zone: 'archived', id: 'KKKKKKKK', column: 'completed' })
    git('add', '-A'); git('commit', '-qm', 'seed already-archived card')

    const r = cli('archive', 'KKKKKKKK', '--approver', 'user')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/already archived|immutable/i)
  })
})

describe('trddgrep archive — case 10: target by path', () => {
  it('a path inside the corpus works', () => {
    const file = seedCard({ zone: 'tasks', id: 'LLLLLLLL', column: 'failed', assignee: `w#${AUTHOR_UUID}`, createdBy: `w#${AUTHOR_UUID}`, acceptance: DONE_CHECKLIST })
    git('add', '-A'); git('commit', '-qm', 'seed card for path test')

    const r = cli('archive', file, '--approver', 'user')
    expect(r.status, r.stderr).toBe(0)
    expect(fs.existsSync(fileFor('archived', 'LLLLLLLL'))).toBe(true)
  })

  it('a path outside the corpus is refused', () => {
    const outside = path.join(root, 'not-the-corpus.md')
    fs.writeFileSync(outside, seedCard({ zone: 'tasks', id: 'MMMMMMMM', column: 'failed' }) && fs.readFileSync(fileFor('tasks', 'MMMMMMMM'), 'utf-8'))
    const r = cli('archive', outside, '--approver', 'user')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/not inside/)
  })

  it('a path under design/specs/ is refused (not a TRDD zone)', () => {
    const specFile = path.join(design, 'specs', 'not-a-card.md')
    fs.writeFileSync(specFile, '---\nstatus: normative\n---\n# not a TRDD\n')
    const r = cli('archive', specFile, '--approver', 'user')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/not inside/)
  })
})

describe('trddgrep archive — case 11: two files sharing an id', () => {
  it('refuses — archiving is irreversible, never picks one', () => {
    seedCard({ zone: 'tasks', id: 'NNNNNNNN', column: 'dev' })
    // A second file, same id, different slug/zone.
    const dupe = path.join(design, 'proposals', 'TRDD-20260101_000000+0000-NNNNNNNN-a-duplicate.md')
    fs.writeFileSync(dupe, '---\ntrdd-id: NNNNNNNN\ntitle: dup\ncolumn: proposal\n---\n\nbody\n')
    git('add', '-A'); git('commit', '-qm', 'seed duplicate id')

    const r = cli('archive', 'NNNNNNNN', '--approver', 'user')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/more than one file/)
  })
})

describe('trddgrep archive — case 13: AID_AUTH resolves, --approver disagrees (ai-maestro#168-2)', () => {
  it('refused with the Part A disagreement message; card stays in place', () => {
    const authorSecret = generateSessionSecret()
    writeRegistry([agentRow(AUTHOR_UUID, 'author-agent', 'member', authorSecret.secretHash)])
    writeGovernance(null)
    writeTeams([])

    seedCard({ zone: 'proposals', id: 'PPPPPPPP', column: 'proposal', createdBy: `author-agent#${AUTHOR_UUID}` })
    git('add', '-A'); git('commit', '-qm', 'seed proposal for identity-disagreement test')

    // `--approver user` names a DIFFERENT identity than the one AID_AUTH verifies
    // (`author-agent#AUTHOR_UUID`) — per lib/trdd-identity.ts's resolveCliIdentity, an
    // explicit flag may only CONFIRM a resolved AID_AUTH, never override it, so this must
    // refuse rather than silently trust the flag over the authenticated token.
    const r = cliWith({ AID_AUTH: authorSecret.secret }, 'archive', 'PPPPPPPP', '--approver', 'user')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/does not match the agent AID_AUTH verifies as/)
    expect(r.stderr).toMatch(/may not claim a different identity via --approver/)
    expect(fs.existsSync(fileFor('proposals', 'PPPPPPPP'))).toBe(true)
    expect(fs.existsSync(fileFor('archived', 'PPPPPPPP'))).toBe(false)
  })
})

describe('trddgrep archive — case 14: AID_AUTH resolves, --approver AGREES (ai-maestro#168-2)', () => {
  it('treated as verified (source "aid"): reaches decideTrddVerb and archives, same as AID alone', () => {
    const authorSecret = generateSessionSecret()
    writeRegistry([agentRow(AUTHOR_UUID, 'author-agent', 'member', authorSecret.secretHash)])
    writeGovernance(null)
    writeTeams([])

    seedCard({ zone: 'proposals', id: 'QQQQQQQQ', column: 'proposal', createdBy: `author-agent#${AUTHOR_UUID}` })
    git('add', '-A'); git('commit', '-qm', 'seed proposal for identity-agreement test')

    // `--approver author-agent#AUTHOR_UUID` names the SAME identity AID_AUTH verifies, so
    // resolveCliIdentity returns source 'aid' (not the caller-typed 'flag') — the archive
    // verb only treats 'aid' as a verified agent for decideTrddVerb, so this must reach the
    // same allow outcome case 6 gets from AID alone, not the "self-declared, unverifiable"
    // flag-sourced refusal case 5's second test hits.
    const r = cliWith({ AID_AUTH: authorSecret.secret }, 'archive', 'QQQQQQQQ', '--approver', `author-agent#${AUTHOR_UUID}`)
    expect(r.status, r.stderr).toBe(0)
    expect(fs.existsSync(fileFor('proposals', 'QQQQQQQQ'))).toBe(false)
    expect(fs.existsSync(fileFor('archived', 'QQQQQQQQ'))).toBe(true)
    expect(r.stderr).not.toMatch(/self-declared|unverifiable/)
  })
})

describe('trddgrep archive — case 14b: verified "aid" identity, decideTrddVerb DENIES (ai-maestro#168-2)', () => {
  it('refused with decideTrddVerb\'s own reason — agreement alone is not authorization', () => {
    // Complements case 14: that test proves AID+--approver agreement REACHES
    // decideTrddVerb only insofar as it lands on an ALLOW outcome — which is also what
    // a broken archive verb that let ANY 'aid' identity through undecided would produce.
    // Here `other-agent` is a VERIFIED 'aid' identity (AID_AUTH resolves it, --approver
    // agrees) but is NOT the proposal's author, so lib/authorization.ts's `case 'archive'`
    // zone==='proposals' branch denies it — proving the verified identity is actually
    // being CHECKED against the card, not merely accepted.
    const authorSecret = generateSessionSecret()
    const otherSecret = generateSessionSecret()
    writeRegistry([
      agentRow(AUTHOR_UUID, 'author-agent', 'member', authorSecret.secretHash),
      agentRow(OTHER_UUID, 'other-agent', 'member', otherSecret.secretHash),
    ])
    writeGovernance(null)
    writeTeams([])

    seedCard({ zone: 'proposals', id: 'RRRRRRRR', column: 'proposal', createdBy: `author-agent#${AUTHOR_UUID}` })
    git('add', '-A'); git('commit', '-qm', 'seed proposal for verified-but-denied test')

    const r = cliWith({ AID_AUTH: otherSecret.secret }, 'archive', 'RRRRRRRR', '--approver', `other-agent#${OTHER_UUID}`)
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/Only its author can archive a proposal/)
    expect(fs.existsSync(fileFor('proposals', 'RRRRRRRR'))).toBe(true)
    expect(fs.existsSync(fileFor('archived', 'RRRRRRRR'))).toBe(false)
  })
})

describe('trddgrep archive — case 12: unresolvable identity', () => {
  it('a harness registry present, no --approver, no AID_AUTH → refused', () => {
    writeRegistry([agentRow(AUTHOR_UUID, 'some-agent', 'member')])
    seedCard({ zone: 'tasks', id: 'OOOOOOOO', column: 'failed', acceptance: DONE_CHECKLIST })
    git('add', '-A'); git('commit', '-qm', 'seed card for unresolvable identity test')

    const r = cli('archive', 'OOOOOOOO')
    expect(r.status).toBe(2)
    expect(fs.existsSync(fileFor('tasks', 'OOOOOOOO'))).toBe(true)
  })
})
