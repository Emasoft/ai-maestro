// The agent-teardown POST-CONDITION — TRDD-KERM18NX.
//
// "All-in-one" must mean *the system is left in a VALID state*, not *one entry point attempted
// everything*. `DeleteAgent` has 15 gates and 14 of them WARN-and-continue, so a partial teardown
// and a complete one produced the same success result. Worse, a store nobody wrote a gate for was
// invisible by construction: the `PersistedSession` row outlived every deleted agent until 2026-07-25,
// and because a persisted-but-absent session reads as a DEAD agent, the liveness path kept reviving
// the ghost and re-creating its workdir. No amount of care inside the gates could have caught that —
// the gate did not exist.
//
// So this module inverts the question. Instead of "did each step run?", it asks each STORE
// "do you still claim this agent?" A store is only truly torn down when it answers no, and the
// manifest below is the single place a store is registered — which is what makes a missing gate
// detectable rather than invisible.
//
// FAIL-CLOSED: a probe that throws counts as RESIDUE, never as clean. An unreadable store is
// precisely the case where we know least, and reporting it clean is the failure mode this exists
// to end.

import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** Everything a probe may need. `sessionName` is the tmux session (== agent name by convention). */
export interface TeardownContext {
  agentId: string
  agentName: string
  sessionName?: string | null
  workingDirectory?: string | null
  /** true when the caller asked for the folder to go (hard delete only). */
  expectFolderGone: boolean
  /** true when the agent was HARD-deleted (registry row removed, not tombstoned). */
  hard: boolean
}

export interface AgentStore {
  id: string
  /** What this store holds, for the residue report. */
  owns: string
  /** Return residue detail when the store STILL claims the agent, else null. */
  claims: (ctx: TeardownContext) => Promise<string | null>
}

export interface Residue {
  store: string
  owns: string
  detail: string
}

export interface TeardownVerification {
  clean: boolean
  residue: Residue[]
  /** Stores probed, for the ops log — a verification that probed nothing is not a verification. */
  probed: number
}

/**
 * THE MANIFEST — one row per store `DeleteAgent` is responsible for.
 *
 * Adding a store to the delete path means adding a row here. `tests/unit/agent-teardown.test.ts`
 * pins the id set, so a silent addition/removal fails loudly instead of quietly reopening the
 * class of bug this module exists to close.
 */
