#!/usr/bin/env node
/**
 * trddgrep — the offline query surface over the TRDD corpus.
 *
 * NAMED BY LAW, not by taste (USER, 2026-07-30): every corpus tool is
 * `<document type>grep` — memgrep, trddgrep, prrdgrep, specgrep. This file was called
 * `greptrdd` for its whole life, i.e. the two words backwards, and that alone made it
 * unreachable. The janitor's agent reasoned "memgrep exists for the memory corpus, so
 * trddgrep exists for the TRDD corpus", searched for exactly that name, and found
 * nothing — while the tool it wanted sat right here under a reversed one. So do not
 * "tidy" this back: a tool whose name cannot be GUESSED from the corpus it reads is not
 * installed, whatever the filesystem says (TRDD-217AYEOT).
 *
 * The memgrep of the task board. memgrep answers "have we hit this before?" from a
 * SYMPTOM; trddgrep answers "what is the state of this work, and what is holding it
 * up?" from an id, a word, or nothing at all.
 *
 * WHY IT EXISTS, given three TRDD tools already do:
 *   lib/trdd-store.ts   — the ONE owner of "what is a TRDD" (parse, list, search)
 *   lib/trdd-graph.ts   — the ONE owner of the edges + invariants (cycle, gates)
 *   scripts/trdd-doctor — HEALTH: lint the corpus, repair what is derivable
 *   trddgrep            — QUERY: read the corpus. This file. It COMPOSES the two
 *                         libraries above and OWNS NOTHING. Adding a fourth parser or
 *                         a second cycle detector would create a second truth — which
 *                         is exactly the bug the doctor was built to catch, and which
 *                         the doctor itself committed by not looking first.
 *
 * It needs NO SERVER. `aimaestro-trdd.sh` goes through the HTTP API (and 403s an agent
 * on the write verbs); trddgrep reads the files, so it works in a cold repo, in CI, and
 * in an agent's tmux pane at 3am when the dashboard is down.
 *
 * THE CENTRAL QUERY IS `why`. Timing is noise — how long a card has waited says nothing.
 * ORDER is everything: a card is workable, or it is waiting on something, and that
 * something is waiting on something. `why` walks that chain to its ROOT — the thing
 * that, if it moved, would move everything behind it. A column list cannot show you
 * that, and neither can an age.
 *
 *   trddgrep                     the board
 *   trddgrep next                what is workable RIGHT NOW, ranked by what it frees
 *   trddgrep why <id>            the transitive blocker chain, down to the root cause
 *   trddgrep unblocks <id>       what finishing this would free
 *   trddgrep roots               every root cause on the board — the whole critical path
 *   trddgrep show <id>           the card + its STATE block (authoritative on resume)
 *   trddgrep <pattern>           ranked search over title, labels, id and body
 */
import fs from 'fs'
import path from 'path'
import process from 'process'
import { fileURLToPath } from 'url'

const { TRDD_ZONES, listTrddFiles, parseTrddFile, assertDesignDir, STATE_HEADING_SOURCE } =
  await import('../lib/trdd-store.ts')
const { SHIPPED, normalizeTrddRef, localRefList, normalizePriority, BLOCKER_FIELDS } =
  await import('../lib/trdd-graph.ts')
const { readyQueueFrom } = await import('../lib/trdd-doctor.ts')
const { defaultDesignDirFor } = await import('../lib/pillar/kinds.ts')
const { writeRefusal } = await import('../lib/pillar/write-gate.ts')

// ai-maestro#161 phase a — the realpath of the parent of the `scripts/` dir THIS file
// lives in. Computed HERE, in the entry point, never inside `lib/` (from `lib/pillar/`
// the parent would be `lib/` and every write would refuse).
const REPO_ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
}

// EXIT CODES — 0 clean · 1 findings · 2 THE CHECK COULD NOT RUN.
// `validate` is the WRITE GATE, and until now a gate that could not read its
// corpus exited 0 — "I found nothing wrong" and "I looked at nothing" were the
// same answer. They are now different answers with different exit codes.
process.on('uncaughtException', (err) => {
  // A BLOCKED edit is a 2 like everything else here — the caller asked for a mutation and
  // none happened. But 2 also means "no corpus", so a retry loop keying on the code alone
  // would spin forever in the wrong directory. `STALE` first is the only thing that can
  // carry that distinction, and it is the same token prrdgrep and specgrep print — all
  // three tools share one retry contract or none of them does. (TRDD-D7KVF4HQ)
  const stale = err?.name === 'StaleDocumentError'
  console.error(`${stale ? 'STALE ' : ''}trddgrep: could not run — ${err?.message ?? err}`)
  if (process.env.TRDD_DEBUG) console.error(err?.stack ?? '')
  process.exit(2)
})

// Value flags are STRIPPED before `cmd`/`arg` are read, so a flag may sit anywhere in
// the line without shifting the positional arguments. They go through ONE helper for a
// reason: the first version located `--design-dir` by index in a list that still held
// other flags, and the `--no-index` filter had to run first or it shifted that value by
// one. That ordering hazard is a property of index arithmetic on a shared list, so it
// would return with every flag added. Taking each flag OUT removes it structurally.
const rawArgv = process.argv.slice(2)
const noIndex = rawArgv.includes('--no-index')
let rest = rawArgv.filter((a) => a !== '--no-index')

/** Take `--name <value>` out of the list; returns the value (or undefined) and the rest. */
function takeFlag(list, name) {
  const i = list.indexOf(name)
  if (i < 0) return [undefined, list]
  // A MISSING value is a could-not-run, not ''. "Each consumer validates its own value"
  // was the theory; measured, none of them can: `Number('') === 0` and `0` is `--limit`'s
  // documented "no limit", so a truncated `--limit` UNCAPPED the output the cap exists to
  // bound (129 lines vs the 112-line cap), and `path.resolve('')` is the cwd, so a
  // valueless `--design-dir` silently retargets the corpus and then blames the working
  // directory in its diagnostic.
  const value = list[i + 1]
  if (value === undefined) {
    console.error(`trddgrep: ${name} needs a value`)
    process.exit(2)
  }
  return [value, [...list.slice(0, i), ...list.slice(i + 2)]]
}

/**
 * A verb's VALUELESS switches may sit ANYWHERE; its positionals are what is left, in order.
 *
 * `append`, `check-box` and `set` used to read their positionals by index (`argv[2]`,
 * `argv[3]`) and look for switches only AFTER them, so a switch placed before the last
 * positional was read AS that positional: `append <id> <heading> --create "<line>"` took
 * `--create` as the line and refused the real line as "unrecognised" (observed twice on
 * 2026-09-24 — first mis-diagnosed as a `- `-prefixed line, which it never was). Splitting
 * the switches out first makes every order mean the same thing. The one value that cannot
 * be passed as a positional is a token spelled exactly like one of the verb's switches.
 */
function splitSwitches(tokens, switches) {
  return [new Set(tokens.filter((t) => switches.includes(t))), tokens.filter((t) => !switches.includes(t))]
}

// `--path <file>` — name a `fix` target by file path instead of id (TRDD-9JOCY2EJ).
// Stripped here, like `--design-dir`, so it never reaches the unknown-option check below.
let pathVal
;[pathVal, rest] = takeFlag(rest, '--path')

let designDirVal, limitVal, columnVal, minSeverityVal, ruleVal
;[designDirVal, rest] = takeFlag(rest, '--design-dir')
;[limitVal, rest] = takeFlag(rest, '--limit')
;[columnVal, rest] = takeFlag(rest, '--column')
;[minSeverityVal, rest] = takeFlag(rest, '--min-severity')
;[ruleVal, rest] = takeFlag(rest, '--rule')

// `--porcelain` is VALUELESS, so it must not go through `takeFlag` (which would eat the
// next token as its value). Machine-readable mode for `show` and the default search:
// one record per line, TAB-separated, path FIRST (TRDD-IPSNDKGM — the mode library
// consumers parse instead of the ranked human output).
const porcelainIdx = rest.indexOf('--porcelain')
const porcelain = porcelainIdx !== -1
if (porcelain) rest = [...rest.slice(0, porcelainIdx), ...rest.slice(porcelainIdx + 1)]

// `--design-body` / `--no-design-body` — which HALF of a card's body this run reads.
//
// 3P-TRDD-13: the implementation design lives in the SAME file, after the exact divider
// line below, at most once per card. So a card's prose is two documents in one, and a
// question asked of the whole file cannot tell "the original body says X" from "the
// design says X". These narrow WHAT IS READ; neither flag reproduces the current
// behaviour byte-for-byte (the whole body).
//
// Valueless, so they are stripped here rather than through `takeFlag` (which would eat
// the next token as a value) — the same treatment `--porcelain` gets, and the same
// reason. They are ALSO in KNOWN_FLAGS: stripping means the unknown-option check never
// sees them, and a flag whose acceptance depends on the order two filters run in is the
// index-arithmetic hazard `takeFlag`'s own comment records.
const DESIGN_DIVIDER = '<!-- @trdd:design-body -->'
const designBodyIdx = rest.indexOf('--design-body')
const noDesignBodyIdx = rest.indexOf('--no-design-body')
// BOTH is a could-not-run, never a silent pick. They ask opposite questions, so choosing
// one would answer a question the caller did not ask — with an exit code that looks like
// a verdict (the `--min-severity` defect this file already carries the scar of).
if (designBodyIdx !== -1 && noDesignBodyIdx !== -1) {
  console.error('trddgrep: --design-body and --no-design-body are mutually exclusive — pass one')
  process.exit(2)
}
const bodyScope = designBodyIdx !== -1 ? 'design' : noDesignBodyIdx !== -1 ? 'original' : 'all'
rest = rest.filter((t) => t !== '--design-body' && t !== '--no-design-body')

/**
 * The half of `body` this run is asking about — or `null` for "this card has none".
 *
 * `null` is the load-bearing return. A card with NO divider has no design body, and the
 * ONE thing it must never do is answer `--design-body` with its whole prose: that is the
 * "unread reads as clean" inversion pointed the other way — a card that carries no design
 * at all would answer every design question with its original body, and confidently.
 *
 * The FIRST divider splits. 3P-TRDD-13 allows at most one; a second is a lint finding, not
 * this reader's to adjudicate, and taking the first keeps the original body correct (it is
 * bounded by the first divider under either interpretation).
 */
/** Does `body` carry a `@trdd:design-body` divider at all? The ONE divider predicate — both
 * `bodySlice` (below) and `show`'s no-flag rendering (#165 follow-up, #167 review) call this
 * instead of each running its own `.find`/`.some` over the same marker. */
function hasDesignDivider(body) {
  return body.split('\n').some((l) => l.trim() === DESIGN_DIVIDER)
}

function bodySlice(body) {
  if (bodyScope === 'all') return body
  const lines = body.split('\n')
  const i = lines.findIndex((l) => l.trim() === DESIGN_DIVIDER)
  if (i < 0) return bodyScope === 'design' ? null : body
  return bodyScope === 'design' ? lines.slice(i + 1).join('\n') : lines.slice(0, i).join('\n')
}

const designDir = path.resolve(designDirVal ?? defaultDesignDirFor())
const argv = rest
const cmd = argv[0] ?? 'board'
const arg = argv[1]

// TRDD write-gate (ai-maestro#161 phase a) — run as soon as `cmd` is known, so it
// precedes both the `fix` intercept below and the verb switch. Keyed on WHERE THE
// CALLER IS RUNNING FROM (`REPO_ROOT`), never on the corpus `--design-dir` points at.
const writeMsg = writeRefusal('trddgrep', cmd, { cwd: fs.realpathSync.native(process.cwd()), root: REPO_ROOT })
if (writeMsg) {
  console.error(writeMsg)
  process.exit(2)
}

