/**
 * TRDD approval ⟷ portfolio token — the binding that makes R41 true (ai-maestro#47).
 *
 * THE PROBLEM. R41 calls an APPROVAL and a MANDATE "signed, verifiable, binding".
 * Authorization was real (`manage-trdd` refuses an under-authorized approver, and
 * no one may approve their own proposal). But the RECORD of the decision was a
 * line of prose:
 *
 *     - 2026-07-10T… — APPROVED by amama-manager (min-approval-requirement: manager).
 *
 * in a git-tracked file. Auditable — and typeable by anyone with repo write. An
 * agent handed a mandate could not tell an authority's command from a peer's
 * invention. It simply believed the file. That is the hole this module closes.
 *
 * THE BINDING. When an authority approves a card, the server mints a portfolio
 * token (R28): host-signed with Ed25519, anchored in the host-signed ledger (R34),
 * scoped `trdd:approve`, and PINNED to that card's id. The token id goes into the
 * card's frontmatter as `approval-token:` (or `mandate-token:`). The prose line
 * STAYS — it is the human trail. It just stops being the only evidence.
 *
 * WHOSE ENCLAVE HOLDS IT. The APPROVER's. The token is not a capability handed to
 * a worker; it is the authority's signed statement *"I approved card X"* — a
 * receipt. So verification asks the server the question the card cannot answer for
 * itself: does the authority actually hold a host-signed, ledger-anchored approval
 * pinned to THIS card, and did it hold the required title when it minted it?
 *
 * WHY THE VERIFIER IGNORES `approval-judge:`. That field names who decided — and it
 * is in the file, so a forger rewrites it for free. The verifier therefore takes
 * only the token ID from the card and derives WHO approved from the SIGNED TOKEN.
 * The file may lie about the approver; the token cannot.
 *
 * WHAT THIS DOES NOT PROVE (and must not be described as proving). The token binds
 * an approval to a card's IDENTITY, not to its CONTENT. An attacker with repo write
 * can still edit the card's body after approval, and this verifier will still say
 * the approval is authentic — because it is: that authority did approve that card.
 * Freezing the content needs a digest of the card inside the token, which is what
 * `attestation_ref` is reserved for and is a separate, deliberate piece of work.
 * Overstating this is worse than not shipping it: an agent that believes a verified
 * approval also vouches for the body would obey a rewritten card.
 */

import type { AuthContext } from '@/lib/agent-auth'
import type { PortfolioToken, PortfolioIssuerTitle, PortfolioTokenKind } from '@/types/portfolio'
import { SYSTEM_OWNER_ISSUER } from '@/types/portfolio'
import { signPortfolioToken } from '@/lib/portfolio-sign'
import { issueToken, setLedgerSeq, findTokenAnywhere, revokeToken } from '@/lib/portfolio-store'
import { emitPortfolioOp, issueDiff } from '@/lib/portfolio-ledger'
import { explainPortfolioToken, type PortfolioVerdict } from '@/lib/portfolio-check'
import { TRDD_AUTHORITY } from '@/lib/authorization'
import { readMinApproval } from '@/lib/trdd-authz'
import { readTrdd } from '@/lib/trdd-store'
import { randomUUID } from 'crypto'
import fs from 'fs'

/** The scope every TRDD approval/mandate token carries. */
export const TRDD_APPROVE_SCOPE = 'trdd:approve'

/**
 * A REVIEW VERDICT is a different fact from a proposal approval (TRDD-06G43RK2): `approve`
 * says "this work is authorized", a verdict says "this work was reviewed and the card may
 * move on / close". Until this scope existed `promote` and `archive` anchored nothing, so a
 * card closed on a `human_review -> complete` verdict was indistinguishable from one whose
 * `## Approval log` was typed by hand. The scope is deliberately NOT `trdd:approve`: the
 * portfolio scope check is exact-match, so a verdict token can never satisfy the approval
 * verifier (nor the reverse) even if its id is pasted into the wrong frontmatter field.
 */
