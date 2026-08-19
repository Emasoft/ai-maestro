/**
 * TRDD corpus graph — the structural invariants of the derived-TRDD model.
 *
 * The rules live in `rules/aimaestro/aimaestro-trdd-approval.md` (§ "A derived
 * TRDD has no derived TRDDs", § "A parent is COMPLETE only when its whole flock
 * is", § D4 "The classification watchdog"). They are stated there as things a
 * watchdog can check "with two greps, no LLM". This module is those greps, typed.
 *
 * Two edges look alike and are not:
 *   - `npt:` / `eht:` are DERIVATION edges — "I spawned this". They establish
 *     parenthood, so a TRDD has at most one parent, and a derived TRDD carries no
 *     children of its own (depth is exactly 1).
 *   - `blocked-by:` is a RUNTIME edge — "I cannot proceed until this resolves".
 *     It establishes nothing, and it lists only OPEN blockers.
 *
 * Conflating the two is the bug this module exists to catch: on 2026-07-10 five
 * siblings each named the same shared platelet in their own `eht:`, giving one
 * child six parents, and two top-level TRDDs each named the other as its child,
 * giving a cycle. Both were dependencies drawn as derivations.
 *
 * A node is checked only once it declares `derived:`. That flag is not cosmetic —
 * `depth1`, `unclaimed`, `kindMismatch` and `parentMismatch` are all gated on it,
 * so a TRDD without it is claimed but unguarded. Adding it is migrate-on-touch.
 */
import { TRDD_ZONES, listTrddFiles, parseTrddFile, type ParsedTrdd, type TrddZone } from '@/lib/trdd-store'
// V1_STATUS_TO_COLUMN and TERMINAL_DONE moved to lib/trdd-vocabulary.ts (a LEAF module,
// importing only @/types/task) so lib/trdd-edit-guard.ts can share this grammar without
// closing a cycle back through trdd-store.ts. Re-exported here so every existing importer
// of this module (and its own use below) is unaffected by the move.
import { TERMINAL_DONE, V1_STATUS_TO_COLUMN } from '@/lib/trdd-vocabulary'
export { TERMINAL_DONE, V1_STATUS_TO_COLUMN }

export interface TrddNode {
  id: string
  zone: TrddZone
  filePath: string
  column: string
  derived: boolean
  hasDerivedField: boolean
  derivedKind: string | null
  parent: string | null
  npt: string[]
  eht: string[]
  blockedBy: string[]
  /**
   * The RAW non-local `blocked-by:` spellings (`gh:owner/repo#n`, `<project-id>:TRDD-<id8>`)
   * — real blockers the LOCAL graph cannot resolve, kept un-normalized because the raw
   * spelling IS the information (TRDD-PTFPGSLV).
   */
  externalBlockers: string[]
}

export type ViolationKind =
  | 'depth1'
  | 'parentIsDerived'
  | 'unclaimed'
  | 'twoParents'
  | 'cycle'
  | 'kindMismatch'
  | 'parentMismatch'
  | 'childMissing'
  | 'childDerivedFalse'
  | 'falseComplete'
  | 'orderCycle'
  | 'blockedNotBlocked'
  | 'danglingBlocker'
  | 'unknownBlocker'
  | 'externalBlocker'
  | 'crossProjectBlocker'

export interface TrddViolation {
  kind: ViolationKind
  id: string
  detail: string
}

/**
 * The join key across every TRDD reference is the 8-char PREFIX, not the whole
 * `trdd-id:`. The corpus mixes v1 full-UUID ids (`903b7a20-bddf-4368-…`) with v2
 * 8-char base36 ids, and every cross-reference cites the first eight characters.
 * Matching on the full id invents missing children that are sitting right there.
 */
export function normalizeTrddRef(ref: unknown): string {
  return String(ref).trim().replace(/^TRDD-/i, '').toUpperCase().slice(0, 8)
}

/**
 * The two NON-LOCAL `blocked-by:` spellings (TRDD-PTFPGSLV). Each names a REAL blocker the
 * local graph cannot resolve — a GitHub issue, or a TRDD owned by another project's corpus —
 * so neither may reach `normalizeTrddRef`, whose 8-char slice would mangle
 * `gh:Emasoft/ai-maestro#145` into `GH:EMASO` and report a phantom unknown id. Anything
 * matching NEITHER shape keeps today's behavior: treated as a local id, ERROR when it does
 * not resolve (`ai-maestro#145` is deliberately not a sanctioned spelling).
 */