// THE VERB MUST COME FIRST. `lib/pillar/cli.ts` strips the edit flags from anywhere before
// it binds its verb; here `parseEditFlags` is a lazy import inside the `edit` case, so it
// cannot. Without this refusal `cmd` binds to the FLAG: measured,
// `trddgrep --at-line 4 --expect X --replace Y edit TRDD-XXXXXXXX` ran a regex SEARCH for
// "--at-line", edited nothing, and exited 0 — a governance write that silently did not
// happen while the tool reported success. The byte-identical argument order really does
// edit under prrdgrep/specgrep, which is precisely the cross-tool drift the shared core
// exists to prevent, so this fails loudly rather than diverging quietly.
const EDIT_FLAGS = new Set(['--at-line', '--expect', '--replace'])
if (EDIT_FLAGS.has(cmd)) {
  console.error(
    `trddgrep: put the verb first — \`trddgrep edit <id> ${cmd} …\`; the edit flags follow it.`,
  )
  process.exit(2)
}

// An UNKNOWN OPTION is a could-not-run (2), never a silently-ignored token.
//
// The shared core enforces this at `lib/pillar/cli.ts:193` — which is why `prrdgrep --xyzzy`
// and `specgrep --xyzzy` both exit 2 with "could not run — unknown option" — and trddgrep,
// which does NOT route through that core, had no equivalent. Measured 2026-08-16:
// `trddgrep validate --min-severity error` printed all 265 findings (264 of them WARN) and
// exited 1, exactly as the bare command does. `--min-severity` does not exist. It was not
// rejected, not warned about, not even mentioned: the flag was dropped on the floor and the
// tool answered a DIFFERENT question than the one asked, with an exit code that looks like a
// verdict. A caller filtering for errors gets the unfiltered corpus and no way to tell.
//
// That is the same defect class this repo has been finding all day in other tools (a CLI
// printing `error: unknown option` and exiting 0, so its caller reported success having run
// nothing) — and finding it in our own governance gate is worse, because `validate` is the
// tool other tools trust. Two sibling CLIs behaving one way and the third behaving another is
// also precisely the cross-tool drift the shared core exists to prevent.
//
// `edit` is exempt HERE because it owns a stricter check of its own further down (it rejects
// stray tokens rather than allowlisting, since a mutating verb must never ignore anything).
const KNOWN_FLAGS = new Set([
  '--strict',      // validate | lint | doctor
  '--all',         // index-verify
  '--repair',      // index-verify
  '--dry-run',     // fix
  '--design-body',    // show | search — stripped above; listed so acceptance is not
  '--no-design-body', // a function of which filter ran first
  '--help',        // help short-circuits before the corpus assertion — issue 159
  '-h',            // -h never hits this check (no -- prefix) but is listed defensively
])
// `new` and `move` join `edit` in the exemption for the same stated reason: a MUTATING
// verb must never IGNORE a token, and an allowlist can only ever ignore. Each rejects
// every token it did not consume, which is strictly stronger than this check.
const STRICT_PARSE_VERBS = new Set(['edit', 'new', 'move', 'set', 'append', 'check-box', 'archive'])
if (!STRICT_PARSE_VERBS.has(cmd)) {
  const unknownFlag = argv.find((t) => t.startsWith('--') && !KNOWN_FLAGS.has(t))
  if (unknownFlag) {
    console.error(`trddgrep: could not run — unknown option ${unknownFlag} — see \`trddgrep help\``)
    process.exit(2)
  }
}

// A body-scope flag on a verb that reads NO body is a could-not-run, not a no-op.
//
// `show` and the default search are the only two commands that read prose at all (the walk
// is body-free by design — see its comment below), so `board --design-body` cannot narrow
// anything. Accepting it silently would be the `--min-severity` defect exactly: the tool
// answers the unfiltered question with an exit code the caller reads as a verdict. The
// default search is the FALL-THROUGH, so only the named verbs are refused — an unknown
// token is a search pattern, and `trddgrep --design-body <pattern>` must work.
const BODY_READING_VERBS = new Set(['show'])
const CORPUS_VERBS = new Set([
  'why', 'unblocks', 'roots', 'next', 'show', 'board', 'doctor', 'lint', 'validate',
  'index-verify', 'fix', 'edit', 'env', 'help', '--help', '-h',
])
if (bodyScope !== 'all' && CORPUS_VERBS.has(cmd) && !BODY_READING_VERBS.has(cmd)) {
  console.error(
    `trddgrep: --${bodyScope === 'design' ? '' : 'no-'}design-body reads a card's prose, and \`${cmd}\` reads none —` +
      ' it applies to `show` and to the ranked search',
  )
  process.exit(2)
}

// Rows a list-shaped answer prints before it STOPS AND SAYS SO.
//
// A silent cap is the same class of bug as a silent empty result, and at 10⁵ these
// answers were not merely long: `board` printed 100 000 lines and `roots` 7 782, which
// is output no reader can use and no pager makes meaningful — rendering it was also a
// measurable slice of the query's own cost (TRDD-C069SK9E). `0` means unlimited, and it
// is what reproduces the pre-cap output byte-for-byte, so the bound is a DEFAULT rather
// than a capability removed. The default SEARCH is untouched: it has always capped at
// its own 25 and has always said what it dropped, which is the convention these follow.
const DEFAULT_LIMIT = 20
const limit = limitVal === undefined ? DEFAULT_LIMIT : Number(limitVal)
if (!Number.isInteger(limit) || limit < 0) {
  console.error(
    `trddgrep: --limit takes a non-negative integer (0 = no limit), not ${JSON.stringify(limitVal)}`,
  )
  process.exit(2)
}
const capped = (list) => (limit === 0 ? list : list.slice(0, limit))
/** The line a truncation OWES its reader: what was dropped, and how to see it. */
const droppedNote = (list, hint) =>
  limit > 0 && list.length > limit
    ? `  ${C.y(`… +${list.length - limit} more not shown`)} ${C.d(hint)}`
    : null

// `--min-severity` / `--rule` — real filters for `validate`/`lint`/`doctor`, replacing the
// flag that used to be typed and silently dropped (see the KNOWN_FLAGS comment above).
//
// FILTER AT THE PRINT SITE, not in `lib/trdd-doctor.ts::lintCorpus` — that function is the
// one producer for both this CLI and the vitest suite's own non-vacuity assertions
// (`scanned > 100`), and neither of those callers wants a pre-filtered result. Narrowing
// what is SHOWN is this tool's job; narrowing what is FOUND would be a second, silent
// question asked of the corpus.
//
// `--rule` is comma-separated rather than repeatable: `takeFlag` takes exactly one
// occurrence of a name out of argv (see its own comment above on why flags are stripped
// structurally), so a repeated `--rule` would silently keep only the LAST one — worse than
// not supporting repetition at all. A comma list needs no second mechanism.
const SEVERITY_RANK = { warn: 0, error: 1 }
if (minSeverityVal !== undefined && !(minSeverityVal in SEVERITY_RANK)) {
  console.error(`trddgrep: --min-severity takes warn|error, not ${JSON.stringify(minSeverityVal)}`)
  process.exit(2)
}
const minSeverityRank = minSeverityVal === undefined ? SEVERITY_RANK.warn : SEVERITY_RANK[minSeverityVal]
const ruleFilter = ruleVal === undefined ? null : new Set(ruleVal.split(',').map((s) => s.trim()).filter(Boolean))
if (ruleFilter && ruleFilter.size === 0) {
  console.error(`trddgrep: --rule needs at least one rule code`)
  process.exit(2)
}
/** Findings this run is willing to SHOW — the corpus itself is never narrowed. */
const filterFindings = (findings) =>
  findings.filter((f) => SEVERITY_RANK[f.severity] >= minSeverityRank && (!ruleFilter || ruleFilter.has(f.rule)))

// Issue 159: help/--help/-h must work with no design/ corpus present. Probe the corpus
// ourselves before the unconditional gate below; on failure print a short banner and exit 0
// instead of erroring. When a corpus genuinely exists this is a no-op and the real
// switch-case 'help' block further down still renders the full banner as before.
if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
  try {
    assertDesignDir(designDir)
  } catch {
    console.log('trddgrep - query, CREATE, MOVE AND validate the TRDD corpus (offline; no server)')
    console.log('Run this from inside a project with a design/ corpus for the full command reference,')
    console.log('or pass --design-dir <path>.')
    process.exit(0)
  }
}

// `env` is EXEMPT, and this is the one exemption that matters: it is the verb whose whole
// job is to explain what this tool concluded about where it is running, so gating it on a
// corpus existing means the diagnostic is unavailable in precisely the situation that
// prompts a human to ask for it ("trddgrep says nothing in this project — why?"). Every
// other verb READS the corpus and must still refuse loudly when it is absent.
if (cmd !== 'env') assertDesignDir(designDir)

// ---- the corpus walk, through the ONE owner ----
//
// LAZY and BODY-FREE. Two separate wins, and the second is the one that scales:
//
//  · LAZY — this ran at top level, before the switch, so `trddgrep help` walked
//    all four zones to print a usage string, and `trddgrep next` walked them to
//    answer a question it then re-asks of `lib/trdd-doctor.ts` anyway.
//  · BODY-FREE — an array of cards carrying `body` IS the memory wall. Measured
//    on the linter, which had the identical defect: at 100 000 cards x ~10 KB it
//    did not run slowly, it CRASHED — exit 134, 4.45 GB (TRDD-BQC8NQSW). This is
//    that same bug in the second consumer, so it gets that same fix: the body is
//    YIELDED as a transient, never retained. Only `show` and the default search
//    read prose at all, and each reduces it — to a STATE block, to a hit count —
//    before letting it go.
const vanished = []

/**
 * The three frontmatter facts these subcommands actually read, REDUCED at parse time.
 *
 * Retaining `fm` whole is the other half of the memory wall: at 10⁵ the object is
 * ~15 KB of fields nothing here looks at, which is why `board` still held 1.52 GB
 * after the bodies were freed. Reducing to three scalars also makes the card shape
 * something the INDEX can reproduce EXACTLY — the precondition for a walk-vs-index
 * differential, because a comparison against a shape only the walk can build proves
 * nothing about the index.
 */
function cardFieldsFrom(fm) {
  return {
    // A STRING or null, never a number — the one form the index's TEXT column can
    // round-trip to. Invisible at the surface: `P${0}` and `P${'0'}` print the same.
    priority: normalizePriority(fm.priority),
    // The refs that impose ORDER, through the graph's OWN helpers. trddgrep carried a
    // private `list()` that accepted ONLY arrays, so a scalar `npt: TRDD-X` was a
    // reference to `lib/trdd-graph.ts` and to the pillar index but NOT to this file —
    // the same "two consumers of one store, divergent on identical input" bug Phase 1
    // fixed one layer down. This tool owns nothing: `BLOCKER_FIELDS` names the fields
    // and `localRefList` reads them, and the INDEX filters its edge rows on the same tuple.
    // `localRefList` so a non-local `blocked-by:` spelling is dropped here exactly as the
    // graph and the index drop it (TRDD-PTFPGSLV) — the walk-vs-index differential depends
    // on the two feeders sharing one notion of an edge.
    blockerRefs: BLOCKER_FIELDS.flatMap((f) => localRefList(f, fm[f])),
    // Scored only by the default SEARCH, which is walk-only by design — so this is
    // the one card field the index does not carry (see `lib/pillar/index-open.ts`).
    labels: String(fm.labels ?? ''),
  }
}

function* walkCards() {
  for (const zone of TRDD_ZONES) {
    for (const file of listTrddFiles(designDir, zone)) {
      const t = parseTrddFile(file, zone)
      // Post-fail-loud, a null here means exactly one thing: the file was listed
      // and then moved by a concurrent `git mv` lifecycle transition. Every other
      // read fault throws. `lib/trdd-doctor.ts` has always reported these; this
      // tool used to `continue` past them silently, so two consumers of one store
      // gave different answers about identical input.
      if (!t) {
        vanished.push(file)
        continue
      }
      yield [
        {
          id: normalizeTrddRef(t.id),
          zone,
          filePath: file,
          column: String(t.column ?? '').trim() || '(none)',
          title: String(t.title ?? '').trim(),
          ...cardFieldsFrom(t.frontmatter ?? {}),
        },
        t.body ?? '',
      ]
    }
  }
}

