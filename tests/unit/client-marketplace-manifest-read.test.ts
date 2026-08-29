/**
 * readClientMarketplacePlugins — the ONE manifest reader for both the role and the
 * custom per-client marketplaces (TRDD-Y0XEEUXN).
 *
 * Two byte-identical copies of this parser existed (`readRoleClientMarketplacePlugins`
 * and `readCustomClientMarketplacePlugins`), differing only in which path helper
 * produced their directory. They were merged into one function taking the directory.
 *
 * This file exists because a neuter run found the merge was landing on NOTHING:
 * making the helper return `[]` unconditionally left all 24 tests of the four
 * conversion suites green. The parser sits on the path every plugin install and
 * cross-client convert flow uses, and it handles the two incompatible manifest
 * shapes — Claude's `source: "./name"` string and Codex's `source: { path: "./name" }`
 * object — which is exactly the edge case the card names as the reason to have one
 * owner. Nothing asserted either shape.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readClientMarketplacePlugins } from '@/services/plugin-storage-service'

const dirs: string[] = []

function makeMarketplace(shape: 'claude' | 'codex', plugins: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), 'mkt-read-'))
  dirs.push(root)
  if (shape === 'claude') {
    mkdirSync(join(root, '.claude-plugin'), { recursive: true })
    writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins }))
  } else {
    writeFileSync(join(root, 'marketplace.json'), JSON.stringify({ plugins }))
  }
  return root
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('readClientMarketplacePlugins (TRDD-Y0XEEUXN)', () => {
  it('Claude shape: a STRING source is the relative path', async () => {
    const dir = makeMarketplace('claude', [
      { name: 'alpha', description: 'first', version: '1.2.3', source: './alpha', category: 'tools' },
    ])

    const out = await readClientMarketplacePlugins(dir)

    expect(out).toEqual([
      { name: 'alpha', description: 'first', version: '1.2.3', relativePath: './alpha', category: 'tools' },
    ])
  })

  it('Codex shape: an OBJECT source yields the same relativePath', async () => {
    // The whole point of one owner: these two shapes must decode identically.
    const dir = makeMarketplace('codex', [
      { name: 'alpha', description: 'first', version: '1.2.3', source: { path: './alpha' } },
    ])

    const out = await readClientMarketplacePlugins(dir)

    expect(out[0].relativePath).toBe('./alpha')
    expect(out[0].name).toBe('alpha')
  })

  it('prefers the Claude manifest when BOTH locations exist', async () => {
    const dir = makeMarketplace('claude', [{ name: 'from-claude', source: './c' }])
    writeFileSync(join(dir, 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'from-codex', source: { path: './x' } }] }))

    const out = await readClientMarketplacePlugins(dir)

    expect(out.map(p => p.name)).toEqual(['from-claude'])
  })

  it('a directory with no manifest reads as EMPTY, not as an error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mkt-read-'))
    dirs.push(root)

    await expect(readClientMarketplacePlugins(root)).resolves.toEqual([])
  })

  it('missing fields get defaults, and a non-object entry is skipped rather than crashing', async () => {
    const dir = makeMarketplace('codex', [
      null,
      'not-an-object',
      { name: 'bare' },
    ])

    const out = await readClientMarketplacePlugins(dir)

    expect(out).toEqual([
      { name: 'bare', description: '', version: '0.0.0', relativePath: '', category: undefined },
    ])
  })

  it('an unrecognised source shape yields an empty relativePath, not a throw', async () => {
    const dir = makeMarketplace('codex', [{ name: 'weird', source: { repo: 'owner/name' } }])

    const out = await readClientMarketplacePlugins(dir)

    expect(out[0].relativePath).toBe('')
  })
})
