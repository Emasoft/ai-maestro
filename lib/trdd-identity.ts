/**
 * WHO IS WRITING — the CLI's caller identity for a TRDD identity field (ai-maestro#168).
 *
 * The CLI cannot authenticate its caller, so what this returns is a SELF-DECLARATION:
 * trustworthy attribution comes only from server-side writes (the API resolves the
 * authenticated caller) and from git authorship. What this module guarantees is narrower
 * and still load-bearing: nothing is ever written that is outside the identity grammar
 * (`parseTrddIdentity`), and nothing is ever DEFAULTED where a wrong default would put one
 * actor's name on another actor's act.
 *
 * Order (the #168 comment, revised after review, then revised again for #168-2: an
 * explicit flag must AGREE with a resolvable AID_AUTH, not override it):
 *   1. an explicit `--author` / `--approver`, validated against the grammar;
 *   2. a resolvable `AID_AUTH` → `<name>#<uuid>` of the registered agent it belongs to;
 *   3. `main-agent@<project-id>` ONLY when `AID_AUTH` is UNSET and the machine has NO
 *      ai-maestro agent registry;
 *   4. otherwise refuse.
 * When BOTH (1) and (2) are present, they must name the SAME identity, or the call is
 * refused: a harness agent carrying a verified AID_AUTH token could otherwise type
 * `--author user` (or anyone else's identity) and have the flag win outright, bypassing the
 * one signal this module has for who is actually asking — the resolved agent's session
 * secret. Neither side is dropped in favour of the other; disagreement is an error, not a
 * tiebreak.
 * Never `process.env.USER`: that is the OS login, which is exactly the leak #168 reports.
 * An `AID_AUTH` that is SET and does not resolve (stale token, unreadable registry, or no
 * registry at all — e.g. a different HOME, a container, a remote host) always refuses; it
 * never falls through to the default, or a real agent gets recorded under someone else's name.
 *
 * WHY THE DEFAULT IS GATED ON THE REGISTRY, NOT ON THE CWD. A cwd/corpus test ("is this a
 * registered workdir?") is chosen by the caller: one `cd /tmp` would turn a harness agent
 * into "standalone" and hand it the main agent's identity, in a card that later becomes
 * immutable forensic history. Whether this machine hosts the harness at all is the one
 * signal the caller cannot pick. An unreadable or unparseable registry counts as PRESENT
 * (fail closed); only an absent file or a readable empty list means "no harness here".
 */

import fs from 'fs'
import { statePath } from './ecosystem-constants'
import { validateSessionSecret } from './session-secret'
import { parseTrddIdentity, formatTrddIdentity, TRDD_IDENTITY_FORMS } from './trdd-vocabulary'

export type CliIdentityResult =
  | { ok: true; identity: string; source: 'flag' | 'aid' | 'default' }
  | { ok: false; error: string }

interface RegistryRow {
  id?: unknown
  name?: unknown
  deletedAt?: unknown
  metadata?: { sessionSecretHash?: unknown } | null
}

/** The registry as far as this decision needs it: absent, unreadable, or its rows. */
function readRegistry(file: string): { state: 'absent' } | { state: 'unreadable' } | { state: 'rows'; rows: RegistryRow[] } {
  if (!fs.existsSync(file)) return { state: 'absent' }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return Array.isArray(parsed) ? { state: 'rows', rows: parsed as RegistryRow[] } : { state: 'unreadable' }
  } catch {
    return { state: 'unreadable' }
  }
}

/**
 * A `main-agent@X` identity must name THIS corpus's project when the corpus declares one
 * (its PRRD `project-id:`): the shape alone let a card in project `probe` be signed
 * `main-agent@Other`, and identity fields are write-once — a wrong name is permanent.
 * Returns the refusal text, or null when there is nothing to refuse.
 *
 * With NO PRRD project-id any well-formed `main-agent@X` is accepted: the interim rule
 * for PRRD-less projects is an open point on ai-maestro#168 (derive a default id from
 * the repo, or keep requiring an explicit author) — do not tighten it here unilaterally.
 */
export function mainAgentProjectMismatch(value: string, projectId: string | null): string | null {
  const id = parseTrddIdentity(value)
  if (!id || id.kind !== 'main-agent' || !projectId || id.projectId === projectId) return null
  return `\`${value}\` names project "${id.projectId}", but this corpus's PRRD project-id is "${projectId}" — use \`main-agent@${projectId}\``
}

