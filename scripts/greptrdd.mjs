#!/usr/bin/env node
/**
 * greptrdd — the offline query surface over the TRDD corpus.
 *
 * The memgrep of the task board. memgrep answers "have we hit this before?" from a
 * SYMPTOM; greptrdd answers "what is the state of this work, and what is holding it
 * up?" from an id, a word, or nothing at all.
 *
 * WHY IT EXISTS, given three TRDD tools already do:
 *   lib/trdd-store.ts   — the ONE owner of "what is a TRDD" (parse, list, search)
 *   lib/trdd-graph.ts   — the ONE owner of the edges + invariants (cycle, gates)
 *   scripts/trdd-doctor — HEALTH: lint the corpus, repair what is derivable
 *   greptrdd            — QUERY: read the corpus. This file. It COMPOSES the two
 *                         libraries above and OWNS NOTHING. Adding a fourth parser or
 *                         a second cycle detector would create a second truth — which
 *                         is exactly the bug the doctor was built to catch, and which
 *                         the doctor itself committed by not looking first.
 *
 * It needs NO SERVER. `aimaestro-trdd.sh` goes through the HTTP API (and 403s an agent
 * on the write verbs); greptrdd reads the files, so it works in a cold repo, in CI, and
 * in an agent's tmux pane at 3am when the dashboard is down.
 *
 * THE CENTRAL QUERY IS `why`. Timing is noise — how long a card has waited says nothing.
 * ORDER is everything: a card is workable, or it is waiting on something, and that
 * something is waiting on something. `why` walks that chain to its ROOT — the thing
 * that, if it moved, would move everything behind it. A column list cannot show you
 * that, and neither can an age.
 *
 *   greptrdd                     the board
 *   greptrdd next                what is workable RIGHT NOW, ranked by what it frees
 *   greptrdd why <id>            the transitive blocker chain, down to the root cause
 *   greptrdd unblocks <id>       what finishing this would free
 *   greptrdd roots               every root cause on the board — the whole critical path
 *   greptrdd show <id>           the card + its STATE block (authoritative on resume)
 *   greptrdd <pattern>           ranked search over title, labels, id and body
 */
import path from 'path'
import process from 'process'

const { TRDD_ZONES, listTrddFiles, parseTrddFile, assertDesignDir } =
  await import('../lib/trdd-store.ts')
const { TERMINAL_DONE, normalizeTrddRef, refList } = await import('../lib/trdd-graph.ts')
const { readyQueue } = await import('../lib/trdd-doctor.ts')

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
  console.error(`greptrdd: could not run — ${err?.message ?? err}`)
  if (process.env.TRDD_DEBUG) console.error(err?.stack ?? '')
  process.exit(2)
})

// `--design-dir` is stripped before `cmd`/`arg` are read, so the flag may sit
// anywhere in the line without shifting the positional arguments.
const rawArgv = process.argv.slice(2)
const ddIdx = rawArgv.indexOf('--design-dir')
const designDir = path.resolve(
  ddIdx >= 0 ? (rawArgv[ddIdx + 1] ?? '') : path.join(process.cwd(), 'design'),
)
const argv = ddIdx >= 0 ? [...rawArgv.slice(0, ddIdx), ...rawArgv.slice(ddIdx + 2)] : rawArgv
const cmd = argv[0] ?? 'board'
const arg = argv[1]

assertDesignDir(designDir)

