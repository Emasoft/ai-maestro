/**
 * TRDD-I8UC56GZ — `trddgrep new` and `trddgrep move`, the two verbs `PRRD G12.1`
 * assumes exist.
 *
 * G12.1 (GOLDEN) mandates that every TRDD write go through this tool and forbids hand
 * edits. Until this card the tool could QUERY and EDIT-A-LINE and nothing else: there
 * was no way to create a card or to transition one, so the mandate named operations the
 * tool could not perform and every card was hand-written — which is how every malformed
 * card in this corpus got that way.
 *
 * These spawn the real CLI, because the exit code and the on-disk layout are contracts
 * of the BINARY: nothing that imports the library can observe either.
 *
 * CONTAINMENT: `$HOME` is redirected per spawn. The index-backed subcommands resolve
 * state under `homedir()`, and a subprocess never sees a `vi.mock` — measured on this
 * repo as +1 real file in the developer's own `~/.aimaestro/` per suite run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync, execFileSync } from 'child_process'

const REPO = process.cwd()
let root: string
let design: string
let fakeHome: string

function cli(...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join('scripts', 'trddgrep.mjs'), ...args, '--design-dir', design],
    { cwd: REPO, encoding: 'utf-8', env: { ...process.env, TRDD_DEBUG: '', HOME: fakeHome } },
  )
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf-8' })

/** The single card in a zone, or '' — the tests never hardcode a minted id. */
function only(zone: string): string {
  const dir = path.join(design, zone)
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('TRDD-')) : []
  return files.length === 1 ? path.join(dir, files[0]) : ''
}
const idOf = (file: string) => path.basename(file).replace(/^TRDD-\d{8}_\d{6}[+-]\d{4}-/, '').slice(0, 8)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'trddgrep-verbs-'))
  design = path.join(root, 'design')
  fakeHome = path.join(root, 'home')
  fs.mkdirSync(fakeHome)
  for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
    fs.mkdirSync(path.join(design, z), { recursive: true })
  }
  // A REAL git repo: `move` is a column edit AND a `git mv`, and the staging half is
  // only observable in one.
  git('init', '-q', '.')
  git('config', 'user.email', 't@example.invalid')
  git('config', 'user.name', 'test')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('trddgrep new', () => {
  it('mints a card carrying the fields whose absence IS the corpus-wide META-MISSING', () => {
    const r = cli('new', '--title', 'a minted card', '--task-type', 'infra', '--author', 'probe')
    expect(r.status).toBe(0)
    const file = only('tasks')
    expect(file).not.toBe('')
    const text = fs.readFileSync(file, 'utf-8')
    // The three the D4 watchdog reads and no other field can supply.
    expect(text).toMatch(/^assignee: probe$/m)
    expect(text).toMatch(/^created-by: probe$/m)
    expect(text).toMatch(/^min-approval-requirement: none$/m)
    // ISO 8601 with a LOCAL offset — never bare, never `Z` (TRDD-ZRRDCQ52).
    expect(text).toMatch(/^created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/m)
    expect(text).toMatch(/^trdd-id: [A-Z0-9]{8}$/m)
  })

  it('refuses an unrecognised argument instead of silently dropping it', () => {
    // A mutating verb that ignores a token performs a DIFFERENT write than the one asked
    // for and reports success — `--titel` would otherwise mint an "untitled" card at 0.
    const r = cli('new', '--titel', 'typo', '--task-type', 'infra', '--author', 'probe')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/unrecognised argument/)
    expect(only('tasks')).toBe('')
  })

  it('routes an author BELOW the floor to proposals/, and the flag cannot override it', () => {
    const r = cli(
      'new', '--title', 'needs a manager', '--task-type', 'infra', '--author', 'member-1',
      '--min-approval', 'manager', '--column', 'dev',
    )
    expect(r.status).toBe(0)
    expect(only('tasks')).toBe('')
    expect(fs.readFileSync(only('proposals'), 'utf-8')).toMatch(/^column: proposal$/m)
  })
})