/**
 * The `<name>#<uuid>` identity of the registered, non-deleted agent whose session secret
 * `secret` verifies against — or null when no row matches. Shared by both the AID-only
 * default path and the explicit-flag agreement check below, so there is exactly one place
 * that decides "who does this token belong to".
 */
function resolveAidAgent(secret: string, rows: RegistryRow[]): string | null {
  for (const row of rows) {
    if (row.deletedAt) continue
    const hash = row.metadata?.sessionSecretHash
    if (typeof hash !== 'string' || !validateSessionSecret(secret, hash)) continue
    const parsed = typeof row.id === 'string' && typeof row.name === 'string'
      ? parseTrddIdentity(`${row.name}#${row.id}`)
      : null
    if (parsed) return formatTrddIdentity(parsed)
  }
  return null
}

/**
 * Why a SET AID_AUTH failed to resolve: stale/invalid token, an unreadable registry, or no
 * registry on this machine at all. Shared text (never the token substrings) so both refusal
 * shapes below — the registry-gated default, and an explicit flag with no agreement to
 * check against — name the same fault the same way.
 */
function aidUnresolvedReason(registry: { state: 'absent' } | { state: 'unreadable' } | { state: 'rows'; rows: RegistryRow[] }): string {
  const harnessHere = registry.state === 'unreadable' || (registry.state === 'rows' && registry.rows.length > 0)
  if (!harnessHere) return 'there is no agent registry on this machine (absent or empty) to resolve it'
  return registry.state === 'unreadable'
    ? 'the agent registry could not be read to resolve it'
    : 'it does not resolve to a registered agent (stale or invalid token)'
}

/**
 * The registry-gated-default refusal for a SET-but-unresolved AID_AUTH (no explicit flag).
 * Kept as the exact three pinned wordings (byte-identical to the pre-#168-2 text, not
 * rebuilt from `aidUnresolvedReason` — that helper's phrasing reads naturally after "AID_AUTH
 * is set and…" but not after "AID_AUTH is set, but…", and this text is pinned by name in the
 * unit tests).
 */
function aidUnresolvedError(
  registry: { state: 'absent' } | { state: 'unreadable' } | { state: 'rows'; rows: RegistryRow[] },
  flag: string,
): string {
  const harnessHere = registry.state === 'unreadable' || (registry.state === 'rows' && registry.rows.length > 0)
  if (!harnessHere) {
    return (
      `AID_AUTH is set, but there is no agent registry on this machine (absent or empty) to resolve it — ` +
      `refusing to guess who is writing (a default here could record a harness agent under someone else's name). ` +
      `Pass ${flag} (${TRDD_IDENTITY_FORMS}); a project's main session passes \`${flag} main-agent@<project-id>\`.`
    )
  }
  const why = registry.state === 'unreadable'
    ? 'AID_AUTH is set, but the agent registry could not be read to resolve it'
    : 'AID_AUTH is set but does not resolve to a registered agent (stale or invalid token)'
  return (
    `${why}, on a machine that hosts the ai-maestro harness — ` +
    `refusing to guess who is writing (a default here could record a harness agent under someone else's name). ` +
    `Pass ${flag} (${TRDD_IDENTITY_FORMS}); a project's main session passes \`${flag} main-agent@<project-id>\`.`
  )
}

