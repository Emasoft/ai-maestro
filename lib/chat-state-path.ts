/**
 * THE ONE resolver from an agent's working directory to the hook's chat-state file
 * (`~/.aimaestro/chat-state/<cwd-hash>.json`, written by ai-maestro-plugin's `ai-maestro-hook.cjs`).
 *
 * WHY THIS MODULE EXISTS (measured 2026-08-19, TRDD-O8NCNRWO live e2e): the server carried THREE
 * private copies of the hook's `hashCwd` — `services/agents-chat-service.ts`,
 * `services/sessions-service.ts`, `lib/session-safe-state.ts` — each `md5(cwd)[:16]`. The hook
 * switched to `sha256(cwd)[:16]` on 2026-05-08 (ai-maestro-plugin 14dc9a5, audit INFO-02) and every
 * installed hook version since (2.11.0 → 3.1.26) writes sha256, so for THREE MONTHS all three readers
 * opened a file that does not exist and returned "no state": the stop/restart subagent gate
 * (`readSubagentCount`) was inert, the chat endpoint's hook status was always null, and
 * `getHookState` saw nothing. A comment on each copy said "Mirror of the hook's cwd hashing" — a
 * mirror nobody polished. Three copies of a foreign algorithm is three places to go stale at once.
 *
 * THE FIX IS TO STOP MIRRORING THE ALGORITHM: the hook PUBLISHES its own mapping,
 * `chat-state/index.json` (`{ [cwd]: hash }`, rewritten atomically on every writeState). Read that —
 * it is right by construction whatever the hook hashes with — and derive `sha256(cwd)[:16]` only
 * for a cwd the index has not seen yet (a brand-new agent before its first hook event, whose state
 * file does not exist either way). No md5 fallback: an md5-era file is a pre-May-2026 relic and
 * reading it would resurrect stale state as current.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { statePath } from '@/lib/ecosystem-constants'

/** Same derivation as the installed hook (`ai-maestro-hook.cjs::hashCwd`, sha256 since 2026-05-08). */
export function hashCwdLikeHook(cwd: string): string {
  return crypto.createHash('sha256').update(cwd || '').digest('hex').substring(0, 16)
}

/**
 * Absolute path of the chat-state file for `workingDir`: the hook's published index first, the
 * sha256 derivation second. Pure path resolution — never creates anything, never throws.
 * `stateDir` is injectable for tests (0-IMPACT: never the developer's real dir).
 */
export function chatStateFileFor(workingDir: string, stateDir: string = statePath('chat-state')): string {
  let hash: string | undefined
  try {
    const index = JSON.parse(fs.readFileSync(path.join(stateDir, 'index.json'), 'utf8')) as unknown
    const fromIndex = (index as Record<string, unknown> | null)?.[workingDir]
    if (typeof fromIndex === 'string' && /^[0-9a-f]{16}$/.test(fromIndex)) hash = fromIndex
  } catch {
    // no index yet / unreadable → derive
  }
  return path.join(stateDir, `${hash ?? hashCwdLikeHook(workingDir)}.json`)
}