const EXTERNAL_ISSUE_RE = /^gh:[^\s#]+#\d+$/i
const CROSS_PROJECT_RE = /^[a-z0-9][a-z0-9-]*:TRDD-[A-Z0-9]{8}$/i

export function classifyBlockerRef(raw: unknown): 'local' | 'external-issue' | 'cross-project' {
  const s = String(raw ?? '').trim()
  if (EXTERNAL_ISSUE_RE.test(s)) return 'external-issue'
  if (CROSS_PROJECT_RE.test(s)) return 'cross-project'
  return 'local'
}

/** The raw values of a ref field, before any normalization — shared by the two filters below. */
function rawRefValues(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim() && v.trim() !== 'null') return [v.trim()]
  return []
}

/**
 * The LOCALLY-RESOLVABLE refs of a field. Only `blocked-by:` admits the non-local spellings,
 * so only there are they filtered out (everywhere else a `gh:` ref stays mangled-and-ERRORed,
 * exactly as before — silently dropping it from an `npt:` would soften `childMissing`). This
 * is the ONE owner of that decision: the graph, the pillar index and trddgrep's board must all
 * drop the same edge for the same reason, or the walk-vs-index differential compares shapes.
 */
export function localRefList(field: string, v: unknown): string[] {
  if (field !== 'blocked-by') return refList(v)
  return rawRefValues(v)
    .filter((s) => classifyBlockerRef(s) === 'local')
    .map(normalizeTrddRef)
    .filter(Boolean)
}

/** The RAW non-local refs of a `blocked-by:` value — never normalized. */
export function externalRefList(v: unknown): string[] {
  return rawRefValues(v).filter((s) => classifyBlockerRef(s) !== 'local')
}

/**
 * Exported so the pillar INDEX derives its edges from the same helpers the graph
 * does. Two readers with their own notion of "what counts as a reference" would
 * disagree silently — and the index exists precisely to answer the graph's question
 * faster, so a divergence there is worse than no index.
 */
export function refList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(normalizeTrddRef).filter(Boolean)
  // A single bare scalar (`npt: TRDD-X`) is a lone reference, not a list.
  if (typeof v === 'string' && v.trim() && v.trim() !== 'null') return [normalizeTrddRef(v)]
  return []
}

/**
 * The frontmatter fields that impose ORDER — this card cannot proceed until those do.
 *
 * A CONSTANT rather than a literal at each site, for the same reason `refList` is
 * exported: `scripts/greptrdd.mjs` reads them off the frontmatter and
 * `lib/pillar/index-open.ts` reads them back out of the `edges` table, so a field
 * added here that only one of them learns about would make the board and the index
 * disagree about what "blocked" means. The ORDER of this tuple is load-bearing too —
 * it is the order the refs appear in, and therefore the order every blocker chain
 * prints in.
 */
export const BLOCKER_FIELDS = ['blocked-by', 'npt'] as const

/**
 * `priority` as a STRING or null — the one form the walk and the index both produce.
 *
 * The index stores it in a TEXT column, so a card rebuilt from a row can only ever
 * hand back a string; a walk that handed back the raw YAML number would make the two
 * paths differ in TYPE while agreeing on VALUE, and the differential test would then
 * be comparing shapes rather than answers. Normalizing both to text is invisible at
 * the surface — `P${0}` and `P${'0'}` print identically, and `String(x ?? 9)` sorts
 * identically — which is precisely what makes it safe to do.
 */
export function normalizePriority(v: unknown): string | null {
  return v === undefined || v === null ? null : String(v)
}

/** Exported for the pillar index, for the same reason as `refList`. */
export function optionalRef(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s === 'null') return null
  return normalizeTrddRef(s)
}

/** The TRDD's column, reading a v1 `status:` when `column:` is absent. */
export function resolveTrddColumn(t: ParsedTrdd): string {
  if (t.column) return t.column
  const status = typeof t.frontmatter.status === 'string' ? t.frontmatter.status : ''
  return V1_STATUS_TO_COLUMN[status] ?? ''
}

/**
 * A parsed TRDD becomes a graph node only if it carries frontmatter. Seven
 * pre-frontmatter v0 files keep their id in a `**TRDD ID:**` body line and have no
 * fields to check. They are deliberately absent from the graph, so a parent that
 * names one is reported as `childMissing` — the right alarm, not silence.
 */
export function toGraphNode(t: ParsedTrdd): TrddNode | null {
  const fm = t.frontmatter
  if (!('trdd-id' in fm)) return null
  return {
    id: t.id,
    zone: t.zone,
    filePath: t.filePath,
    column: resolveTrddColumn(t),
    derived: fm.derived === true,
    hasDerivedField: 'derived' in fm,
    derivedKind: typeof fm['derived-kind'] === 'string' ? fm['derived-kind'] : null,
    parent: optionalRef(fm['parent-trdd']),
    npt: refList(fm.npt),
    eht: refList(fm.eht),
    blockedBy: localRefList('blocked-by', fm['blocked-by']),
    externalBlockers: externalRefList(fm['blocked-by']),
  }
}

