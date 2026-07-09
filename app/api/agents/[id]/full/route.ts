import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { requireAuth } from '@/lib/route-auth'
import { getAgentById } from '@/services/agents-core-service'
import { getTeamsForAgent } from '@/lib/team-registry'
import { listRepos, parseGithubRepo } from '@/services/agents-repos-service'
import { detectRepoDocker } from '@/lib/repo-docker-detect'
import { loadTasks } from '@/lib/task-registry'
import { statePath } from '@/lib/ecosystem-constants'
import type { Task } from '@/types/task'

// Kanban columns that mean the task is DONE/dead — a task in any of these is NOT
// pending. Mirrors the TERMINAL columns of the ratified 17-status TRDD `column:`
// vocabulary (types/task.ts DEFAULT_STATUSES). The in-flight ship states
// (publish/deploy/live_auditing) and `blocked` all remain "pending" — they are
// work that still needs attention.
const TERMINAL_TASK_STATUSES = new Set(['complete', 'published', 'live', 'superseded', 'failed'])

// GET /api/agents/[id]/full — the consolidated operating context for ONE agent:
// base config + resolved team membership + normalized GitHub identity + whether
// the agent's repo uses Docker + its pending tasks + its AID public key.
//
// Unlike GET /api/agents/[id]/repos this route is DELIBERATELY NOT clamped to
// "own agent only": it is the fleet-MONITOR surface a governance agent (the
// janitor, a MANAGER) uses to read ANOTHER agent's operating context, so any
// authenticated caller may read any agent. It exposes only operational metadata
// plus the agent's PUBLIC key (public by definition) — never the private key,
// never a secret — so cross-agent read is safe. Read-only ⇒ non-strict (no sudo).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const { id } = await params
  if (!id || id.length > 200) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  const result = getAgentById(id)
  if (result.error || !result.data) {
    return NextResponse.json(
      { error: result.error || 'Agent not found' },
      { status: result.status || 404 },
    )
  }
  const agent = result.data.agent

  // Resolved team object(s) this agent belongs to (reverse lookup — not a boolean).
  let teams: ReturnType<typeof getTeamsForAgent>
  try {
    teams = getTeamsForAgent(id)
  } catch {
    teams = []
  }

  // Normalized GitHub identity: prefer a github.com remote found by the workdir
  // repo scan, then fall back to the explicit (MAINTAINER-only) agent.githubRepo.
  let githubRepo: string | null = null
  try {
    const repos = listRepos(id)
    const list = (repos.data?.repositories as Array<{ remoteUrl?: string | null }> | undefined) || []
    for (const r of list) {
      const parsed = parseGithubRepo(r.remoteUrl)
      if (parsed) { githubRepo = parsed; break }
    }
  } catch { /* repo scan is best-effort; a missing/blank remote is not an error */ }
  if (!githubRepo && agent.githubRepo) {
    githubRepo = parseGithubRepo(agent.githubRepo) || agent.githubRepo
  }

  // Does the agent's OWN repo/workdir use Docker (compose/Dockerfile at root)?
  const repoDocker = agent.workingDirectory
    ? detectRepoDocker(agent.workingDirectory)
    : { usesDocker: false, files: [] as string[] }

  // Pending tasks assigned to this agent across all its teams (non-terminal).
  // Composed inline here (getTeamsForAgent → loadTasks → filter) rather than via
  // a shared agent→tasks reverse lookup; that dedicated lookup lands with the
  // full task API (TRDD-KJQZEYXW / D5, Phase C).
  let pendingTasks: Task[] = []
  try {
    pendingTasks = teams
      .flatMap(t => {
        try { return loadTasks(t.id) } catch { return [] as Task[] }
      })
      .filter(task => task.assigneeAgentId === id && !TERMINAL_TASK_STATUSES.has(task.status))
  } catch {
    pendingTasks = []
  }

  // AID public key (public by definition — the private key is NEVER read here).
  let aidPublicKey: string | null = null
  try {
    const pubPath = statePath('agents', id, 'keys', 'public.pem')
    if (existsSync(pubPath)) {
      aidPublicKey = readFileSync(pubPath, 'utf-8').trim()
    }
  } catch {
    aidPublicKey = null
  }

  return NextResponse.json({
    agent,
    teams,
    githubRepo,
    repoDocker,
    pendingTasks,
    aid: { publicKey: aidPublicKey },
  })
}
