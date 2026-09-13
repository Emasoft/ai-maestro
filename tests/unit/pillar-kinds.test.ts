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
})
