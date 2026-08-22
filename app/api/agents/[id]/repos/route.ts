import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agent-registry'
import { execFileSync } from 'child_process'
import { findGitDirs } from '@/lib/find-git-dirs'
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
    // Find .git directories up to 3 levels deep.
    //
    // A JS WALK, NOT `find` THROUGH A SHELL (TRDD-JIHK7SWH). The previous form
    // interpolated `resolvedWorkDir` into a shell string, and the metacharacter
    // blocklist above runs on `workDir` BEFORE `realpathSync` — so a symlink whose
    // TARGET contained a quote resolved straight past it. `readdirSync` takes a path,
    // not a command, so there is nothing to quote and nothing to escape.
    const gitDirs = findGitDirs(resolvedWorkDir, 3)

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
      // NO SHELL (TRDD-JIHK7SWH). `resolvedRepoDir` is a directory name DISCOVERED
      // under the workdir, and nothing ever constrained it: the metacharacter blocklist
      // guards `workDir`, and `path.resolve` normalises a path without escaping a single
      // shell character. The `startsWith` check above answers "is this inside the
      // sandbox?", never "is this safe to paste into a shell" — so an agent creating
      //     mkdir 'x"; <command>; "'
      // in its OWN workdir passed every check honestly and executed in the server.
      // `execFileSync` with an argument array goes straight to execve, so metacharacters
      // are inert and the question stops existing. `2>/dev/null` becomes the stdio entry.
      //
      // `--no-optional-locks`: a plain `git status` refreshes the index and takes
      // `.git/index.lock`. This runs on an AGENT'S OWN repo whenever the dashboard lists
      // repos, so without it a read-only UI listing can contend with — or orphan a lock
      // in front of — whatever that agent is committing. A probe must not take a write
      // lock on the repo it probes (TRDD-IMCEYV9F; `server-liveness.ts` and
      // `pillar/freshness.ts` follow the same rule).
      const git = (args: string[]): string =>
        execFileSync('git', ['-C', resolvedRepoDir, ...args], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
      try {
        remote = git(['remote', 'get-url', 'origin'])
      } catch { /* no remote */ }
      try {
        branch = git(['branch', '--show-current'])
      } catch { /* detached */ }
      try {
        dirty = git(['--no-optional-locks', 'status', '--porcelain']).split('\n').filter(Boolean).length
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
