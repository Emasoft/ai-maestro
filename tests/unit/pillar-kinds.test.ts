import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import {
  corpusRootFor,
  isUserCorpusPath,
  scopeOfDesignDir,
  TRDD_KIND,
  SPEC_KIND,
  PRRD_KIND,
} from '@/lib/pillar/kinds'

describe('corpusRootFor scope', () => {
  it('project scope (default) is byte-identical to the pre-scope behaviour', () => {
    const designDir = '/repo/design'
    expect(corpusRootFor(designDir, TRDD_KIND)).toBe(path.join(designDir, ''))
    expect(corpusRootFor(designDir, SPEC_KIND)).toBe(path.join(designDir, 'specs'))
    expect(corpusRootFor(designDir, PRRD_KIND, 'project')).toBe(path.join(designDir, 'requirements'))
  })

  it('local scope resolves to <project-root>/.claude/local/design/<subdir>, derived from designDir', () => {
    const designDir = '/repo/design'
    expect(corpusRootFor(designDir, TRDD_KIND, 'local')).toBe(
      path.join('/repo', '.claude', 'local', 'design', ''),
    )
    expect(corpusRootFor(designDir, SPEC_KIND, 'local')).toBe(
      path.join('/repo', '.claude', 'local', 'design', 'specs'),
    )
  })

  it('user scope resolves an already-explicit designDir identically to project scope', () => {
    const explicitUserDesignDir = path.join(
      '/home/x', '.claude', 'cross-projects-coordination', 'my-group', 'design',
    )
    expect(corpusRootFor(explicitUserDesignDir, TRDD_KIND, 'user')).toBe(explicitUserDesignDir)
    expect(corpusRootFor(explicitUserDesignDir, SPEC_KIND, 'user')).toBe(
      path.join(explicitUserDesignDir, 'specs'),
    )
  })
})

describe('isUserCorpusPath', () => {
  // Hand-written literals on BOTH sides, never composed from corpusRootFor. A test that
  // feeds one function the output of its partner asserts only that the two agree — it
  // passes identically if both use the same WRONG segment, which is agreement, not
  // correctness.
  it('recognises a cross-project corpus path', () => {
    expect(isUserCorpusPath('/home/x/.claude/cross-projects-coordination/g/design')).toBe(true)
    expect(isUserCorpusPath('/home/x/.claude/cross-projects-coordination/g/design/specs')).toBe(true)
  })

  it('rejects project and local paths', () => {
    expect(isUserCorpusPath('/repo/design')).toBe(false)
    expect(isUserCorpusPath('/repo/.claude/local/design')).toBe(false)
    expect(isUserCorpusPath('/home/x/.claude/projects/slug/design')).toBe(false)
  })

  it('rejects the groups CONTAINER — a container is not a corpus', () => {
    // <root>/<segment> alone has no <group> and no design/. Minting there would file
    // cards one level above every group. Inert while nothing emitted user scope;
    // a persisted false claim once a mint can write it.
    expect(isUserCorpusPath('/home/x/.claude/cross-projects-coordination')).toBe(false)
    expect(isUserCorpusPath('/home/x/.claude/cross-projects-coordination/g')).toBe(false)
    expect(isUserCorpusPath('/home/x/.claude/cross-projects-coordination/g/design')).toBe(true)
  })


  it('matches a whole path SEGMENT, not a substring', () => {
    // The discriminating case: a near-miss directory name must NOT pass. This is what
    // separates a segment test from an indexOf() and it is the assertion that would
    // redden if someone "simplified" it to a substring check.
    expect(isUserCorpusPath('/repo/cross-projects-coordination-backup/design')).toBe(false)
    expect(isUserCorpusPath('/repo/my-cross-projects-coordination/design')).toBe(false)
  })
})

describe('scopeOfDesignDir', () => {
  it('classifies a project corpus', () => {
    expect(scopeOfDesignDir('/repo/design')).toBe('project')
    expect(scopeOfDesignDir('/repo/design/specs')).toBe('project')
  })

  it('classifies BOTH local layouts — the current one and the post-migration one', () => {
    // Post-migration (ai-maestro#163).
    expect(scopeOfDesignDir('/repo/.claude/local/design')).toBe('local')
    expect(scopeOfDesignDir('/repo/.claude/local/design/specs')).toBe('local')
    // CURRENT layout, holding every local card that exists today. Recognising only the
    // line above would classify all 22 of them as 'project' — writing the exact false
    // claim this function exists to prevent, across the whole population.
    expect(scopeOfDesignDir('/home/x/.claude/projects/-Users-x-repo/design')).toBe('local')
    expect(scopeOfDesignDir('/home/x/.claude/projects/-Users-x-repo/design/tasks')).toBe('local')
  })

  it('classifies a user corpus', () => {
    expect(scopeOfDesignDir('/home/x/.claude/cross-projects-coordination/g/design')).toBe('user')
  })

  it('does NOT mistake near-miss shapes for local', () => {
    // .claude without local; local without .claude; projects without design.
    expect(scopeOfDesignDir('/repo/.claude/design')).toBe('project')
    expect(scopeOfDesignDir('/repo/local/design')).toBe('project')
    expect(scopeOfDesignDir('/home/x/.claude/projects/slug/notes')).toBe('project')
  })
})

describe('scopeOfDesignDir — symlink normalisation', () => {
  // THE DEFECT THIS PINS: the classifier fed two call sites (the mint and the doctor's
  // repair path) that normalised differently — one realpathed, one did not. On a
  // symlinked ancestor the SAME card classified 'local' through one and 'project'
  // through the other, and the verdict is persisted to frontmatter, so the disagreement
  // would have been written to disk. Normalisation now happens once, inside.
  it('classifies through a symlink TO THE CORPUS ITSELF, where the string hides the shape', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-scope-real-'))
    const corpus = path.join(real, '.claude', 'local', 'design')
    fs.mkdirSync(corpus, { recursive: true })
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-scope-link-'))
    // The link points AT the corpus, so the alias path contains none of the segments.
    // A FIRST attempt at this test symlinked a PARENT instead, which left
    // '.claude/local/design' sitting in the string after the link — resolve alone found
    // it, the neuter reddened nothing, and the test proved only that string matching
    // works. The symlink has to hide the shape or it discriminates nothing.
    const alias = path.join(linkDir, 'aliased-design')
    fs.symlinkSync(corpus, alias)

    expect(scopeOfDesignDir(corpus)).toBe('local')
    expect(alias.includes('.claude')).toBe(false) // the string genuinely hides it
    expect(scopeOfDesignDir(alias)).toBe('local')

    fs.rmSync(real, { recursive: true, force: true })
    fs.rmSync(linkDir, { recursive: true, force: true })
  })
})
