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

const { TRDD_ZONES, listTrddFiles, parseTrddFile } = await import('../lib/trdd-store.ts')
const { TERMINAL_DONE, normalizeTrddRef } = await import('../lib/trdd-graph.ts')
const { readyQueue } = await import('../lib/trdd-doctor.ts')

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
}

const designDir = path.join(process.cwd(), 'design')
const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'board'
const arg = argv[1]

// ---- load once, through the ONE owner ----
const cards = []
for (const zone of TRDD_ZONES) {
  for (const file of listTrddFiles(designDir, zone)) {
    const t = parseTrddFile(file, zone)
    if (!t) continue
    cards.push({
      id: normalizeTrddRef(t.id),
      zone,
      filePath: file,
      column: String(t.column ?? '').trim() || '(none)',
      title: String(t.title ?? '').trim(),
      fm: t.frontmatter ?? {},
      body: t.body ?? '',
    })
  }
}
const byId = new Map(cards.map((c) => [c.id, c]))
const done = (id) => {
  const c = byId.get(id)
  return !c || TERMINAL_DONE.has?.(c.column) || [...TERMINAL_DONE].includes(c.column)
}
const list = (v) => (Array.isArray(v) ? v.map((x) => normalizeTrddRef(x)).filter(Boolean) : [])
/** The edges that impose ORDER: this card cannot proceed until those do. */
const blockers = (c) => [...list(c.fm['blocked-by']), ...list(c.fm['npt'])].filter((k) => byId.has(k))
const openBlockers = (c) => blockers(c).filter((k) => !done(k))

const fmt = (c) =>
  `${C.b(c.id)} ${C.d(`P${c.fm.priority ?? '?'}`)} ${String(c.column).padEnd(13)} ${String(c.title).slice(0, 62)}`

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
    // The STATE block is AUTHORITATIVE on resume — it supersedes the body, so it is the
    // only part worth printing by default.
    const state = c.body.match(/##\s*⏵?\s*STATE[^\n]*\n([\s\S]*?)(?=\n## |\n$)/i)
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
      for (const c of cs.sort((a, b) => String(a.fm.priority ?? 9).localeCompare(String(b.fm.priority ?? 9)))) {
        const blk = openBlockers(c).length
        console.log(`  ${fmt(c)}${blk ? '  ' + C.r(`⛔${blk}`) : ''}`)
      }
      console.log()
    }
    break
  }

  case 'help':
  case '--help':
  case '-h':
    console.log(`
${C.b('greptrdd')} — query the TRDD corpus (offline; no server)

  ${C.c('greptrdd')}                  the board
  ${C.c('greptrdd next')}             what is workable RIGHT NOW, ranked by what it frees
  ${C.c('greptrdd why <id>')}         the transitive blocker chain, down to the ROOT CAUSE
  ${C.c('greptrdd unblocks <id>')}    what finishing this would free
  ${C.c('greptrdd roots')}            every root blocker — the critical path of the board
  ${C.c('greptrdd show <id>')}        the card + its STATE block
  ${C.c('greptrdd <pattern>')}        ranked search over title, labels, id, body

Health (lint / repair) lives in the sibling tool: ${C.c('yarn trdd:doctor')}
`)
    break

  default: {
    // Ranked search. Title and labels outrank the body: a word in the title is what the
    // card IS; a word in the body may be an aside.
    const rx = new RegExp(cmd, 'i')
    const hits = cards
      .map((c) => {
        let score = 0
        if (rx.test(c.id)) score += 10
        if (rx.test(c.title)) score += 5
        if (rx.test(String(c.fm.labels ?? ''))) score += 3
        const bodyHits = (c.body.match(new RegExp(cmd, 'gi')) ?? []).length
        score += Math.min(bodyHits, 3)
        return { c, score, bodyHits }
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || (a.c.zone === 'tasks' ? -1 : 1))
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
