/**
 * The ONE owner of every read-modify-write of `extraKnownMarketplaces` in a Claude Code
 * settings file (TRDD-Y0XEEUXN Part 3).
 *
 * BEFORE THIS FILE, six call sites mutated the same key independently, each with its own
 * `updateJson(SETTINGS_PATH, s => { const ekm = (s.extraKnownMarketplaces || {}); ekm[name] =
 * ...; s.extraKnownMarketplaces = ekm })` — correctly LOCKED (TRDD-RYFP030K), but six copies of
 * the same read-modify-write shape, each free to drift. This module does not change what any of
 * them write (Part 3's DECISION, the TRDD's STATE block: "No behaviour change per writer — only
 * the WRITE moves"); it gives the shape one home.
 *
 * WHY A BATCH, NOT ONE CALL PER ENTRY (DECISION REFINED (1)): `auto-update-service.ts`'s
 * `ensureMarketplaceAutoUpdate` emits two DIFFERENT kinds of op in one tick — a one-field PATCH
 * (`autoUpdate: true` on an already-declared marketplace) and a whole-entry SET (a marketplace
 * the settings file has never seen, `{source, autoUpdate: true}`) — and both must land in ONE
 * locked write. Two sequential calls would open a window between them: a crash, or a concurrent
 * writer (the `claude` CLI takes no lock of ours), landing between call 1 and call 2 could leave
 * `autoUpdate` set on an entry whose `source` was never written — a half-registered marketplace
 * that reads as fully configured. A single `ops` array applied inside ONE `updateJson` mutator
 * closes that window by construction: either every op in the batch lands, or (on a throw before
 * the write) none of them do.
 *
 * WHY THE VALUE PASSES THROUGH UNCHANGED (DECISION REFINED (2)): this module encodes only the
 * KEY PATH (`['extraKnownMarketplaces', name]` for `set`/`delete`, `['extraKnownMarketplaces',
 * name, field]` per field for `patch`). It never inspects or normalises the entry VALUE. The six
 * writers this replaces do not agree on entry shape — `{source: {source: 'directory', path}}`
 * (plugin-storage-service.ts, role-plugin-service.ts) vs `{source, autoUpdate: true}`
 * (auto-update-service.ts, verbatim from the registry, per its own boundary note) vs `{source:
 * {source: 'github'|'directory', repo|path}}` (element-management-service.ts's G03b) — and the
 * TRDD's STATE block found NO type enforced at any existing write site (twelve inline casts,
 * ten of them bare `Record<string, unknown>`). Normalising here would be a behaviour change this
 * card explicitly declines to make; the shape question is out of scope for a storage-dedup.
 *
 * WHY PATCH IS PER-FIELD `set` OPS, NOT A MERGED WHOLE-ENTRY `set`: `applySettingsOps`'s `set`
 * REPLACES the value at its key path wholesale (lib/settings-gate.ts). A whole-entry `set` built
 * from a caller's partial patch would silently DROP every sibling field the entry already has —
 * `ensureMarketplaceAutoUpdate`'s own doc comment (auto-update-service.ts:460-464) names exactly
 * this hazard for the `autoUpdate` flag it flips on an entry it did not otherwise touch. One
 * `set` per patched field, each addressing `['extraKnownMarketplaces', name, field]`, leaves
 * every untouched field alone.
 *
 * WHY PRIOR ENTRIES ARE RETURNED (DECISION REFINED (3)): `element-management-service.ts`'s
 * `ChangeMarketplace` gates (`add`'s G03b, `remove`'s G05) need the pre-mutation value of the
 * entry they are about to write or delete, so their `undo` can restore it exactly. Reading that
 * value with a SEPARATE call (before or after this one) would be a second, non-atomic read: a
 * concurrent writer landing between the two calls could make the "prior" value already wrong by
 * the time `undo` uses it. Capturing it INSIDE the same locked mutator — from the same `data`
 * this call is about to rewrite — is the only way the snapshot and the write can never disagree.
 *
 * WHY `UnreadableTargetError` (lib/json-io.ts) IS NEVER CAUGHT HERE (DECISION REFINED (4)):
 * `updateJson` throws it after exhausting its read-retry budget on a settings file that exists
 * but does not parse. "Legitimately absent" (no file, or the key not present) and "unreadable"
 * (corrupt JSON) are different facts with different correct responses, and only the CALLER knows
 * which response is correct for it — `ensureMarketplaceAutoUpdate` reports `failed` and touches
 * nothing; `ChangeMarketplace`'s G05 today lets it propagate as `ChangeResult.success: false`.
 * Catching it here and returning some default would collapse that distinction back into the one
 * this repo has already been burned by (a lenient reader answering `{}` for a file it cannot
 * parse, so the write path derived from `{}` clobbers the real, unreadable-but-not-empty file).
 */
import { homedir } from 'os'
import { join } from 'path'
import { updateJson } from './json-io'
import { resolveSettingsPath, applySettingsOps, type SettingsOp } from './settings-gate'

/**
 * One mutation of one `extraKnownMarketplaces[name]` entry. Exactly one of `set`, `patch`,
 * `delete` must be present — see the module doc for why each shape exists.
 */
export interface ExtraKnownMarketplaceOp {
  name: string
  /** Replace the WHOLE entry with this value, verbatim — no normalisation (DECISION REFINED (2)). */
  set?: unknown
  /** Set only these fields on the EXISTING entry, leaving every other field untouched. */
  patch?: Record<string, unknown>
  /** Delete the entry. Absence (no such key, or no `extraKnownMarketplaces` object at all) is a
   *  silent success, matching every writer this module replaces. */
  delete?: true
}

