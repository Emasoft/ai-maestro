/**
 * GET /api/governance/users — list human users (R36/R37/R38).
 *
 * Returns the active (non-soft-deleted) user records so the UI can render the
 * MAESTRO-DELEGATE picker (and, later, the user-management surface). MAESTRO-
 * only: the user roster is admin information, so it is gated behind
 * enforceMaestro (the active MAESTRO under the model; the legacy system owner
 * when the model is off).
 *
 * Sensitive fields are NEVER returned: `passwordHash` is stripped. The AID is
 * a public fingerprint (R36.1) so it is safe to include for identification.
 *
 * USER CREATION (POST) is MAESTRO-only and is intentionally NOT implemented in
 * this item — it belongs to the ASSISTANT auto-create sibling TRDD (R39). Only
 * the read endpoint the delegate-handoff UI needs ships here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceMaestro } from '@/lib/route-auth'
import { isUserAuthorityModelEnabled } from '@/lib/governance'
import { loadUsers } from '@/lib/user-registry'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authErr = enforceMaestro(request)
  if (authErr) return authErr

  // With the model off there is no user roster — return an empty list rather
  // than leaking the (single, anonymous) legacy operator as a fake user.
  if (!isUserAuthorityModelEnabled()) {
    return NextResponse.json({ users: [], modelEnabled: false })
  }

  try {
    const users = loadUsers()
      .filter(u => !u.deletedAt)
      .map(u => ({
        id: u.id,
        aid: u.aid,
        name: u.name,
        avatar: u.avatar,
        title: u.title,
        native: u.native,
        homeHostId: u.homeHostId,
        assistantAgentId: u.assistantAgentId,
        approvedByMaestroAt: u.approvedByMaestroAt,
        createdAt: u.createdAt,
        // passwordHash and passwordSetAt are deliberately omitted.
      }))
    return NextResponse.json({ users, modelEnabled: true })
  } catch (error) {
    return internalError(error, 'governance-users-list')
  }
}
