// The ROTATE actuator (TRDD-1GGQ4HWY Phase E.2) — swap the live account to a slot's credential.
//
// ⚠️ R16: switchLiveTo calls writeLiveBlob (THE irreversible write against `Claude Code-credentials`).
// Ported as INFRA, NOT wired to any tick/route — the first LIVE run needs the USER checkpoint.
//
// FAITHFUL port of rotator.py's `_switch_blob`. The MERGE is the load-bearing part: a slot is a
// `{ claudeAiOauth }`-only blob (mcpOAuth stripped by writeSlot), so a rotation must replace ONLY
// the `claudeAiOauth` section of the CURRENT live blob and PRESERVE the user's live `mcpOAuth` (+
// any other live top-level keys) — else rotating would wipe the MCP-server OAuth tokens. fingerprint()
// keys off the accessToken inside claudeAiOauth, so the merged live blob and the slot share the same
// fp (state stays consistent). The rotator AUTHORED the write, so it stamps the F1/F2 identity beacon
// with certainty — even in a context that cannot read the primary back.

import { writeLiveBlob, readLiveBlob } from './live'
import { loadState, saveState, fingerprint, rotatorRoot, type CredentialBlob } from './slots'
import { atomicWriteBytes } from './integrity'
import * as path from 'path'

/** The session-context ground-truth beacon path (ROOT/live-identity.json). */
function liveIdentityPath(): string {
  return path.join(rotatorRoot(), 'live-identity.json')
}

/**
 * ⚠️ R16 — swap the live account to `blob`'s credential and record the switch in state. Merges the
 * slot's `claudeAiOauth` into the current live blob (preserving live `mcpOAuth`), then
 * {@link writeLiveBlob}. Records live_email / live_fp / last_switch_at / last_switch_reason and
 * resets live_429_streak. Stamps the identity beacon (best-effort). DO NOT run against the real
 * credential without the R16 USER checkpoint.
 */
export function switchLiveTo(email: string, blob: CredentialBlob, reason: string): void {
  const cred = (blob && typeof blob === 'object' ? (blob as Record<string, unknown>).claudeAiOauth : undefined)
  if (cred && typeof cred === 'object') {
    const live = readLiveBlob() ?? {}
    const merged: Record<string, unknown> = { ...live }
    merged.claudeAiOauth = cred // replace ONLY claudeAiOauth — keep the live mcpOAuth + other keys
    writeLiveBlob(merged)
  } else {
    writeLiveBlob(blob) // degenerate slot (no claudeAiOauth) — write as-is
  }
  const state = loadState()
  state.live_email = email
  state.live_fp = fingerprint(blob)
  state.last_switch_at = Date.now() / 1000 // seconds — matches Python time.time()
  state.last_switch_reason = reason
  state.live_429_streak = 0 // a new live account starts with a clean debounce slate
  saveState(state)
  // F2: the rotator authored this live write, so it knows the identity with certainty — stamp the
  // beacon directly. Best-effort observability side-channel; never fail a switch over it.
  try {
    const payload = JSON.stringify({ fp: fingerprint(blob), email, ts: Date.now() / 1000 })
    atomicWriteBytes(liveIdentityPath(), Buffer.from(payload, 'utf8'), 0o600)
  } catch {
    // best-effort
  }
}
