import path from 'path'
import { SignedLedger } from '@/lib/signed-ledger'
import { getStateDir } from '@/lib/ecosystem-constants'
import { loadSecurityConfig } from '@/lib/security-config'

const AIMAESTRO_DIR = getStateDir()

const LEDGER_PATHS = [
  path.join(AIMAESTRO_DIR, 'agents', 'registry.json'),
  path.join(AIMAESTRO_DIR, 'teams', 'teams.json'),
  path.join(AIMAESTRO_DIR, 'teams', 'groups.json'),
  path.join(AIMAESTRO_DIR, 'governance.json'),
  // R28/R34: the portfolio (secure-enclave) audit chain. Verified at boot so a
  // tampered portfolio ledger is caught alongside the others; the live file
  // store is then rebuilt from this chain (R33) — see the reconstruct call in
  // verifyAllLedgers below. The SignedLedger constructor derives the actual
  // file name (portfolios.ledger.json) from this virtual registry path.
  path.join(AIMAESTRO_DIR, 'agents', 'portfolios', 'portfolios.json'),
  // R34.2/R35/R40: the foreign-approval queue is host-signed (lib/foreign-
  // approval-registry.ts) — boot-verify it so a tampered approval file is
  // caught. The SignedLedger derives foreign-approvals.ledger.json from this.
  path.join(AIMAESTRO_DIR, 'foreign-approvals.json'),
  // R34/R36: the human-directory chain (lib/human-directory.ts) records user
  // AIDs and the foreign_user_grant/revoke ops (R40.2). Boot-verify it too so a
  // tampered humans.json (which can hold a foreign user's approval state) is
  // caught alongside the rest. Derives humans.ledger.json from this path.
  path.join(AIMAESTRO_DIR, 'humans.json'),
]

let _readOnlyMode = false
let _tamperDetails: string | null = null
// R33: the file store must be rebuilt from the (host-signed) portfolio ledger
// exactly ONCE per process — at startup. verifyAllLedgers also runs on every
// /api/system/ledger-health hit, so this guard keeps recovery a boot-only act
// and prevents a per-request overwrite of the live portfolio files.
let _portfoliosReconstructed = false
// R34.1: the one-time AID-association backfill must run at most ONCE per process
// and ONLY on a clean verify. verifyAllLedgers is hit on every health-check, so
// this guard keeps the backfill a boot-only act.
let _aidAssociationsBackfilled = false

export function isReadOnlyMode(): boolean {
  return _readOnlyMode
}

export function getTamperDetails(): string | null {
  return _tamperDetails
}

export async function verifyAllLedgers(): Promise<{ ok: boolean; details: string }> {
  const results: string[] = []
  let allOk = true

  for (const registryPath of LEDGER_PATHS) {
    const ledger = new SignedLedger(registryPath)
    const label = path.basename(registryPath)

    try {
      const result = await ledger.verify()
      if (result.ok) {
        const stats = ledger.stats()
        results.push(`[OK] ${label}: ${stats.entryCount} entries verified`)
      } else {
        allOk = false
        results.push(`[TAMPER] ${label}: seq ${result.seq} — ${result.reason}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push(`[SKIP] ${label}: ${msg}`)
    }
  }

  const details = results.join('\n')

  if (!allOk) {
    const cfg = loadSecurityConfig()
    if (cfg.ledger.readOnlyOnTamper) {
      _readOnlyMode = true
    }
    _tamperDetails = details
    console.error('[SECURITY] Ledger verification FAILED' + (_readOnlyMode ? ' — entering read-only mode' : ''))
    console.error(details)
  } else {
    console.log('[SECURITY] All ledger chains verified')
  }

  // R33 — rebuild the portfolio file store from its host-signed ledger, ONCE
  // per process and ONLY when all chains verified clean (never reconstruct from
  // a tampered chain). Best-effort: a failure here must not block startup or a
  // health-check; the live files simply keep their current contents.
  if (allOk && !_portfoliosReconstructed) {
    _portfoliosReconstructed = true
    try {
      const { reconstructPortfoliosFromLedger } = await import('@/lib/portfolio-ledger')
      const rebuilt = await reconstructPortfoliosFromLedger()
      if (rebuilt > 0) {
        console.log(`[SECURITY] Portfolio store reconstructed from ledger (${rebuilt} subject file(s))`)
      }
    } catch (err) {
      console.warn('[SECURITY] Portfolio store reconstruction skipped:', err instanceof Error ? err.message : err)
    }
  }

  // R34.1 — backfill aid_associate entries for pre-existing agents, ONCE per
  // process and ONLY on a CLEAN verify (Risk R8: never bless a tampered
  // registry) and NOT in read-only mode (Risk R7: no writes while tampered).
  // This is what makes flipping enforceAidAssociation ON safe — every legit
  // agent already has a signed association, so nobody is locked out (Risk R1).
  // recordAidAssociation is cache-deduped, so re-running across restarts adds no
  // duplicate rows. Best-effort: a failure must not block startup.
  if (allOk && !_readOnlyMode && !_aidAssociationsBackfilled) {
    _aidAssociationsBackfilled = true
    try {
      const backfilled = await backfillAidAssociations()
      if (backfilled > 0) {
        console.log(`[SECURITY] AID associations backfilled from registry (${backfilled} agent(s))`)
      }
    } catch (err) {
      console.warn('[SECURITY] AID-association backfill skipped:', err instanceof Error ? err.message : err)
    }
  }

  return { ok: allOk, details }
}

/**
 * R34.1 one-time backfill — emit an aid_associate for every non-deleted agent
 * that already has a metadata.amp.fingerprint but no ledger association yet.
 * Idempotent at the cache level (recordAidAssociation dedupes), so safe to call
 * across restarts. Returns the number of agents for which an association was
 * (re)recorded. Callers MUST only invoke this on a clean verify (see the gate in
 * verifyAllLedgers) — this function does NOT re-check tamper state itself, to
 * keep it independently testable.
 */
export async function backfillAidAssociations(): Promise<number> {
  const { loadAgents } = await import('@/lib/agent-registry')
  const { recordAidAssociation } = await import('@/lib/aid-ledger-authority')
  const { getSelfHostId } = await import('@/lib/hosts-config')
  const hostId = getSelfHostId()
  let count = 0
  for (const agent of loadAgents()) {
    if (agent.deletedAt) continue
    const fp = (agent.metadata?.amp as Record<string, unknown> | undefined)?.fingerprint as string | undefined
    if (!fp) continue
    recordAidAssociation(agent.id, fp, hostId, { backfill: true, actor: 'system' })
    count++
  }
  return count
}
