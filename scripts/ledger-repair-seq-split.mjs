#!/usr/bin/env node
/**
 * Repair a ledger whose seq counter RESTARTED mid-file — losslessly.
 *
 * THE DEFECT (TRDD: the 49e007f3 fix). `SignedLedger.append()` used to derive
 * the next seq from `this.entries.length`. `rotateLedger()` truncates that
 * array to a tail, so the FIRST append after a rotation restarted the counter.
 * The live file then holds two runs: a correctly-numbered prefix and a
 * restarted tail — with the two ranges OVERLAPPING, so seq values are
 * duplicated inside one file. `verify()` reports the first discontinuity as a
 * "Sequence gap" and the server enters READ-ONLY mode.
 *
 * WHY A SPLIT AND NOT A RENUMBER. `seq` is the FIRST element of the
 * canonicalized payload (`canonicalize()` in lib/signed-ledger.ts), so it is
 * inside both the entry hash and the Ed25519 signature. Renumbering therefore
 * forces re-signing every moved entry — replacing signatures made at the time
 * of the event with signatures made today. For a tamper-evident audit chain
 * that is the worst thing you can do to it.
 *
 * A split needs neither. `verify()` deliberately ANCHORS on `entries[0]` —
 * taking its seq and prevHash as the expected starting point — precisely so a
 * ROTATED file verifies, where the first kept entry legitimately has a
 * non-zero seq and a prevHash pointing at an entry that now lives in an
 * archive. So if we archive the prefix and keep the tail, the tail anchors on
 * itself and +1 continuity holds for the rest. Not one byte of any entry
 * changes; not one signature is re-made.
 *
 * This is not a novel surgery: it is byte-for-byte the same operation
 * `rotateLedger()` performs on every rotation (same `{version, entries}`
 * shape, same `.ledger.<ms>.archive.json` name, same 0600 tmp+rename), just
 * cut at the discontinuity instead of at a count boundary.
 *
 * WHAT IT COSTS. seq stays non-unique ACROSS files: the archived prefix holds
 * 5001..10000 while the live tail will keep counting 5703, 5704, … So the
 * archive and the future live file will both contain those numbers. That is
 * already true today (it is the bug), a split does not make it worse, and
 * nothing in verify() depends on cross-file uniqueness — but `ledger-replay`
 * walks "in seq order", so a cross-file replay must be read per-file.
 *
 * SAFETY POSTURE — fail-closed, and never destructive:
 *   - DRY-RUN BY DEFAULT. Writes nothing without --apply.
 *   - REFUSES unless the damage matches this exact signature (one
 *     discontinuity, a contiguous tail, no duplicate prevHash). Any other
 *     shape is a different problem and must not be "repaired" by this tool.
 *   - Backs the whole live file up byte-identical BEFORE touching anything.
 *   - Deletes nothing. The repair is reversible: concatenating the archive's
 *     entries with the new live file's entries reproduces the current file
 *     exactly, and the tool prints the command to do it.
 *
 * Usage:
 *   node scripts/ledger-repair-seq-split.mjs                     # inspect (default)
 *   node scripts/ledger-repair-seq-split.mjs --registry agents   # pick a ledger
 *   node scripts/ledger-repair-seq-split.mjs --apply             # perform it
 *
 * Restart the server after --apply; startup re-verifies and clears read-only.
 */

import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const AIMAESTRO_DIR = join(homedir(), '.aimaestro')

const REGISTRIES = {
  agents: join(AIMAESTRO_DIR, 'agents', 'registry.json'),
  teams: join(AIMAESTRO_DIR, 'teams', 'teams.json'),
  groups: join(AIMAESTRO_DIR, 'teams', 'groups.json'),
  governance: join(AIMAESTRO_DIR, 'governance.json'),
}

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }

const registryName = val('--registry') || 'agents'
const apply = has('--apply')

if (!REGISTRIES[registryName]) {
  console.error(`error: unknown registry '${registryName}'. One of: ${Object.keys(REGISTRIES).join(', ')}`)
  process.exit(2)
}

const ledgerPath = REGISTRIES[registryName].replace(/\.json$/, '.ledger.json')
if (!existsSync(ledgerPath)) {
  console.error(`error: no ledger at ${ledgerPath}`)
  process.exit(2)
}

const raw = readFileSync(ledgerPath, 'utf8')
let file
try {
  file = JSON.parse(raw)
} catch (err) {
  console.error(`error: ${ledgerPath} is not valid JSON — this tool cannot help. ${err.message}`)
  process.exit(2)
}
const entries = file.entries
if (!Array.isArray(entries) || entries.length === 0) {
  console.error('error: ledger has no entries array')
  process.exit(2)
}

console.log(`ledger : ${ledgerPath}`)
console.log(`entries: ${entries.length}  (seq ${entries[0].seq} … ${entries[entries.length - 1].seq})`)

// ---- Diagnose. Every check below must pass or the tool refuses. -------------
const problems = []

const breaks = []
for (let i = 1; i < entries.length; i++) {
  if (entries[i].seq !== entries[i - 1].seq + 1) breaks.push(i)
}

