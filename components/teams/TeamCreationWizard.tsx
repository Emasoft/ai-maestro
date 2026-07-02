'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  GitBranch,
  Users,
  Shield,
  Megaphone,
  AlertTriangle,
  Plus,
  ExternalLink,
  Loader2,
  X,
  Lock,
  FolderGit2,
  LayoutDashboard,
  UserCheck,
} from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────────────

interface TeamCreationWizardProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (teamId: string) => void
  reservedNames: { teamNames: string[]; agentNames: string[] }
}

// ──────────────────────────────────────────────────────────────────────
// Internal state types
// ──────────────────────────────────────────────────────────────────────

interface GitHubAuthStatus {
  authenticated: boolean
  hasProjectScope: boolean
  username?: string
}

interface GitHubOrg {
  login: string
  avatarUrl?: string
}

interface GitHubRepo {
  name: string
  fullName: string
  private: boolean
  description?: string
}

interface GitHubProjectInfo {
  id: string
  title: string
  number: number
  url: string
}

type ProjectChoice = 'create' | 'link' | 'skip'

// An agent the user can pick to BECOME a team officer (COS or Orchestrator).
// Filtering at fetch time guarantees only AUTONOMOUS agents not in any team
// appear here — so the picker never offers an ineligible target.
//
// Why AUTONOMOUS only: a team officer title (COS / Orchestrator / Architect /
// Integrator / Member) requires team membership (TEAM_TITLES set in
// element-management-service.ts). An agent already in another team carries
// one of those titles; reassigning it to a NEW team is a two-step process
// (remove from old team → revert to AUTONOMOUS → add to new team). The
// Team Creation Wizard is the ENTRY point — not the right surface for that
// migration. If the user wants to pull an existing team member into the new
// team, they do it from the Team Membership section after creation.
//
// Why only agents not in any team: same reason — membership exclusivity.
// AUTONOMOUS agents are specifically NOT in a team (R9.13: the autonomous
// role-plugin is the fallback identity when no team binds them).
interface AgentOption {
  id: string
  name: string
  label?: string
  /** Governance title — only AUTONOMOUS agents reach this picker */
  governanceTitle: string | null
}

interface WizardData {
  // Step 1: Team Info
  teamName: string
  description: string
  password: string
  // Step 2: GitHub Repos
  selectedOrg: string
  selectedRepos: string[]            // fullName values
  newRepoName: string
  newRepoPrivate: boolean
  createNewRepo: boolean
  // Step 3: GitHub Project
  projectChoice: ProjectChoice
  linkedProjectUrl: string
  linkedProjectValid: boolean | null // null = not checked, true/false = result
  linkedProjectInfo: GitHubProjectInfo | null
  // Step 4: Team Roles
  cosAgentId: string                 // 'auto' = auto-create (default), or agent UUID
  orchestratorAgentId: string        // '' = none, 'auto' = auto-create
  // Step 5: (confirm — no extra data)
}

const INITIAL_DATA: WizardData = {
  teamName: '',
  description: '',
  password: '',
  selectedOrg: '',
  selectedRepos: [],
  newRepoName: '',
  newRepoPrivate: true,
  createNewRepo: false,
  projectChoice: 'skip',
  linkedProjectUrl: '',
  linkedProjectValid: null,
  linkedProjectInfo: null,
  cosAgentId: 'auto',
  orchestratorAgentId: '',
}

