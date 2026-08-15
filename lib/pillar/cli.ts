/**
 * TRDD-D7KVF4HQ — the shared CLI core behind `prrdgrep` and `specgrep`.
 *
 * ONE implementation, N entry points — the same shape `scripts/pillar-cli` already
 * uses for the launcher (it dispatches on `basename $0`). `scripts/prrdgrep.mjs` and
 * `scripts/specgrep.mjs` are four-line wrappers that hand this function a `PillarKind`
 * and nothing else. Two near-identical CLIs would drift on the day one of them gained
 * a flag, and the drift would be invisible: each would keep passing its own tests.
 *
 * WHY THIS IS NOT `trddgrep` WITH A `--kind` FLAG. trddgrep's centre of gravity is the
 * blocker GRAPH — `why`, `roots`, `unblocks`, `next`, `board` all answer "what is
 * holding this up?", and neither PRRD nor SPEC has blockers, columns, or a lifecycle.
 * Forcing them into it would mean a tool whose help text is mostly verbs that refuse.
 * What the three genuinely share is the corpus reader (`lib/pillar/store.ts`) and the
 * write seam (`lib/pillar/edit.ts`), and those are shared as libraries — which is the
 * sharing that matters, because it is where correctness lives.
 *
 * THE EDIT VERB IS THE POINT (USER, 2026-08-03). Design folders are symlinked between
 * agents, so N agents in N processes edit one corpus with nothing serialising them.
 * The USER specified the primitive verbatim: **AT LINE N REPLACE X WITH Y** — "so if X
 * is not found, this means the file has changed and the command is blocked". That is
 * `replaceAtLines`, and these CLIs are how a human or an agent reaches it.
 *
 * EXIT CODES — grep's trichotomy, which every pillar tool here already follows:
 *   0  the query answered, or the edit landed
 *   1  nothing matched (an unknown id, a search with no hits)
 *   2  THE COMMAND COULD NOT RUN — no corpus, a bad flag, or a BLOCKED edit
 *
 * A blocked edit is a 2, not a 1: the caller asked for a mutation and none happened,
 * which is a different answer from "I looked and found nothing". Because 2 also covers
 * "no corpus", a retry loop must NOT key on the code alone — the stale block prints
 * `STALE` as its first stderr token precisely so a caller can tell "re-read and retry"
 * from "you are in the wrong directory", which is a distinction no exit code in the
 * trichotomy can carry. A GRAMMAR refusal (lib/pillar/edit-guard, TRDD-2R34M8FA)
 * prints `BLOCKED` as its first token — the third exit-2 class: the edit itself is
 * illegal, so unlike STALE, re-reading and retrying unchanged refuses identically.
 */
import path from 'path'
import type { PillarKind } from './kinds'
import { corpusRootFor } from './kinds'
import { assertCorpusRoot, findRecord, walkRecords, type PillarRecord } from './store'
import { documentLockKeyFor, replaceAtLines, StaleDocumentError, type LineEdit } from './edit'
import { GuardedEditError, pillarPreWriteCheck } from './edit-guard'

/** Colour, but only for a human. A pipe or a test spawn gets clean bytes. */
export function palette(useColour: boolean) {
  const w = (code: string) => (s: string) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s)
  return { b: w('1'), d: w('2'), r: w('31'), g: w('32'), y: w('33'), c: w('36') }
}

/**
 * One `--at-line N --expect X --replace Y` triple, and its repeats.
 *
 * The flags REPEAT so a caller can issue a batch, and the batch matters: `replaceAtLines`
 * is all-or-nothing, so a two-edit batch where the second is stale leaves the file
 * byte-identical. A CLI that could only ever send one edit could never reach that
 * guarantee, and the atomicity the USER asked for would exist in the library and be
 * unreachable from the tool that exists to expose it.
 *
 * Parsed by a LEFT-TO-RIGHT scan rather than by index arithmetic on a shared list.
 * trddgrep's own header records why: locating a flag by index in a list that still
 * holds other flags is an ordering hazard that returns with every flag added.
 */
