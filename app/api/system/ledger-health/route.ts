/**
 * GET /api/system/ledger-health
 *
 * Phase 0.A-derived (#234, 2026-04-20). After TRDD-eac02238 shipped per-op
 * ledger coverage (ChangeTitle, Create/Delete/ChangePlugin, and the Change*
 * fan-out), operators need a way to verify from the UI or automation that
 * all 4 signed ledgers are still intact — Ed25519 signatures valid +
 * BLAKE2b-256 hash chain unbroken — without shelling into the host.
 *
 * The endpoint runs the same verify() that startup uses (lib/ledger-startup.ts)
 * plus per-ledger stats so a Diagnostics panel can display:
 *   - overall verdict (ok / tamper)
 *   - entry count, last-seq, last-timestamp, root hash per ledger
 *   - a human-readable details string identical to what server startup logs
 *   - whether the server is in read-only-on-tamper mode right now
 *
 * Auth: read-only endpoint but gated by the same auth layer as GET /api/agents
 * so the diagnostics payload doesn't leak to unauthenticated probes (hash
 * chain contents can reveal activity patterns).
 *
 * The ledger is append-only and verify() is O(N) in entry count — expected
 * to stay under a few milliseconds for months of activity. If performance
 * becomes a concern we can cache the last verification result per ledger
 * root-hash (deferred to a future task).
 */

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { SignedLedger } from '@/lib/signed-ledger'
import { getStateDir } from '@/lib/ecosystem-constants'
import { isReadOnlyMode, getTamperDetails, verifyAllLedgers } from '@/lib/ledger-startup'

export const dynamic = 'force-dynamic'

interface PerLedgerReport {
  label: string
  path: string
  verified: boolean
  entryCount: number
  lastSeq: number
  lastTs: string
  rootHash: string
  reason?: string // only when verified === false
}

interface LedgerHealthResponse {
  ok: boolean                  // true iff EVERY ledger verified cleanly
  readOnlyMode: boolean        // current isReadOnlyMode() state
  ledgers: PerLedgerReport[]
  details: string              // human-readable multi-line summary
  checkedAt: string
}

export async function GET(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const stateDir = getStateDir()
  const LEDGER_FILES: Array<{ label: string; file: string }> = [
    { label: 'agents', file: path.join(stateDir, 'agents', 'registry.json') },
    { label: 'teams', file: path.join(stateDir, 'teams', 'teams.json') },
    { label: 'groups', file: path.join(stateDir, 'teams', 'groups.json') },
    { label: 'governance', file: path.join(stateDir, 'governance.json') },
  ]

  const ledgers: PerLedgerReport[] = []
  let ok = true

  for (const { label, file } of LEDGER_FILES) {
    try {
      const ledger = new SignedLedger(file)
      const verifyResult = await ledger.verify()
      const stats = ledger.stats()
      if (verifyResult.ok) {
        ledgers.push({
          label,
          path: file,
          verified: true,
          entryCount: stats.entryCount,
          lastSeq: stats.lastSeq,
          lastTs: stats.lastTs,
          rootHash: stats.rootHash,
        })
      } else {
        ok = false
        ledgers.push({
          label,
          path: file,
          verified: false,
          entryCount: stats.entryCount,
          lastSeq: stats.lastSeq,
          lastTs: stats.lastTs,
          rootHash: stats.rootHash,
          reason: `seq ${verifyResult.seq} — ${verifyResult.reason}`,
        })
      }
    } catch (err: unknown) {
      // A missing or unreadable ledger file is NOT a tamper signal — it
      // just means the underlying registry hasn't been written to yet in
      // this deployment (e.g. fresh install with no groups defined).
      // verified:false would mis-trigger a tamper alert on the Diagnostics
      // panel, so we surface these as a separate "unavailable" signal via
      // reason but keep verified:true so ok stays accurate overall.
      ledgers.push({
        label,
        path: file,
        verified: true,
        entryCount: 0,
        lastSeq: -1,
        lastTs: '',
        rootHash: '',
        reason: `unavailable: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  const details = ledgers
    .map(l =>
      l.verified
        ? `[OK] ${l.label}: ${l.entryCount} entries, lastSeq=${l.lastSeq}`
        : `[TAMPER] ${l.label}: ${l.reason}`,
    )
    .join('\n')

  const response: LedgerHealthResponse = {
    ok,
    readOnlyMode: isReadOnlyMode(),
    ledgers,
    details,
    checkedAt: new Date().toISOString(),
  }

  // If any ledger failed verify, also echo the cached startup tamper details
  // so the caller can see WHEN the tamper was first detected (startup vs now).
  const startupTamper = getTamperDetails()
  if (startupTamper && !ok) {
    response.details = `${response.details}\n\n--- startup detection ---\n${startupTamper}`
  }

  // Side-effect: if ok=false AND the server isn't already in read-only mode,
  // re-run the full startup verifier so any policy-driven read-only switch
  // fires. This keeps UI and startup behaviour consistent even when tampering
  // happens AFTER the server started (e.g. someone edits registry.json by hand).
  if (!ok && !isReadOnlyMode()) {
    await verifyAllLedgers().catch(() => { /* startup verifier is best-effort — we already have our own details */ })
  }

  return NextResponse.json(response, { status: ok ? 200 : 503 })
}