if (breaks.length === 0) {
  console.log('\nNo seq discontinuity — this ledger does not have the defect this tool repairs.')
  console.log('If the server is still read-only, the cause is something else (hash chain, signature,')
  console.log('or a different ledger). Check the [TAMPER] line in the server log.')
  process.exit(0)
}

if (breaks.length > 1) {
  problems.push(`${breaks.length} seq discontinuities (at indices ${breaks.slice(0, 5).join(', ')}${breaks.length > 5 ? ', …' : ''}). ` +
    'This tool only repairs the single-restart shape a rotation bug produces.')
}

const cut = breaks[0]

// The tail must be internally contiguous — otherwise splitting here does not
// yield a verifiable file and we would have moved the problem, not fixed it.
for (let i = cut + 1; i < entries.length; i++) {
  if (entries[i].seq !== entries[i - 1].seq + 1) {
    problems.push(`tail is not contiguous: index ${i} breaks it. A split at ${cut} would not verify.`)
    break
  }
}

// The prefix must be contiguous too, so the archive is itself a valid chain.
for (let i = 1; i < cut; i++) {
  if (entries[i].seq !== entries[i - 1].seq + 1) {
    problems.push(`prefix is not contiguous: index ${i} breaks it.`)
    break
  }
}

// A repeated prevHash means the hash chain itself is damaged — a signature or
// content problem, not a numbering one. Refuse: this tool re-signs nothing and
// therefore cannot fix that.
for (let i = 1; i < entries.length; i++) {
  if (entries[i].prevHash === entries[i - 1].prevHash) {
    problems.push(`duplicate prevHash at index ${i} — the hash chain is damaged, not just the numbering.`)
    break
  }
}

console.log(`\ndiscontinuity: index ${cut}  seq ${entries[cut - 1].seq} -> ${entries[cut].seq}`)
console.log(`  prefix idx 0..${cut - 1}      seq ${entries[0].seq}..${entries[cut - 1].seq}   (${cut} entries)`)
console.log(`  tail   idx ${cut}..${entries.length - 1}  seq ${entries[cut].seq}..${entries[entries.length - 1].seq}   (${entries.length - cut} entries)`)

const seen = new Map()
for (const e of entries) seen.set(e.seq, (seen.get(e.seq) || 0) + 1)
const dupCount = [...seen.values()].filter(n => n > 1).length
if (dupCount) console.log(`  ${dupCount} seq values appear TWICE in this one file (the two runs overlap)`)

if (problems.length) {
  console.error('\nREFUSING — the damage does not match the shape this tool repairs:')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nNothing was written. Investigate before repairing; a wrong repair to a')
  console.error('tamper-evident chain is worse than a read-only server.')
  process.exit(1)
}

// ---- Plan -------------------------------------------------------------------
const stamp = Date.now()
const archivePath = ledgerPath.replace('.ledger.json', `.ledger.${stamp}.archive.json`)
const backupPath = `${ledgerPath}.pre-repair.${stamp}.bak`

console.log('\nPLAN (the same split rotateLedger() performs, cut at the discontinuity):')
console.log(`  1. copy the live file verbatim -> ${backupPath}`)
console.log(`  2. write entries 0..${cut - 1} -> ${archivePath}`)
console.log(`  3. rewrite the live file with entries ${cut}..${entries.length - 1}`)
console.log('  No entry is modified. No signature is re-made. Nothing is deleted.')
console.log(`  After: the live file anchors on seq ${entries[cut].seq} and verifies.`)

if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to perform it.')
  process.exit(0)
}

// ---- Apply ------------------------------------------------------------------
copyFileSync(ledgerPath, backupPath)
console.log(`\nbacked up  -> ${backupPath}`)

const writeAtomic = (path, data) => {
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
  renameSync(tmp, path)
}

writeAtomic(archivePath, { version: file.version ?? 1, entries: entries.slice(0, cut) })
console.log(`archived   -> ${archivePath}  (${cut} entries)`)

writeAtomic(ledgerPath, { ...file, entries: entries.slice(cut) })
console.log(`live file  -> ${ledgerPath}  (${entries.length - cut} entries)`)

// Re-read from disk and re-run the same continuity checks. Trusting the
// in-memory slice would prove nothing about what actually landed.
const after = JSON.parse(readFileSync(ledgerPath, 'utf8')).entries
let ok = after.length === entries.length - cut
for (let i = 1; ok && i < after.length; i++) if (after[i].seq !== after[i - 1].seq + 1) ok = false
console.log(`\nre-read    -> ${after.length} entries, seq ${after[0].seq}..${after[after.length - 1].seq}, contiguous: ${ok ? 'YES' : 'NO'}`)

if (!ok) {
  console.error('\nPOST-CHECK FAILED. Restore with:')
  console.error(`  cp ${backupPath} ${ledgerPath}`)
  process.exit(1)
}

console.log('\nDone. Restart the server; startup re-verifies and clears read-only mode.')
console.log('To undo (restores the exact bytes that were there before):')
console.log(`  cp ${backupPath} ${ledgerPath}`)