export const TRDD_VERDICT_SCOPE = 'trdd:verdict'

/**
 * The scope a verdict token actually carries: `trdd:verdict:<from>:<to>`. WHY the transition is
 * in the scope: a token pinned only to the card id verified against ANY later state of the
 * card, so a hand-edited `column: complete` still read "review verdict VERIFIED" off a real
 * token minted for a reject. The scope is a signed field the portfolio check already compares
 * exactly, so binding the transition there needs no new token field and no signature change.
 * The token KIND stays 'approval' (PortfolioTokenKind has no verdict kind; the scope, not the
 * kind, is what the verifiers compare).
 */
export function verdictScope(from: string, to: string): string {
  return `${TRDD_VERDICT_SCOPE}:${from}:${to}`
}

/** Frontmatter field holding the LATEST review-verdict token id (a later verdict overwrites). */
export const VERDICT_TOKEN_FIELD = 'verdict-token'

const REVIEW_COLUMNS: ReadonlySet<string> = new Set([
  'design_ai_review',
  'design_human_review',
  'ai_review',
  'human_review',
])

/**
 * Is moving a card `from` -> `to` a review VERDICT? Only LEAVING a review column (pass or
 * reject) is a reviewer's decision; entering one is a submission. `testing -> complete`
 * skips review, and `publish -> published` / `deploy -> live` are release confirmations, so
 * none of those is a review verdict and claiming one would make the token lie.
 */
export function isReviewVerdictMove(from: string | undefined, _to: string): boolean {
  return !!from && REVIEW_COLUMNS.has(from)
}

/** Frontmatter field holding the token id, per kind. */
export const APPROVAL_TOKEN_FIELD = 'approval-token'
export const MANDATE_TOKEN_FIELD = 'mandate-token'

/**
 * An approval token outlives the request that minted it but not the card's life:
 * 30 days is long enough for any review cycle and short enough that a leaked token
 * eventually dies on its own. It is never CONSUMED (uses_remaining: null) — an
 * approval is a standing fact about the card, re-checkable by every agent that
 * later picks it up, not a one-shot ticket the first reader burns.
 */
const TRDD_TOKEN_TTL_SECONDS = 30 * 24 * 3600

/**
 * Mint the token that makes a TRDD decision verifiable, into the APPROVER's own
 * enclave, pinned to `trddId`.
 *
 * Returns the token id, or `null` if the token could not be anchored in the ledger.
 * A null return must NOT fail the approval: the decision was authorized and is
 * recorded in the prose log exactly as it was before this module existed. Refusing
 * to approve because the AUDIT layer hiccuped would convert a logging outage into a
 * governance outage — the fleet would stop being able to approve anything. The
 * caller records the absence instead, and the verifier reports "no token" (an
 * unverifiable approval), which is honest and actionable.
 */
