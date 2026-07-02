/**
 * GitHub tarball download utility.
 * Ported from acplugin github.ts, modernized to use Node 18+ fetch.
 */

import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

const execFileAsync = promisify(execFile)

export interface GitHubSource {
  owner: string
  repo: string
  branch?: string
  subPath?: string
}

/**
 * Parse a GitHub source string into components.
 * Supported: github:owner/repo, owner/repo#branch, https://github.com/owner/repo/tree/branch/sub/path
 */
export function parseGitHubSource(source: string): GitHubSource {
  let cleaned = source.replace(/^github:/, '')

  // Full URL
  const urlMatch = cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?$/)
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], branch: urlMatch[3] || undefined, subPath: urlMatch[4] || undefined }
  }

  // owner/repo#branch
  let branch: string | undefined
  const hashIdx = cleaned.indexOf('#')
  if (hashIdx !== -1) {
    branch = cleaned.slice(hashIdx + 1)
    cleaned = cleaned.slice(0, hashIdx)
  }

  const parts = cleaned.split('/')
  if (parts.length < 2) throw new Error(`Invalid GitHub source: "${source}"`)

  return { owner: parts[0], repo: parts[1], branch }
}

/**
 * Download a GitHub repo tarball and extract to a temp directory.
 * Returns the path to the extracted directory.
 */
export async function downloadGitHubRepo(source: GitHubSource): Promise<string> {
  const branch = source.branch || 'HEAD'
  const tarballUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/tarball/${branch}`

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aim-convert-'))
  const tarballPath = path.join(tmpDir, 'repo.tar.gz')

  // Download tarball using fetch (Node 18+)
  const headers: Record<string, string> = {
    'User-Agent': 'ai-maestro-converter/1.0',
    'Accept': 'application/vnd.github+json',
  }
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const response = await fetch(tarballUrl, { headers, redirect: 'follow' })
  if (!response.ok) {
    await fs.rm(tmpDir, { recursive: true, force: true })
    throw new Error(`GitHub API returned ${response.status} for ${source.owner}/${source.repo}`)
  }

  // Write response body to file
  const body = response.body
  if (!body) throw new Error('Empty response body')
  const nodeStream = Readable.fromWeb(body as unknown as import('stream/web').ReadableStream)
  await pipeline(nodeStream, createWriteStream(tarballPath))

  // LIB2-MAJ-12: Tar extraction with member-path validation. GNU tar 1.30+
  // strips leading "/" by default and refuses ".." members, but BSD tar (macOS
  // default) and older GNU tar versions do NOT — a malicious tarball with a
  // member like "../../etc/passwd" could otherwise write outside tmpDir.
  //
  // Step 1: list all members WITHOUT extracting and validate each one. We refuse
  //   - absolute paths (leading '/')
  //   - paths containing '..' segments
  //   - paths whose resolved location escapes tmpDir
  //
  // Step 2: only after every member is verified safe do we run the actual
  // extract. We pass `-P` is NOT what we want (that DISABLES protection); we
  // instead rely on the prior validation + the default --strip-components=0.
  const { stdout: tarList } = await execFileAsync('tar', ['-tzf', tarballPath], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 })
  const tmpDirReal = await fs.realpath(tmpDir)
  const members = tarList.split('\n').filter(line => line.length > 0)
  for (const member of members) {
    if (member.startsWith('/')) {
      await fs.rm(tmpDir, { recursive: true, force: true })
      throw new Error(`Refusing to extract tarball: absolute member path "${member}"`)
    }
    // Tar member names are relative; reject any that contains a '..' segment.
    const segments = member.split('/')
    if (segments.some(seg => seg === '..')) {
      await fs.rm(tmpDir, { recursive: true, force: true })
      throw new Error(`Refusing to extract tarball: traversal member path "${member}"`)
    }
    // Final safety check: the resolved path must stay under tmpDir.
    const resolved = path.resolve(tmpDirReal, member)
    if (!resolved.startsWith(tmpDirReal + path.sep) && resolved !== tmpDirReal) {
      await fs.rm(tmpDir, { recursive: true, force: true })
      throw new Error(`Refusing to extract tarball: member "${member}" escapes extraction root`)
    }
  }
  await execFileAsync('tar', ['-xzf', tarballPath, '-C', tmpDir], { timeout: 60_000 })

  // Find extracted directory
  const entries = await fs.readdir(tmpDir, { withFileTypes: true })
  const extractedDir = entries.find(e => e.isDirectory())
  if (!extractedDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
    throw new Error('Failed to extract repository archive')
  }

  let repoDir = path.join(tmpDir, extractedDir.name)

  // Navigate to subPath if specified (with path traversal protection)
  if (source.subPath) {
    const subDir = path.resolve(repoDir, source.subPath)
    // Prevent path traversal: resolved subDir must stay inside repoDir
    if (!subDir.startsWith(repoDir + path.sep) && subDir !== repoDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
      throw new Error(`Sub-path "${source.subPath}" escapes repository directory`)
    }
    try {
      await fs.access(subDir)
      repoDir = subDir
    } catch {
      await fs.rm(tmpDir, { recursive: true, force: true })
      throw new Error(`Sub-path "${source.subPath}" not found in repository`)
    }
  }

  // Clean up tarball
  await fs.unlink(tarballPath).catch(() => {})

  return repoDir
}

/** Get the temp root dir for cleanup */
export function getTempRoot(repoDir: string): string {
  const tmpBase = os.tmpdir()
  const relative = path.relative(tmpBase, repoDir)
  const firstSegment = relative.split(path.sep)[0]
  return path.join(tmpBase, firstSegment)
}

/** Clean up a temp directory (safety: only deletes if inside os.tmpdir()) */
export async function cleanupTempDir(dir: string): Promise<void> {
  const root = getTempRoot(dir)
  // Resolve symlinks and normalize to catch traversal attacks like /tmp/../etc
  const resolvedRoot = await fs.realpath(root).catch(() => path.resolve(root))
  const resolvedTmp = await fs.realpath(os.tmpdir()).catch(() => path.resolve(os.tmpdir()))
  if (!resolvedRoot.startsWith(resolvedTmp + path.sep) && resolvedRoot !== resolvedTmp) {
    throw new Error(`Refusing to delete directory outside tmpdir: ${resolvedRoot}`)
  }
  await fs.rm(root, { recursive: true, force: true })
}
