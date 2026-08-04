/**
 * The ONE transport-agnostic entry point for editing a `settings.json` /
 * `settings.local.json` file (TRDD-RYFP030K).
 *
 * Both `app/api/settings/edit/route.ts` (the HTTP transport) and
 * `scripts/aimaestro-settings-cli.mjs` (the direct-node transport the CLI wrapper
 * `scripts/aimaestro-settings.sh` invokes — deliberately NOT over HTTP, because the
 * installer runs with the ai-maestro server DOWN) call THIS function. Neither calls
 * `lib/json-io.ts`'s `updateJson` directly and neither hand-rolls an `fs` write — this
 * is the ONE gate between "a caller outside `lib/json-io.ts`'s own module" and the
 * settings file on disk (Plugin Abstraction Principle, CLAUDE.md: the core lives in
 * `lib/`, every other surface is a thin transport over it).
 *
 * WHY AN OPS GRAMMAR, NOT A RAW MUTATOR: `updateJson`'s mutator parameter is a plain JS
 * function, which neither an HTTP request body nor a shell argv can carry across a
 * process boundary. The two ops below (`set`, `delete` on a nested key path) are the
 * bounded, JSON-serializable subset that every real call site in this codebase already
 * needs — every one of the ~30 sites this card's TRDD migrated does exactly one of
 * those two things to `enabledPlugins`, `extraKnownMarketplaces`, or similar maps. This
 * is deliberately NOT AgentlensPro's `apply_ops` grammar (rejected for the CORE
 * primitive per the TRDD, for lacking a root-level `set` and for the auto-rollback
 * hazard) — it is a much narrower shape purpose-built for a network/CLI transport, not
 * a general mutation DSL.
 */
import { basename, dirname, resolve } from 'path'
import {
  updateJson,
  readJson,
  type UpdateJsonResult,
  type JsonRead,
  type JsonLockOpts,
} from './json-io'

/** Thrown by {@link resolveSettingsPath} — never by anything downstream, so a caller can
 *  tell "this path was rejected before touching disk" from every other failure mode. */
export class InvalidSettingsPathError extends Error {
  constructor(public readonly rawPath: string, reason: string) {
    super(`refusing to edit "${rawPath}": ${reason}`)
    this.name = 'InvalidSettingsPathError'
  }
}

/** The only two filenames this gate will ever write. Anything else — a plugin manifest,
 *  the agent registry, `/etc/passwd` — is refused before `resolve()`'s result is even
 *  looked at a second time. */
const ALLOWED_BASENAMES = new Set(['settings.json', 'settings.local.json'])

/**
 * Validate + resolve a caller-supplied path to a settings file this gate is allowed to
 * touch. TWO independent checks, both load-bearing:
 *
 *   1. BASENAME — only `settings.json` or `settings.local.json`. Rejects every other
 *      filename outright, regardless of directory.
 *   2. PARENT DIRECTORY NAME — every legitimate settings file (the human user's own
 *      global one, or any agent's per-workdir one) lives directly inside a `.claude/`
 *      directory. Rejects e.g. `~/.claude/skills/settings.json` or a caller trying to
 *      walk the shape of this gate into somewhere it was never meant to reach.
 *
 * `path.resolve()` collapses any `..` segments BEFORE either check runs, so a traversal
 * attempt (`../../../etc/.claude/settings.json`) is evaluated against where it ACTUALLY
 * points, never against the raw string — the checks above are what then refuse it (in
 * that example, `.claude` would have to be a real directory literally named `.claude`
 * containing a file literally named `settings.json`, which is exactly the shape this
 * gate is willing to write regardless of where on disk it sits; the resolve() call is
 * what prevents a `..`-obscured path from *bypassing* the two checks, not a third check
 * of its own).
 */
export function resolveSettingsPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new InvalidSettingsPathError(String(rawPath), 'a non-empty path is required')
  }
  const resolved = resolve(rawPath)
  const base = basename(resolved)
  if (!ALLOWED_BASENAMES.has(base)) {
    throw new InvalidSettingsPathError(
      rawPath,
      `only "settings.json" or "settings.local.json" may be edited through this gate, not "${base}"`,
    )
  }
  if (basename(dirname(resolved)) !== '.claude') {
    throw new InvalidSettingsPathError(
      rawPath,
      `must live directly inside a ".claude" directory, not "${dirname(resolved)}"`,
    )
  }
  return resolved
}

/**
 * Key-path segments that are REFUSED outright, at every position.
 *
 * `walkToParent` reaches an intermediate segment with a plain `cursor[seg]`, and for the
 * literal string `__proto__` that expression is NOT a property lookup on the data object —
 * it resolves to `Object.prototype`. A `set` op with `keyPath: ['__proto__', 'x']` therefore
 * walks OUT of the parsed settings document and writes `x` onto the prototype of every
 * object in the server process, while the settings file itself is left untouched (so the
 * write even reports `changed: false`). `constructor`/`prototype` are refused for the same
 * class of reachability, belt-and-braces: today `cursor['constructor']` is a FUNCTION, so
 * the `typeof next !== 'object'` branch below replaces it with a plain `{}` own-property and
 * the walk cannot escape — but that containment is an accident of the shape check, not a
 * decision, and it would silently vanish if that branch were ever relaxed.
 *
 * No legitimate settings key is named any of these: the real key paths are
 * `enabledPlugins`, `extraKnownMarketplaces`, `hooks`, and plugin/marketplace names.
 */
const FORBIDDEN_KEY_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/** A single, JSON-serializable mutation. `keyPath` is a list of object keys walked from
 *  the settings file's root — `['enabledPlugins', 'foo@bar']` means `data.enabledPlugins['foo@bar']`. */