describe('trddgrep move', () => {
  const seed = (title = 'a card to move') => {
    expect(cli('new', '--title', title, '--task-type', 'infra', '--author', 'probe').status).toBe(0)
    const file = only('tasks')
    fs.appendFileSync(file, '\n## Acceptance\n\n- [x] done\n')
    git('add', '-A')
    git('commit', '-qm', 'seed')
    return idOf(file)
  }

  it('archives a `complete` card with release-via none — the column AND the git mv, as one op', () => {
    // THE GAP THIS VERB WAS BUILT AROUND. `expectedZone` says `complete` with
    // `release-via: none` belongs in archived/, but the only in-tasks verb (advanceColumn)
    // never moves folders — so the obvious dispatch would leave a terminal column in the
    // OPEN zone, which is the ZONE-MISMATCH the doctor reports as an ERROR and the exact
    // defect this session shipped once by hand.
    const id = seed()
    const r = cli('move', id, 'complete')
    expect(r.status).toBe(0)
    expect(only('tasks')).toBe('')
    expect(fs.readFileSync(only('archived'), 'utf-8')).toMatch(/^column: complete$/m)
    // The rename is STAGED: a `git mv` stages the bytes already in the index, so an
    // unstaged content edit at the new path is how a half-move reaches a commit.
    expect(git('diff', '--cached', '--name-only')).toMatch(/archived/)
  })

  it('refuses to archive as complete when the acceptance checklist is not finished', () => {
    const id = seed('an unfinished card')
    const file = only('tasks')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('- [x] done', '- [ ] not done'))
    const r = cli('move', id, 'complete')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/still unchecked|false completion/)
    expect(only('tasks')).not.toBe('')
    expect(only('archived')).toBe('')
  })

  it('advances within tasks/ without moving the file', () => {
    const id = seed()
    const before = only('tasks')
    expect(cli('move', id, 'testing').status).toBe(0)
    expect(only('tasks')).toBe(before)
    expect(fs.readFileSync(before, 'utf-8')).toMatch(/^column: testing$/m)
  })

  it('refuses a column outside the ratified vocabulary', () => {
    const id = seed()
    const r = cli('move', id, 'banana')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/not a ratified column/)
  })

  it('promotes a proposal to planned, and refuses to skip the approval by advancing past it', () => {
    expect(cli('new', '--title', 'a proposal', '--task-type', 'infra', '--author', 'm',
      '--min-approval', 'manager').status).toBe(0)
    const id = idOf(only('proposals'))
    git('add', '-A'); git('commit', '-qm', 'seed proposal')

    // proposals/ → tasks/ IS the approval event; asking for any other target column
    // would bury it inside an advance.
    const skip = cli('move', id, 'dev')
    expect(skip.status).toBe(2)
    expect(skip.stderr).toMatch(/approve it first/)

    expect(cli('move', id, 'planned').status).toBe(0)
    expect(only('proposals')).toBe('')
    const text = fs.readFileSync(only('tasks'), 'utf-8')
    expect(text).toMatch(/^column: planned$/m)
    expect(text).toMatch(/APPROVED by/)
  })
})

/**
 * TRDD-I8UC56GZ — the on-touch migration of the retired `approval-tier: N`.
 *
 * The approval rules say migrate "on next touch, never in a mass rewrite", so the repair
 * cannot live in `trddgrep fix` (a corpus sweep) and lives on the transition verbs
 * instead. 82 cards carried the legacy field when this landed; they migrate as work
 * reaches them.
 *
 * NEUTER: delete the `migrateLegacyApprovalTier(content).content` line from `editAt` and
 * the first test below reds while the other two stay green (they exercise the REFUSALS,
 * which are the helper returning the content unchanged — the same thing a deleted call
 * does, so only the positive case can pin the wiring).
 */
describe('trddgrep move — the on-touch approval-tier migration', () => {
  const seedWithTier = (frontmatterExtra: string[]) => {
    expect(cli('new', '--title', 'a legacy card', '--task-type', 'infra', '--author', 'probe').status).toBe(0)
    const file = only('tasks')
    const text = fs.readFileSync(file, 'utf-8')
      .replace(/^min-approval-requirement: none$/m, frontmatterExtra.join('\n'))
    fs.writeFileSync(file, text + '\n## Acceptance\n\n- [x] done\n')
    git('add', '-A'); git('commit', '-qm', 'seed legacy')
    return idOf(file)
  }

  it('rewrites a lone `approval-tier: 2` to `min-approval-requirement: manager` on a transition', () => {
    const id = seedWithTier(['approval-tier: 2'])
    expect(cli('move', id, 'testing').status).toBe(0)
    const text = fs.readFileSync(only('tasks'), 'utf-8')
    expect(text).toMatch(/^min-approval-requirement: manager$/m)
    expect(text).not.toMatch(/^approval-tier:/m)
  })

  /**
   * The SECOND call site. `advanceColumn` writes its own frontmatter and does not go
   * through `editAt`, so the migration is wired twice — and the test above exercises only
   * the advanceColumn one. Without this test, deleting the `editAt` call site reds
   * nothing, which is how a migration comes to fire on one of the four transition verbs
   * and not the other three.
   */
  it('migrates on the ARCHIVE path too (editAt), not only on an in-place advance', () => {
    const id = seedWithTier(['approval-tier: 1'])
    expect(cli('move', id, 'complete').status).toBe(0)
    const text = fs.readFileSync(only('archived'), 'utf-8')
    expect(text).toMatch(/^min-approval-requirement: chief-of-staff$/m)
    expect(text).not.toMatch(/^approval-tier:/m)
  })

  it('REFUSES the ambiguous case — both fields present and disagreeing are left alone', () => {
    // APPROVAL-FIELD-CONFLICT is an ERROR the doctor marks non-autofixable precisely
    // because picking a side silently hands two readers different required approvers.
    const id = seedWithTier(['approval-tier: 2', 'min-approval-requirement: none'])
    expect(cli('move', id, 'testing').status).toBe(0)
    const text = fs.readFileSync(only('tasks'), 'utf-8')
    expect(text).toMatch(/^approval-tier: 2$/m)
    expect(text).toMatch(/^min-approval-requirement: none$/m)
  })

  it('leaves an UNDECODABLE tier number for a human', () => {
    const id = seedWithTier(['approval-tier: 9'])
    expect(cli('move', id, 'testing').status).toBe(0)
    expect(fs.readFileSync(only('tasks'), 'utf-8')).toMatch(/^approval-tier: 9$/m)
  })
})
