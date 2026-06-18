import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agent-registry'
import { execSync } from 'child_process'
import path from 'path'
import { requireAuth } from '@/lib/route-auth'

// GET /api/agents/[id]/repos — Scan agent's working directory for git repos
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // N3: this enumerated any agent's git repos + remotes by UUID with NO auth.
  // Authenticate, and let an agent enumerate ONLY its own repos; the system
  // owner (web UI) may enumerate any.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  const { id } = await params
  if (auth.agentId && auth.agentId !== id) {
    return NextResponse.json({ error: 'Forbidden — you may only enumerate your own repos' }, { status: 403 })
  }
  const agent = getAgent(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const workDir = agent.workingDirectory
  if (!workDir) {
    return NextResponse.json({ repos: [], message: 'No working directory set' })
  }

  // Validate workDir: must be absolute, no shell metacharacters, must exist
  const { existsSync, statSync, realpathSync } = await import('fs')
  if (!workDir.startsWith('/') || /[;&|`$(){}!#'"\\<>*?\[\]\n\r~]/.test(workDir) || workDir.length > 2000) {
    return NextResponse.json({ error: 'Invalid working directory' }, { status: 400 })
  }
  if (!existsSync(workDir) || !statSync(workDir).isDirectory()) {
    return NextResponse.json({ repos: [], message: 'Working directory does not exist' })
  }

  // SEC: Resolve symlinks and verify no path traversal escape.
  // After resolving, the real path must not contain '..' segments
  // and must be a valid absolute directory.
  let resolvedWorkDir: string
  try {
    resolvedWorkDir = realpathSync(workDir)
  } catch {
    return NextResponse.json({ error: 'Cannot resolve working directory' }, { status: 400 })
  }
  if (resolvedWorkDir.includes('..') || !resolvedWorkDir.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid working directory path' }, { status: 400 })
  }

  try {
    // Find .git directories up to 3 levels deep
    const gitDirs = execSync(
      `find "${resolvedWorkDir}" -maxdepth 3 -name .git -type d 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim().split('\n').filter(Boolean)

    const repos = gitDirs.map(gitDir => {
      const repoDir = gitDir.replace(/\/\.git$/, '')
      // SEC: Validate repoDir is within the resolved working directory
      // to prevent find output from escaping via symlinks or crafted paths.
      const resolvedRepoDir = path.resolve(repoDir)
      if (!resolvedRepoDir.startsWith(resolvedWorkDir + '/') && resolvedRepoDir !== resolvedWorkDir) {
        return null // Skip repos outside the working directory
      }
      const name = resolvedRepoDir.split('/').pop() || ''
      let remote = ''
      let branch = ''
      let dirty = 0
      // SEC: Use resolvedRepoDir in git commands to prevent shell injection
      // via crafted directory names in find output.
      try {
        remote = execSync(`git -C "${resolvedRepoDir}" remote get-url origin 2>/dev/null`, { encoding: 'utf-8' }).trim()
      } catch { /* no remote */ }
      try {
        branch = execSync(`git -C "${resolvedRepoDir}" branch --show-current 2>/dev/null`, { encoding: 'utf-8' }).trim()
      } catch { /* detached */ }
      try {
        dirty = execSync(`git -C "${resolvedRepoDir}" status --porcelain 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean).length
      } catch { /* error */ }
      return { path: resolvedRepoDir, name, remote, branch, dirty }
    }).filter(Boolean)

    return NextResponse.json({ repos })
  } catch (error) {
    return NextResponse.json(
      { error: `Repo scan failed: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
