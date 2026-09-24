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
 *   3. `main-agent@<project-id>` ONLY on a machine with NO ai-maestro agent registry;
 *   4. otherwise refuse.
 * Never `process.env.USER`: that is the OS login, which is exactly the leak #168 reports.
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
    if (!opts.projectId) {
      return {
        ok: false,
        error: `no ${opts.flag} given and this corpus has no project-id in its PRRD to derive \`main-agent@<project-id>\` from — pass ${opts.flag} (${TRDD_IDENTITY_FORMS})`,
      }
    }
    return { ok: true, identity: `main-agent@${opts.projectId}`, source: 'default' }
  }
  return {
    ok: false,
    error:
      `no ${opts.flag} given and no resolvable AID_AUTH, on a machine that hosts the ai-maestro harness — ` +
      `refusing to guess who is writing (a default here could record a harness agent under someone else's name). ` +
      `Pass ${opts.flag} (${TRDD_IDENTITY_FORMS}); a project's main session passes \`${opts.flag} main-agent@<project-id>\`.`,
  }
}