export async function mintTrddDecisionToken(
  ctx: AuthContext,
  trddId: string,
  kind: PortfolioTokenKind,
  scope: string = TRDD_APPROVE_SCOPE,
): Promise<string | null> {
  // The issuer IS the approver. A human owner has no agent record — see
  // SYSTEM_OWNER_ISSUER for why that needs a sentinel rather than a lookup.
  const issuerAgentId = ctx.agentId ?? SYSTEM_OWNER_ISSUER
  // The title is read from the REGISTRY, the same source the verifier's issuer re-check uses
  // (lib/portfolio-check.ts issuerStillValid). ctx.governanceTitle is empty for an agent that
  // authenticated with an AMP key, so reading it would mint nothing for a real MANAGER whose
  // approval authorize() had just accepted on its registry title.
  // Lazy require, exactly as issuerStillValid does it: one lookup shape for mint and verify.
  let callerTitle = ''
  if (ctx.agentId) {
    const reg = require('@/lib/agent-registry') as {
      loadAgents: () => Array<{ id: string; governanceTitle?: string; deletedAt?: string | null }>
    }
    callerTitle = (reg.loadAgents().find(a => a.id === ctx.agentId && !a.deletedAt)?.governanceTitle || '').toLowerCase()
  }
  // The SIGNED title must be the issuer's real one. Every non-COS agent used to be signed as
  // 'manager', and the verifier's issuer check compares the signed title to the issuer's current
  // registry title — so an orchestrator's token could never verify (TRDD-ADYYHLIC). A title with
  // no rung on the approval ladder mints nothing: there is no honest title to sign.
  const AGENT_ISSUER_TITLES: readonly PortfolioIssuerTitle[] = ['manager', 'chief-of-staff', 'orchestrator']
  const agentTitle = AGENT_ISSUER_TITLES.find(t => t === callerTitle)
  if (ctx.agentId && !agentTitle) return null
  const issuerTitle: PortfolioIssuerTitle = agentTitle ?? 'user'

  const now = new Date()
  const token: PortfolioToken = {
    token_id: randomUUID(),
    kind,
    // The approver holds its own receipt.
    subject_agent_id: issuerAgentId,
    scope,
    target_trdd_id: trddId.toUpperCase(),
    issuer_agent_id: issuerAgentId,
    issuer_title: issuerTitle,
    uses_remaining: null,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + TRDD_TOKEN_TTL_SECONDS * 1000).toISOString(),
    issuer_sig: '',
    ledger_seq: null,
    status: 'active',
  }
  token.issuer_sig = signPortfolioToken(token)

  try {
    await issueToken(token)
    const seq = await emitPortfolioOp('issue_portfolio_token', token.token_id, issueDiff(token), {
      action: 'issue-trdd-decision-token',
      agentId: ctx.agentId ?? null,
      actor: ctx.agentId ? 'agent' : 'user',
    })
    if (seq === null) {
      // Unanchored ⇒ the verifier will refuse it anyway (R34). Do not leave a
      // record that looks like proof but is not.
      await revokeToken(token.token_id)
      return null
    }
    await setLedgerSeq(token.token_id, seq)
    return token.token_id
  } catch (err) {
    console.error('[trdd-approval-token] mint failed; the approval stands but is unverifiable:', err)
    return null
  }
}

/**
 * Make a freshly created MANDATE verifiable (TRDD-ADYYHLIC). WHY: `createTrdd` writes
 * `mandate: true` / `approval-judge:` but mints nothing, so verify rejected every legitimate
 * server-issued mandate above `none` exactly like a hand-typed forgery. The token needs the
 * card id, which exists only after createTrdd, so it is minted and recorded here, after.
 * `none` self-mandates and proposals get no token (verify needs none). A failed mint leaves the
 * card created without the field — the same degradation as approve — and returns null.
 */
export async function recordMandateToken(
  ctx: AuthContext,
  created: { id: string; file: string; mandate: boolean; minApproval: string },
): Promise<string | null> {
  if (!created.mandate || created.minApproval === 'none') return null
  const tokenId = await mintTrddDecisionToken(ctx, created.id, 'mandate')
  if (!tokenId) return null
  const text = fs.readFileSync(created.file, 'utf8')
  // createTrdd always writes `approval-datetime:` on a mandate; its absence is a broken invariant.
  if (!/^approval-datetime: .*$/m.test(text)) throw new Error(`mandate card ${created.id} has no approval-datetime line to anchor mandate-token`)
  const next = text.replace(/^(approval-datetime: .*)$/m, `$1\n${MANDATE_TOKEN_FIELD}: ${tokenId}`)
  const tmp = `${created.file}.tmp`
  fs.writeFileSync(tmp, next, 'utf8')
  fs.renameSync(tmp, created.file)
  return tokenId
}