export type SettingsOp =
  | { op: 'set'; keyPath: string[]; value: unknown }
  | { op: 'delete'; keyPath: string[] }

/**
 * Walk nested objects along `keyPath`, returning the immediate parent of the leaf key so
 * the caller can read/write/delete it.
 *
 * `create` controls what happens when an intermediate segment is missing (or is not
 * itself a plain object), and the two callers below deliberately choose OPPOSITE
 * behaviour:
 *   - `set` passes `create: true` — a caller asking to set `a.b.c` when `a` is currently
 *     `5` (or absent) is asking for the path to EXIST, not for the write to silently
 *     no-op two levels up. Every missing/wrong-shaped segment is REPLACED with `{}`.
 *   - `delete` passes `create: false` and gets `null` back when the path is not there —
 *     deleting something that was never present must be a TRUE no-op, not a side effect
 *     that plants an empty object where nothing existed before. Without this split, a
 *     `delete enabledPlugins.foo` against a settings file that has no `enabledPlugins`
 *     yet would leave `enabledPlugins: {}` behind — a real, if harmless, mutation for an
 *     operation whose whole point is "make sure this is gone".
 */
function walkToParent(
  data: Record<string, unknown>,
  keyPath: string[],
  opts: { create: boolean },
): { parent: Record<string, unknown>; leaf: string } | null {
  let cursor: Record<string, unknown> = data
  for (const seg of keyPath.slice(0, -1)) {
    const next = cursor[seg]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      if (!opts.create) return null
      cursor[seg] = {}
    }
    cursor = cursor[seg] as Record<string, unknown>
  }
  return { parent: cursor, leaf: keyPath[keyPath.length - 1] }
}

/** Apply every op in order, mutating `data` in place — this is the mutator body
 *  `updateJson` runs under its lock. Exported so a caller who already holds a validated
 *  path (e.g. a test) can exercise the mutation logic without a real file. */
export function applySettingsOps(data: Record<string, unknown>, ops: SettingsOp[]): void {
  for (const op of ops) {
    if (!Array.isArray(op.keyPath) || op.keyPath.length === 0 || !op.keyPath.every(k => typeof k === 'string')) {
      throw new TypeError(`settings op "${op.op}" needs a non-empty keyPath of strings`)
    }
    // Refuse BEFORE the walk, not inside it: by the time `walkToParent` has stepped onto
    // `Object.prototype` the damage is one assignment away, and the `delete` path would
    // equally delete OFF the prototype. Checked here rather than in `walkToParent` so both
    // ops are covered by one check that runs before either of them touches `data`.
    const bad = op.keyPath.find(k => FORBIDDEN_KEY_SEGMENTS.has(k))
    if (bad !== undefined) {
      throw new TypeError(
        `settings op "${op.op}" refuses the key-path segment "${bad}": it addresses the object ` +
        `prototype, not the settings document (prototype-pollution guard)`,
      )
    }
    if (op.op === 'set') {
      const loc = walkToParent(data, op.keyPath, { create: true })
      // create:true never returns null — the non-null assertion documents that, not a runtime check.
      loc!.parent[loc!.leaf] = op.value
    } else if (op.op === 'delete') {
      const loc = walkToParent(data, op.keyPath, { create: false })
      if (loc) delete loc.parent[loc.leaf]
    } else {
      // Exhaustiveness guard: TypeScript already refuses a third `op` value at the call
      // site, but a caller crossing the JSON boundary (HTTP body, CLI --ops) is not
      // type-checked, so this is the runtime backstop for that path.
      throw new TypeError(`unknown settings op: "${(op as { op: string }).op}"`)
    }
  }
}

export interface EditSettingsOpts extends JsonLockOpts {
  /** Create the file (starting from `{}`) if it does not exist yet. Default `true` — an
   *  install script's first write to a brand-new agent's `settings.local.json` is the
   *  common case, mirroring every existing `updateJson(..., { createIfMissing: true })`
   *  call site this gate replaces. */
  createIfMissing?: boolean
  /** Forwarded to `updateJson`'s key-loss tripwire. Default `true`: every mutation here
   *  is an EXPLICIT, caller-named `set`/`delete` on a specific key path — never the
   *  "rebuild a minimal object" shape the tripwire exists to catch — so a `delete` op
   *  that happens to remove a top-level key is not an accident, it is the ask. A caller
   *  that wants the tripwire active anyway (e.g. a defensive script) may pass `false`. */
  allowKeyLoss?: boolean
}

/**
 * THE ONE WAY to mutate a settings file from outside `lib/json-io.ts`'s own module.
 * Validates the path, then applies `ops` under the shared cross-process lock via
 * `updateJson` — the same fsync + backup + staleness-checked write every other
 * participating writer in this codebase now goes through.
 */
export async function editSettings(
  rawPath: string,
  ops: SettingsOp[],
  opts: EditSettingsOpts = {},
): Promise<UpdateJsonResult> {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new TypeError('editSettings requires a non-empty ops array')
  }
  const path = resolveSettingsPath(rawPath)
  return updateJson(path, data => { applySettingsOps(data, ops) }, {
    createIfMissing: opts.createIfMissing ?? true,
    allowKeyLoss: opts.allowKeyLoss ?? true,
    staleMs: opts.staleMs,
    maxWaitMs: opts.maxWaitMs,
  })
}

/**
 * THE ONE WAY to read a settings file through this gate. Validates the path, then
 * delegates to `readJson` — which distinguishes "missing" from "unreadable" rather than
 * collapsing both to `{}`, so a caller can tell a first-run file from a corrupt one.
 */
export async function readSettings(rawPath: string): Promise<JsonRead> {
  const path = resolveSettingsPath(rawPath)
  return readJson(path)
}