export function parseEditFlags(argv: string[]): { edits: Partial<LineEdit>[]; rest: string[] } {
  const edits: Partial<LineEdit>[] = []
  const rest: string[] = []
  let current: Partial<LineEdit> | null = null

  const field = (flag: string): keyof LineEdit | null =>
    flag === '--at-line' ? 'line' : flag === '--expect' ? 'expect' : flag === '--replace' ? 'replace' : null

  for (let i = 0; i < argv.length; i++) {
    const key = field(argv[i])
    if (!key) {
      rest.push(argv[i])
      continue
    }
    // `--at-line` ALWAYS opens the next edit; the other two open one only when the
    // current edit already has that field. This is not symmetry for its own sake — it
    // is the USER's own word order, `AT LINE N REPLACE X WITH Y`, where the line is the
    // LEADING token. Under a plain "any repeat opens the next edit" rule, a trailing
    // `--expect A --replace B --at-line 9 --expect C --replace D` binds line 9 to the
    // FIRST pair (its `line` slot was still free), silently aiming edit 1 at edit 2's
    // line. Measured, on exactly that command line, before this branch existed.
    if (!current || key === 'line' || current[key] !== undefined) {
      current = {}
      edits.push(current)
    }
    const value = argv[++i]
    if (value === undefined) throw new UsageError(`${argv[i - 1]} needs a value`)
    if (key === 'line') {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1) {
        throw new UsageError(`--at-line takes a positive integer, not ${JSON.stringify(value)}`)
      }
      current.line = n
    } else {
      current[key] = value
    }
  }
  return { edits, rest }
}

/** A caller-input fault: exits 2, because the command could not run as asked. */
export class UsageError extends Error {}

/**
 * Pull `--name <value>` out of the list.
 *
 * A MISSING value is a UsageError, never `''`. The old `?? ''` failed OPEN in both
 * callers and neither failure was visible: `Number('') === 0`, and `0` is `--limit`'s
 * documented "no limit" sentinel, so a truncated `--limit` UNCAPPED the output the cap
 * exists to bound (measured: 60 of 60 records instead of the 50-row cap). `path.resolve('')`
 * is the cwd, so a valueless `--design-dir` silently pointed the tool at `<cwd>` instead of
 * `<cwd>/design` and then blamed the working directory in its diagnostic.
 */
function takeFlag(list: string[], name: string): [string | undefined, string[]] {
  const i = list.indexOf(name)
  if (i < 0) return [undefined, list]
  const value = list[i + 1]
  if (value === undefined) throw new UsageError(`${name} needs a value`)
  return [value, [...list.slice(0, i), ...list.slice(i + 2)]]
}

/**
 * Run the CLI for one pillar. Never returns — it always exits with a trichotomy code.
 *
 * `argv` is `process.argv.slice(2)`, taken as a parameter rather than read from the
 * global so a test can drive the whole surface in-process. The spawn tests still exist
 * (an exit code is a contract of the BINARY, and nothing that imports a library can
 * observe it), but they are slow, and a fast in-process path is what makes it
 * affordable to cover every branch.
 */