export const AGENT_STORES: AgentStore[] = [
  {
    id: 'registry',
    owns: '~/.aimaestro/agents/registry.json',
    claims: async (ctx) => {
      const { getAgent } = await import('@/lib/agent-registry')
      const a = getAgent(ctx.agentId) as { deletedAt?: string | null } | undefined
      if (!a) return null
      // A SOFT delete legitimately leaves a tombstone; only a live row is residue.
      if (ctx.hard) return 'registry row still present after a hard delete'
      return a.deletedAt ? null : 'registry row present without deletedAt (soft delete did not land)'
    },
  },
  {
    id: 'persisted-session',
    owns: '~/.aimaestro/sessions.json',
    claims: async (ctx) => {
      const { loadPersistedSessions } = await import('@/lib/session-persistence')
      const hit = loadPersistedSessions().find(
        (s) => s.id === ctx.agentName || (!!s.agentId && s.agentId === ctx.agentId),
      )
      // THE regression guard: this row outliving the agent is what resurrected deleted workdirs.
      return hit ? `PersistedSession row "${hit.id}" still present` : null
    },
  },
  {
    id: 'tmux-session',
    owns: 'the running tmux session',
    claims: async (ctx) => {
      const name = ctx.sessionName || ctx.agentName
      if (!name) return null
      const { getRuntime } = await import('@/lib/agent-runtime')
      return (await getRuntime().sessionExists(name)) ? `tmux session "${name}" still running` : null
    },
  },
  {
    id: 'teams',
    owns: '~/.aimaestro/teams/teams.json (membership + COS/orchestrator slots)',
    claims: async (ctx) => {
      const { loadTeams } = await import('@/lib/team-registry')
      const hits = loadTeams()
        .filter(
          (t) =>
            (t.agentIds || []).includes(ctx.agentId) ||
            t.chiefOfStaffId === ctx.agentId ||
            (t as { orchestratorId?: string }).orchestratorId === ctx.agentId,
        )
        .map((t) => t.name)
      return hits.length ? `still referenced by team(s): ${hits.join(', ')}` : null
    },
  },
  {
    id: 'groups',
    owns: '~/.aimaestro/teams/groups.json (subscriptions)',
    claims: async (ctx) => {
      const { loadGroups } = await import('@/lib/group-registry')
      const hits = loadGroups()
        .filter((g) => (g.subscriberIds || []).includes(ctx.agentId))
        .map((g) => g.name)
      return hits.length ? `still subscribed to group(s): ${hits.join(', ')}` : null
    },
  },
  {
    id: 'amp-keys',
    owns: '~/.aimaestro/amp-api-keys.json',
    claims: async (ctx) => {
      const { getKeysForAgent } = await import('@/lib/amp-auth')
      const n = getKeysForAgent(ctx.agentId).length
      return n ? `${n} AMP API key(s) still issued` : null
    },
  },
  {
    id: 'aid-tokens',
    owns: '~/.aimaestro/governance-tokens/active-tokens.json',
    claims: async (ctx) => {
      const { countTokensForAgent } = await import('@/lib/aid-token')
      const n = countTokensForAgent(ctx.agentId)
      return n ? `${n} AID governance token(s) still active` : null
    },
  },
  {
    id: 'governance-requests',
    owns: '~/.aimaestro/governance-requests.json (pending queue)',
    claims: async (ctx) => {
      const { loadGovernanceRequests } = await import('@/lib/governance-request-registry')
      const file = loadGovernanceRequests()
      const reqs = (file?.requests || []) as unknown as Array<Record<string, unknown>>
      const n = reqs.filter(
        (r) =>
          r.status === 'pending' &&
          (r.agentId === ctx.agentId || r.requestingAgentId === ctx.agentId || r.targetAgentId === ctx.agentId),
      ).length
      return n ? `${n} pending governance request(s)` : null
    },
  },
  {
    id: 'workdir',
    owns: 'the agent working directory',
    claims: async (ctx) => {
      if (!ctx.expectFolderGone || !ctx.workingDirectory) return null
      // G03-SAFETY refuses to delete a workdir outside ~/agents/, and that refusal is CORRECT for an
      // adopted folder (~/Code/<project>) — so it is not residue, it is policy. Only a folder the
      // pipeline was actually responsible for counts.
      const managedRoot = join(homedir(), 'agents') + '/'
      if (!ctx.workingDirectory.startsWith(managedRoot)) return null
      return existsSync(ctx.workingDirectory) ? `workdir still on disk: ${ctx.workingDirectory}` : null
    },
  },
  {
    id: 'transcript-dir',
    owns: '~/.claude/projects/<workdir-slug>/ (chat transcripts)',
    claims: async (ctx) => {
      if (!ctx.expectFolderGone || !ctx.workingDirectory) return null
      const managedRoot = join(homedir(), 'agents') + '/'
      if (!ctx.workingDirectory.startsWith(managedRoot)) return null
      const slug = ctx.workingDirectory.replace(/[^a-zA-Z0-9]/g, '-')
      const dir = join(homedir(), '.claude', 'projects', slug)
      return existsSync(dir) ? `transcript dir still on disk: ${dir}` : null
    },
  },
]

/**
 * Ask every store whether it still claims the agent.
 *
 * Never throws: a probe that fails is reported as residue (fail-closed) so an unreadable store can
 * never be mistaken for a clean one.
 */
export async function verifyAgentRemoved(ctx: TeardownContext): Promise<TeardownVerification> {
  const residue: Residue[] = []
  for (const store of AGENT_STORES) {
    try {
      const detail = await store.claims(ctx)
      if (detail) residue.push({ store: store.id, owns: store.owns, detail })
    } catch (err) {
      residue.push({
        store: store.id,
        owns: store.owns,
        detail: `probe failed (treated as residue): ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  return { clean: residue.length === 0, residue, probed: AGENT_STORES.length }
}

/** One-line ops summary for the pipeline log. */
export function formatVerification(v: TeardownVerification): string {
  if (v.clean) return `verified clean across ${v.probed} store(s)`
  return `INCOMPLETE — ${v.residue.length}/${v.probed} store(s) still claim the agent: ${v.residue
    .map((r) => `${r.store} (${r.detail})`)
    .join('; ')}`
}
