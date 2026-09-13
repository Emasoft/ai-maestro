import { describe, it, expect } from 'vitest'
import path from 'path'
import { corpusRootFor, TRDD_KIND, SPEC_KIND, PRRD_KIND } from '@/lib/pillar/kinds'

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

  it('user scope resolves an already-explicit designDir identically to project scope (no group lookup, no throw)', () => {
    const explicitUserDesignDir = path.join(
      '/home/x', '.claude', 'cross-projects-coordination', 'my-group', 'design',
    )
    expect(corpusRootFor(explicitUserDesignDir, TRDD_KIND, 'user')).toBe(explicitUserDesignDir)
    expect(corpusRootFor(explicitUserDesignDir, SPEC_KIND, 'user')).toBe(
      path.join(explicitUserDesignDir, 'specs'),
    )
  })

  it('user scope REFUSES a project designDir rather than filing into the project corpus', () => {
    // THE HAZARD the passthrough creates, and the reason the guard lives in the resolver
    // rather than waiting for access control. Nothing at the call site distinguishes a
    // DEFAULTED project designDir from an explicit user one, so the resolver checks the
    // one property readable off the path alone: is this a cross-project corpus at all?
    // Without it a user-scope write lands in whatever project the caller defaulted to,
    // with a plausible path and no error — the silent-wrong-tree case.
    expect(() => corpusRootFor('/repo/design', TRDD_KIND, 'user')).toThrow(
      /not a cross-project corpus/,
    )
    expect(() => corpusRootFor('/repo/design', PRRD_KIND, 'user')).toThrow()
    // A RELATIVE path must not sneak past: the check resolves before testing segments.
    expect(() => corpusRootFor('design', SPEC_KIND, 'user')).toThrow()
  })
})
