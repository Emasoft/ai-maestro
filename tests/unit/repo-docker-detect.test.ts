import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { detectRepoDocker } from '@/lib/repo-docker-detect'

describe('detectRepoDocker', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rdd-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('detects a root Dockerfile', () => {
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20')
    const r = detectRepoDocker(dir)
    expect(r.usesDocker).toBe(true)
    expect(r.files).toContain('Dockerfile')
  })

  it('detects a v1 docker-compose.yml', () => {
    writeFileSync(join(dir, 'docker-compose.yml'), 'services: {}')
    expect(detectRepoDocker(dir).usesDocker).toBe(true)
  })

  it('detects a v2 compose.yaml', () => {
    writeFileSync(join(dir, 'compose.yaml'), 'services: {}')
    expect(detectRepoDocker(dir).files).toContain('compose.yaml')
  })

  it('returns false for a repo with no docker files', () => {
    writeFileSync(join(dir, 'README.md'), '# hi')
    const r = detectRepoDocker(dir)
    expect(r.usesDocker).toBe(false)
    expect(r.files).toEqual([])
  })

  it('ignores docker files nested one level down (root-only by design)', () => {
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'Dockerfile'), 'FROM node:20')
    expect(detectRepoDocker(dir).usesDocker).toBe(false)
  })

  it('returns false for a non-existent or relative path', () => {
    expect(detectRepoDocker(join(dir, 'does-not-exist')).usesDocker).toBe(false)
    expect(detectRepoDocker('relative/path').usesDocker).toBe(false)
  })
})
