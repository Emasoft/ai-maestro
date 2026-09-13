import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  corpusRootFor,
  isUserCorpusPath,
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

  it('matches a whole path SEGMENT, not a substring', () => {
    // The discriminating case: a near-miss directory name must NOT pass. This is what
    // separates a segment test from an indexOf() and it is the assertion that would
    // redden if someone "simplified" it to a substring check.
    expect(isUserCorpusPath('/repo/cross-projects-coordination-backup/design')).toBe(false)
    expect(isUserCorpusPath('/repo/my-cross-projects-coordination/design')).toBe(false)
  })
})
