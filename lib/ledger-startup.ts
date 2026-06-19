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
]

let _readOnlyMode = false
let _tamperDetails: string | null = null
// R33: the file store must be rebuilt from the (host-signed) portfolio ledger
// exactly ONCE per process — at startup. verifyAllLedgers also runs on every
// /api/system/ledger-health hit, so this guard keeps recovery a boot-only act
// and prevents a per-request overwrite of the live portfolio files.
let _portfoliosReconstructed = false

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

  return { ok: allOk, details }
}
