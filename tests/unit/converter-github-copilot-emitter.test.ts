import { describe, it, expect } from 'vitest'
import githubCopilotEmitter from '@/lib/converter/emitters/github-copilot'
import type { ProjectIR, SkillIR } from '@/lib/converter/types'

// Real emitter, no mocks. GitHub Copilot has no skills dir — a skill converts
// to ONE plain-markdown .github/copilot-instructions.md (no frontmatter), with
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

describe('github-copilot emitter', () => {
  it('emits exactly one .github/copilot-instructions.md with NO frontmatter', () => {
    const files = githubCopilotEmitter.emit(makeProject([
      makeSkill({ name: 'tldr-code', body: 'BODY-CONTENT', references: [{ path: 'references/ast.md', content: 'REF-AST' }] }),
    ]))
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('.github/copilot-instructions.md')
    expect(files[0].type).toBe('instructions')
    expect(files[0].content.startsWith('---')).toBe(false)
    expect(files[0].content).toContain('# tldr-code')
    expect(files[0].content).toContain('BODY-CONTENT')
    expect(files[0].content).toContain('## Reference: ast')
    expect(files[0].content).toContain('REF-AST')
  })

  it('is deterministic — no provenance/date, identical across runs', () => {
    const p = makeProject([makeSkill()])
    const a = githubCopilotEmitter.emit(p)[0].content
    const b = githubCopilotEmitter.emit(p)[0].content
    expect(a).toBe(b)
    expect(a).not.toMatch(/_converted/)
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  it('merges multiple skills into the single file', () => {
    const files = githubCopilotEmitter.emit(makeProject([
      makeSkill({ name: 'one', dirName: 'one', body: 'B1' }),
      makeSkill({ name: 'two', dirName: 'two', body: 'B2' }),
    ]))
    expect(files).toHaveLength(1)
    expect(files[0].content).toContain('# one')
    expect(files[0].content).toContain('# two')
  })

  it('returns no files when there is nothing to emit', () => {
    expect(githubCopilotEmitter.emit(makeProject([]))).toHaveLength(0)
  })
})