export async function runPillarCli(kind: PillarKind, argv: string[]): Promise<never> {
  const C = palette(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR)
  const tool = `${kind.name}grep`

  const die = (msg: string, code: 1 | 2): never => {
    console.error(`${tool}: ${msg}`)
    process.exit(code)
  }

  try {
    let rest = argv
    let designDirVal: string | undefined
    let limitVal: string | undefined
    ;[designDirVal, rest] = takeFlag(rest, '--design-dir')
    ;[limitVal, rest] = takeFlag(rest, '--limit')

    const designDir = path.resolve(designDirVal ?? path.join(process.cwd(), 'design'))
    const root = corpusRootFor(designDir, kind)

    const limit = limitVal === undefined ? 50 : Number(limitVal)
    if (!Number.isInteger(limit) || limit < 0) {
      throw new UsageError(`--limit takes a non-negative integer (0 = no limit), not ${JSON.stringify(limitVal)}`)
    }

    const { edits: rawEdits, rest: positional } = parseEditFlags(rest)
    const cmd = positional[0] ?? 'list'
    const arg = positional[1]

    // `env` and `help` are EXEMPT from the corpus check, and the exemption is the
    // whole point of `env`: it explains what the tool concluded about where it is
    // running, so gating it on a corpus existing makes the diagnostic unavailable in
    // exactly the situation that prompts someone to ask for it.
    if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
      printHelp(kind, C)
      return process.exit(0)
    }
    if (cmd === 'env') {
      const { resolvePillarEnvironment } = await import('./environment')
      const env = resolvePillarEnvironment()
      console.log(`mode=${env.mode}`)
      if (env.mode === 'agent') {
        console.log(`agent=${env.agentName}`)
        console.log(`workdir=${env.workdir}`)
      }
      console.log(`reason=${env.reason}`)
      console.log(`corpus=${root}`)
      return process.exit(0)
    }

    // An UNKNOWN OPTION is a could-not-run (2), never a no-match (1).
    //
    // Every `--flag` this tool understands has been stripped by now, so anything still
    // carrying a `--` prefix is a typo or a flag from another tool — and the `default:`
    // branch below would otherwise fold it into the SEARCH PATTERN and report exit 1,
    // "no record matches". That is the forbidden collapse, in the direction that lies to a
    // caller: measured, `prrdgrep G1.1 --limt 5` answered "no PRRD record matches
    // \"G1.1 --limt 5\"" with exit 1, telling a gate that rule G1.1 does not exist because
    // the gate's own flag had a typo in it.
    const unknown = positional.find((t) => t.startsWith('--'))
    if (unknown) throw new UsageError(`unknown option ${unknown} — see \`${tool} help\``)

    // Throws with the kind's own label on an absent or unreadable root. This is what
    // separates "the corpus is empty" from "you are not where you think you are" — a
    // distinction a tool that answered `[]` for both could never make.
    assertCorpusRoot(root, kind)

    switch (cmd) {
      case 'edit':
        return await runPillarEdit(kind, root, arg, rawEdits, C, tool)

      case 'show': {
        if (!arg) throw new UsageError(`show needs an id — try \`${tool} list\``)
        const rec = findRecord(root, kind, arg)
        if (!rec) return die(`no ${kind.label} record ${JSON.stringify(arg)} under ${root}`, 1)
        printRecord(rec, root, C)
        return process.exit(0)
      }

      case 'list': {
        const all = [...walkRecords(root, kind)]
        // The root EXISTS (assertCorpusRoot passed) and holds no records. That is a
        // real answer, not a fault — but it is `1`, because a caller scripting on
        // this must not read "nothing here" as "here is everything".
        if (all.length === 0) return die(`no ${kind.label} records under ${root}`, 1)
        printRecords(all, limit, root, C, tool)
        return process.exit(0)
      }

      default: {
        // Anything else is a SEARCH pattern — the same fall-through trddgrep uses, so
        // `prrdgrep governance` works without a verb.
        const pattern = positional.join(' ')
        const hits = search([...walkRecords(root, kind)], pattern, kind)
        if (hits.length === 0) {
          return die(`no ${kind.label} record matches ${JSON.stringify(pattern)}`, 1)
        }
        printRecords(hits, limit, root, C, tool)
        return process.exit(0)
      }
    }
  } catch (err) {
    if (err instanceof StaleDocumentError) {
      // `STALE` first, deliberately: exit 2 also means "no corpus", so the token is
      // the only thing a retry loop can safely key on.
      console.error(`STALE ${tool}: ${err.message}`)
      process.exit(2)
    }
    if (err instanceof GuardedEditError) {
      // `BLOCKED` is the third exit-2 class, distinct from `STALE` on purpose:
      // STALE means re-read and retry; BLOCKED means the edit itself is illegal
      // and retrying unchanged refuses identically.
      console.error(`BLOCKED ${tool}: ${err.message}`)
      process.exit(2)
    }
    console.error(`${tool}: could not run — ${(err as Error)?.message ?? err}`)
    if (process.env.TRDD_DEBUG) console.error((err as Error)?.stack ?? '')
    process.exit(2)
  }
}

/**
 * `AT LINE N REPLACE X WITH Y`, under the document's lock.
 *
 * The id resolves to a DOCUMENT and a line. For a per-line pillar the record's own
 * declaration line is the default target, so `prrdgrep edit G7 --expect old --replace
 * new` rewrites that bullet without the caller counting lines — which is both the
 * common case and the one where a hand-counted line number would silently hit the
 * wrong rule.
 */
