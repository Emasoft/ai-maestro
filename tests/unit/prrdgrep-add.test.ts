/**
 * TRDD-I8UC56GZ — `prrdgrep add`, and the fixture shape that its first build lacked.
 *
 * The first implementation anchored "after the last rule". It PASSED on a single-line,
 * single-section fixture and, run against a copy of the live PRRD, inserted a SILVER rule
 * at line 147 — inside another rule's multi-line body, in the GOLDEN section. The fixture
 * did not merely fail to catch that: it FAILED FOR AN UNRELATED REASON (an empty `expect`
 * on the file's trailing newline), which read as the approach being rejected. One
 * non-empty trailing line and it would have shipped.
 *
 * So this fixture is built from the SHAPES THAT WERE MEASURED on the real document, and
 * the last test is a differential asserting the real document still has them — because a
 * fixture that has quietly stopped resembling its subject is the same failure again.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

const REPO = process.cwd()
let root: string
let design: string
let prrd: string
let fakeHome: string

/** The measured shape: a MULTI-LINE rule carrying an INTERNAL BLANK, and TWO tier sections. */
const REAL_SHAPED = [
  '---', 'project-id: probe', '---', '', '# Rules', '',
  '## 🥇 GOLDEN rules', '',
  '- **G1.1** — a short golden rule.', '',
  '- **G2.1** — a rule whose text runs on for several lines,',
  '  continuing here at an indent,', '',
  '  and resuming after a blank line INSIDE its own body.', '',
  '---', '',
  '## 🥈 SILVER rules', '',
  '(none yet — the MANAGER may add one.)', '',
  '---', '',
].join('\n')

function cli(...args: string[]) {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join('scripts', 'prrdgrep.mjs'), ...args, '--design-dir', design],
    { cwd: REPO, encoding: 'utf-8', env: { ...process.env, TRDD_DEBUG: '', HOME: fakeHome } },
  )
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
const lines = () => fs.readFileSync(prrd, 'utf-8').split('\n')
const lineOf = (re: RegExp) => lines().findIndex((l) => re.test(l))

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'prrdgrep-add-'))
  design = path.join(root, 'design')
  fakeHome = path.join(root, 'home')
  fs.mkdirSync(path.join(design, 'requirements'), { recursive: true })
  fs.mkdirSync(fakeHome)
  prrd = path.join(design, 'requirements', 'PRRD.md')
  fs.writeFileSync(prrd, REAL_SHAPED)
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('prrdgrep add', () => {
  it('puts a SILVER rule in the SILVER section, not after the last rule', () => {
    // THE CORRUPTION THE FIRST BUILD SHIPPED. "After the last rule" is a golden-section
    // position; the tiers are separate sections and the tier decides which one.
    expect(cli('add', 'silver', 'a new silver rule').status).toBe(0)
    const added = lineOf(/^- \*\*S3\.1\*\*/)
    expect(added).toBeGreaterThan(lineOf(/^## .*SILVER/))
    expect(added).toBeGreaterThan(lineOf(/^## .*GOLDEN/))
  })

  it('puts a GOLDEN rule at the END of the golden section, never inside a multi-line rule', () => {
    expect(cli('add', 'golden', 'a new golden rule', '--user').status).toBe(0)
    const added = lineOf(/^- \*\*G3\.1\*\*/)
    // AFTER the last golden rule's final continuation line — the position the first build
    // got wrong by anchoring one line below the DECLARATION.
    expect(added).toBeGreaterThan(lineOf(/resuming after a blank line INSIDE/))
    expect(added).toBeLessThan(lineOf(/^## .*SILVER/))
  })

  it('mints the next number across BOTH tiers and never reuses one', () => {
    expect(cli('add', 'silver', 'first').status).toBe(0)
    expect(cli('add', 'silver', 'second').status).toBe(0)
    const text = fs.readFileSync(prrd, 'utf-8')
    expect(text).toMatch(/^- \*\*S3\.1\*\* — first$/m)
    expect(text).toMatch(/^- \*\*S4\.1\*\* — second$/m)
  })

  it('refuses GOLDEN without --user — an agent may not mint a golden rule', () => {
    const r = cli('add', 'golden', 'a golden rule')
    expect(r.stderr).toMatch(/golden rules are USER-only/)
    expect(r.status).toBe(2)
    expect(fs.readFileSync(prrd, 'utf-8')).not.toContain('a golden rule')
  })

  it('refuses a newline in the rule text — the PRRD is a flat bullet list', () => {
    const r = cli('add', 'silver', 'line one\nline two')
    expect(r.stderr).toMatch(/must be ONE line/)
    expect(r.status).toBe(2)
  })

  it('leaves the document LINTABLE — the gate judges what this verb writes', () => {
    expect(cli('add', 'silver', 'a lintable rule').status).toBe(0)
    const lint = cli('lint')
    expect(lint.status).toBe(0)
  })

  it('specgrep has no `add`, and says why rather than minting a wrong id', () => {
    // A REAL spec corpus is required, and finding that out is the message-assertion
    // discipline paying for itself: without one, specgrep exits 2 on "no spec corpus"
    // BEFORE reaching the verb, so a test asserting only the status would have passed
    // while proving nothing about `add`. Same exit code, entirely different branch.
    fs.mkdirSync(path.join(design, 'specs'), { recursive: true })
    fs.writeFileSync(path.join(design, 'specs', 'a.md'), '`SP-AAA-01` **alpha** — a clause.\n')
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', path.join('scripts', 'specgrep.mjs'), 'add', 'golden', 'x', '--design-dir', design],
      { cwd: REPO, encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/encodes a family the author chooses/)
  })

  /**
   * THE DIFFERENTIAL. Every shape above was copied from the live PRRD; if that document
   * loses one, this fixture silently stops representing it and these tests go on passing
   * about a document that no longer exists. That is the failure this whole verb's history
   * is made of, so it gets an assertion rather than a comment.
   */
  it('the fixture still resembles the real PRRD (multi-line rules with internal blanks, two tier sections)', () => {
    const real = fs.readFileSync(path.join(REPO, 'design', 'requirements', 'PRRD.md'), 'utf-8').split('\n')
    const decls = real.map((l, i) => (/^- \*\*[GS]\d+\.\d+\*\*/.test(l) ? i : -1)).filter((i) => i >= 0)
    expect(decls.length).toBeGreaterThan(1)
    // At least one rule is multi-line AND carries a blank line inside its own body.
    const multiLineWithBlank = decls.some((d) => {
      const next = decls.find((x) => x > d) ?? real.length
      const block = real.slice(d + 1, next)
      return block.length > 2 && block.some((l) => l.trim() === '') && block.some((l) => /^\s+\S/.test(l))
    })
    expect(multiLineWithBlank).toBe(true)
    expect(real.some((l) => /^## .*GOLDEN/i.test(l))).toBe(true)
    expect(real.some((l) => /^## .*SILVER/i.test(l))).toBe(true)
  })
})
