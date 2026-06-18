/**
 * Portfolio audit chain (R28 / R34 anchor).
 *
 * A SEPARATE host-signed SignedLedger so portfolio history is its own
 * auditable chain and does NOT pollute the agent-registry ledger. The
 * constructor derives `portfolios.ledger.json` (lock `ledger:portfolios`)
 * from the virtual registry path `…/agents/portfolios/portfolios.json`.
 *
 * Unlike `emitAgentOp` (fire-and-forget against the registry ledger), the
 * ISSUE path must AWAIT and READ BACK the entry's `seq` — the freshly minted
 * token records that seq as its `ledger_seq` (R34 anchor), and
 * `checkPortfolioToken` later refuses any token whose `ledger_seq` does not
 * resolve to a real `issue_portfolio_token` entry. consume/revoke ops are
 * fire-and-forget (audit-only; they don't gate anything).
 */

import path from 'path'
import { SignedLedger } from '@/lib/signed-ledger'
import { statePath } from '@/lib/ecosystem-constants'
import type { JsonPatch } from '@/types/json-patch'
import type { LedgerOp, LedgerActor } from '@/types/ledger'
import type { PortfolioToken } from '@/types/portfolio'
import type { EmitAuthContext } from '@/lib/ledger-emit'

/** The virtual registry path the portfolio ledger anchors to. */
export const PORTFOLIO_LEDGER_REGISTRY_PATH = statePath('agents', 'portfolios', 'portfolios.json')

/** Lazily-constructed singleton so tests can resetModules cleanly. */
let _ledger: SignedLedger | null = null
function portfolioLedger(): SignedLedger {
  if (!_ledger) _ledger = new SignedLedger(PORTFOLIO_LEDGER_REGISTRY_PATH)
  return _ledger
}

type PortfolioLedgerOp =
  | 'issue_portfolio_token'
  | 'consume_portfolio_token'
  | 'revoke_portfolio_token'

/**
 * Append a portfolio op to the dedicated chain and return its `seq`.
 *
 * AWAIT this for the ISSUE op (the seq is the R34 anchor written back onto the
 * token). consume/revoke callers may ignore the returned promise. Returns null
 * if the append throws (audit gap is logged; never crashes the caller).
 */