export async function runPillarEdit(
  kind: PillarKind,
  root: string,
  id: string | undefined,
  rawEdits: Partial<LineEdit>[],
  C: ReturnType<typeof palette>,
  tool: string,
): Promise<never> {
  if (!id) throw new UsageError(`edit needs an id — \`${tool} edit <id> --expect X --replace Y\``)
  if (rawEdits.length === 0) {
    throw new UsageError(`edit needs at least one --expect/--replace pair (see \`${tool} help\`)`)
  }

  const rec = findRecord(root, kind, id)
  if (!rec) {
    console.error(`${tool}: no ${kind.label} record ${JSON.stringify(id)} under ${root}`)
    return process.exit(1)
  }

  const edits: LineEdit[] = rawEdits.map((e, i) => {
    // An omitted --at-line means "the line this record is declared on". A
    // per-document pillar has no such line, so there it is required rather than
    // defaulted — inventing line 1 would be a confident write to the wrong place.
    const line = e.line ?? rec.line ?? undefined
    if (line === undefined) {
      throw new UsageError(`edit #${i + 1} needs --at-line (a ${kind.label} record spans the whole document)`)
    }
    if (e.expect === undefined) throw new UsageError(`edit #${i + 1} is missing --expect`)
    if (e.replace === undefined) throw new UsageError(`edit #${i + 1} is missing --replace`)
    return { line, expect: e.expect, replace: e.replace }
  })

  const result = await replaceAtLines(rec.filePath, edits, {
    lockKey: documentLockKeyFor(root, kind, rec),
    // TRDD-2R34M8FA — the grammar gate, judged inside the lock on the exact bytes
    // that would land (rule-id grammar, tier-wide number uniqueness, forward-only
    // versions, stable clause ids, status: legality). A refusal exits 2 as
    // `BLOCKED`, which — unlike `STALE` — does NOT mean re-read and retry: the
    // edit itself is illegal and will refuse identically on every retry.
    preWriteCheck: pillarPreWriteCheck(kind, {
      filePath: rec.filePath,
      corpusRecords: [...walkRecords(root, kind)],
    }),
  })

  console.log(C.g(`edited ${path.relative(root, result.path) || path.basename(result.path)}`))
  console.log(result.diff)
  return process.exit(0)
}

/** id-exact beats id-prefix beats text. Ties keep corpus order, which is sorted. */
function search(all: PillarRecord[], pattern: string, kind: PillarKind): PillarRecord[] {
  if (!pattern) return all
  const needle = pattern.toLowerCase()
  const wantId = kind.normalizeId(pattern)
  const scored: Array<{ rec: PillarRecord; score: number }> = []
  for (const rec of all) {
    const id = kind.normalizeId(rec.id)
    let score = 0
    if (id === wantId) score = 3
    else if (id.includes(wantId) && wantId) score = 2
    else if (rec.text.toLowerCase().includes(needle)) score = 1
    if (score) scored.push({ rec, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.rec)
}

function printRecords(
  recs: PillarRecord[],
  limit: number,
  root: string,
  C: ReturnType<typeof palette>,
  tool: string,
): void {
  const shown = limit === 0 ? recs : recs.slice(0, limit)
  for (const rec of shown) {
    const where = `${path.relative(root, rec.filePath) || path.basename(rec.filePath)}:${rec.line ?? '-'}`
    console.log(`${C.c(rec.id.padEnd(10))} ${C.d(where.padEnd(28))} ${rec.text.trim()}`)
  }
  // A silent cap reads as "that was everything". What was dropped, and how to see it.
  if (limit > 0 && recs.length > limit) {
    console.log(C.y(`  … +${recs.length - limit} more not shown`) + C.d(` (${tool} --limit 0)`))
  }
}

function printRecord(rec: PillarRecord, root: string, C: ReturnType<typeof palette>): void {
  console.log(C.b(rec.id))
  console.log(C.d(`${path.relative(root, rec.filePath) || path.basename(rec.filePath)}:${rec.line ?? '-'}`))
  console.log('')
  console.log(rec.text)
}

function printHelp(kind: PillarKind, C: ReturnType<typeof palette>): void {
  const t = `${kind.name}grep`
  console.log(`
${C.b(t)} — query and EDIT the ${kind.label} corpus (offline; no server)

  ${C.c(`${t}`)}                      every ${kind.label} record
  ${C.c(`${t} show <id>`)}            one record, with where it lives
  ${C.c(`${t} <pattern>`)}            ranked search over id and text

  ${C.c(`${t} edit <id> --expect X --replace Y`)}
  ${C.c(`${t} edit <id> --at-line N --expect X --replace Y`)}
      AT LINE N, REPLACE X WITH Y — under the document's lock. If X is not at
      line N the document changed since you read it and the edit is BLOCKED.
      Omit --at-line to target the record's own declaration line.
      Repeat the triple for a batch; a batch is ALL-OR-NOTHING.

  ${C.c(`${t} env`)}                  which corpus this is, and why
  ${C.d('  --design-dir <p>       point at another project')}
  ${C.d('  --limit N              cap list/search output (0 = no limit)')}

${C.d('exit: 0 answered · 1 nothing matched · 2 could not run (a stale edit prints STALE —')}
${C.d('      re-read and retry; an illegal edit prints BLOCKED — retrying refuses identically)')}
`)
}
