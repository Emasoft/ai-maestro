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
]

let _readOnlyMode = false
let _tamperDetails: string | null = null

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

  return { ok: allOk, details }
}