export function resolveCliIdentity(opts: {
  /** The explicit flag value, if the caller passed one. */
  explicit?: string
  /** The flag's name, for the messages (`--author` / `--approver`). */
  flag: string
  /** The corpus's project-id (from its PRRD), or null when it has none. */
  projectId: string | null
  env?: Record<string, string | undefined>
  /** Test seam; defaults to the real registry under the state dir. */
  registryFile?: string
}): CliIdentityResult {
  const env = opts.env ?? process.env
  const registry = readRegistry(opts.registryFile ?? statePath('agents', 'registry.json'))
  const secret = env.AID_AUTH
  const resolvedAid = secret && registry.state === 'rows' ? resolveAidAgent(secret, registry.rows) : null

  if (opts.explicit !== undefined) {
    // A SET-but-unresolved AID_AUTH refuses an explicit flag too, and for the identical
    // reason it refuses the default: the flag is an unauthenticated string, and the whole
    // point of a live token is that it is the one signal this module trusts more than that
    // string. Checked before the flag's own grammar, because the AID fault is the real
    // cause regardless of whether the flag value happens to parse. Guidance differs from
    // `aidUnresolvedError`'s "pass the flag" — the flag WAS passed, so a human whose shell
    // carries a stale exported AID_AUTH (a copied tmux environment, say) needs to know it
    // can unset the variable instead of unsetting a flag it never controlled the AID with.
    if (secret && !resolvedAid) {
      return {
        ok: false,
        error:
          `${opts.flag} was given, but AID_AUTH is set and ${aidUnresolvedReason(registry)} — ` +
          `unset AID_AUTH, or omit ${opts.flag}, to proceed (ai-maestro#168)`,
      }
    }
    const parsed = parseTrddIdentity(opts.explicit)
    if (!parsed) {
      return {
        ok: false,
        error: `${opts.flag} ${JSON.stringify(opts.explicit)} is not an identity — use ${TRDD_IDENTITY_FORMS} (ai-maestro#168)`,
      }
    }
    const mismatch = mainAgentProjectMismatch(opts.explicit, opts.projectId)
    if (mismatch) return { ok: false, error: `${opts.flag} ${mismatch}` }
    const identity = formatTrddIdentity(parsed)
    // A resolvable AID_AUTH is the one signal this module trusts (a session secret, not a
    // caller-typed string) — an explicit flag may only CONFIRM it, never override it. Never
    // prints any part of the token; resolvedAid is already a `<name>#<uuid>` from the registry.
    if (resolvedAid && resolvedAid !== identity) {
      return {
        ok: false,
        error:
          `${opts.flag} ${JSON.stringify(opts.explicit)} does not match the agent AID_AUTH verifies as ` +
          `\`${resolvedAid}\` — an authenticated agent may not claim a different identity via ${opts.flag}; ` +
          `omit ${opts.flag} — AID_AUTH already identifies you as \`${resolvedAid}\` (ai-maestro#168)`,
      }
    }
    // Agreed with a verified token, or no token to agree with either way: 'aid' when the
    // agreement is what makes it trustworthy — the archive verb treats only 'aid' as
    // verified, and the agreement with an authenticated session secret earns that, not the
    // caller-typed flag alone. 'flag' only when there was no token to verify against.
    return { ok: true, identity, source: resolvedAid ? 'aid' : 'flag' }
  }

  if (resolvedAid) return { ok: true, identity: resolvedAid, source: 'aid' }

  // The three `if`s below are mutually exclusive and exhaustive over (harnessHere, secret) —
  // deliberately independent early-returns rather than an if/else-if chain, so REVIEW: a
  // 5th branch added later must keep that partition explicit rather than relying on `else`
  // to enforce it.
  const harnessHere = registry.state === 'unreadable' || (registry.state === 'rows' && registry.rows.length > 0)
  if (!harnessHere && !secret) {
    // The default is for an UNSET AID_AUTH only. A SET-but-unresolved AID_AUTH must never
    // fall through to the default just because THIS machine has no registry rows — that
    // machine could be a container, a jailed HOME, or a remote host running a real
    // registered agent whose token simply can't be checked from here, and defaulting would
    // silently record its work under the project's main-agent identity instead.
    if (!opts.projectId) {
      return {
        ok: false,
        error: `no ${opts.flag} given and this corpus has no project-id in its PRRD to derive \`main-agent@<project-id>\` from — pass ${opts.flag} (${TRDD_IDENTITY_FORMS})`,
      }
    }
    return { ok: true, identity: `main-agent@${opts.projectId}`, source: 'default' }
  }
  if (!harnessHere) {
    // secret is truthy here (the branch above handled !secret) — same fault as the
    // explicit-flag gate above, shared via aidUnresolvedError.
    return { ok: false, error: aidUnresolvedError(registry, opts.flag) }
  }
  if (secret) return { ok: false, error: aidUnresolvedError(registry, opts.flag) }
  return {
    ok: false,
    error:
      `no ${opts.flag} given and no AID_AUTH set, on a machine that hosts the ai-maestro harness — ` +
      `refusing to guess who is writing (a default here could record a harness agent under someone else's name). ` +
      `Pass ${opts.flag} (${TRDD_IDENTITY_FORMS}); a project's main session passes \`${opts.flag} main-agent@<project-id>\`.`,
  }
}