/** The mid-scan casualties, reported once — after the walk that found them. */
function reportVanished() {
  if (!vanished.length) return
  console.error(`trddgrep: ${vanished.length} file(s) vanished mid-scan and were skipped:`)
  for (const f of vanished.slice(0, 5)) console.error(`  · ${path.relative(process.cwd(), f)}`)
  if (vanished.length > 5) console.error(`  … and ${vanished.length - 5} more`)
}

// `fix` is intercepted HERE, before the switch (TRDD-9JOCY2EJ, issue 160): a target is
// now required, and the whole-corpus batch caller keeps calling `fixCorpus` with no
// selector, untouched. `cmd` is a const (:177) and the switch below dispatches on that same
// const at top level, so this intercept — whose every branch exits — made the switch's old
// `case 'fix'` unreachable. That dead case is now DELETED; proven first by placing a throw as
// its first statement and finding it never fired across 42 trddgrep tests and both CLI paths.
if (cmd === 'fix') {
  if (!arg && !pathVal) {
    console.error('trddgrep: fix requires a target — `trddgrep fix <id>` or `trddgrep fix --path <file>`')
    process.exit(2)
  }
  const { fixCorpus, lintCorpus, loadCorpus } = await import('../lib/trdd-doctor.ts')
  const dryRun = argv.includes('--dry-run')
  const { cards: allCards } = loadCorpus(designDir)
  let target
  if (pathVal) {
    const resolved = path.resolve(pathVal)
    target = allCards.find((c) => path.resolve(c.filePath) === resolved)
    if (!target) {
      console.log(C.r(`\nno TRDD at path '${pathVal}'\n`))
      process.exit(1)
    }
  } else {
    const wantId = normalizeTrddRef(arg ?? '')
    target = allCards.find((c) => c.id === wantId)
    if (!target) {
      console.log(C.r(`\nno TRDD with id '${arg}' in either root\n`))
      process.exit(1)
    }
  }
  const before = lintCorpus(designDir).findings.filter((f) => f.id === target.id)
  const results = fixCorpus(designDir, { dryRun, selector: (c) => c.id === target.id })
  if (results.length === 0) {
    console.log(C.g(`nothing for \`fix\` to repair on ${target.id} — run \`trddgrep validate\``))
    process.exit(0)
  }
  console.log(C.b(`\n${dryRun ? 'WOULD REPAIR' : 'REPAIRED'} ${results.length} file(s):\n`))
  for (const r of results) {
    const badge = r.bumped ? C.y('  [updated: bumped]') : C.d('  [mechanical]')
    console.log(`  ${C.b(r.id)}  ${C.d(path.relative(process.cwd(), r.filePath))}${badge}`)
    for (const c of r.changes) console.log(`      • ${c}`)
  }
  const after = dryRun ? before : lintCorpus(designDir).findings.filter((f) => f.id === target.id)
  console.log(C.d(`\nlint(${target.id}) before: ${before.length} → after: ${after.length}`))
  console.log(dryRun ? C.d('\n(dry run — nothing written)') : C.y('\nReview and commit.'))
  process.exit(0)
}

const cards = []
let byId = new Map()

/**
 * The index path — tried FIRST, and never silently.
 *
 * `better-sqlite3` is a NATIVE module that hard-caps at Node 25, while this CLI
 * otherwise needs nothing but tsx. So the import is LAZY and guarded: on the wrong
 * Node, on a missing build, or on an index fault the tool must still work, because a
 * query tool that dies because its cache is broken is worse than one that has no
 * cache. `--no-index` skips the attempt outright.
 *
 * The failure is LOUD. At 10^5 documents the walk is the outage the index exists to
 * prevent, so falling back to it silently would turn a broken cache into a mysterious
 * multi-minute hang — the operator has to be told which path answered them.
 */
async function tryIndex() {
  if (noIndex) return null
  try {
    const { loadTrddGraphViaIndex } = await import('../lib/pillar/index-open.ts')
    return loadTrddGraphViaIndex(designDir)
  } catch (err) {
    console.error(`trddgrep: the index could not answer — ${err?.message ?? err}`)
    console.error('trddgrep: falling back to the corpus walk (--no-index skips this attempt)')
    return null
  }
}

/**
 * Fill the graph — every card, no prose.
 *
 * The walk loop is load-bearing and must NOT be written as `[...walkCards()]`:
 * spreading the generator materializes every [card, body] pair at once, which is
 * exactly the array TRDD-O4JK6RV3 deleted. Destructuring one pair per iteration is
 * what lets each body die with the iteration that produced it.
 */
async function loadGraph() {
  const indexed = await tryIndex()
  if (indexed) {
    cards.push(...indexed)
    byId = new Map(cards.map((c) => [c.id, c]))
    return
  }
  for (const [c] of walkCards()) cards.push(c)
  byId = new Map(cards.map((c) => [c.id, c]))
  reportVanished()
}
const done = (id) => {
  const c = byId.get(id)
  return !c || SHIPPED.has(c.column)
}
/**
 * The edges that impose ORDER: this card cannot proceed until those do.
 *
 * A ref to a card that is not in the corpus is DROPPED, not treated as a blocker —
 * a dangling reference is a lint finding (`DANGLING-REF`, the doctor's), never a
 * reason to call work unstartable. The index-backed reader reproduces this by
 * JOINing edges onto records, which drops the same rows for the same reason.
 */
const blockers = (c) => c.blockerRefs.filter((k) => byId.has(k))
const openBlockers = (c) => blockers(c).filter((k) => !done(k))

const fmt = (c) =>
  `${C.b(c.id)} ${C.d(`P${c.priority ?? '?'}`)} ${String(c.column).padEnd(13)} ${String(c.title).slice(0, 62)}`

const need = (id) => {
  const c = byId.get(normalizeTrddRef(id ?? ''))
  if (!c) {
    console.log(C.r(`\nno TRDD with id '${id}' in either root\n`))
    process.exit(1)
  }
  return c
}

/**
 * Walk the blocker chain to its ROOTS — the cards that block others but are themselves
 * blocked by nothing. Those are the only things worth pushing on: everything else on the
 * chain moves for free once a root moves.
 */
function rootsOf(c, seen = new Set(), depth = 0, out = []) {
  if (seen.has(c.id)) {
    out.push({ card: c, depth, cyclic: true })
    return out
  }
  seen.add(c.id)
  const open = openBlockers(c)
  if (open.length === 0) {
    out.push({ card: c, depth, cyclic: false })
    return out
  }
  for (const k of open) rootsOf(byId.get(k), new Set(seen), depth + 1, out)
  return out
}

function printChain(c, depth = 0, seen = new Set()) {
  const pad = '  '.repeat(depth + 1)
  if (seen.has(c.id)) {
    console.log(`${pad}${C.r('↻ CYCLE back to')} ${c.id} — nothing in this ring can EVER start`)
    return
  }
  seen.add(c.id)
  const open = openBlockers(c)
  if (open.length === 0) {
    console.log(`${pad}${C.g('◆ ROOT')} ${fmt(c)}`)
    if (c.column === 'human_review' || c.column === 'proposal') {
      console.log(`${pad}       ${C.y('⇒ waiting on a HUMAN decision — no agent work can move this')}`)
    }
    if (c.column === 'blocked') {
      // A `blocked` leaf with no local edge is blocked on a non-local ref (TRDD-PTFPGSLV).
      console.log(`${pad}       ${C.y('⇒ blocked on an EXTERNAL/cross-project ref — see its blocked-by (trddgrep show ' + c.id + ')')}`)
    }
    return
  }
  console.log(`${pad}${C.d('└─ blocked by')}`)
  for (const k of open) printChain(byId.get(k), depth + 1, new Set(seen))
}

// Which subcommands need the graph — and, just as deliberately, which do not.
// `lint` and `validate` load their own corpus through `lib/trdd-doctor.ts`, which is
// the LINTER and walk-only by design; `help` reads nothing. The default branch
// (search) is absent on purpose too: it streams its OWN walk, because it is the one
// command that must see every body and must therefore keep none of them.
//
// `next` joined this list in TRDD-C069SK9E. It used to call `readyQueue(designDir)`,
// which walks the corpus a SECOND time through the doctor — so the one subcommand whose
// entire job is "what should I work on right now?" was the only graph question that
// could not be answered from the index. The RANKING did not move: it lives once, in
// `readyQueueFrom`, and only the feeder changed. That is what makes the walk-vs-index
// differential meaningful — the two paths run identical code over identical shapes.
if (['why', 'unblocks', 'roots', 'show', 'board', 'next'].includes(cmd)) await loadGraph()

