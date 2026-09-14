import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import { writeRefusal, WRITE_VERBS, type PillarWriteTool } from '@/lib/pillar/write-gate'

/**
 * TRDD ai-maestro#161 phase a — the corpus-scoped write gate for trddgrep/prrdgrep/specgrep.
 *
 * Two layers: the pure `writeRefusal` predicate (unit, in-process) and the three CLIs that
 * call it (subprocess — an exit code and a byte-identical file are contracts of the BINARY,
 * not of the library `lib/pillar/cli.ts` exports). The subprocess half MUST run W's own
 * `cli.ts`, never a copy elsewhere on the machine, which is why the loader and tsconfig are
 * both pinned to this checkout's own absolute paths rather than resolved from `cwd`.
 */

const CHECKOUT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOADER_URL = pathToFileURL(path.join(CHECKOUT_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href
const TSCONFIG_PATH = path.join(CHECKOUT_ROOT, 'tsconfig.json')

function sha256(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

describe('writeRefusal — the pure predicate', () => {
  const root = '/repo/checkout'

  it('each write verb is refused outside the checkout', () => {
    for (const [tool, verbs] of Object.entries(WRITE_VERBS) as [PillarWriteTool, readonly string[]][]) {
      for (const verb of verbs) {
        const msg = writeRefusal(tool, verb, { cwd: '/somewhere/else', root, env: { ...process.env, AIM_PILLAR_ALLOW_WRITE: undefined } })
        expect(msg, `${tool} ${verb}`).not.toBeNull()
        expect(msg).toContain(tool)
        expect(msg).toContain(verb)
      }
    }
  })

  it('is allowed when cwd equals root exactly', () => {
    expect(writeRefusal('trddgrep', 'edit', { cwd: root, root, env: { ...process.env, AIM_PILLAR_ALLOW_WRITE: undefined } })).toBeNull()
  })

  it('is allowed from a subdirectory of root', () => {
    expect(writeRefusal('trddgrep', 'edit', { cwd: path.join(root, 'scripts'), root, env: { ...process.env, AIM_PILLAR_ALLOW_WRITE: undefined } })).toBeNull()
  })

  it('is allowed with AIM_PILLAR_ALLOW_WRITE=1, even from outside', () => {
    expect(
      writeRefusal('trddgrep', 'edit', { cwd: '/somewhere/else', root, env: { ...process.env, AIM_PILLAR_ALLOW_WRITE: '1' } }),
    ).toBeNull()
  })

  it('a non-write verb is never refused, whatever the cwd', () => {
    expect(writeRefusal('trddgrep', 'board', { cwd: '/somewhere/else', root, env: { ...process.env, AIM_PILLAR_ALLOW_WRITE: undefined } })).toBeNull()
    expect(writeRefusal('prrdgrep', 'list', { cwd: '/somewhere/else', root, env: { ...process.env, AIM_PILLAR_ALLOW_WRITE: undefined } })).toBeNull()
  })

  it('a sibling directory sharing the root as a PREFIX (not a path segment) is refused', () => {
    // Regression for the `cwd.startsWith(root)` bug without the trailing path.sep: without
    // it, `/repo/checkout-other` would satisfy the prefix check and be treated as inside.
    const msg = writeRefusal('trddgrep', 'edit', { cwd: `${root}-other`, root, env: { ...process.env, AIM_PILLAR_ALLOW_WRITE: undefined } })
    expect(msg).not.toBeNull()
  })
})

describe('the CLIs enforce the gate as a subprocess (spawns THIS checkout, not any other)', () => {
  vi.setConfig({ testTimeout: 30_000 })

  let fakeHome: string
  let outsideCwd: string
  let fixtureRoot: string

  const PRRD_FIXTURE = [
    '---',
    'project-id: fixture',
    '---',
    '',
    '# Project rules',
    '',
    '## GOLDEN rules',
    '',
    '- **G1.1** — golden rule one.',
    '',
    '---',
    '',
    '## SILVER rules',
    '',
    '- **S2.1** — the silver rule under test.',
    '',
    '---',
    '',
  ].join('\n')

  const SPEC_FIXTURE = [
    '---',
    'spec-version: 1.0.0',
    '---',
    '',
    '`3P-AAA-01` **first** — the first clause.',
    '',
  ].join('\n')

  const trddDesignDir = () => path.join(fixtureRoot, 'trdd', 'design')
  const trddCardPath = () =>
    path.join(trddDesignDir(), 'tasks', 'TRDD-20260101_000000+0100-ZZWRTGT1-write-gate-probe.md')
  const prrdDesignDir = () => path.join(fixtureRoot, 'prrd', 'design')
  const prrdFile = () => path.join(prrdDesignDir(), 'requirements', 'PRRD.md')
  const specDesignDir = () => path.join(fixtureRoot, 'spec', 'design')
  const specFile = () => path.join(specDesignDir(), 'specs', 'x-spec.md')

  function seedTrddCard() {
    for (const zone of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(trddDesignDir(), zone), { recursive: true })
    }
    fs.writeFileSync(
      trddCardPath(),
      [
        '---',
        'trdd-id: ZZWRTGT1',
        'title: write gate probe',
        'column: dev',
        'created: 2026-01-01T00:00:00+0100',
        'updated: 2026-01-01T00:00:00+0100',
        'blocked-by: []',
        '---',
        '',
        '# write gate probe',
        '',
        'body line',
        '',
      ].join('\n'),
      'utf-8',
    )
  }

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wgate-home-'))
    outsideCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wgate-outside-'))
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wgate-fixture-'))
    fs.mkdirSync(path.join(prrdDesignDir(), 'requirements'), { recursive: true })
    fs.mkdirSync(path.join(specDesignDir(), 'specs'), { recursive: true })
    fs.writeFileSync(prrdFile(), PRRD_FIXTURE, 'utf-8')
    fs.writeFileSync(specFile(), SPEC_FIXTURE, 'utf-8')
    seedTrddCard()
  })
  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true })
    fs.rmSync(outsideCwd, { recursive: true, force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  /**
   * `cwd` is the caller's PWD (kept outside the checkout for the refusal half of this
   * suite) — never confused with `--design-dir`, which points at the throwaway corpus
   * fixture and may be anywhere.
   *
   * The loader is an ABSOLUTE `file://` URL into THIS checkout's own `node_modules`, and
   * `TSX_TSCONFIG_PATH` pins the `@/…` alias to THIS checkout's `tsconfig.json` — a bare
   * `--import tsx` resolves relative to `cwd`, so from `outsideCwd` it would fail before
   * the gate ever ran, and without the pinned tsconfig `@/lib/...` could resolve to a
   * DIFFERENT (ungated) copy of `cli.ts` on the machine and pass vacuously.
   */
  function runCli(tool: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
    const { AIM_PILLAR_ALLOW_WRITE, ...cleanEnv } = process.env
    const r = spawnSync(
      process.execPath,
      ['--import', LOADER_URL, path.join(CHECKOUT_ROOT, 'scripts', `${tool}.mjs`), ...args],
      {
        cwd,
        encoding: 'utf-8',
        env: { ...cleanEnv, HOME: fakeHome, TSX_TSCONFIG_PATH: TSCONFIG_PATH, NO_COLOR: '1' },
      },
    )
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  describe('refused from OUTSIDE the checkout — exit 2, refusal on stderr, target untouched', () => {
    it('trddgrep edit', () => {
      const before = sha256(trddCardPath())
      const r = runCli(
        'trddgrep',
        ['edit', 'ZZWRTGT1', '--at-line', '12', '--expect', 'body line', '--replace', 'CHANGED', '--design-dir', trddDesignDir()],
        outsideCwd,
      )
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("'edit' rewrites the corpus and is disabled outside the ai-maestro checkout")
      expect(sha256(trddCardPath())).toBe(before)
    })

    it('trddgrep fix <id>', () => {
      const before = sha256(trddCardPath())
      const r = runCli('trddgrep', ['fix', 'ZZWRTGT1', '--design-dir', trddDesignDir()], outsideCwd)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("'fix' rewrites the corpus and is disabled outside the ai-maestro checkout")
      expect(sha256(trddCardPath())).toBe(before)
    })

    it('prrdgrep add', () => {
      const before = sha256(prrdFile())
      const r = runCli('prrdgrep', ['add', 'silver', 'a new rule', '--design-dir', prrdDesignDir()], outsideCwd)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("'add' rewrites the corpus and is disabled outside the ai-maestro checkout")
      expect(sha256(prrdFile())).toBe(before)
    })

    it('specgrep edit', () => {
      const before = sha256(specFile())
      const r = runCli(
        'specgrep',
        [
          'edit',
          '3P-AAA-01',
          '--expect',
          '`3P-AAA-01` **first** — the first clause.',
          '--replace',
          '`3P-AAA-01` **first** — CHANGED.',
          '--design-dir',
          specDesignDir(),
        ],
        outsideCwd,
      )
      expect(r.status).toBe(2)
      expect(r.stderr).toContain("'edit' rewrites the corpus and is disabled outside the ai-maestro checkout")
      expect(sha256(specFile())).toBe(before)
    })
  })

  describe('allowed from cwd = the checkout root, against a /tmp corpus — the write LANDS', () => {
    it('trddgrep edit', () => {
      const r = runCli(
        'trddgrep',
        ['edit', 'ZZWRTGT1', '--at-line', '12', '--expect', 'body line', '--replace', 'CHANGED', '--design-dir', trddDesignDir()],
        CHECKOUT_ROOT,
      )
      expect(r.status, r.stderr).toBe(0)
      expect(fs.readFileSync(trddCardPath(), 'utf-8')).toContain('CHANGED')
    })

    it('prrdgrep add silver "<text>"', () => {
      const r = runCli(
        'prrdgrep',
        ['add', 'silver', 'a new rule', '--design-dir', prrdDesignDir()],
        CHECKOUT_ROOT,
      )
      expect(r.status, r.stderr).toBe(0)
      expect(fs.readFileSync(prrdFile(), 'utf-8')).toContain('a new rule')
    })

    it('specgrep edit', () => {
      const r = runCli(
        'specgrep',
        [
          'edit',
          '3P-AAA-01',
          '--expect',
          '`3P-AAA-01` **first** — the first clause.',
          '--replace',
          '`3P-AAA-01` **first** — CHANGED.',
          '--design-dir',
          specDesignDir(),
        ],
        CHECKOUT_ROOT,
      )
      expect(r.status, r.stderr).toBe(0)
      expect(fs.readFileSync(specFile(), 'utf-8')).toContain('CHANGED')
    })
  })

  it('a SEARCH pattern containing the word "edit" is not misread as the verb, even from outside', () => {
    const r = runCli('trddgrep', ['--design-dir', trddDesignDir(), 'edit the rotator'], outsideCwd)
    expect(r.stderr).not.toContain('rewrites the corpus and is disabled')
  })
})