// ---- the corpus walk, through the ONE owner ----
//
// LAZY and BODY-FREE. Two separate wins, and the second is the one that scales:
//
//  · LAZY — this ran at top level, before the switch, so `greptrdd help` walked
//    all four zones to print a usage string, and `greptrdd next` walked them to
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
  const p = fm.priority
  return {
    // A STRING or null, never a number. `P${0}` and `P${'0'}` print identically and
    // `String(x ?? 9)` sorts identically, so this is byte-identical to reading `fm`
    // directly — and it is exactly what the index's TEXT column round-trips to.
    priority: p === undefined || p === null ? null : String(p),
    // The refs that impose ORDER, through the graph's OWN helper. greptrdd carried a
    // private `list()` that accepted ONLY arrays, so a scalar `npt: TRDD-X` was a
    // reference to `lib/trdd-graph.ts` and to the pillar index but NOT to this file —
    // the same "two consumers of one store, divergent on identical input" bug Phase 1
    // fixed one layer down. This tool owns nothing; `refList` is the one definition.
    blockerRefs: [...refList(fm['blocked-by']), ...refList(fm['npt'])],
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
  console.error(`greptrdd: ${vanished.length} file(s) vanished mid-scan and were skipped:`)
  for (const f of vanished.slice(0, 5)) console.error(`  · ${path.relative(process.cwd(), f)}`)
  if (vanished.length > 5) console.error(`  … and ${vanished.length - 5} more`)
}

const cards = []
let byId = new Map()

/**
 * Fill the graph — every card, no prose.
 *
 * The loop is load-bearing and must NOT be written as `[...walkCards()]`: spreading
 * the generator materializes every [card, body] pair at once, which is exactly the
 * array this change exists to delete. Destructuring one pair per iteration is what
 * lets each body die with the iteration that produced it.
 */
function loadGraph() {
  for (const [c] of walkCards()) cards.push(c)
  byId = new Map(cards.map((c) => [c.id, c]))
  reportVanished()
}
const done = (id) => {
  const c = byId.get(id)
  return !c || TERMINAL_DONE.has?.(c.column) || [...TERMINAL_DONE].includes(c.column)
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
    return
  }
  console.log(`${pad}${C.d('└─ blocked by')}`)
  for (const k of open) printChain(byId.get(k), depth + 1, new Set(seen))
}

// Which subcommands need the graph — and, just as deliberately, which do not.
// `next`, `lint` and `validate` each load their own corpus through
// `lib/trdd-doctor.ts`; `help` reads nothing. The default branch (search) is
// absent on purpose too: it streams its OWN walk, because it is the one command
// that must see every body and must therefore keep none of them.
if (['why', 'unblocks', 'roots', 'show', 'board'].includes(cmd)) loadGraph()

