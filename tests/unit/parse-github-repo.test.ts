import { describe, it, expect } from 'vitest'
import { parseGithubRepo } from '@/services/agents-repos-service'

describe('parseGithubRepo', () => {
  it('normalizes an SSH remote to owner/repo', () => {
    expect(parseGithubRepo('git@github.com:Emasoft/ai-maestro.git')).toBe('Emasoft/ai-maestro')
  })

  it('normalizes an HTTPS remote to the SAME owner/repo', () => {
    expect(parseGithubRepo('https://github.com/Emasoft/ai-maestro.git')).toBe('Emasoft/ai-maestro')
  })

  it('handles a missing .git suffix and a trailing slash', () => {
    expect(parseGithubRepo('git@github.com:Emasoft/ai-maestro')).toBe('Emasoft/ai-maestro')
    expect(parseGithubRepo('https://github.com/Emasoft/ai-maestro/')).toBe('Emasoft/ai-maestro')
  })

  it('returns null for a non-GitHub remote (and does not match a look-alike host)', () => {
    expect(parseGithubRepo('git@gitlab.com:owner/repo.git')).toBeNull()
    expect(parseGithubRepo('https://mygithub.com/owner/repo.git')).toBeNull()
  })

  it('returns null for empty / null / garbage input', () => {
    expect(parseGithubRepo('')).toBeNull()
    expect(parseGithubRepo(null)).toBeNull()
    expect(parseGithubRepo('not a url')).toBeNull()
  })
})