export interface ApplyExtraKnownMarketplaceOpsOptions {
  /** Forwarded to `updateJson`. Default `true` — every existing writer this module replaces
   *  except one (`element-management-service.ts`'s G05 `remove`, which pre-checks
   *  `existsSync` itself because creating the user's settings file as a side effect of REMOVING
   *  a marketplace would be new, unwanted behaviour) passes `createIfMissing: true`. */
  createIfMissing?: boolean
}

/** Mirrors the `USER_GLOBAL_SETTINGS`/`SETTINGS_JSON` constant every one of the six writers this
 *  module replaces already defines locally — kept private because every real call site passes
 *  its own path explicitly (each already has that constant); this default exists for tests and
 *  any future caller with no opinion of its own. */
function defaultUserGlobalSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json')
}

/**
 * Apply a batch of `extraKnownMarketplaces` mutations in ONE locked read-modify-write, and
 * return each named entry's value FROM BEFORE this call (`undefined` when it was absent).
 *
 * Ops are applied in array order; the returned priors reflect the FIRST time this call touches
 * each name (i.e. the value before ANY op in this batch ran against it) — the shape a caller
 * needs for "restore what was here before I did anything", not "restore what was here a moment
 * ago mid-batch".
 */
export async function applyExtraKnownMarketplaceOps(
  ops: ExtraKnownMarketplaceOp[],
  settingsPath: string = defaultUserGlobalSettingsPath(),
  opts: ApplyExtraKnownMarketplaceOpsOptions = {},
): Promise<Record<string, unknown | undefined>> {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new TypeError('applyExtraKnownMarketplaceOps requires a non-empty ops array')
  }
  const path = resolveSettingsPath(settingsPath)

  // Captured by the mutator — which `updateJson` may invoke MORE THAN ONCE (lib/json-io.ts
  // retries a stale-write conflict by re-reading and re-running the mutator against the fresh
  // base). Reset on every invocation so a later run's captures — the one attached to the
  // attempt that actually commits — always supersede an earlier, abandoned attempt's; there is
  // no invocation whose captures could survive stale relative to the write that lands.
  let priors: Record<string, unknown | undefined> = {}

  await updateJson(path, data => {
    priors = {}
    const currentExtra = data.extraKnownMarketplaces
    const ekm: Record<string, unknown> | null =
      currentExtra !== null && typeof currentExtra === 'object' && !Array.isArray(currentExtra)
        ? (currentExtra as Record<string, unknown>)
        : null

    const settingsOps: SettingsOp[] = []
    for (const op of ops) {
      // `structuredClone`, not a bare reference: `ekm[op.name]` is the SAME object
      // `applySettingsOps`'s `set` walk mutates IN PLACE below (a `patch` targets
      // `['extraKnownMarketplaces', name, field]`, whose parent IS this entry object) — a bare
      // reference here would read back as the POST-mutation value, not the prior one. MEASURED:
      // without the clone, a `patch: {autoUpdate: true}` on an entry whose prior had
      // `autoUpdate: false` returned a prior of `autoUpdate: true` — the mutation had already
      // happened to the object the "prior" pointed at.
      if (!(op.name in priors)) priors[op.name] = ekm && op.name in ekm ? structuredClone(ekm[op.name]) : undefined

      if (op.delete) {
        settingsOps.push({ op: 'delete', keyPath: ['extraKnownMarketplaces', op.name] })
      } else if (op.patch) {
        for (const [field, value] of Object.entries(op.patch)) {
          settingsOps.push({ op: 'set', keyPath: ['extraKnownMarketplaces', op.name, field], value })
        }
      } else if ('set' in op) {
        settingsOps.push({ op: 'set', keyPath: ['extraKnownMarketplaces', op.name], value: op.set })
      } else {
        // Runtime backstop for a caller crossing a serialisation boundary (HTTP body, CLI argv)
        // that TypeScript cannot check — every in-process caller is already refused this by the
        // `ExtraKnownMarketplaceOp` type.
        throw new TypeError(
          `applyExtraKnownMarketplaceOps: op for "${op.name}" carries none of set/patch/delete`,
        )
      }
    }
    // `applySettingsOps`'s `set` walk auto-vivifies `extraKnownMarketplaces` (and, for a
    // `patch`, the per-name entry) with `create: true` when it is missing or the wrong shape —
    // see lib/settings-gate.ts `walkToParent`. Its `delete` walk uses `create: false` and is a
    // true no-op against a missing/malformed `extraKnownMarketplaces`, matching every writer
    // this module replaces ("absence is a silent success", never a reason to vivify a shell).
    //
    // NO SCHEMA-SHAPE LINT HERE, unlike `editSettings` (lib/settings-gate.ts's `lintTouchedKeys`,
    // private to that module): every writer this module owns already writes a plain object at
    // this exact key path (plugin-storage-service.ts, role-plugin-service.ts x2,
    // auto-update-service.ts, element-management-service.ts's G03b/G05), and `set`/`patch`'s
    // types already refuse a bare string/number/array literal at every in-process call site. Not
    // re-deriving that lint here is a deliberate, narrow gap — noted rather than silently
    // dropped — traded for not exporting a private helper from `lib/settings-gate.ts` to close it.
    applySettingsOps(data, settingsOps)
  }, { createIfMissing: opts.createIfMissing ?? true })
  // UnreadableTargetError, or any other error `updateJson` throws, propagates from here
  // unmodified — see the module doc's DECISION REFINED (4).

  return priors
}
