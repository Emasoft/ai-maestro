import { describe, it, expect } from 'vitest'
import kilocodeEmitter from '@/lib/converter/emitters/kilocode'
import type { ProjectIR, SkillIR } from '@/lib/converter/types'

// Real emitter, no mocks. KiloCode has no skills dir — each skill converts to ONE
// plain-markdown rule file .kilocode/rules/<name>.md (no frontmatter), with
// references inline-appended. Deterministic by construction.

function makeSkill(over: Partial<SkillIR> = {}): SkillIR {
  return {
    name: 'tldr-code', description: 'Token-efficient code analysis', userInvokable: false,
    args: [], license: null, compatibility: null, metadata: null, allowedTools: null,
    paths: null, body: 'BODY-CONTENT', references: [], auxFiles: [],
    dirName: 'tldr-code', sourcePath: '/tmp/skills/tldr-code/SKILL.md', ...over,
  }
}

function makeProject(skills: SkillIR[]): ProjectIR {
  return {
    skills, agents: [], instructions: [], mcp: null, commands: [], hooks: [],
    sourceProvider: 'claude-code', rootDir: '/tmp',
  }
}

describe('kilocode emitter', () => {
  it('emits one .kilocode/rules/<name>.md per skill with NO frontmatter', () => {
    const files = kilocodeEmitter.emit(makeProject([
      makeSkill({ name: 'tldr-code', dirName: 'tldr-code', body: 'BODY-CONTENT', references: [{ path: 'references/ast.md', content: 'REF-AST' }] }),
    ]))
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('.kilocode/rules/tldr-code.md')
    expect(files[0].type).toBe('instructions')
    expect(files[0].content.startsWith('---')).toBe(false)
    expect(files[0].content).toContain('# tldr-code')
    expect(files[0].content).toContain('BODY-CONTENT')
    expect(files[0].content).toContain('## Reference: ast')
    expect(files[0].content).toContain('REF-AST')
  })

  it('is deterministic — no provenance/date, identical across runs', () => {
    const p = makeProject([makeSkill()])
    const a = kilocodeEmitter.emit(p)[0].content
    const b = kilocodeEmitter.emit(p)[0].content
    expect(a).toBe(b)
    expect(a).not.toMatch(/_converted/)
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  it('emits a separate rule file per skill', () => {
    const files = kilocodeEmitter.emit(makeProject([
      makeSkill({ name: 'one', dirName: 'one', body: 'B1' }),
      makeSkill({ name: 'two', dirName: 'two', body: 'B2' }),
    ]))
    expect(files).toHaveLength(2)
    expect(files.map(f => f.path).sort()).toEqual(['.kilocode/rules/one.md', '.kilocode/rules/two.md'])
  })

  it('sanitizes the rule file name (no path traversal)', () => {
    const files = kilocodeEmitter.emit(makeProject([
      makeSkill({ name: 'x', dirName: '../evil/../x', body: 'B' }),
    ]))
    expect(files).toHaveLength(1)
    expect(files[0].path).not.toContain('..')
    expect(files[0].path).toMatch(/^\.kilocode\/rules\/[a-zA-Z0-9_-]+\.md$/)
  })

  it('returns no files when there is nothing to emit', () => {
    expect(kilocodeEmitter.emit(makeProject([]))).toHaveLength(0)
  })
})