/** Every frontmatter-bearing TRDD across all four zones. */
export function loadTrddGraph(designDir: string): TrddNode[] {
  const nodes: TrddNode[] = []
  for (const zone of TRDD_ZONES) {
    for (const file of listTrddFiles(designDir, zone)) {
      const parsed = parseTrddFile(file, zone)
      if (!parsed) continue
      const node = toGraphNode(parsed)
      if (node) nodes.push(node)
    }
  }
  return nodes
}

interface Claim {
  parent: string
  kind: 'npt' | 'eht'
}

export function checkTrddInvariants(nodes: TrddNode[]): TrddViolation[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const v: TrddViolation[] = []

  // Who names whom as a child.
  const claims = new Map<string, Claim[]>()
  for (const n of nodes) {
    for (const c of n.npt) claims.set(c, [...(claims.get(c) ?? []), { parent: n.id, kind: 'npt' }])
    for (const c of n.eht) claims.set(c, [...(claims.get(c) ?? []), { parent: n.id, kind: 'eht' }])
  }

  for (const n of nodes) {
    // Depth is exactly 1: a derived TRDD ships its own changes or is accompanied
    // by SIBLINGS under the same parent. Without this the flock is unbounded and
    // the parent's completion gate recurses forever.
    if (n.derived && (n.npt.length || n.eht.length)) {
      v.push({ kind: 'depth1', id: n.id, detail: `derived, yet npt=[${n.npt}] eht=[${n.eht}]` })
    }

    if (n.parent) {
      const p = byId.get(n.parent)
      if (!p) v.push({ kind: 'childMissing', id: n.id, detail: `parent-trdd ${n.parent} not found` })
      else if (p.derived) v.push({ kind: 'parentIsDerived', id: n.id, detail: `parent ${n.parent} is itself derived` })
    }

    // One parent. A child claimed by two or more is the shared-dependency-drawn-
    // as-a-derivation mistake; a cycle is its degenerate two-node case.
    const cs = claims.get(n.id) ?? []
    if (cs.length > 1) {
      v.push({ kind: 'twoParents', id: n.id, detail: `claimed by ${cs.map((c) => `${c.parent}:${c.kind}`).join(', ')}` })
    }
    for (const c of cs) {
      if (n.npt.includes(c.parent) || n.eht.includes(c.parent)) {
        v.push({ kind: 'cycle', id: n.id, detail: `${n.id} and ${c.parent} each claim the other as a child` })
      }
    }

    if (n.derived) {
      if (cs.length === 0) {
        v.push({ kind: 'unclaimed', id: n.id, detail: 'declares derived, but no parent lists it' })
      } else if (cs.length === 1) {
        const [c] = cs
        if (n.derivedKind && n.derivedKind !== c.kind) {
          v.push({ kind: 'kindMismatch', id: n.id, detail: `says ${n.derivedKind}, ${c.parent} lists it under ${c.kind}` })
        }
        if (n.parent !== c.parent) {
          v.push({ kind: 'parentMismatch', id: n.id, detail: `parent-trdd=${n.parent}, but claimed by ${c.parent}` })
        }
      }
    }

    for (const kind of ['npt', 'eht'] as const) {
      for (const c of n[kind]) {
        const child = byId.get(c)
        if (!child) v.push({ kind: 'childMissing', id: n.id, detail: `${kind} names ${c}, which does not exist` })
        else if (child.hasDerivedField && !child.derived) {
          v.push({ kind: 'childDerivedFalse', id: n.id, detail: `${kind} names ${c}, which says derived: false` })
        }
      }
    }

    // The flock gate: a terminal parent whose child is still open has not finished
    // — it shipped a change and left the hole it opened. Its honest column is
    // `blocked`, on itself. A non-terminal parent claims nothing, so it is exempt.
    if (TERMINAL_DONE.has(n.column)) {
      const open = [...n.npt, ...n.eht].filter((c) => {
        const k = byId.get(c)
        return k && !TERMINAL_DONE.has(k.column)
      })
      if (open.length) v.push({ kind: 'falseComplete', id: n.id, detail: `column=${n.column} with open children: ${open}` })
    }

    if (n.blockedBy.length || n.externalBlockers.length) {
      if (!TERMINAL_DONE.has(n.column) && n.column !== 'blocked') {
        v.push({ kind: 'blockedNotBlocked', id: n.id, detail: `column=${n.column} with blocked-by=[${[...n.blockedBy, ...n.externalBlockers]}]` })
      }
      for (const b of n.blockedBy) {
        const bd = byId.get(b)
        if (!bd) v.push({ kind: 'unknownBlocker', id: n.id, detail: `blocked-by ${b}, which does not exist` })
        else if (TERMINAL_DONE.has(bd.column)) {
          v.push({ kind: 'danglingBlocker', id: n.id, detail: `blocked-by ${b}, which is ${bd.column} — stale` })
        }
      }
      // A non-local blocker is a WARN, never an ERROR: the blocker is real, the graph just
      // carries no edge for it. Removing the entry to silence the tool would blind the board
      // (TRDD-PTFPGSLV — COS and AMAMA both measured the old mangled-ERROR on live corpora).
      for (const e of n.externalBlockers) {
        v.push(
          classifyBlockerRef(e) === 'external-issue'
            ? { kind: 'externalBlocker', id: n.id, detail: `blocked-by ${e} — an external issue; the graph carries no edge for it` }
            : { kind: 'crossProjectBlocker', id: n.id, detail: `blocked-by ${e} — a cross-project TRDD, not locally resolvable; track it in the owning corpus` },
        )
      }
    }
  }

  v.push(...findOrderCycles(nodes))
  return v
}

