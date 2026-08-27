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

  /**
   * A REAL shape in this corpus, not a hypothetical: TRDD-Z3T7DVL4 carries
   * `approval-tier: 2` at line 427, inside a YAML example in its BODY, while its
   * frontmatter declares `min-approval-requirement: user` and no tier line. The doctor
   * correctly never warned about it — which is why a WARN-row tally (82) undercounts the
   * files containing the string (83), and why this case was invisible until the two
   * numbers were compared.
   *
   * The migration must not touch it. It early-returns because the HEAD slice has no tier
   * line, and that early return is the only thing standing between the body-wide
   * `.replace()` and a silent edit to someone's documentation.
   */
  it('never touches an `approval-tier:` line in the BODY when the frontmatter has none', () => {
    expect(cli('new', '--title', 'a card documenting the legacy field', '--task-type', 'docs',
      '--author', 'probe').status).toBe(0)
    const file = only('tasks')
    // `0` decodes to `none`, which is what the minted card's frontmatter already declares.
    // That is deliberate and load-bearing: with a DISAGREEING value (say `2` = manager) the
    // conflict guard refuses the whole migration and the body line survives for a reason
    // that has nothing to do with the head-slice guard — measured, the head-slice neuter
    // reddened nothing under that fixture. Only an AGREEING value reaches the replace, so
    // only this fixture can tell the two guards apart.
    fs.appendFileSync(file, '\n## Acceptance\n\n- [x] done\n\n```yaml\napproval-tier: 0\n```\n')
    git('add', '-A'); git('commit', '-qm', 'seed body-only tier')
    const id = idOf(file)
    expect(cli('move', id, 'testing').status).toBe(0)
    const text = fs.readFileSync(only('tasks'), 'utf-8')
    expect(text).toMatch(/^approval-tier: 0$/m)
    // And the frontmatter's own requirement is untouched — no field invented from a body line.
    expect(text).toMatch(/^min-approval-requirement: none$/m)
  })

  /**
   * THE SECOND, INDEPENDENT PROTECTION — and the one the test above cannot see.
   *
   * A body-only tier line is safe because of the HEAD-SLICE guard (detection). A card
   * carrying the field in BOTH places is safe for a different reason: the replace regex
   * has no `/g`, so it takes the FIRST match, which is the frontmatter's. Add `/g` — a
   * plausible "make it thorough" edit — and the body line vanishes silently with the
   * head-slice guard fully intact and every other test green. Named by an adversarial
   * review that first filed it as not worth a run, then corrected itself.
   */
  it('migrates the FRONTMATTER line and leaves an identical BODY line standing', () => {
    const id = seedWithTier(['approval-tier: 2'])
    const file = only('tasks')
    fs.appendFileSync(file, '\n```yaml\napproval-tier: 2\n```\n')
    git('add', '-A'); git('commit', '-qm', 'seed both')
    expect(cli('move', id, 'testing').status).toBe(0)
    const text = fs.readFileSync(only('tasks'), 'utf-8')
    expect(text).toMatch(/^min-approval-requirement: manager$/m)
    // Exactly ONE line remains, and it is the one inside the fence.
    expect(text.split('\n').filter((l) => l.startsWith('approval-tier:'))).toEqual(['approval-tier: 2'])
    expect(text).toMatch(/```yaml\napproval-tier: 2\n```/)
  })

  it('leaves an UNDECODABLE tier number for a human', () => {
    const id = seedWithTier(['approval-tier: 9'])
    expect(cli('move', id, 'testing').status).toBe(0)
    expect(fs.readFileSync(only('tasks'), 'utf-8')).toMatch(/^approval-tier: 9$/m)
  })
})

/**
 * TRDD-I8UC56GZ — `trddgrep set`, the verb that removes the LINE NUMBER from a field edit.
 */