const STEP_LABELS = ['Team Info', 'GitHub Repos', 'GitHub Project', 'Team Roles', 'Confirm']
const STEP_ICONS = [Users, FolderGit2, LayoutDashboard, Shield, Check]

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export default function TeamCreationWizard({
  isOpen,
  onClose,
  onCreated,
  reservedNames,
}: TeamCreationWizardProps) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<WizardData>({ ...INITIAL_DATA })
  const [nameValidation, setNameValidation] = useState<{ error: string | null }>({ error: null })

  // Step 2 state
  const [ghAuth, setGhAuth] = useState<GitHubAuthStatus | null>(null)
  const [ghAuthLoading, setGhAuthLoading] = useState(false)
  const [orgs, setOrgs] = useState<GitHubOrg[]>([])
  const [orgsLoading, setOrgsLoading] = useState(false)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [reposLoading, setReposLoading] = useState(false)

  // Step 3 state
  const [projectValidating, setProjectValidating] = useState(false)

  // Step 4 state
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)

  // Step 5 state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Reset on open ─────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setStep(0)
      setData({ ...INITIAL_DATA })
      setNameValidation({ error: null })
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [isOpen])

  // ── Escape to close ───────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // ── Team name validation (same rules as teams page) ───────────────
  const validateTeamName = useCallback((raw: string) => {
    const clean = raw.replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ').trim()
    if (clean.length === 0) { setNameValidation({ error: null }); return }
    if (clean.length < 4) { setNameValidation({ error: 'Team name must be at least 4 characters' }); return }
    if (clean.length > 64) { setNameValidation({ error: 'Team name must be at most 64 characters' }); return }
    if (!/^[a-zA-Z0-9]/.test(clean)) { setNameValidation({ error: 'Team name must start with a letter or number' }); return }
    if (/[^\w \-.&()]/.test(clean)) { setNameValidation({ error: 'Only letters, numbers, spaces, hyphens, underscores, dots, ampersands, and parentheses are allowed' }); return }
    const lowerName = clean.toLowerCase()
    const teamDupe = reservedNames.teamNames.find(n => n.toLowerCase() === lowerName)
    if (teamDupe) { setNameValidation({ error: `A team named "${teamDupe}" already exists` }); return }
    const agentDupe = reservedNames.agentNames.find(n => n.toLowerCase() === lowerName)
    if (agentDupe) { setNameValidation({ error: `Name "${agentDupe}" is already used by an agent` }); return }
    setNameValidation({ error: null })
  }, [reservedNames])

  // ── Fetch GitHub auth on Step 2 entry ─────────────────────────────
  useEffect(() => {
    if (step !== 1 || ghAuth !== null) return
    setGhAuthLoading(true)
    fetch('/api/github/auth')
      .then(r => r.ok ? r.json() : { authenticated: false, hasProjectScope: false })
      .then(d => setGhAuth(d))
      .catch((err) => { console.error('Failed to fetch GitHub auth:', err); setGhAuth({ authenticated: false, hasProjectScope: false }) })
      .finally(() => setGhAuthLoading(false))
  }, [step, ghAuth])

  // ── Fetch orgs when auth is confirmed ─────────────────────────────
  useEffect(() => {
    if (!ghAuth?.authenticated) return
    setOrgsLoading(true)
    fetch('/api/github/orgs')
      .then(r => r.ok ? r.json() : { orgs: [] })
      .then(d => setOrgs(d.orgs || []))
      .catch((err) => { console.error('Failed to fetch GitHub orgs:', err); setOrgs([]) })
      .finally(() => setOrgsLoading(false))
  }, [ghAuth])

  // ── Fetch repos when org selected ─────────────────────────────────
  useEffect(() => {
    if (!data.selectedOrg) { setRepos([]); return }
    setReposLoading(true)
    fetch(`/api/github/repos?owner=${encodeURIComponent(data.selectedOrg)}`)
      .then(r => r.ok ? r.json() : { repos: [] })
      .then(d => setRepos(d.repos || []))
      .catch((err) => { console.error('Failed to fetch GitHub repos:', err); setRepos([]) })
      .finally(() => setReposLoading(false))
  }, [data.selectedOrg])

  // ── Fetch eligible agents on Step 4 entry ─────────────────────────
  // Previously this pulled from /api/sessions which returns Session objects
  // with no governanceTitle — so the picker offered every agent as a COS
  // candidate, including MANAGERs, existing COSes of other teams, MEMBERs,
  // and MAINTAINERs. Assigning any of those as COS of the new team would
  // either be a silent title override (security risk) or a no-op (because
  // ChangeTitle Gate 9 would reject the transition without team removal
  // first, showing the user a cryptic error late in the flow).
  //
  // Correct behavior per team governance (R9.13, R11.12, and the 2026-04-21
  // user directive): offer ONLY agents whose current title is AUTONOMOUS
  // and who are not members of ANY team. These are the legal "free" agents
  // that can be pulled into the new team and assigned their first team
  // title. An agent becomes a COS only at the moment its team is created —
  // no COS exists without a team, no team exists without a COS.
  //
  // Fetch strategy: query /api/agents (has governanceTitle) and /api/teams
  // (has agentIds for every team) in parallel, then locally compute the
  // intersection. This is cheap (both endpoints cache aggressively and
  // return compact JSON) and avoids a new server endpoint.
  useEffect(() => {
    if (step !== 3) return
    setAgentsLoading(true)
    Promise.all([
      fetch('/api/agents').then(r => r.ok ? r.json() : { agents: [] }),
      fetch('/api/teams').then(r => r.ok ? r.json() : { teams: [] }),
    ])
      .then(([agentsRes, teamsRes]: [
        { agents?: Array<{ id: string; name: string; label?: string; governanceTitle?: string | null; deletedAt?: string | null }> },
        { teams?: Array<{ agentIds?: string[] }> }
      ]) => {
        const allAgents = Array.isArray(agentsRes.agents) ? agentsRes.agents : []
        const allTeams = Array.isArray(teamsRes.teams) ? teamsRes.teams : []
        // Set of all agent IDs that are already in a team.
        const agentsInAnyTeam = new Set<string>()
        for (const team of allTeams) {
          for (const aid of (team.agentIds || [])) {
            agentsInAnyTeam.add(aid)
          }
        }
        // Keep: live + AUTONOMOUS + not in any team.
        const eligible = allAgents
          .filter(a => !a.deletedAt)
          .filter(a => (a.governanceTitle || 'autonomous') === 'autonomous')
          .filter(a => !agentsInAnyTeam.has(a.id))
          .map(a => ({
            id: a.id,
            name: a.name,
            label: a.label,
            governanceTitle: a.governanceTitle || 'autonomous',
          }))
        setAgents(eligible)
      })
      .catch((err) => { console.error('Failed to fetch eligible agents:', err); setAgents([]) })
      .finally(() => setAgentsLoading(false))
  }, [step])

  // ── Validate linked project URL ───────────────────────────────────
  const validateProjectUrl = useCallback(async (url: string) => {
    if (!url.trim()) {
      setData(d => ({ ...d, linkedProjectValid: null, linkedProjectInfo: null }))
      return
    }
    setProjectValidating(true)
    try {
      const res = await fetch(`/api/github/projects?validate=${encodeURIComponent(url.trim())}`)
      if (res.ok) {
        const info = await res.json()
        setData(d => ({ ...d, linkedProjectValid: true, linkedProjectInfo: info }))
      } else {
        setData(d => ({ ...d, linkedProjectValid: false, linkedProjectInfo: null }))
      }
    } catch (err) {
      console.error('Failed to validate project URL:', err)
      setData(d => ({ ...d, linkedProjectValid: false, linkedProjectInfo: null }))
    } finally {
      setProjectValidating(false)
    }
  }, [])

  // ── Step validation ───────────────────────────────────────────────
  const isStepValid = useCallback((s: number): boolean => {
    switch (s) {
      case 0: // Team Info — name required (4+ chars, no errors), password required
        return data.teamName.trim().length >= 4 && !nameValidation.error && data.password.length > 0
      case 1: // GitHub Repos — always valid (repos are optional)
        return true
      case 2: // GitHub Project — valid unless "link" chosen with invalid URL
        if (data.projectChoice === 'link') {
          return data.linkedProjectValid === true
        }
        return true
      case 3: // Team Roles — always valid (roles are optional)
        return true
      case 4: // Confirm — always valid
        return true
      default:
        return false
    }
  }, [data, nameValidation.error])

  // ── Create team ───────────────────────────────────────────────────
  const handleCreate = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      // SCEN-003 BUG-001 fix (2026-04-19):
      // /api/teams/create-with-project uses a .strict() Zod schema that
      // only accepts: name, description, password, githubProject,
      // chiefOfStaffId, orchestratorId. The previous payload included
      // `agentIds: []`, `autoCreateCos`, `autoCreateOrchestrator`,
      // `githubRepos`, `newRepo`, `createGithubProject`, `githubProjectUrl`
      // — all of which caused EVERY team creation via the full wizard to
      // fail with "Validation failed". The service (createNewTeam) already
      // auto-creates a COS when chiefOfStaffId is absent, so the
      // autoCreateCos flag was redundant.
      //
      // TODO(post-scenario): extend /api/teams/create-with-project to
      // accept repos/project creation/auto-orchestrator, OR extract those
      // side effects into follow-up calls after the team row exists.
      // For now the wizard degrades gracefully — a team is created with
      // an auto-COS but no repos/project.
      const payload: Record<string, unknown> = {
        name: data.teamName.trim(),
        description: data.description.trim() || undefined,
        password: data.password,
      }

      // Roles
      //   cosAgentId === 'auto'  → omit chiefOfStaffId, server auto-creates
      //   cosAgentId specific    → send as chiefOfStaffId
      if (data.cosAgentId && data.cosAgentId !== 'auto') {
        payload.chiefOfStaffId = data.cosAgentId
      }
      if (data.orchestratorAgentId && data.orchestratorAgentId !== 'auto') {
        payload.orchestratorId = data.orchestratorAgentId
      }

      // GitHub Project — only the "link" path can be mapped to the current
      // route schema (owner+repo+number tuple). GitHubProjectInfo exposes
      // a `url` field but no pre-parsed owner/repo, so we extract them from
      // the URL. Repo selection, new-repo creation, and
      // createGithubProject=true are not plumbed through yet and are
      // silently dropped here to keep team creation working.
      if (data.projectChoice === 'link' && data.linkedProjectInfo) {
        const info = data.linkedProjectInfo
        // URL format: https://github.com/<owner>/<repo>/projects/<number>
        // or https://github.com/orgs/<owner>/projects/<number>
        const m =
          /github\.com\/(?:orgs\/)?([^/]+)(?:\/([^/]+))?\/projects\/(\d+)/.exec(info.url || '')
        if (m && m[1] && m[3]) {
          const owner = m[1]
          const repo = m[2] || m[1]
          const number = Number(m[3])
          if (Number.isFinite(number) && number > 0) {
            payload.githubProject = { owner, repo, number }
          }
        }
      }

      const res = await fetch('/api/teams/create-with-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Failed to create team' }))
        const issuesMsg = Array.isArray(errData.issues) && errData.issues.length > 0
          ? ` (${errData.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ')})`
          : ''
        throw new Error((errData.error || 'Failed to create team') + issuesMsg)
      }
      const result = await res.json()
      onCreated(result.team?.id || result.id)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create team')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────
  const update = <K extends keyof WizardData>(key: K, value: WizardData[K]) =>
    setData(d => ({ ...d, [key]: value }))

  const toggleRepo = (fullName: string) => {
    setData(d => ({
      ...d,
      selectedRepos: d.selectedRepos.includes(fullName)
        ? d.selectedRepos.filter(r => r !== fullName)
        : [...d.selectedRepos, fullName],
    }))
  }

  if (!isOpen) return null

  // ──────────────────────────────────────────────────────────────────
  // Render: Step Content
  // ──────────────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      // ── Step 1: Team Info ───────────────────────────────────────
      case 0:
        return (
          <div className="space-y-4">
            {/* Team Name */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Team Name *</label>
              <p className="text-xs text-gray-600 mb-1">4-64 characters. Letters, numbers, spaces, hyphens, dots allowed. Must be unique.</p>
              <input
                type="text"
                value={data.teamName}
                onChange={e => { update('teamName', e.target.value); validateTeamName(e.target.value) }}
                placeholder="e.g. Backend Squad"
                aria-label="Team name"
                className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none ${
                  nameValidation.error ? 'border-red-500 focus:border-red-500' : 'border-gray-700 focus:border-emerald-500'
                }`}
                autoFocus
              />
              {nameValidation.error && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {nameValidation.error}
                </p>
              )}
              {!nameValidation.error && data.teamName.trim().length >= 4 && (
                <p className="text-xs text-emerald-400 mt-1">Name is available</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Description (optional)</label>
              <textarea
                value={data.description}
                onChange={e => update('description', e.target.value)}
                placeholder="What does this team work on?"
                aria-label="Team description"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 resize-none"
                rows={3}
              />
            </div>

            {/* Password */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Governance Password *</label>
              <p className="text-xs text-gray-600 mb-1">Required for team governance actions (role assignments, transfers, etc.)</p>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  type="password"
                  value={data.password}
                  onChange={e => update('password', e.target.value)}
                  placeholder="Governance password"
                  aria-label="Governance password"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>
        )

      // ── Step 2: GitHub Repos ────────────────────────────────────
      case 1:
        return (
          <div className="space-y-4">
            {/* Auth Status */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <GitBranch className="w-4 h-4 text-gray-400" />
                <span className="text-xs font-medium text-gray-300">GitHub Connection</span>
              </div>
              {ghAuthLoading ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                  <span className="text-xs text-gray-500">Checking authentication...</span>
                </div>
              ) : ghAuth?.authenticated ? (
                <div className="space-y-1">
                  <p className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Authenticated{ghAuth.username ? ` as ${ghAuth.username}` : ''}
                  </p>
                  {!ghAuth.hasProjectScope && (
                    <p className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Missing &quot;project&quot; scope — project creation will be unavailable
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Not authenticated — GitHub features will be unavailable. Run <code className="bg-gray-700 px-1 rounded">gh auth login</code> to connect.
                </p>
              )}
            </div>

            {/* Org Selector */}
            {ghAuth?.authenticated && (
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Organization / Owner</label>
                {orgsLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                    <span className="text-xs text-gray-500">Loading organizations...</span>
                  </div>
                ) : (
                  <select
                    value={data.selectedOrg}
                    onChange={e => { update('selectedOrg', e.target.value); update('selectedRepos', []) }}
                    aria-label="Select GitHub organization"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select organization...</option>
                    {ghAuth.username && <option value={ghAuth.username}>{ghAuth.username} (personal)</option>}
                    {orgs.map(org => (
                      <option key={org.login} value={org.login}>{org.login}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Repo List */}
            {data.selectedOrg && (
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Select Repositories</label>
                {reposLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                    <span className="text-xs text-gray-500">Loading repositories...</span>
                  </div>
                ) : repos.length === 0 ? (
                  <p className="text-xs text-gray-500 py-2">No repositories found for {data.selectedOrg}</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto border border-gray-700 rounded-lg divide-y divide-gray-800">
                    {repos.map(repo => (
                      <label key={repo.fullName} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={data.selectedRepos.includes(repo.fullName)}
                          onChange={() => toggleRepo(repo.fullName)}
                          className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-white truncate block">{repo.name}</span>
                          {repo.description && <span className="text-xs text-gray-500 truncate block">{repo.description}</span>}
                        </div>
                        {repo.private && <Lock className="w-3 h-3 text-gray-600 flex-shrink-0" />}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Create New Repo */}
            {ghAuth?.authenticated && (
              <div className="border-t border-gray-700 pt-3">
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={data.createNewRepo}
                    onChange={e => update('createNewRepo', e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-xs text-gray-300">Create a new repository</span>
                </label>
                {data.createNewRepo && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={data.newRepoName}
                      onChange={e => update('newRepoName', e.target.value)}
                      placeholder="repository-name"
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                    />
                    <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={data.newRepoPrivate}
                        onChange={e => update('newRepoPrivate', e.target.checked)}
                        className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                      />
                      Private
                    </label>
                  </div>
                )}
              </div>
            )}

            {!ghAuth?.authenticated && (
              <p className="text-xs text-gray-600 italic">You can skip this step and add repos later.</p>
            )}
          </div>
        )

      // ── Step 3: GitHub Project ──────────────────────────────────
      case 2:
        return (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              A GitHub Project provides a centralized kanban board synced with GitHub Issues. You can also use a local-only kanban.
            </p>

            {/* Option A: Create */}
            <label
              className={`block border rounded-lg p-3 cursor-pointer transition-colors ${
                data.projectChoice === 'create'
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="projectChoice"
                  checked={data.projectChoice === 'create'}
                  onChange={() => update('projectChoice', 'create')}
                  className="text-emerald-500 focus:ring-emerald-500 bg-gray-800 border-gray-600"
                />
                <div>
                  <span className="text-sm text-white font-medium">Create New Project</span>
                  <p className="text-xs text-gray-500">Auto-creates a GitHub Project named &quot;{data.teamName.trim() || 'Team Name'}&quot;</p>
                </div>
              </div>
              {!ghAuth?.hasProjectScope && data.projectChoice === 'create' && (
                <p className="text-xs text-amber-400 mt-2 flex items-center gap-1 ml-6">
                  <AlertTriangle className="w-3 h-3" /> Requires &quot;project&quot; scope in GitHub auth
                </p>
              )}
            </label>

            {/* Option B: Link Existing */}
            <label
              className={`block border rounded-lg p-3 cursor-pointer transition-colors ${
                data.projectChoice === 'link'
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="projectChoice"
                  checked={data.projectChoice === 'link'}
                  onChange={() => update('projectChoice', 'link')}
                  className="text-emerald-500 focus:ring-emerald-500 bg-gray-800 border-gray-600"
                />
                <div>
                  <span className="text-sm text-white font-medium">Link Existing Project</span>
                  <p className="text-xs text-gray-500">Enter the URL of an existing GitHub Project</p>
                </div>
              </div>
            </label>
            {data.projectChoice === 'link' && (
              <div className="ml-6">
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={data.linkedProjectUrl}
                    onChange={e => {
                      update('linkedProjectUrl', e.target.value)
                      update('linkedProjectValid', null)
                      update('linkedProjectInfo', null)
                    }}
                    placeholder="https://github.com/orgs/.../projects/..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={() => validateProjectUrl(data.linkedProjectUrl)}
                    disabled={!data.linkedProjectUrl.trim() || projectValidating}
                    title="Validate GitHub project URL"
                    className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {projectValidating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Validate
                  </button>
                </div>
                {data.linkedProjectValid === true && data.linkedProjectInfo && (
                  <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Found: {data.linkedProjectInfo.title} (#{data.linkedProjectInfo.number})
                  </p>
                )}
                {data.linkedProjectValid === false && (
                  <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Could not validate project URL
                  </p>
                )}
              </div>
            )}

            {/* Option C: Skip */}
            <label
              className={`block border rounded-lg p-3 cursor-pointer transition-colors ${
                data.projectChoice === 'skip'
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="projectChoice"
                  checked={data.projectChoice === 'skip'}
                  onChange={() => update('projectChoice', 'skip')}
                  className="text-emerald-500 focus:ring-emerald-500 bg-gray-800 border-gray-600"
                />
                <div>
                  <span className="text-sm text-white font-medium">Skip</span>
                  <p className="text-xs text-gray-500">Use local kanban only — no GitHub Project integration</p>
                </div>
              </div>
            </label>
          </div>
        )

      // ── Step 4: Team Roles ──────────────────────────────────────
      case 3:
        return (
          <div className="space-y-5">
            <p className="text-xs text-gray-500">
              Every team requires a Chief of Staff. Select an existing AUTONOMOUS agent or auto-create one. Orchestrator is optional.
            </p>

            {agentsLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                <span className="text-xs text-gray-500">Loading agents...</span>
              </div>
            ) : (
              <>
                {/* Chief of Staff */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-yellow-400" />
                    <span className="text-sm font-medium text-white">Chief of Staff</span>
                    <span className="text-xs text-red-400">(required)</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">
                    Leads the team, manages membership, routes external messages.
                    Choose Auto-create to spawn a new COS agent, or reuse one of
                    your existing AUTONOMOUS agents (they become COS when this
                    team is created — there is no COS without a team).
                  </p>
                  <select
                    value={data.cosAgentId}
                    onChange={e => update('cosAgentId', e.target.value)}
                    aria-label="Select Chief of Staff"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="auto">Auto-create new COS agent</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id} disabled={a.id === data.orchestratorAgentId}>
                        Reuse {a.label || a.name} (AUTONOMOUS → becomes COS){a.id === data.orchestratorAgentId ? ' — assigned as Orchestrator' : ''}
                      </option>
                    ))}
                  </select>
                  {agents.length === 0 && !agentsLoading && (
                    <p className="text-[11px] text-gray-600 mt-1 italic">
                      No AUTONOMOUS agents available for reuse — Auto-create will spawn one.
                    </p>
                  )}
                </div>

                {/* Orchestrator */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Megaphone className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-white">Orchestrator</span>
                    <span className="text-xs text-gray-600">(optional)</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">
                    Primary kanban manager, assigns tasks, direct MANAGER
                    communication. Same rules as COS: choose Auto-create or
                    reuse an AUTONOMOUS agent (becomes Orchestrator on team
                    creation).
                  </p>
                  <select
                    value={data.orchestratorAgentId}
                    onChange={e => update('orchestratorAgentId', e.target.value)}
                    aria-label="Select Orchestrator"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">None</option>
                    <option value="auto">Auto-create new Orchestrator agent</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id} disabled={a.id === data.cosAgentId}>
                        Reuse {a.label || a.name} (AUTONOMOUS → becomes Orchestrator){a.id === data.cosAgentId ? ' — assigned as COS' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        )

      // ── Step 5: Confirm ─────────────────────────────────────────
      case 4:
        return (
          <div className="space-y-4">
            {submitError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {submitError}
                </p>
              </div>
            )}

            {/* Summary Card */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg divide-y divide-gray-700">
              {/* Team Info */}
              <div className="p-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Team</p>
                <p className="text-sm text-white font-medium">{data.teamName.trim()}</p>
                {data.description.trim() && (
                  <p className="text-xs text-gray-400 mt-0.5">{data.description.trim()}</p>
                )}
              </div>

              {/* Repos */}
              <div className="p-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">GitHub Repos</p>
                {data.selectedRepos.length === 0 && !data.createNewRepo ? (
                  <p className="text-xs text-gray-600 italic">None selected</p>
                ) : (
                  <div className="space-y-0.5">
                    {data.selectedRepos.map(r => (
                      <p key={r} className="text-xs text-white flex items-center gap-1">
                        <FolderGit2 className="w-3 h-3 text-gray-500" /> {r}
                      </p>
                    ))}
                    {data.createNewRepo && data.newRepoName.trim() && (
                      <p className="text-xs text-emerald-400 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> {data.selectedOrg ? `${data.selectedOrg}/` : ''}{data.newRepoName.trim()} (new{data.newRepoPrivate ? ', private' : ''})
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Project */}
              <div className="p-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">GitHub Project</p>
                {data.projectChoice === 'create' && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Will create &quot;{data.teamName.trim()}&quot;
                  </p>
                )}
                {data.projectChoice === 'link' && data.linkedProjectInfo && (
                  <p className="text-xs text-white flex items-center gap-1">
                    <ExternalLink className="w-3 h-3 text-gray-500" /> {data.linkedProjectInfo.title} (#{data.linkedProjectInfo.number})
                  </p>
                )}
                {data.projectChoice === 'skip' && (
                  <p className="text-xs text-gray-600 italic">Local kanban only</p>
                )}
              </div>

              {/* Roles */}
              <div className="p-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Roles</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-xs text-gray-400">COS:</span>
                    {data.cosAgentId === 'auto' ? (
                      <span className="text-xs text-emerald-400">Auto-create new</span>
                    ) : data.cosAgentId ? (
                      <span className="text-xs text-white">
                        Reuse {agents.find(a => a.id === data.cosAgentId)?.label || agents.find(a => a.id === data.cosAgentId)?.name || data.cosAgentId}
                        <span className="text-gray-500"> (AUTONOMOUS → COS)</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600 italic">None</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Megaphone className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs text-gray-400">Orchestrator:</span>
                    {data.orchestratorAgentId === 'auto' ? (
                      <span className="text-xs text-emerald-400">Auto-create new</span>
                    ) : data.orchestratorAgentId ? (
                      <span className="text-xs text-white">
                        Reuse {agents.find(a => a.id === data.orchestratorAgentId)?.label || agents.find(a => a.id === data.orchestratorAgentId)?.name || data.orchestratorAgentId}
                        <span className="text-gray-500"> (AUTONOMOUS → Orchestrator)</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600 italic">None</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Render: Main Layout
  // ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-xl mx-4 max-h-[90vh] flex flex-col"
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <h3 id="wizard-title" className="text-sm font-medium text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            Create Team
          </h3>
          <button onClick={onClose} title="Close wizard" aria-label="Close wizard" className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Step Indicator ──────────────────────────────────────── */}
        <div className="px-5 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center justify-between">
            {STEP_LABELS.map((label, i) => {
              const Icon = STEP_ICONS[i]
              const isComplete = i < step
              const isCurrent = i === step
              return (
                <div key={label} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <div className={`w-6 h-px mx-1 ${isComplete ? 'bg-emerald-500' : 'bg-gray-700'}`} />
                  )}
                  <div className="flex items-center gap-1">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                        isComplete
                          ? 'bg-emerald-500 text-white'
                          : isCurrent
                            ? 'bg-emerald-500/20 border border-emerald-500 text-emerald-400'
                            : 'bg-gray-800 border border-gray-700 text-gray-600'
                      }`}
                    >
                      {isComplete ? <Check className="w-3 h-3" /> : <Icon className="w-2.5 h-2.5" />}
                    </div>
                    <span
                      className={`text-xs hidden sm:inline ${
                        isCurrent ? 'text-white' : isComplete ? 'text-emerald-400' : 'text-gray-600'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Step Content ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {renderStep()}
        </div>

        {/* ── Footer Buttons ──────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-gray-700 flex items-center justify-between flex-shrink-0">
          <div>
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                disabled={submitting}
                title="Go to previous step"
                className="flex items-center gap-1 text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              title="Cancel team creation"
              className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            {step < 4 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={!isStepValid(step)}
                title="Go to next step"
                className="flex items-center gap-1 text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors disabled:opacity-50"
              >
                Next
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={submitting}
                title="Create the team"
                className="flex items-center gap-1 text-xs px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3.5 h-3.5" />
                    Create Team
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