/** What a caller learns when it asks "is this card's approval real?". */
export interface TrddApprovalVerdict {
  trdd_id: string
  /** The single answer. False whenever ANY part of the chain fails. */
  verified: boolean
  /** No token recorded at all — the approval is prose only (the pre-#47 state). */
  token_present: boolean
  token_id: string | null
  /** Derived from the SIGNED token, never from the card's own prose. */
  issuer_agent_id: string | null
  issuer_title: PortfolioIssuerTitle | null
  /** What the card says it requires, and whether the token's issuer outranks it. */
  min_approval_requirement: string
  authority_sufficient: boolean | null
  /** The underlying portfolio verdict (signature, ledger anchor, expiry, pin…). */
  token_verdict: PortfolioVerdict | null
  reasons: string[]
  /**
   * The REVIEW-VERDICT half (TRDD-06G43RK2), kept apart from `verified` on purpose:
   * `verified` answers "was this card's approval real?" (the proposal gate); a verdict
   * token answers "did a reviewer close it?". Merging them would let a closing verdict
   * stand in for an authorization nobody gave.
   */
  verdict_token_present: boolean
  verdict_token_id: string | null
  verdict_verified: boolean
  verdict_issuer_agent_id: string | null
  verdict_issuer_title: PortfolioIssuerTitle | null
  /** The `<from>` and `<to>` bound into the token's signed scope, when it is a verdict scope. */
  verdict_from: string | null
  verdict_to: string | null
  verdict_reasons: string[]
}

/** Verify the `verdict-token:` on a card: signature, ledger anchor, expiry, pin, `trdd:verdict` scope. */
async function verifyVerdict(
  fm: Record<string, unknown>,
  trddId: string,
  column: string | undefined,
): Promise<Pick<TrddApprovalVerdict, 'verdict_token_present' | 'verdict_token_id' | 'verdict_verified' | 'verdict_issuer_agent_id' | 'verdict_issuer_title' | 'verdict_from' | 'verdict_to' | 'verdict_reasons'>> {
  const raw = fm[VERDICT_TOKEN_FIELD]
  const tokenId = typeof raw === 'string' && raw.trim() ? raw.trim() : null
  const none = {
    verdict_token_present: !!tokenId,
    verdict_token_id: tokenId,
    verdict_verified: false,
    verdict_issuer_agent_id: null,
    verdict_issuer_title: null,
    verdict_from: null as string | null,
    verdict_to: null as string | null,
    verdict_reasons: [] as string[],
  }
  if (!tokenId) return none
  const token = findTokenAnywhere(tokenId)
  if (!token) {
    return { ...none, verdict_reasons: [`No such verdict token (${tokenId}) exists in any enclave.`] }
  }
  // The verdict is bound to the move it recorded. Archiving as `completed` is the filing of a
  // card already `complete`, so the two spellings name the same state here.
  const m = /^trdd:verdict:([^:]+):([^:]+)$/.exec(token.scope)
  if (!m) {
    return { ...none, verdict_reasons: [`Token scope "${token.scope}" is not a review-verdict scope (${TRDD_VERDICT_SCOPE}:<from>:<to>).`] }
  }
  const [, from, to] = m
  // Re-check the minter's classification instead of trusting it: only a move OUT of a review
  // column is a verdict, whatever path minted the token.
  if (!REVIEW_COLUMNS.has(from)) {
    return { ...none, verdict_from: from, verdict_to: to, verdict_reasons: [`The token records ${from} -> ${to}, which does not leave a review column, so it is not a review verdict.`] }
  }
  const norm = (c: string | undefined) => (c === 'completed' ? 'complete' : c)
  if (norm(to) !== norm(column)) {
    return {
      ...none,
      verdict_from: from,
      verdict_to: to,
      verdict_reasons: [`The verdict recorded the move ${from} -> ${to}, but the card is now in "${column}": the verdict does not vouch for the current column.`],
    }
  }
  // The scope passed here equals token.scope whenever the anchored regex above matched, so the
  // portfolio scope compare adds nothing for verdicts. The protection is the checks ABOVE (scope
  // family via the regex, `from` is a review column, `to` is the card's current column) plus the
  // signature and the trddId pin inside explainPortfolioToken.
  const v = await explainPortfolioToken(token, { scope: token.scope, trddId: trddId.toUpperCase() })
  return {
    ...none,
    verdict_from: from,
    verdict_to: to,
    verdict_verified: v.valid,
    verdict_issuer_agent_id: token.issuer_agent_id,
    verdict_issuer_title: token.issuer_title,
    verdict_reasons: v.reasons,
  }
}