export async function emitPortfolioOp(
  op: PortfolioLedgerOp,
  tokenId: string,
  diff: JsonPatch,
  auth?: EmitAuthContext,
): Promise<number | null> {
  const opts = auth
    ? {
        authAction: auth.action,
        authAgentId: auth.agentId ?? undefined,
        authActor: auth.actor as LedgerActor | undefined,
      }
    : undefined
  try {
    const entry = await portfolioLedger().append(
      op as LedgerOp,
      PORTFOLIO_LEDGER_REGISTRY_PATH,
      diff,
      opts,
    )
    return entry.seq
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[portfolio-ledger] AUDIT GAP: ${op} for token ${tokenId} NOT recorded: ${msg}`,
    )
    return null
  }
}

/** Build the canonical ISSUE diff (carries the full token so R33 can replay). */
export function issueDiff(token: PortfolioToken): JsonPatch {
  return [
    {
      op: 'add',
      path: `/portfolios/${token.subject_agent_id}/${token.token_id}`,
      value: token as unknown,
    },
  ]
}

/** Build the canonical CONSUME diff. */
export function consumeDiff(token: PortfolioToken, usesRemaining: number): JsonPatch {
  return [
    {
      op: 'replace',
      path: `/portfolios/${token.subject_agent_id}/${token.token_id}/uses_remaining`,
      value: usesRemaining,
    },
  ]
}

/** Build the canonical REVOKE diff. */
export function revokeDiff(token: PortfolioToken): JsonPatch {
  return [
    {
      op: 'replace',
      path: `/portfolios/${token.subject_agent_id}/${token.token_id}/status`,
      value: 'revoked',
    },
  ]
}

/**
 * R34 anchor check: does an `issue_portfolio_token` entry with the given seq
 * record the given tokenId? A token whose `ledger_seq` does not resolve to a
 * real issue entry (i.e. written straight to the JSON file with no chained,
 * host-signed entry) is untrusted.
 */
export async function ledgerHasIssue(tokenId: string, seq: number): Promise<boolean> {
  const entries = portfolioLedger().getEntries()
  for (const e of entries) {
    if (e.seq !== seq) continue
    if (e.op !== 'issue_portfolio_token') return false
    // The diff path embeds the token id; match it to bind seq↔token.
    return diffMentionsToken(e.diff, tokenId)
  }
  return false
}

function diffMentionsToken(diff: JsonPatch, tokenId: string): boolean {
  for (const patch of diff) {
    if ('path' in patch && typeof patch.path === 'string' && patch.path.endsWith(`/${tokenId}`)) {
      return true
    }
    // The issue diff's add path is `…/<subject>/<token_id>` (the token id is
    // the LAST segment), but consume/revoke append a trailing field segment.
    if ('path' in patch && typeof patch.path === 'string' && patch.path.includes(`/${tokenId}/`)) {
      return true
    }
  }
  return false
}

/**
 * R33 recovery: replay the host-signed portfolio ledger to rebuild the live
 * file store. For each token: ISSUE creates it, CONSUME decrements
 * uses_remaining (flip consumed at 0), REVOKE flips status, and any token past
 * its expiry is flipped to expired. The reconstructed per-subject token lists
 * overwrite the on-disk files (the ledger is the ultimate truth). Returns the
 * number of subject files rewritten.
 */
export async function reconstructPortfoliosFromLedger(): Promise<number> {
  const entries = portfolioLedger().getEntries()
  // token_id → reconstructed token
  const tokens = new Map<string, PortfolioToken>()

  for (const e of entries) {
    if (e.op === 'issue_portfolio_token') {
      for (const patch of e.diff) {
        if (patch.op === 'add' && 'value' in patch && patch.value && typeof patch.value === 'object') {
          const tok = patch.value as PortfolioToken
          if (tok.token_id) {
            // Anchor the replayed token to the entry's own seq (R34).
            tokens.set(tok.token_id, { ...tok, ledger_seq: e.seq })
          }
        }
      }
    } else if (e.op === 'consume_portfolio_token') {
      for (const patch of e.diff) {
        if (patch.op === 'replace' && typeof patch.path === 'string') {
          const tokenId = extractTokenIdFromFieldPath(patch.path)
          const tok = tokenId ? tokens.get(tokenId) : undefined
          if (tok && typeof patch.value === 'number') {
            const remaining = patch.value
            tokens.set(tok.token_id, {
              ...tok,
              uses_remaining: remaining,
              status: remaining <= 0 ? 'consumed' : tok.status,
            })
          }
        }
      }
    } else if (e.op === 'revoke_portfolio_token') {
      for (const patch of e.diff) {
        if (patch.op === 'replace' && typeof patch.path === 'string') {
          const tokenId = extractTokenIdFromFieldPath(patch.path)
          const tok = tokenId ? tokens.get(tokenId) : undefined
          if (tok) tokens.set(tok.token_id, { ...tok, status: 'revoked' })
        }
      }
    }
  }

  // Apply expiry as of now.
  const now = Date.now()
  for (const [id, tok] of tokens) {
    if (
      tok.status === 'active' &&
      tok.expires_at !== null &&
      new Date(tok.expires_at).getTime() <= now
    ) {
      tokens.set(id, { ...tok, status: 'expired' })
    }
  }

  // Group by subject and overwrite the live store.
  const bySubject = new Map<string, PortfolioToken[]>()
  for (const tok of tokens.values()) {
    const list = bySubject.get(tok.subject_agent_id) ?? []
    list.push(tok)
    bySubject.set(tok.subject_agent_id, list)
  }

  if (bySubject.size === 0) return 0
  const { replaceAllPortfolios } = await import('@/lib/portfolio-store')
  return replaceAllPortfolios(bySubject)
}

/**
 * A consume/revoke diff path looks like
 *   /portfolios/<subject>/<token_id>/<field>
 * Return the <token_id> segment (the second-to-last), or undefined.
 */
function extractTokenIdFromFieldPath(p: string): string | undefined {
  const segs = p.split('/').filter(Boolean) // ['portfolios','<subject>','<token_id>','<field>']
  if (segs.length >= 4 && segs[0] === 'portfolios') return segs[segs.length - 2]
  return undefined
}

/** Test-only: drop the singleton so a fresh fs/resetModules state is re-read. */
export function _resetPortfolioLedgerForTests(): void {
  _ledger = null
}