switch (cmd) {
  case 'why': {
    const c = need(arg)
    console.log(`\n${fmt(c)}\n`)
    const open = openBlockers(c)
    if (open.length === 0) {
      // A `blocked` card with zero LOCAL edges is blocked on a non-local ref
      // (`gh:owner/repo#n` or `<project-id>:TRDD-<id8>` — TRDD-PTFPGSLV): the graph has
      // no edge to walk, but READY would be a lie. Column is the discriminator because it
      // is the one fact both the walk and the index carry.
      if (String(c.column) === 'blocked') {
        console.log(C.y(`  BLOCKED with no locally-resolvable blocker — its blocked-by names an external issue or a cross-project TRDD. Read the card: trddgrep show ${c.id}\n`))
      } else {
        console.log(C.g('  READY — every prerequisite is satisfied. Nothing is holding it up.\n'))
      }
      break
    }
    printChain(c)
    const roots = rootsOf(c).filter((r) => !r.cyclic)
    const uniq = [...new Map(roots.map((r) => [r.card.id, r.card])).values()]
    console.log(`\n  ${C.b('ROOT CAUSE')} — move ${uniq.length === 1 ? 'this' : 'these'} and the rest follows:`)
    for (const r of uniq) console.log(`    ${fmt(r)}`)
    console.log()
    break
  }

  case 'unblocks': {
    const c = need(arg)
    const direct = cards.filter((x) => !done(x.id) && blockers(x).includes(c.id))
    console.log(`\n${fmt(c)}\n`)
    if (direct.length === 0) {
      console.log(C.d('  blocks nothing — finishing it frees no other card\n'))
      break
    }
    console.log(`  ${C.g(`finishing it directly unblocks ${direct.length}`)}:`)
    for (const d of direct) console.log(`    ${fmt(d)}`)
    console.log()
    break
  }

  case 'roots': {
    // Every open card that blocks something and is itself blocked by nothing. This IS the
    // critical path of the whole board, and it is derived purely from the graph.
    const open = cards.filter((c) => !done(c.id) && c.zone === 'tasks')
    const blocks = new Map()
    for (const c of open) for (const k of openBlockers(c)) blocks.set(k, (blocks.get(k) ?? 0) + 1)
    const roots = [...blocks.keys()]
      .map((k) => byId.get(k))
      .filter((c) => c && openBlockers(c).length === 0)
      .sort((a, b) => (blocks.get(b.id) ?? 0) - (blocks.get(a.id) ?? 0))
    if (roots.length === 0) {
      console.log(C.g('\nno root blockers — nothing on the board is waiting on anything\n'))
      break
    }
    console.log(C.b('\nROOT BLOCKERS — the critical path. Everything else moves once these do.\n'))
    for (const r of capped(roots)) {
      const human = r.column === 'human_review' || r.column === 'proposal' || r.zone === 'proposals'
      // Zero local edges + column `blocked` = blocked on a non-local ref (TRDD-PTFPGSLV):
      // still the local board's root, but moving it means moving the EXTERNAL blocker.
      const ext = r.column === 'blocked'
      console.log(`  ${fmt(r)}`)
      console.log(`      ${C.g(`holds up ${blocks.get(r.id)}`)}${human ? '  ' + C.y('⇒ needs a HUMAN decision') : ''}${ext ? '  ' + C.y('⇒ itself blocked on an EXTERNAL/cross-project ref (trddgrep show ' + r.id + ')') : ''}`)
    }
    // Already sorted by how much each root holds up, so a cap keeps the WORST ones —
    // the property that makes truncating this list defensible at all.
    const rootsNote = droppedNote(roots, '(sorted worst-first; --limit 0 for all)')
    if (rootsNote) console.log(rootsNote)
    console.log()
    break
  }

  case 'next': {
    // Ranked by `lib/trdd-doctor.ts`'s ONE ranker, over the graph this tool already
    // loaded — index-backed when there is an index. `blockerRefs` IS the ranker's
    // `orderEdges`: both are exactly `BLOCKER_FIELDS` (`blocked-by` + `npt`) read
    // through `localRefList`, which is why the two feeders can be held byte-identical.
    const q = readyQueueFrom(
      cards.map((c) => ({
        id: c.id,
        column: c.column,
        title: c.title,
        priority: c.priority,
        orderEdges: c.blockerRefs,
        // An archived card keeps whatever column it had (TRDD-MQE5D28T D2); without its
        // zone the ranker would list an archived `dev` card as ready work.
        zone: c.zone,
      })),
    )
    if (q.length === 0) {
      console.log(C.y('\nNOTHING IS READY — every open card waits on another. Check for a cycle: trddgrep roots\n'))
      break
    }
    console.log(C.b(`\nREADY — ${q.length} card(s), ranked by how much finishing them frees\n`))
    for (const r of capped(q)) {
      const lev = r.unblocks > 0 ? C.g(`unblocks ${r.unblocks}`) : C.d('unblocks 0')
      console.log(`  ${C.b(r.id.padEnd(9))} ${C.d(`P${r.priority ?? '?'}`)} ${String(r.column).padEnd(13)} ${lev.padEnd(22)} ${String(r.title).slice(0, 54)}`)
    }
    const nextNote = droppedNote(q, '(ranked; --limit 0 for all)')
    if (nextNote) console.log(nextNote)
    console.log()
    break
  }

  case 'show': {
    const c = need(arg)
    // Under a body-scope flag the BODY decides whether this card answers AT ALL, so it is
    // read before anything is printed — the porcelain record included. A card with no
    // design body is not a match for a design question, and exiting 1 is the answer the
    // trichotomy already gives an empty search.
    let scoped = null
    if (bodyScope !== 'all') {
      const pre = parseTrddFile(c.filePath, c.zone)
      if (!pre) {
        console.log(C.r('\n  the file moved mid-command (a concurrent git mv) — re-run\n'))
        break
      }
      scoped = bodySlice(pre.body ?? '')
      if (scoped === null) {
        console.error(
          `trddgrep: ${c.id} has no design body — the file carries no ${DESIGN_DIVIDER} divider ` +
            `(plain \`show ${c.id}\`, with no flag, prints the whole body)`,
        )
        process.exit(1)
      }
    }
    if (porcelain) {
      // `path<TAB>id<TAB>column<TAB>zone<TAB>title` — path ABSOLUTE (a consumer's cwd is
      // anywhere), title LAST so a rogue tab in it cannot shift the machine fields. The
      // field order is the contract (additive-only) — documented in help.
      console.log([path.resolve(c.filePath), c.id, c.column, c.zone, c.title].join('\t'))
      break
    }
    console.log(`\n${fmt(c)}`)
    console.log(C.d(`  ${path.relative(process.cwd(), c.filePath)}`))
    const ob = openBlockers(c)
    if (ob.length) console.log(`  ${C.r('blocked by')} ${ob.join(', ')}   ${C.d('(trddgrep why ' + c.id + ')')}`)
    // The body is read HERE, for this ONE card — the walk above kept none. Through
    // the same store, so the semantics are the walk's: null means the file was
    // `git mv`d between the walk and now (benign, and worth saying out loud), while
    // every other read fault throws instead of reading as "no STATE block".
    const fresh = bodyScope === 'all' ? parseTrddFile(c.filePath, c.zone) : { body: scoped }
    if (!fresh) {
      console.log(C.r('\n  the file moved mid-command (a concurrent git mv) — re-run\n'))
      break
    }
    if (bodyScope === 'design') {
      // The design body is what was ASKED for — print it, not a STATE block extracted
      // from it. (A STATE block belongs to the original body; 3P-TRDD-13 puts the design
      // after the divider.)
      console.log(C.b(`\n  ⏵ DESIGN BODY (after ${DESIGN_DIVIDER})\n`))
      for (const l of fresh.body.trim().split('\n')) console.log(`  ${l}`)
      console.log()
      break
    }
    // #165: a card with NO divider has no design half hidden behind a marker — the STATE
    // extraction below is a SUMMARY of a body that is also readable in full elsewhere (via
    // `--design-body`/`--no-design-body` on a divided card). Without a divider there is no
    // "elsewhere": summarizing down to just STATE (or to nothing, absent a STATE block)
    // silently dropped the rest of the card — a 254-line acceptance-checklist card rendered
    // as 20 lines. So a no-divider card renders whole; only a divided card gets the summary.
    // #167 review: ONE divider predicate — `bodyScope === 'all'` is still required here
    // because `bodySlice` short-circuits to "has a divider" for any OTHER scope (it has
    // already sliced the body down to one side of it by then), so calling it unguarded
    // would read as "yes" under `--no-design-body` regardless of the real body.
    const hasDivider = bodyScope === 'all' && hasDesignDivider(fresh.body)
    if (bodyScope === 'all' && !hasDivider) {
      console.log(C.b('\n  ⏵ BODY (no design-body divider — full card shown)\n'))
      for (const l of fresh.body.trim().split('\n')) console.log(`  ${l}`)
      console.log()
      break
    }
    // The STATE block is AUTHORITATIVE on resume — it supersedes the body, so it is the
    // only part worth printing by default.
    // #167: STATE_HEADING_SOURCE is anchored + tightened (line-start `m` flag; STATE must
    // not be followed by a word char or hyphen) so `## STATE-notes`/`## Statement of
    // work`/`### STATE` are never mistaken for the STATE block — the SAME pattern the
    // `append` verb's STATE alias uses to locate this exact heading (lib/trdd-store.ts).
    // #167 follow-up: the tail used to be `(?=\n## |\n$)` — under the `m` flag `\n$` also
    // matches a BLANK line, so a two-paragraph STATE block truncated at its first blank
    // line. `(?![\s\S])` only matches the true end of the string, so the capture now runs
    // to the next `## ` heading or the actual end of the body, whichever comes first.
    const state = fresh.body.match(new RegExp(`${STATE_HEADING_SOURCE}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`, 'im'))
    if (state) {
      console.log(C.b('\n  ⏵ STATE (authoritative — supersedes the body)\n'))
      for (const l of state[1].trim().split('\n').slice(0, 30)) console.log(`  ${l}`)
    } else {
      console.log(C.d('\n  (no STATE block — read the file)'))
    }
    console.log()
    break
  }

  case 'board': {
    const grouped = new Map()
    for (const c of cards) {
      if (c.zone !== 'tasks') continue
      if (columnVal !== undefined && c.column !== columnVal) continue
      if (!grouped.has(c.column)) grouped.set(c.column, [])
      grouped.get(c.column).push(c)
    }
    const n = [...grouped.values()].reduce((a, b) => a + b.length, 0)
    // An empty board under a filter must not look like an empty board: "no cards match
    // this column" and "the corpus has no open work" are different answers.
    if (n === 0 && columnVal !== undefined) {
      console.log(
        C.y(`\nno open cards in column ${JSON.stringify(columnVal)}`) +
          C.d(' — `trddgrep board` lists every column\n'),
      )
      break
    }
    const filtered = columnVal !== undefined ? `, column ${columnVal}` : ''
    console.log(C.b(`\n${n} open cards (design/tasks${filtered})\n`))
    for (const [col, cs] of [...grouped].sort((a, b) => b[1].length - a[1].length)) {
      const head = col === '(none)' ? C.r('(NO COLUMN — INVISIBLE TO THE BOARD)') : C.b(col.toUpperCase())
      // The heading count is the column's TRUE size, never the shown count — it is what
      // makes the board's shape readable even where the listing under it stops early.
      console.log(`═══ ${head} (${cs.length})`)
      const sorted = cs.sort((a, b) => String(a.priority ?? 9).localeCompare(String(b.priority ?? 9)))
      for (const c of capped(sorted)) {
        const blk = openBlockers(c).length
        console.log(`  ${fmt(c)}${blk ? '  ' + C.r(`⛔${blk}`) : ''}`)
      }
      const note = droppedNote(sorted, `(--column ${col} for this one, --limit 0 for all)`)
      if (note) console.log(note)
      console.log()
    }
    break
  }

  // ---- the WRITE GATE half, so one tool both retrieves and validates (memgrep's shape) ----
  // `lint` is for a human: findings grouped by rule, worst first.
  // `validate` is for a machine: one TAB row per finding, so `cut -f2` and `awk -F'\t'` are
  // exact. Greppability is a PROMISED property of that output, not an accident of it — a
  // consumer that split on prose would break the next time a message is reworded, which is
  // why the row is keyed on the stable CODE and never on the message text.
  // `doctor` is an ALIAS for `lint`, not a fourth thing: the repo-local script was called
  // `trdd-doctor` and `yarn trdd:doctor`, so that is the word an agent carries — and no
  // `trdd-doctor` name is distributed, by design (one tool per corpus, four names total).
  // An alias costs a line; a name an agent guesses and does not find costs the tool.
  case 'doctor':
  case 'lint':
  case 'validate': {
    const { lintCorpus } = await import('../lib/trdd-doctor.ts')
    const report = lintCorpus(designDir)
    // NON-VACUITY, in the GATE itself. The vitest suite has asserted
    // `scanned > 100` before checking for errors since it was written; the tool
    // that humans and agents actually run had no such guard, so an empty read
    // certified a clean corpus. Zero scanned is "could not run", never "clean".
    if (report.scanned === 0) {
      console.error(
        `trddgrep: scanned 0 TRDDs under ${designDir} — refusing to certify a corpus it never read`,
      )
      process.exit(2)
    }
    const strict = argv.includes('--strict')
    // The exit code answers "did what was ASKED FOR turn up anything", not "is the whole
    // corpus clean" — `--min-severity error` with zero errors present exits 0, same as a
    // clean corpus, because from that query's point of view nothing was found. Recomputed
    // from the FILTERED set for exactly that reason: the unfiltered `report.errors` would
    // report exit 1 for a query that printed nothing, which is the silent-drop bug this
    // whole flag exists to fix, wearing a different hat.
    const shown = filterFindings(report.findings)
    const shownErrors = shown.filter((f) => f.severity === 'error').length
    const shownWarnings = shown.length - shownErrors

    if (cmd === 'validate') {
      // SEV ⇥ CODE ⇥ id ⇥ path ⇥ message. No colour: this is piped, not read.
      for (const f of shown) {
        console.log([f.severity.toUpperCase(), f.rule, f.id, path.relative(process.cwd(), f.filePath), f.message].join('\t'))
      }
      process.exit(shownErrors > 0 || (strict && shownWarnings > 0) ? 1 : 0)
    }

    if (shown.length === 0) {
      console.log(C.g(`✓ ${report.scanned} TRDDs — ${minSeverityVal || ruleFilter ? 'no findings match the filter' : 'corpus is clean'}`))
      process.exit(0)
    }
    const byRule = new Map()
    for (const f of shown) {
      if (!byRule.has(f.rule)) byRule.set(f.rule, [])
      byRule.get(f.rule).push(f)
    }
    console.log(C.b(`\n${report.scanned} scanned · ${C.r(`${shownErrors} error`)} · ${C.y(`${shownWarnings} warn`)}\n`))
    // Errors first, then by volume: a single ERROR outranks ninety warnings, because the
    // error is what a gate refuses on and the warnings are a migration chore.
    const order = [...byRule].sort((a, b) =>
      (a[1][0].severity === b[1][0].severity ? 0 : a[1][0].severity === 'error' ? -1 : 1) || b[1].length - a[1].length)
    for (const [rule, fs_] of order) {
      const sev = fs_[0].severity === 'error' ? C.r('ERROR') : C.y('WARN ')
      console.log(`${sev} ${C.b(rule)} ×${fs_.length}${fs_[0].autofixable ? C.g(' [--fix]') : ''}`)
      console.log(`      ${C.d(fs_[0].message.slice(0, 150))}`)
      for (const f of fs_.slice(0, 6)) console.log(`      · ${f.id.padEnd(9)} ${C.d(path.relative(process.cwd(), f.filePath))}`)
      if (fs_.length > 6) console.log(C.d(`      … and ${fs_.length - 6} more`))
      console.log()
    }
    process.exit(shownErrors > 0 || (strict && shownWarnings > 0) ? 1 : 0)
  }

  // ---- the INDEX's own health (TRDD-C4YJAUD9) ----
  //
  // This is the REPAIRER half. The server's sweep detects and deliberately cannot fix
  // (`3P-IDX-07`, and `corpusKeyFor` is one-way so it could never rebuild), while this
  // command is the only path that HOLDS the corpus path — so it is the only one that can.
  // It is also the ONLY verification a standalone repo user with no ai-maestro server
  // running will ever get, which is why it exists even though the sweep covers the host.
  //
  // `--repair` adds no deletion code: it asks `openIndex` for the FULL depth and lets the
  // ALREADY-TESTED self-heal do the work. A second "is this healable?" decision is exactly
  // what drifted apart once before and cost a healthy index (see NEVER_HEALED).
  case 'index-verify': {
    const all = argv.includes('--all')
    const repair = argv.includes('--repair')
    if (all && repair) {
      console.error('trddgrep: --repair is per-corpus (it needs the corpus path); --all is detect-only')
      process.exit(2)
    }
    // LAZY + guarded, like `tryIndex`: better-sqlite3 is native and caps at Node 25, and a
    // health command that dies because its own dependency is unavailable has told the
    // operator nothing about the thing they asked about.
    let mod
    try {
      mod = await import('../lib/pillar/index-verify.ts')
    } catch (err) {
      console.error(`trddgrep: cannot load the index verifier — ${err?.message ?? err}`)
      console.error('trddgrep: the index needs the native better-sqlite3 (Node <= 25); the corpus itself is unaffected')
      process.exit(2)
    }

    // EXIT CODES follow the trichotomy, and `2` OUTRANKS `1` when both occur — grep's own
    // precedence (`grep pat readable unreadable` exits 2 even though it matched). "I could
    // not finish looking" must not be reported as "I looked and here is the verdict".
    const rank = { ok: 0, behind: 1, downgrade: 1, damaged: 1, busy: 2, unreadable: 2 }
    const describe = (v) => {
      const base = `${path.basename(v.file)}: ${C.b(v.state)}`
      const why = v.faults.length ? v.faults.map((f) => `${f.code}: ${f.detail}`).join('; ') : (v.detail ?? '')
      return why ? `${base} — ${why}` : base
    }

    if (all) {
      const r = mod.runIndexVerifySweep()
      if (r.verdicts.length === 0) {
        console.log(C.d(`\nno index files under ${r.dir} — nothing has been indexed on this host yet\n`))
        break
      }
      console.log(C.b(`\n${r.verdicts.length} index(es) under ${r.dir}\n`))
      let worst = 0
      for (const v of r.verdicts) {
        const colour = v.state === 'ok' ? C.g : v.state === 'damaged' ? C.r : C.y
        console.log(`  ${colour(describe(v))}`)
        worst = Math.max(worst, rank[v.state] ?? 2)
      }
      if (r.recorded.length) console.log(C.y(`\n  ${r.recorded.length} newly recorded in the heal ledger`))
      console.log()
      process.exit(worst)
    }

    const { indexPath, corpusKeyFor } = await import('../lib/pillar/index-db.ts')
    const { statePath } = await import('../lib/ecosystem-constants.ts')
    const file = indexPath(statePath('pillar-index'), corpusKeyFor(designDir))

    // "No index yet" is the NORMAL state before the first index-backed query, not a fault.
    // Reporting it as unreadable (which is what `fileMustExist` produces) would make a
    // clean cold repo look broken.
    const fsm = await import('fs')
    if (!fsm.existsSync(file)) {
      if (!repair) {
        console.log(C.d(`\nno index for this corpus yet — built on the first index-backed query\n  ${file}\n`))
        break
      }
      console.log(C.d(`no index yet — building it: ${file}`))
    }

    if (repair) {
      const { openIndex } = await import('../lib/pillar/index-db.ts')
      const { syncIndex } = await import('../lib/pillar/index-build.ts')
      const { TRDD_KIND } = await import('../lib/pillar/kinds.ts')
      const { readHealLedger } = await import('../lib/pillar/index-db.ts')
      const before = readHealLedger(mod.ledgerFileFor(file)).length
      // FULL depth on purpose: this is the one caller that WANTS the expensive pass on an
      // already-current index, because finding damage is the entire point of being asked.
      const db = openIndex(file, { verify: 'full' })
      try {
        const s = syncIndex(db, designDir, TRDD_KIND)
        console.log(C.g(`\n✓ repaired/rebuilt — ${s.records ?? 0} record(s), ${s.edges ?? 0} edge(s) synced`))
      } finally {
        db.close()
      }
      const after = readHealLedger(mod.ledgerFileFor(file))
      if (after.length > before) {
        console.log(C.y(`  heal recorded: ${after[after.length - 1].reason}`))
        for (const f of after[after.length - 1].faults) console.log(C.d(`    · ${f}`))
      } else {
        console.log(C.d('  no heal was needed — the index was already valid'))
      }
      console.log()
    }

    const v = mod.verifyIndexFile(file)
    const colour = v.state === 'ok' ? C.g : v.state === 'damaged' ? C.r : C.y
    console.log(`${colour(describe(v))}`)
    if (v.state === 'damaged' && !repair) {
      console.log(C.d('  repair with: trddgrep index-verify --repair'))
    }
    console.log()
    process.exit(rank[v.state] ?? 2)
  }


  // ---- AT LINE N REPLACE X WITH Y, the USER-specified transaction (TRDD-D7KVF4HQ).
  //
  // The directive named all THREE tools — "the trddgrep, specgrep and prrdgrep ... must
  // use a editing procedure like AT LINE N REPLACE X WITH Y". `fix` above is not that
  // verb: it applies the doctor's mechanically-DERIVABLE repairs, so it decides for
  // itself what to write. This one writes exactly what the caller says and BLOCKS when
  // the caller's view of the line is stale.
  //
  // It goes through `lib/pillar/cli.ts`, the same core prrdgrep and specgrep use, rather
  // than a fourth implementation — the whole reason that core exists is that three tools
  // must not drift into three concurrency stories. `--at-line` is REQUIRED here and
  // optional there: a TRDD is a per-DOCUMENT pillar whose record has no declaration
  // line, and defaulting to line 1 would be a confident write to the wrong place.
  case 'edit': {
    const { TRDD_KIND } = await import('../lib/pillar/kinds.ts')
    const { parseEditFlags, runPillarEdit, palette } = await import('../lib/pillar/cli.ts')
    // `--no-bump` is a NO-OP here, recognised for consistency with `set`/`append`/
    // `check-box`: unlike those, `edit` is a raw `--at-line`/`--expect`/`--replace`
    // triple (lib/pillar/cli.ts::runPillarEdit) that never touches `updated:` on its
    // own — it writes only the exact lines the caller named. A caller that always
    // appends `--no-bump` to a mechanical repair (matching the sibling verbs) must
    // not have `edit` refuse it as an unrecognised option.
    const editRest = argv.slice(2).filter((t) => t !== '--no-bump')
    const { edits, rest: strayEdit } = parseEditFlags(editRest)
    // `rest` used to be DISCARDED, so any token `parseEditFlags` did not recognise was
    // silently dropped and the write proceeded anyway. trddgrep's own help advertises
    // `--dry-run` for the sibling `fix` verb, so `trddgrep edit ID … --dry-run` performed
    // a REAL locked write to a governance document and exited 0 — measured. A mutating
    // verb must never ignore a token it does not understand.
    if (strayEdit.length > 0) {
      console.error(
        `trddgrep: unrecognised option(s) on \`edit\`: ${strayEdit.join(' ')} — ` +
          '`edit` performs a real locked write and has no --dry-run.',
      )
      process.exit(2)
    }
    // designDir IS the TRDD corpus root (TRDD_KIND.corpusSubdir is ''), so the lock key
    // this computes is byte-identical to the one lib/trdd-store.ts's write verbs take —
    // pinned by a test, because two keys for one document is exactly the failure this
    // card exists to prevent.
    await runPillarEdit(TRDD_KIND, designDir, arg, edits, palette(false), 'trddgrep')
    break
  }

  // ---- CREATE. The verb `PRRD G12.1` assumes exists (TRDD-I8UC56GZ).
  //
  // Every malformed card in this corpus was hand-written, and the failure is always the
  // same shape: a `cat > file <<EOF` writes a plausible card missing the two or three
  // fields no human remembers, and the linter's usual warning count is consistent with
  // their absence, so running it confirms nothing. A create verb writes them in the
  // first place.
  //
  // The MINTING, the mandate routing (authority >= floor ⇒ a self-approved mandate in
  // tasks/, below it ⇒ a proposal awaiting the approver) and the frontmatter-injection
  // guards are `lib/trdd-create.ts`, which the HTTP create route has used since
  // TRDD-40DYBI4T. Nothing of that is reimplemented here — this verb is the CLI surface
  // that library never had, which is why the tools looked like they had no create verb.
  case 'new': {
    const { createTrdd, readProjectId } = await import('../lib/trdd-create.ts')
    const { candidateFrontmatter, validateTrddCandidate } = await import('../lib/pillar/trdd-candidate.ts')
    const { parseTrddFile } = await import('../lib/trdd-store.ts')

    let list = argv.slice(1)
    const take = (name) => {
      const i = list.indexOf(name)
      if (i < 0) return undefined
      const v = list[i + 1]
      if (v === undefined) {
        console.error(`trddgrep: ${name} needs a value`)
        process.exit(2)
      }
      list = [...list.slice(0, i), ...list.slice(i + 2)]
      return v
    }
    const title = take('--title')
    const taskType = take('--task-type')
    const author = take('--author')
    const assignee = take('--assignee')
    const minApproval = take('--min-approval')
    const authority = take('--authority')
    const parent = take('--parent')
    const npt = take('--npt')
    const eht = take('--eht')
    const body = take('--body')
    // STRAY TOKENS ARE A REFUSAL, never a silent drop — the same contract `edit` carries.
    // A mutating verb that ignores a token performs a DIFFERENT write than the one asked
    // for and reports success; `--titel "…"` would otherwise mint a card called
    // "untitled" and exit 0.
    if (list.length > 0) {
      console.error(
        `trddgrep: unrecognised argument(s) on \`new\`: ${list.join(' ')} — see \`trddgrep help\``,
      )
      process.exit(2)
    }
    if (!title) {
      console.error('trddgrep: `new` needs --title (and --task-type); see `trddgrep help`')
      process.exit(2)
    }
    if (!taskType) {
      console.error('trddgrep: `new` needs --task-type (feature|bugfix|refactor|docs|infra|security|artifact|spike|audit)')
      process.exit(2)
    }
    // AUTHORITY DEFAULTS TO `none`, deliberately. It decides whether the card is born a
    // self-approved MANDATE or a proposal awaiting an approver, so a permissive default
    // would let any caller mint a manager-floor mandate by omitting a flag. `none` can
    // only ever route a card to the MORE gated of the two zones.
    const splitIds = (v) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    // WHO IS WRITING (ai-maestro#168): explicit --author, else the caller's AID, else
    // `main-agent@<project-id>` only on a machine with no agent registry, else refuse.
    // Never `process.env.USER` — the OS login is the leak #168 reports.
    const { resolveCliIdentity, mainAgentProjectMismatch } = await import('../lib/trdd-identity.ts')
    const pid = readProjectId(designDir)
    const projectId = 'id' in pid ? pid.id : null
    const who = resolveCliIdentity({ explicit: author, flag: '--author', projectId })
    if (!who.ok) {
      console.error(`trddgrep: refusing to create — ${who.error}`)
      process.exit(2)
    }
    // --assignee is not resolved (it names someone else), so it gets the same project check
    // here; createTrdd checks only its grammar. The check lives at the CLI rather than in
    // createTrdd because the API's author is always `<name>#<uuid>` or `user`, never main-agent.
    const assigneeMismatch = assignee ? mainAgentProjectMismatch(assignee, projectId) : null
    if (assigneeMismatch) {
      console.error(`trddgrep: refusing to create — --assignee ${assigneeMismatch}`)
      process.exit(2)
    }
    let result
    try {
      result = createTrdd(designDir, {
        title,
        taskType,
        column: columnVal,
        minApproval: minApproval ?? 'none',
        authorAuthority: authority ?? 'none',
        author: who.identity,
        ...(assignee ? { assignee } : {}),
        ...(parent ? { parent } : {}),
        npt: splitIds(npt),
        eht: splitIds(eht),
        ...(body ? { body } : {}),
      })
    } catch (err) {
      console.error(`trddgrep: refusing to create — ${err?.message ?? err}`)
      process.exit(2)
    }

    // POST-WRITE GATE. The card was written by a function that means to write it
    // correctly; this asks the SHARED predicate — the same one `trddgrep edit` is gated
    // on — whether it did. A card that would not pass is DELETED rather than left for a
    // human to find: nothing else references it yet, so the abort is clean, and a
    // half-valid governance document that exists is worse than one that does not.
    const written = fs.readFileSync(result.file, 'utf-8')
    const violations = validateTrddCandidate(candidateFrontmatter(written.split('\n')), result.zone)
    // The store's own parser is the second oracle: a file the predicate likes but the
    // corpus reader cannot parse is invisible to every board query, which is the one
    // failure a frontmatter check cannot see.
    if (!parseTrddFile(result.file, result.zone)) {
      violations.push('the TRDD store cannot parse the file just written — it would be invisible to every board query')
    }
    if (violations.length) {
      fs.unlinkSync(result.file)
      console.error(`trddgrep: refusing to leave an invalid TRDD — created and REMOVED ${result.file}:`)
      for (const v of violations) console.error(`  • ${v}`)
      process.exit(2)
    }

    console.log(C.g(`created ${C.b(result.id)}  ${path.relative(process.cwd(), result.file)}`))
    console.log(C.d(`  zone=${result.zone}  column=${result.column}`))
    // TRDD-8D9ZYZX9: the card was minted without `project-id:`. stderr, not stdout,
    // and AFTER the success lines — the mint succeeded, so a caller piping stdout
    // still gets a clean id, and this never turns into an exit code.
    if (result.warning) console.error(C.y(`trddgrep: ${result.warning}`))
    console.log(C.y(`  git add ${path.relative(process.cwd(), result.file)} && git commit`))
    process.exit(0)
  }

  // ---- SET one frontmatter field. The verb that removes the LINE NUMBER from a field edit.
  //
  // `edit --at-line N --expect … --replace …` makes a line number stand in for the field
  // you meant. Its staleness guard covers a MOVED line and cannot cover an ABSENT one:
  // the card hand-authored earlier today was patched twice with a regex anchored on a
  // `created-by:` line it did not have, both inserts failed SILENTLY, and the card then
  // claimed a state it did not carry. A setter that INSERTS a missing field cannot
  // produce that shape.
  case 'set': {
    const [setSw, [setId, field, value, ...setRest]] = splitSwitches(argv.slice(1), ['--no-bump'])
    if (!setId || !field || value === undefined) {
      console.error('trddgrep: `set` needs an id, a field and a value — `trddgrep set <id> <field> <value>`')
      process.exit(2)
    }
    const noBump = setSw.has('--no-bump')
    if (setRest.length > 0) {
      console.error(`trddgrep: unrecognised argument(s) on \`set\`: ${setRest.join(' ')} — see \`trddgrep help\``)
      process.exit(2)
    }
    // Identity fields (ai-maestro#168) take the identity grammar on every NEW write: before
    // this, `set <id> assignee agent` wrote a free string into the field that confers owner
    // rights. Only the value being written is checked — legacy values already on cards stay
    // readable. An empty value (clearing the field) is not an identity and is let through.
    if (['created-by', 'current-owner', 'assignee', 'approval-judge'].includes(field) && value !== '') {
      const { parseTrddIdentity, TRDD_IDENTITY_FORMS } = await import('../lib/trdd-vocabulary.ts')
      const { mainAgentProjectMismatch } = await import('../lib/trdd-identity.ts')
      const { readProjectId } = await import('../lib/trdd-create.ts')
      if (!parseTrddIdentity(value)) {
        console.error(`trddgrep: refusing to set ${field} — ${JSON.stringify(value)} is not an identity — use ${TRDD_IDENTITY_FORMS} (ai-maestro#168)`)
        process.exit(2)
      }
      const pid = readProjectId(designDir)
      const mismatch = mainAgentProjectMismatch(value, 'id' in pid ? pid.id : null)
      if (mismatch) {
        console.error(`trddgrep: refusing to set ${field} — ${mismatch}`)
        process.exit(2)
      }
    }
    const { setTrddField, isoLocal } = await import('../lib/trdd-store.ts')
    const res = await setTrddField(designDir, setId, field, value, { iso: isoLocal().iso, bump: !noBump })
    if (!res.ok) {
      console.error(`trddgrep: ${res.error}`)
      process.exit(res.status === 404 ? 1 : 2)
    }
    console.log(C.g(`${C.b(res.id)}  ${field}: ${value}`))
    console.log(C.d(`  ${path.relative(process.cwd(), res.filePath)}${noBump ? '  (mechanical — updated: untouched)' : ''}`))
    process.exit(0)
  }

  // ---- APPEND to a named `## ` section, and TICK an acceptance box by ORDINAL.
  //
  // Both replace a LINE NUMBER with the address the caller actually means. `append`
  // replaces `edit --at-line N --expect <an existing line> --replace <that line + the new
  // text>`, which this session performed four times; `check-box` replaces hunting for the
  // line a `- [ ]` sits on. The line-number route is CAS-guarded and safe — what it is
  // not is honest about what is being addressed.
  case 'append': {
    const [aSw, [aId, heading, text, ...aRest]] = splitSwitches(argv.slice(1), ['--no-bump', '--create'])
    if (!aId || !heading || text === undefined) {
      console.error('trddgrep: `append` needs an id, a section heading and a line — `trddgrep append <id> "## Approval log" "<text>"`')
      process.exit(2)
    }
    const aNoBump = aSw.has('--no-bump')
    // #167: an unmatched heading used to silently CREATE a new `## <heading>` section at
    // EOF — even on a frozen terminal card — which is how a typo'd or stale heading (e.g.
    // addressing `## ⏵ STATE — READ THIS FIRST ON RESUME` by its old plain name) produced a
    // duplicate section instead of an error. Default is now refuse; `--create` opts in.
    const aCreate = aSw.has('--create')
    if (aRest.length > 0) {
      console.error(`trddgrep: unrecognised argument(s) on \`append\`: ${aRest.join(' ')} — see \`trddgrep help\``)
      process.exit(2)
    }
    const { appendTrddSection, isoLocal } = await import('../lib/trdd-store.ts')
    const res = await appendTrddSection(designDir, aId, heading, text, { iso: isoLocal().iso, bump: !aNoBump, create: aCreate })
    if (!res.ok) {
      console.error(`trddgrep: ${res.error}`)
      process.exit(res.status === 404 ? 1 : 2)
    }
    // The confirmation names which of the two happened — a caller addressing the STATE
    // alias, or any other heading, needs to know whether it hit an existing section or just
    // minted one, since the latter is the exact silent-duplicate shape #167 reports.
    const marker = heading.startsWith('## ') ? heading : `## ${heading}`
    console.log(C.g(`${C.b(res.id)}  ${res.created ? 'created' : 'appended to existing'} ${marker}`))
    console.log(C.d(`  ${path.relative(process.cwd(), res.filePath)}`))
    process.exit(0)
  }

  case 'check-box': {
    const [bSw, [bId, bOrdinal, ...bRest]] = splitSwitches(argv.slice(1), ['--uncheck', '--no-bump'])
    const ordinal = Number(bOrdinal)
    if (!bId || !Number.isInteger(ordinal) || ordinal < 1) {
      console.error('trddgrep: `check-box` needs an id and a 1-based box number — `trddgrep check-box <id> 3 [--uncheck]`')
      process.exit(2)
    }
    const uncheck = bSw.has('--uncheck')
    const bNoBump = bSw.has('--no-bump')
    if (bRest.length > 0) {
      console.error(`trddgrep: unrecognised argument(s) on \`check-box\`: ${bRest.join(' ')} — see \`trddgrep help\``)
      process.exit(2)
    }
    const { checkTrddBox, isoLocal } = await import('../lib/trdd-store.ts')
    const res = await checkTrddBox(designDir, bId, ordinal, { iso: isoLocal().iso, check: !uncheck, bump: !bNoBump })
    if (!res.ok) {
      console.error(`trddgrep: ${res.error}`)
      process.exit(res.status === 404 && /TRDD not found/.test(res.error ?? '') ? 1 : 2)
    }
    console.log(C.g(`${C.b(res.id)}  box ${ordinal} → [${uncheck ? ' ' : 'x'}]`))
    console.log(C.d(`  ${path.relative(process.cwd(), res.filePath)}`))
    process.exit(0)
  }

  // ---- MOVE. The column edit AND the zone `git mv`, as ONE operation.
  //
  // A transition is two hand steps today — edit `column:`, then `git mv` between
  // design/proposals|tasks|archived — and doing one without the other is how a
  // card ends terminal in the OPEN zone, which makes the open count a lie. This session
  // shipped exactly that defect once, and its own linter caught it. (`refused` is a
  // column value only — moving TO or FROM it never `git mv`s, owner ruling 2026-09-24.)
  //
  // The four transitions are ALREADY implemented, with the git mv, the rollback and the
  // lock, in `lib/trdd-store.ts` — they were reachable only through the HTTP API. This
  // verb is a dispatcher over them, keyed on `expectedZone` so the CLI and the linter
  // cannot disagree about where a column belongs. It writes no transition logic of its own.
  case 'move': {
    const targetColumn = argv[2]
    if (!arg || !targetColumn) {
      console.error('trddgrep: `move` needs an id and a target column — `trddgrep move <id> <column>`')
      process.exit(2)
    }
    let mvRest = argv.slice(3)
    const takeMv = (name) => {
      const i = mvRest.indexOf(name)
      if (i < 0) return undefined
      const v = mvRest[i + 1]
      if (v === undefined) { console.error(`trddgrep: ${name} needs a value`); process.exit(2) }
      mvRest = [...mvRest.slice(0, i), ...mvRest.slice(i + 2)]
      return v
    }
    const approver = takeMv('--approver')
    const reason = takeMv('--reason')
    const supersededBy = takeMv('--superseded-by')
    const clearBlocker = mvRest.includes('--clear-blocker')
    mvRest = mvRest.filter((t) => t !== '--clear-blocker')
    if (mvRest.length > 0) {
      console.error(`trddgrep: unrecognised argument(s) on \`move\`: ${mvRest.join(' ')} — see \`trddgrep help\``)
      process.exit(2)
    }

    const { findTrdd, isoLocal, promoteTrdd, refuseTrdd, advanceColumn, archiveTrdd } =
      await import('../lib/trdd-store.ts')
    const { VALID_COLUMNS, expectedZone } = await import('../lib/trdd-vocabulary.ts')

    const card = findTrdd(designDir, arg)
    if (!card) {
      console.error(`trddgrep: no TRDD ${JSON.stringify(arg)} under ${designDir}`)
      process.exit(1)
    }
    if (!VALID_COLUMNS.includes(targetColumn)) {
      console.error(`trddgrep: ${JSON.stringify(targetColumn)} is not a ratified column — one of: ${VALID_COLUMNS.join(' ')}`)
      process.exit(2)
    }
    const { iso } = isoLocal()
    // WHO DECIDES (ai-maestro#168) — the same identity order as `new`, resolved only for the
    // transitions that RECORD an approver. Never `process.env.USER`.
    const { resolveCliIdentity } = await import('../lib/trdd-identity.ts')
    const { readProjectId } = await import('../lib/trdd-create.ts')
    const identityOrDie = () => {
      const pid = readProjectId(designDir)
      const r = resolveCliIdentity({ explicit: approver, flag: '--approver', projectId: 'id' in pid ? pid.id : null })
      if (!r.ok) {
        console.error(`trddgrep: refusing to move — ${r.error}`)
        process.exit(2)
      }
      return r.identity
    }
    const recordsApprover = expectedZone(targetColumn, card.frontmatter ?? {}) === 'archived'
      || targetColumn === 'refused' || (targetColumn === 'planned' && card.zone === 'proposals')
    // An in-place advance records an approver only when one is given — and a given one must
    // still be an identity, never a free string on the card.
    const who = recordsApprover ? identityOrDie() : approver === undefined ? undefined : identityOrDie()
    // `expectedZone` is the arbiter, not a table local to this file. `null` means the
    // column implies no zone constraint (a `complete` card with release-via publish
    // still has stages ahead of it), which is an in-place advance.
    const want = expectedZone(targetColumn, card.frontmatter ?? {}) ?? 'tasks'
    let res
    if (want === 'archived') {
      res = await archiveTrdd(designDir, card.id, { approver: who, state: targetColumn, reason, supersededBy, iso, clearBlocker })
    } else if (targetColumn === 'refused') {
      // `refused` is a column, not a zone (owner ruling 2026-09-24) — the card stays
      // in proposals/, so this is never a folder move.
      res = await refuseTrdd(designDir, card.id, { approver: who, reason, iso })
    } else if (targetColumn === 'proposal') {
      // `want` is 'proposals' for BOTH 'proposal' and 'refused' targets now that
      // `refused` shares the same zone — so this branch is reached only by an actual
      // `proposal` target, and it must distinguish RE-PROPOSING a card already in
      // proposals/ (an in-zone column edit — e.g. refused → proposal) from
      // UN-APPROVING one that already left proposals/ for tasks/ or archived/, which
      // no store verb performs and inventing one here would be a write with no
      // approval record.
      if (card.zone !== 'proposals') {
        console.error(`trddgrep: moving a card BACK to column 'proposal' is not a supported transition — a card that left proposals/ was approved, and un-approving it is a governance decision, not a move`)
        process.exit(2)
      }
      res = await advanceColumn(designDir, card.id, targetColumn, { iso, note: reason, approver: who, clearBlocker })
    } else if (card.zone === 'proposals') {
      // proposals/ → tasks/ IS the approval event, and `promoteTrdd` is the verb that
      // writes the approval record for it. It lands on `planned` by definition, so a
      // request for any other column is two transitions; asking for them separately
      // keeps the approval honest instead of burying it inside an advance.
      if (targetColumn !== 'planned') {
        console.error(`trddgrep: ${card.id} is a proposal — approve it first with \`trddgrep move ${card.id} planned\`, then advance it to ${targetColumn}`)
        process.exit(2)
      }
      res = await promoteTrdd(designDir, card.id, { approver: who, rationale: reason, iso })
    } else {
      res = await advanceColumn(designDir, card.id, targetColumn, { iso, note: reason, approver: who, clearBlocker })
    }

    if (!res.ok) {
      console.error(`trddgrep: ${res.error}`)
      process.exit(res.status === 404 ? 1 : 2)
    }
    const moved = res.from && res.to && res.from !== res.to
    console.log(C.g(`${C.b(res.id)} → column ${res.column}${moved ? `  (design/${res.from}/ → design/${res.to}/)` : ''}`))
    console.log(C.d(`  ${path.relative(process.cwd(), res.filePath)}`))
    if (moved) console.log(C.y('  the rename is STAGED — commit it with the content in one commit'))
    process.exit(0)
  }

  // ---- ARCHIVE. A dedicated verb for the terminal move `move` already performs when the
  // target column is a finished one (TRDD-4NISAY49) — but `move` never authorizes: it
  // trusts whoever is holding the keyboard. `archive` is the FIRST CLI write verb that
  // decides who may act, because the act it performs is IRREVERSIBLE (TRDD-MQE5D28T D8 —
  // an archived card can never be un-archived). It reuses `decideTrddVerb`
  // (lib/trdd-authz.ts), the exact decision the HTTP route makes, so the CLI and the API
  // cannot disagree about who may archive a card.
  //
  // Target may be an id OR a file path (a worker handed a path by its own tooling should
  // not have to reverse-engineer the id first). A path is realpath-resolved and MUST
  // land inside proposals/, tasks/ or archived/ of the resolved corpus — never used to
  // reach outside it.
  //
  // WHO MAY ARCHIVE, from the CLI's identity (ai-maestro#168 grammar):
  //   `user`             → the human owner — always allowed (mirrors authorize()'s
  //                         own `!auth.agentId` system-owner grant).
  //   `main-agent@<pid>` → a project's main session — same grant, no registered agentId.
  //   AID-resolved        → the ONE verifiable agent identity a CLI can produce: the
  //                         caller proved it holds a live agent's session secret. Runs
  //                         through `decideTrddVerb` exactly as the route would.
  //   an explicit `--approver <name>#<uuid>` → SELF-DECLARED, unverifiable from a CLI
  //                         with no session to check it against — refused. An agent
  //                         proves who it is with AID_AUTH, not by typing a name.
  case 'archive': {
    const target = argv[1]
    if (!target) {
      console.error('trddgrep: `archive` needs an id or a file path — `trddgrep archive <TRDD-ID | file path> [--approver <identity>] [--as completed|cancelled|superseded] [--reason <text>] [--superseded-by <id>] [--clear-blocker]`')
      process.exit(2)
    }
    const [arSw, arRest0] = splitSwitches(argv.slice(2), ['--clear-blocker'])
    const clearBlocker = arSw.has('--clear-blocker')
    let arRest = arRest0
    const takeAr = (name) => {
      const i = arRest.indexOf(name)
      if (i < 0) return undefined
      const v = arRest[i + 1]
      if (v === undefined) { console.error(`trddgrep: ${name} needs a value`); process.exit(2) }
      arRest = [...arRest.slice(0, i), ...arRest.slice(i + 2)]
      return v
    }
    const approver = takeAr('--approver')
    const asState = takeAr('--as')
    const reason = takeAr('--reason')
    const supersededBy = takeAr('--superseded-by')
    if (arRest.length > 0) {
      console.error(`trddgrep: unrecognised argument(s) on \`archive\`: ${arRest.join(' ')} — see \`trddgrep help\``)
      process.exit(2)
    }

    const { TRDD_ZONES, trddIdFromFilename, TRDD_KIND } = await import('../lib/pillar/kinds.ts')
    const { listTrddFiles, isoLocal, archiveTrdd, withTrddLock } = await import('../lib/trdd-store.ts')

    // Resolve the target to an id. A path must exist, realpath inside the corpus, and
    // land in one of the three TRDD zones — never used to escape the corpus root.
    let id
    const asPath = path.resolve(process.cwd(), target)
    if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
      let resolved
      try {
        resolved = fs.realpathSync.native(asPath)
      } catch {
        console.error(`trddgrep: could not resolve path '${target}'`)
        process.exit(2)
      }
      const corpusReal = fs.realpathSync.native(designDir)
      const rel = path.relative(corpusReal, resolved)
      const zoneDir = rel.split(path.sep)[0]
      if (rel.startsWith('..') || path.isAbsolute(rel) || !TRDD_ZONES.includes(zoneDir)) {
        console.error(`trddgrep: '${target}' is not inside ${designDir}/{${TRDD_ZONES.join(',')}} — refusing to archive a path outside the corpus`)
        process.exit(2)
      }
      const fromName = trddIdFromFilename(path.basename(resolved))
      if (!fromName) {
        console.error(`trddgrep: '${target}' is not a TRDD file`)
        process.exit(2)
      }
      id = fromName
    } else {
      id = target
    }

    // Duplicate-id guard: archiving is irreversible, so never silently pick one.
    const want = TRDD_KIND.normalizeId(id)
    const matches = []
    for (const zone of TRDD_ZONES) {
      for (const file of listTrddFiles(designDir, zone)) {
        if (trddIdFromFilename(path.basename(file)) === want) matches.push(file)
      }
    }
    if (matches.length > 1) {
      console.error(`trddgrep: more than one file carries id ${want} — refusing to archive (irreversible, never picks one): ${matches.join(', ')}`)
      process.exit(2)
    }
    if (matches.length === 0) {
      console.error(`trddgrep: no TRDD ${JSON.stringify(target)} under ${designDir}`)
      process.exit(1)
    }

    const { iso } = isoLocal()
    const { resolveCliIdentity } = await import('../lib/trdd-identity.ts')
    const { readProjectId } = await import('../lib/trdd-create.ts')
    const { parseTrddIdentity } = await import('../lib/trdd-vocabulary.ts')
    const { decideTrddVerb, ARCHIVABLE_STATES } = await import('../lib/trdd-authz.ts')

    // The same DATA invariant the API route enforces (trdd-authz.ts's own
    // `rejectUnarchivableState`, reimplemented here because that one returns a
    // `NextResponse`): an ABSENT --as means archive AS-IS, keeping the card's column
    // (TRDD-MQE5D28T D2) — the way a `failed` card is archived. A given value must be
    // one of the three finished states; `failed` is never a --as target.
    const asStateNorm = asState === undefined ? undefined : asState.toLowerCase()
    if (asStateNorm !== undefined && !ARCHIVABLE_STATES.has(asStateNorm)) {
      console.error(`trddgrep: --as must be one of ${[...ARCHIVABLE_STATES].join(' | ')} (got '${asState}'). To archive a failed card, omit --as — it is archived as-is, keeping 'failed' (definitive).`)
      process.exit(2)
    }

    const pid = readProjectId(designDir)
    const who = resolveCliIdentity({ explicit: approver, flag: '--approver', projectId: 'id' in pid ? pid.id : null })
    if (!who.ok) {
      console.error(`trddgrep: refusing to archive — ${who.error}`)
      process.exit(2)
    }
    const identity = parseTrddIdentity(who.identity)

    // Authorize and archive as ONE critical section (TRDD-6D6SQNI6's own reasoning
    // applied here): `withTrddLock` is reentrant, so nesting inside `archiveTrdd`'s own
    // acquisition is safe, and it means the decision is made against the exact on-disk
    // state the write then acts on.
    const outcome = await withTrddLock(designDir, id, async () => {
      if (who.source === 'flag' && identity?.kind === 'agent') {
        return {
          ok: false,
          status: 2,
          error: 'an agent must prove its identity with AID_AUTH to archive — a self-declared --approver name#uuid cannot be verified from the CLI',
        }
      }
      if (who.source === 'aid') {
        if (!identity || identity.kind !== 'agent') {
          return { ok: false, status: 2, error: 'internal error — AID-resolved identity is not an agent identity' }
        }
        const decision = decideTrddVerb({ agentId: identity.uuid }, designDir, id, 'archive')
        if (!decision.allowed) {
          return { ok: false, status: decision.status === 404 ? 1 : 2, error: decision.reason }
        }
      }
      // 'default' (main-agent@<pid>) and 'flag' + user/main-agent bypass — no registered
      // agentId, same grant `authorize()` itself gives the human/main-agent caller.
      return await archiveTrdd(designDir, id, { approver: who.identity, state: asStateNorm, reason, supersededBy, iso, clearBlocker })
    })

    if (!outcome.ok) {
      console.error(`trddgrep: ${outcome.error}`)
      process.exit(outcome.status === 404 ? 1 : 2)
    }
    console.log(C.g(`${C.b(outcome.id)}  archived (design/${outcome.from}/ → design/${outcome.to}/)  column: ${outcome.column}`))
    console.log(C.d(`  ${path.relative(process.cwd(), outcome.filePath)}`))
    process.exit(0)
  }

  // ---- which corpus am I, and why. The USER's mandate (2026-07-30) is that the tools
  // DETECT their environment rather than being configured per project, so that detection
  // has to be inspectable: an agent that cannot see what the tool concluded cannot tell
  // "standalone project" from "the registry was unreadable". Read-only by construction —
  // resolvePillarEnvironment never creates the state dir it looks in.
  case 'env': {
    const { resolvePillarEnvironment } = await import('../lib/pillar/environment.ts')
    const env = resolvePillarEnvironment()
    console.log(`mode=${env.mode}`)
    if (env.mode === 'agent') {
      console.log(`agent=${env.agentName}`)
      console.log(`workdir=${env.workdir}`)
    }
    console.log(`reason=${env.reason}`)
    console.log(`corpus=${designDir}`)
    process.exit(0)
  }

  case 'help':
  case '--help':
  case '-h':
    console.log(`
${C.b('trddgrep')} — query, CREATE, MOVE AND validate the TRDD corpus (offline; no server)

  ${C.y('MANDATORY — PRRD G12.1 (GOLDEN).')} ${C.d('Every write to a TRDD goes through this tool:')}
  ${C.d('  new · move · edit · fix. Hand edits (an editor, sed, a heredoc, a redirection) are')}
  ${C.d('  forbidden — they bypass the lock, the staleness guard and the field gate, and every')}
  ${C.d('  malformed card in this corpus was hand-written. If a verb you need is MISSING, FILE')}
  ${C.d('  that as a TRDD; do not work around it. The sibling tools are prrdgrep and specgrep.')}

  ${C.c('trddgrep')}                  the board
  ${C.c('trddgrep next')}             what is workable RIGHT NOW, ranked by what it frees
  ${C.c('trddgrep why <id>')}         the transitive blocker chain, down to the ROOT CAUSE
  ${C.c('trddgrep unblocks <id>')}    what finishing this would free
  ${C.c('trddgrep roots')}            every root blocker — the critical path of the board
  ${C.c('trddgrep show <id>')}        the card + its STATE block
  ${C.c('trddgrep <pattern>')}        ranked search over title, labels, id, body

  ${C.c('trddgrep lint')}             every finding, grouped by rule (errors first)
  ${C.c('trddgrep validate')}         the WRITE GATE — TAB rows: SEV⇥CODE⇥id⇥path⇥msg
  ${C.d('  … add --strict to either to fail on warnings too (exit 1)')}
  ${C.d('  … --min-severity warn|error and --rule CODE[,CODE…] narrow what is SHOWN; exit')}
  ${C.d('    reflects the shown set, so a filter matching nothing exits 0')}

  ${C.c('--porcelain')}               machine-readable show and search: one record per
  ${C.d('    line, TAB-separated, in this order (additive-only contract): path (absolute)')}
  ${C.d('    · id · column · zone · title (last — a rogue tab in it cannot shift fields).')}
  ${C.d('    No prose on stdout; a capped search says so on stderr. Exit codes unchanged:')}
  ${C.d('    0 match · 1 none · 2 could-not-run.')}
  ${C.c('trddgrep fix')}              write the mechanically-derivable repairs (--dry-run first)

  ${C.c('trddgrep new --title T --task-type X')}   mint a card with EVERY mandatory field
  ${C.d('  --author W --assignee W --column C --min-approval none|orchestrator|chief-of-staff|manager|user')}
  ${C.d('  --authority W --parent ID --npt A,B --eht A,B --body TEXT')}
  ${C.d('  The ZONE is decided by AUTHORITY vs the floor, never by a flag: at or above it the')}
  ${C.d('  card is a self-approved MANDATE in tasks/, below it a proposal awaiting the approver.')}
  ${C.d('  --authority defaults to none — the only default that can never over-grant.')}

  ${C.c('trddgrep set <id> <field> <value>')}   one frontmatter field, no line numbers
  ${C.d('  --no-bump   a MECHANICAL repair — leaves `updated:` alone so the board order holds.')}
  ${C.d('  Inserts the field when absent, so the silent no-op a regex patch produces cannot')}
  ${C.d('  happen. Refuses `column` — that is half a transition; use move.')}

  ${C.c('trddgrep append <id> <heading> <line>')}   add a line to the END of a named section
  ${C.d('  [--create] [--no-bump]. Refuses an unmatched heading by default (exit 2, file')}
  ${C.d('  untouched) — it will NOT invent a `## <heading>` for you; pass --create to add a')}
  ${C.d('  new section (refused on a terminal-column card, except `## Approval log`, which is')}
  ${C.d('  append-only and exempt). `STATE` (any case, with or without `## `) is a built-in')}
  ${C.d('  alias for the `## ⏵ STATE — ...` block, matched by heading, not by exact text —')}
  ${C.d('  it never matches `## STATE-notes` or similar.')}
  ${C.c('trddgrep check-box <id> <n>')}   tick the Nth acceptance box  [--uncheck] [--no-bump]
  ${C.d('  Both address what you MEAN — a section, a box ordinal — instead of a line number.')}
  ${C.d('  check-box counts exactly what the terminal gate counts, fenced code excluded, and')}
  ${C.d('  refuses a tick that changes nothing rather than reporting a no-op as success.')}

  ${C.c('trddgrep move <id> <column>')}   the column edit AND the zone git-mv, as ONE operation
  ${C.d('  --approver W --reason TEXT --superseded-by ID --clear-blocker')}
  ${C.d('  Doing one half without the other is how a card ends terminal in the OPEN zone, which')}
  ${C.d('  makes the open count a lie. The target zone comes from the same table the linter')}
  ${C.d('  reads, so the two cannot disagree. Archiving as complete/published/live requires a')}
  ${C.d('  finished acceptance checklist; a proposal must be approved (→ planned) before it advances.')}
  ${C.d('  Leaving `blocked` also owns `blocked-by`: it clears when every blocker is terminal,')}
  ${C.d('  else the move is REFUSED (409) naming the ids still open — pass --clear-blocker to force it.')}
  ${C.d('  A card ALREADY in archived/ is refused outright — definitive history, un-archiveable')}
  ${C.d('  (TRDD-MQE5D28T D8). Record that a newer card replaces it with `supersedes: [id]` on')}
  ${C.d('  the replacement, never by rewriting the archived card.')}

  ${C.c('trddgrep edit <id> --at-line N --expect X --replace Y')}   [--no-bump]
  ${C.d('  AT LINE N, REPLACE X WITH Y — under the document lock. If X is not at line N the')}
  ${C.d('  card changed since you read it and the edit is BLOCKED (exit 2, stderr starts STALE).')}
  ${C.d('  --at-line is REQUIRED: a TRDD record spans the whole document, so there is no line')}
  ${C.d('  to default to. Repeat the triple for a batch; a batch is ALL-OR-NOTHING.')}
  ${C.d('  --no-bump   accepted for consistency with set/append/check-box, but a no-op: `edit`')}
  ${C.d('  never touches `updated:` on its own — pass an explicit triple to change it.')}

  ${C.c('trddgrep env')}              which corpus this is — standalone project or ai-maestro agent

  ${C.c('trddgrep index-verify')}     the FULL index check (integrity_check) for this corpus
  ${C.d('  --repair   rebuild it if damaged — the only path that CAN, it holds the corpus')}
  ${C.d('  --all      every index on this host, detect-only (the server sweeps this 6-hourly)')}

  ${C.d('Exit: 0 clean · 1 findings · 2 THE CHECK COULD NOT RUN. 2 outranks 1 — grep\'s own')}
  ${C.d('precedence. So never write `trddgrep validate || …`: that collapses "found')}
  ${C.d('findings" into "could not run", the exact conflation the third code prevents.')}

  ${C.d('--limit N    rows per list before board/roots/next stop AND SAY SO (default 20;')}
  ${C.d('             0 = no limit, which reproduces the un-capped output exactly). The')}
  ${C.d('             search has always had its own stated cap of 25 and is unaffected.')}
  ${C.d('--column C   board only — list just column C (its heading still shows the true size)')}

  ${C.d('--design-body / --no-design-body   which HALF of the body show and the search read.')}
  ${C.d('             A card\'s design lives in the SAME file, after the exact divider line')}
  ${C.d('             ' + DESIGN_DIVIDER + ' (3P-TRDD-13). --design-body reads only what')}
  ${C.d('             follows it, --no-design-body only what precedes it; neither together.')}
  ${C.d('             A card with NO divider has no design body: it is SKIPPED entirely under')}
  ${C.d('             --design-body (show exits 1), and is all original body under the other.')}
  ${C.d('             Neither flag = the whole body, unchanged. Other verbs read no prose and')}
  ${C.d('             REFUSE these (exit 2) rather than ignore them.')}

  ${C.d('--no-index   answer the graph from the corpus WALK, not the SQLite index.')}
  ${C.d('             The index serves why/unblocks/roots/board/next; search is walk-only')}
  ${C.d('             by design, and `show` re-reads its one file for freshness.')}

Repair of the mechanically-derivable findings: ${C.c('yarn trdd:fix')}
`)
    break

  default: {
    // Ranked search. Title and labels outrank the body: a word in the title is what the
    // card IS; a word in the body may be an aside.
    const rx = new RegExp(cmd, 'i')
    // The ONE command that must read every body — so it is the one that must keep
    // none. Each body is scored and dropped in the same iteration; what survives is
    // the count of matches, never the prose that produced it. Streaming here also
    // means an unmatched corpus costs no more memory than a matched one.
    const hits = []
    for (const [c, fullBody] of walkCards()) {
      // The scoped half, computed and dropped in the same iteration as the body it came
      // from — the streaming property this loop's comment above is about.
      const body = bodySlice(fullBody)
      // `null` = this card has no design body, so under `--design-body` it contributes
      // NOTHING — not even a title hit. Scoring its title here would put a card carrying
      // no design at all into the answer to a question about design.
      if (body === null) continue
      let score = 0
      if (rx.test(c.id)) score += 10
      if (rx.test(c.title)) score += 5
      if (rx.test(c.labels)) score += 3
      const bodyHits = (body.match(new RegExp(cmd, 'gi')) ?? []).length
      score += Math.min(bodyHits, 3)
      if (score > 0) hits.push({ c, score, bodyHits })
    }
    reportVanished()
    // Sorted AFTER the walk, over the same sequence the walk produced, so ranking is
    // unchanged by the streaming — the comparator sees an identically-ordered input.
    hits.sort((a, b) => b.score - a.score || (a.c.zone === 'tasks' ? -1 : 1))
    if (hits.length === 0) {
      // EXIT 1, not 0. `show`/`need()` here already exit 1 on an unknown id, and the
      // shared core returns 1 for this identical answer (measured: `specgrep zzz` → 1,
      // `trddgrep zzz` → 0). Exiting 0 told any script keyed on the trichotomy that the
      // search had MATCHED, which is the collapse in the direction that lies to a caller.
      console.log(C.d(`\nno TRDD matches /${cmd}/i\n`))
      process.exit(1)
    }
    if (porcelain) {
      // Same TAB contract as `show`; the cap note goes to STDERR — stdout is the machine
      // surface, and a consumer must still learn the listing was capped.
      for (const h of hits.slice(0, 25)) {
        console.log([path.resolve(h.c.filePath), h.c.id, h.c.column, h.c.zone, h.c.title].join('\t'))
      }
      if (hits.length > 25) console.error(`… and ${hits.length - 25} more (narrow the pattern)`)
      break
    }
    console.log(C.b(`\n${hits.length} match(es) for /${cmd}/i\n`))
    for (const h of hits.slice(0, 25)) {
      const z = h.c.zone === 'tasks' ? C.g('open') : C.d(h.c.zone)
      console.log(`  ${fmt(h.c)} ${C.d(`[${z}${h.bodyHits ? `, ${h.bodyHits} in body` : ''}]`)}`)
    }
    if (hits.length > 25) console.log(C.d(`\n  … and ${hits.length - 25} more`))
    console.log()
  }
}