/**
 * Verify a TRDD's recorded decision: is there a host-signed, ledger-anchored token
 * pinned to THIS card, minted by an authority that outranks what the card requires,
 * and does that authority still hold its title?
 */
export async function verifyTrddDecision(
  designDir: string,
  trddId: string,
): Promise<TrddApprovalVerdict | null> {
  const trdd = readTrdd(designDir, trddId)
  if (!trdd) return null

  const fm = (trdd.frontmatter ?? {}) as Record<string, unknown>
  const minApproval = readMinApproval(fm)
  const raw = fm[APPROVAL_TOKEN_FIELD] ?? fm[MANDATE_TOKEN_FIELD]
  const tokenId = typeof raw === 'string' && raw.trim() ? raw.trim() : null

  const base: TrddApprovalVerdict = {
    trdd_id: trddId.toUpperCase(),
    verified: false,
    token_present: !!tokenId,
    token_id: tokenId,
    issuer_agent_id: null,
    issuer_title: null,
    min_approval_requirement: minApproval,
    authority_sufficient: null,
    token_verdict: null,
    reasons: [],
    ...(await verifyVerdict(fm, trddId, trdd.column)),
  }

  // A card requiring NO approval has nothing to prove. Demanding a token here
  // would make every routine Tier-0 card "unverified", and a verifier that cries
  // forgery on ordinary work is one people learn to ignore.
  if (minApproval === 'none' && !tokenId) {
    return {
      ...base,
      verified: true,
      reasons: ['Card requires no approval (min-approval-requirement: none).'],
    }
  }

  if (!tokenId) {
    return {
      ...base,
      reasons: [
        `No ${APPROVAL_TOKEN_FIELD}/${MANDATE_TOKEN_FIELD} on this card — its approval is prose only, ` +
          'which anyone with repo write can type. Unverifiable.',
      ],
    }
  }

  const token = findTokenAnywhere(tokenId)
  if (!token) {
    return {
      ...base,
      reasons: [`No such token (${tokenId}) exists in any enclave — the id on this card is not real.`],
    }
  }

  const verdict = await explainPortfolioToken(token, {
    scope: TRDD_APPROVE_SCOPE,
    trddId: trddId.toUpperCase(),
  })

  // THE GOVERNANCE CHECK. The token's issuer_title is SIGNED — it is what authority
  // the server saw when it minted. A COS-issued token cannot satisfy a manager-tier
  // card no matter what the card's prose claims, and NO agent token can ever satisfy
  // a `user`-tier card, because no agent holds the `user` rung.
  const issuerRank = TRDD_AUTHORITY[token.issuer_title] ?? 0
  const requiredRank = TRDD_AUTHORITY[minApproval] ?? TRDD_AUTHORITY.manager
  const authoritySufficient = issuerRank >= requiredRank

  const reasons = [...verdict.reasons]
  if (!authoritySufficient) {
    reasons.push(
      `Approved by a ${token.issuer_title} (authority ${issuerRank}), but this card requires ` +
        `${minApproval} (authority ${requiredRank}).`,
    )
  }

  return {
    ...base,
    verified: verdict.valid && authoritySufficient,
    issuer_agent_id: token.issuer_agent_id,
    issuer_title: token.issuer_title,
    authority_sufficient: authoritySufficient,
    token_verdict: verdict,
    reasons,
  }
}