switch (cmd) {
  case 'why': {
    const c = need(arg)
    console.log(`\n${fmt(c)}\n`)
    const open = openBlockers(c)
    if (open.length === 0) {
      console.log(C.g('  READY — every prerequisite is satisfied. Nothing is holding it up.\n'))
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
    for (const r of roots) {
      const human = r.column === 'human_review' || r.column === 'proposal' || r.zone === 'proposals'
      console.log(`  ${fmt(r)}`)
      console.log(`      ${C.g(`holds up ${blocks.get(r.id)}`)}${human ? '  ' + C.y('⇒ needs a HUMAN decision') : ''}`)
    }
    console.log()
    break
  }

  case 'next': {
    const q = readyQueue(designDir)
    if (q.length === 0) {
      console.log(C.y('\nNOTHING IS READY — every open card waits on another. Check for a cycle: greptrdd roots\n'))
      break
    }
    console.log(C.b(`\nREADY — ${q.length} card(s), ranked by how much finishing them frees\n`))
    for (const r of q) {
      const lev = r.unblocks > 0 ? C.g(`unblocks ${r.unblocks}`) : C.d('unblocks 0')
      console.log(`  ${C.b(r.id.padEnd(9))} ${C.d(`P${r.priority ?? '?'}`)} ${String(r.column).padEnd(13)} ${lev.padEnd(22)} ${String(r.title).slice(0, 54)}`)
    }
    console.log()
    break
  }

  case 'show': {
    const c = need(arg)
    console.log(`\n${fmt(c)}`)
    console.log(C.d(`  ${path.relative(process.cwd(), c.filePath)}`))
    const ob = openBlockers(c)
    if (ob.length) console.log(`  ${C.r('blocked by')} ${ob.join(', ')}   ${C.d('(greptrdd why ' + c.id + ')')}`)
    // The body is read HERE, for this ONE card — the walk above kept none. Through
    // the same store, so the semantics are the walk's: null means the file was
    // `git mv`d between the walk and now (benign, and worth saying out loud), while
    // every other read fault throws instead of reading as "no STATE block".
    const fresh = parseTrddFile(c.filePath, c.zone)
    if (!fresh) {
      console.log(C.r('\n  the file moved mid-command (a concurrent git mv) — re-run\n'))
      break
    }
    // The STATE block is AUTHORITATIVE on resume — it supersedes the body, so it is the
    // only part worth printing by default.
    const state = fresh.body.match(/##\s*⏵?\s*STATE[^\n]*\n([\s\S]*?)(?=\n## |\n$)/i)
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
      if (!grouped.has(c.column)) grouped.set(c.column, [])
      grouped.get(c.column).push(c)
    }
    const n = [...grouped.values()].reduce((a, b) => a + b.length, 0)
    console.log(C.b(`\n${n} open cards (design/tasks)\n`))
    for (const [col, cs] of [...grouped].sort((a, b) => b[1].length - a[1].length)) {
      const head = col === '(none)' ? C.r('(NO COLUMN — INVISIBLE TO THE BOARD)') : C.b(col.toUpperCase())
      console.log(`═══ ${head} (${cs.length})`)
      for (const c of cs.sort((a, b) => String(a.priority ?? 9).localeCompare(String(b.priority ?? 9)))) {
        const blk = openBlockers(c).length
        console.log(`  ${fmt(c)}${blk ? '  ' + C.r(`⛔${blk}`) : ''}`)
      }
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
        `greptrdd: scanned 0 TRDDs under ${designDir} — refusing to certify a corpus it never read`,
      )
      process.exit(2)
    }
    const strict = argv.includes('--strict')

    if (cmd === 'validate') {
      // SEV ⇥ CODE ⇥ id ⇥ path ⇥ message. No colour: this is piped, not read.
      for (const f of report.findings) {
        console.log([f.severity.toUpperCase(), f.rule, f.id, path.relative(process.cwd(), f.filePath), f.message].join('\t'))
      }
      process.exit(report.errors > 0 || (strict && report.warnings > 0) ? 1 : 0)
    }

    if (report.findings.length === 0) {
      console.log(C.g(`✓ ${report.scanned} TRDDs — corpus is clean`))
      process.exit(0)
    }
    const byRule = new Map()
    for (const f of report.findings) {
      if (!byRule.has(f.rule)) byRule.set(f.rule, [])
      byRule.get(f.rule).push(f)
    }
    console.log(C.b(`\n${report.scanned} scanned · ${C.r(`${report.errors} error`)} · ${C.y(`${report.warnings} warn`)}\n`))
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
    process.exit(report.errors > 0 || (strict && report.warnings > 0) ? 1 : 0)
  }

  case 'help':
  case '--help':
  case '-h':
    console.log(`
${C.b('greptrdd')} — query AND validate the TRDD corpus (offline; no server)

  ${C.c('greptrdd')}                  the board
  ${C.c('greptrdd next')}             what is workable RIGHT NOW, ranked by what it frees
  ${C.c('greptrdd why <id>')}         the transitive blocker chain, down to the ROOT CAUSE
  ${C.c('greptrdd unblocks <id>')}    what finishing this would free
  ${C.c('greptrdd roots')}            every root blocker — the critical path of the board
  ${C.c('greptrdd show <id>')}        the card + its STATE block
  ${C.c('greptrdd <pattern>')}        ranked search over title, labels, id, body

  ${C.c('greptrdd lint')}             every finding, grouped by rule (errors first)
  ${C.c('greptrdd validate')}         the WRITE GATE — TAB rows: SEV⇥CODE⇥id⇥path⇥msg
  ${C.d('  … add --strict to either to fail on warnings too (exit 1)')}

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
    for (const [c, body] of walkCards()) {
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
      console.log(C.d(`\nno TRDD matches /${cmd}/i\n`))
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