/**
 * Rings in the WAIT-FOR graph, of any length.
 *
 * The edges are the two that impose ORDER: `blocked-by` (A cannot proceed until B
 * resolves) and `npt` (a parent cannot pass `dev` until its prerequisite does). A
 * ring in that graph is a deadlock — no member can EVER start, because each is
 * waiting on the next, forever. It is the one corpus defect that cannot resolve
 * itself with time, so it must be an error, not a warning.
 *
 * This is DISTINCT from `cycle`, which is the degenerate two-node case in the
 * DERIVATION graph (each claims the other as a child). A three-card blocked-by
 * ring trips nothing there, which is exactly how it went undetected.
 */
function findOrderCycles(nodes: TrddNode[]): TrddViolation[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const waitsOn = (id: string): string[] => {
    const n = byId.get(id)
    if (!n) return []
    // Dedupe: a card may name the same id in both blocked-by and npt.
    return [...new Set([...n.blockedBy, ...n.npt])].filter((x) => byId.has(x))
  }

  const state = new Map<string, 'open' | 'done'>()
  const reported = new Set<string>()
  const out: TrddViolation[] = []

  // Iterative DFS — the corpus is small, but a recursive walk over a cyclic graph
  // is the classic way to turn a data bug into a stack overflow.
  for (const start of nodes) {
    if (state.get(start.id)) continue
    const path: string[] = []
    const stack: Array<{ id: string; next: number }> = [{ id: start.id, next: 0 }]
    state.set(start.id, 'open')
    path.push(start.id)

    while (stack.length) {
      const top = stack[stack.length - 1]
      const edges = waitsOn(top.id)
      if (top.next >= edges.length) {
        state.set(top.id, 'done')
        stack.pop()
        path.pop()
        continue
      }
      const nxt = edges[top.next++]
      const s = state.get(nxt)
      if (s === 'done') continue
      if (s === 'open') {
        // Found a ring. Canonicalize by rotating to the smallest id so the same
        // ring is reported once, whichever node we happened to enter it from.
        const ring = path.slice(path.indexOf(nxt))
        const min = ring.indexOf([...ring].sort()[0])
        const rot = [...ring.slice(min), ...ring.slice(0, min)]
        const key = rot.join('>')
        if (!reported.has(key)) {
          reported.add(key)
          out.push({
            kind: 'orderCycle',
            id: rot[0],
            detail: `wait-for ring (nothing in it can ever start): ${[...rot, rot[0]].join(' → ')}`,
          })
        }
        continue
      }
      state.set(nxt, 'open')
      path.push(nxt)
      stack.push({ id: nxt, next: 0 })
    }
  }
  return out
}

export interface BacklogEntry {
  id: string
  claimedBy: string
}

/**
 * Claimed children that have not declared `derived:` yet. NOT a violation — the
 * field postdates most of the corpus, and the policy is migrate-on-touch. Surfaced
 * so the backlog is visible without failing anyone's build.
 */
export function migrationBacklog(nodes: TrddNode[]): BacklogEntry[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const out: BacklogEntry[] = []
  for (const n of nodes) {
    for (const kind of ['npt', 'eht'] as const) {
      for (const c of n[kind]) {
        const child = byId.get(c)
        if (!child || child.hasDerivedField || seen.has(c)) continue
        seen.add(c)
        out.push({ id: c, claimedBy: `${n.id}.${kind}` })
      }
    }
  }
  return out
}
