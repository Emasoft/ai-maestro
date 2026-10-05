// Read-only detector: a team's chief-of-staff / orchestrator slot that names an id which is no
// longer a live agent. New values are validated on write, but an already-seated id that is later
// soft-deleted or removed from the registry stays forever and silently — and these two slots are
// the trust anchor of every chair/orchestrator grant. Pure: it never modifies anything.

export type TeamSlot = 'chief-of-staff' | 'orchestrator'

export interface TeamSlotFinding {
  teamId: string
  teamName: string
  slot: TeamSlot
  danglingId: string
  reason: 'unknown' | 'soft-deleted'
}

interface SlotTeam {
  id: string
  name: string
  chiefOfStaffId?: string | null
  orchestratorId?: string | null
}

/** `lookup` must see soft-deleted agents (e.g. `getAgent(id, true)`); a hit with `deletedAt`
 *  is reported as soft-deleted, a null as unknown. */
export function findDanglingTeamSlots(
  teams: readonly SlotTeam[],
  lookup: (id: string) => { deletedAt?: string } | null,
): TeamSlotFinding[] {
  const out: TeamSlotFinding[] = []
  for (const t of teams) {
    const slots: [TeamSlot, string | null | undefined][] = [
      ['chief-of-staff', t.chiefOfStaffId],
      ['orchestrator', t.orchestratorId],
    ]
    for (const [slot, id] of slots) {
      if (!id) continue
      const a = lookup(id)
      if (!a) out.push({ teamId: t.id, teamName: t.name, slot, danglingId: id, reason: 'unknown' })
      else if (a.deletedAt) out.push({ teamId: t.id, teamName: t.name, slot, danglingId: id, reason: 'soft-deleted' })
    }
  }
  return out
}