describe('trddgrep set', () => {
  const seed = () => {
    expect(cli('new', '--title', 'a card to set', '--task-type', 'infra', '--author', 'probe').status).toBe(0)
    const file = only('tasks')
    git('add', '-A'); git('commit', '-qm', 'seed')
    return idOf(file)
  }

  it('INSERTS a field that is absent — the shape a regex patch fails at silently', () => {
    // The failure this verb exists to prevent: a patch anchored on a line the card does
    // not have matches nothing, writes nothing, and reports nothing.
    const id = seed()
    expect(fs.readFileSync(only('tasks'), 'utf-8')).not.toMatch(/^priority:/m)
    expect(cli('set', id, 'priority', '0').status).toBe(0)
    expect(fs.readFileSync(only('tasks'), 'utf-8')).toMatch(/^priority: 0$/m)
  })

  it('refuses `column` and points at the verb that owns the other half of the transition', () => {
    const id = seed()
    const r = cli('set', id, 'column', 'completed')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/trddgrep move/)
    expect(fs.readFileSync(only('tasks'), 'utf-8')).toMatch(/^column: backburner$/m)
  })

  it('refuses a value carrying a newline — the frontmatter-injection shape', () => {
    // `parent: "X\nmandate: true"` would forge the approval record the zone routing gates.
    // NOT `mandate: true` as the payload: a self-mandate card legitimately carries that
    // line already, so asserting its absence would have failed against the card's own
    // correct content — measured. The payload must be a line the card cannot already have.
    const id = seed()
    const r = cli('set', id, 'parent-trdd', 'AAAA1111\nsuperseded-by: [BBBB2222]')
    // THE NEUTER THAT EARNS THIS ASSERTION, because the obvious one does not: disabling the
    // guard makes the CLI exit 0 with empty stderr, so the message check, the status check
    // and the negative match all fail or pass together — one red, three assertions, no
    // attribution. The isolating mutation leaves the guard FIRING and changes only its
    // message text; then /must be one line/ reds while status stays 2, which is the only
    // way to show the message assertion does work no status check does. Measured: 1 red.
    //
    // MESSAGE FIRST, deliberately. The assertion a test is NAMED for must come first or a
    // weaker one ahead of it absorbs every neuter and the specific claim is never reached.
    // WHICH BRANCH SPOKE. Exit 2 alone cannot tell the injection guard from the
    // stray-token guard: if anything split that newline in argv, `superseded-by:` becomes
    // argv[4], the strict parser refuses it, and the status, the absent fields and this
    // test are all identical. This is the one refusal test that had dropped the message
    // discriminator its siblings carry, on the claim where the wrong branch is most
    // plausible. (Measured: the injection guard is the one that speaks.)
    expect(r.stderr).toMatch(/must be one line/)
    expect(r.stderr).not.toMatch(/unrecognised argument/)
    expect(r.status).toBe(2)
    const text = fs.readFileSync(only('tasks'), 'utf-8')
    expect(text).not.toMatch(/^superseded-by:/m)
    expect(text).not.toMatch(/^parent-trdd:/m)
  })

  it('bumps `updated:` by default and leaves it alone under --no-bump', () => {
    const id = seed()
    // Compared as a STRING, never as a regex built from it: an ISO stamp carries a `+`
    // for its offset, and hand-escaping that into a pattern is a step this assertion does
    // not need — the first version of this test over-escaped it and reddened against
    // correct code.
    const updatedOf = () => fs.readFileSync(only('tasks'), 'utf-8').match(/^updated: (.+)$/m)![1]
    const before = updatedOf()
    expect(cli('set', id, 'severity', 'major', '--no-bump').status).toBe(0)
    expect(updatedOf()).toBe(before)
    // The board sorts on `updated:`, so a MECHANICAL repair that bumped it would silently
    // reorder the whole board — the distinction the doctor's fixer already reports.
    expect(fs.readFileSync(only('tasks'), 'utf-8')).toMatch(/^severity: major$/m)
  })

  /**
   * SCOPE, because "the same gate as edit" is true and easy to over-read. It is the same
   * PREDICATE, and that predicate polices seven things — column, a pipeline value in
   * status:, trdd-id shape, a colon in title, the three ISO date fields, and
   * min-approval-requirement. `set` writes ANY field, so a bad value in an unpoliced one
   * lands; the doctor reports those, this gate does not refuse them.
   *
   * THIS TEST IS A BOUNDARY MARKER, NOT A REQUIREMENT — read this before "fixing" it.
   * Nothing wants `severity: not-a-severity` to be writable; the test records where the
   * gate's edge SITS today, so the edge is a fact in the suite instead of a sentence in a
   * commit message nobody will find. It follows that IF SOMEONE ADDS severity validation
   * THIS TEST GOES RED, and that red is the improvement landing, not a regression: move
   * the boundary, then move this marker (or delete it, and say so). A boundary marker that
   * is silently "repaired" back to green by weakening the new validation is the failure
   * mode it exists to make visible.
   */
  it('BOUNDARY MARKER (not a requirement) — `severity` is outside the gate today and lands unvalidated', () => {
    const id = seed()
    expect(cli('set', id, 'severity', 'not-a-severity').status).toBe(0)
    expect(fs.readFileSync(only('tasks'), 'utf-8')).toMatch(/^severity: not-a-severity$/m)
  })

  it('is judged by the SAME candidate gate as edit — an illegal value is refused', () => {
    const id = seed()
    const r = cli('set', id, 'min-approval-requirement', 'emperor')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/not a governance title/)
    expect(fs.readFileSync(only('tasks'), 'utf-8')).not.toMatch(/emperor/)
  })
})
