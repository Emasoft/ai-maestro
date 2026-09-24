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
 * Order (the #168 comment, revised after review):
 *   1. an explicit `--author` / `--approver`, validated against the grammar;
 *   2. a resolvable `AID_AUTH` → `<name>#<uuid>` of the registered agent it belongs to;
 *   3. `main-agent@<project-id>` ONLY when `AID_AUTH` is UNSET and the machine has NO
 *      ai-maestro agent registry;
 *   4. otherwise refuse.
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
  if (opts.explicit !== undefined) {
    const parsed = parseTrddIdentity(opts.explicit)
    if (!parsed) {
      return {
        ok: false,
        error: `${opts.flag} ${JSON.stringify(opts.explicit)} is not an identity — use ${TRDD_IDENTITY_FORMS} (ai-maestro#168)`,
      }
    }
    const mismatch = mainAgentProjectMismatch(opts.explicit, opts.projectId)
    if (mismatch) return { ok: false, error: `${opts.flag} ${mismatch}` }
    return { ok: true, identity: formatTrddIdentity(parsed), source: 'flag' }
  }

  const registry = readRegistry(opts.registryFile ?? statePath('agents', 'registry.json'))
  const secret = env.AID_AUTH
  if (secret && registry.state === 'rows') {
    for (const row of registry.rows) {
      if (row.deletedAt) continue
      const hash = row.metadata?.sessionSecretHash
      if (typeof hash !== 'string' || !validateSessionSecret(secret, hash)) continue
      const parsed = typeof row.id === 'string' && typeof row.name === 'string'
        ? parseTrddIdentity(`${row.name}#${row.id}`)
        : null
      if (parsed) return { ok: true, identity: formatTrddIdentity(parsed), source: 'aid' }
    }
  }

  const harnessHere = registry.state === 'unreadable' || (registry.state === 'rows' && registry.rows.length > 0)
  if (!harnessHere) {
    // The default is for an UNSET AID_AUTH only. A SET-but-unresolved AID_AUTH must never
    // fall through to the default just because THIS machine has no registry rows — that
    // machine could be a container, a jailed HOME, or a remote host running a real
    // registered agent whose token simply can't be checked from here, and defaulting would
    // silently record its work under the project's main-agent identity instead.
    if (!secret) {
      if (!opts.projectId) {
        return {
          ok: false,
          error: `no ${opts.flag} given and this corpus has no project-id in its PRRD to derive \`main-agent@<project-id>\` from — pass ${opts.flag} (${TRDD_IDENTITY_FORMS})`,
        }
      }
      return { ok: true, identity: `main-agent@${opts.projectId}`, source: 'default' }
    }
    // Own text, deliberately NOT routed through the "hosts the ai-maestro harness" refusal
    // below — that sentence would be false here: this machine has no harness registry at
    // all, so there is nothing to call "resolving to a stale or invalid token". Never
    // prints the token or any part of it.
    return {
      ok: false,
      error:
        `AID_AUTH is set, but there is no agent registry on this machine (absent or empty) to resolve it — ` +
        `refusing to guess who is writing (a default here could record a harness agent under someone else's name). ` +
        `Pass ${opts.flag} (${TRDD_IDENTITY_FORMS}); a project's main session passes \`${opts.flag} main-agent@<project-id>\`.`,
    }
  }
  // Two different faults, two messages: a caller with NO token needs to pass the flag; a
  // caller whose token is SET but matches no live agent has a stale or invalid token and
  // needs to know that, not be told to "pass the flag" as if it had sent nothing. Neither
  // message ever prints the token or any part of it.
  const why = secret
    ? registry.state === 'unreadable'
      ? 'AID_AUTH is set, but the agent registry could not be read to resolve it'
      : 'AID_AUTH is set but does not resolve to a registered agent (stale or invalid token)'
    : `no ${opts.flag} given and no AID_AUTH set`
  return {
    ok: false,
    error:
      `${why}, on a machine that hosts the ai-maestro harness — ` +
      `refusing to guess who is writing (a default here could record a harness agent under someone else's name). ` +
      `Pass ${opts.flag} (${TRDD_IDENTITY_FORMS}); a project's main session passes \`${opts.flag} main-agent@<project-id>\`.`,
  }
}
