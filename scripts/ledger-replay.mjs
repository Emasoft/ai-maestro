#!/usr/bin/env node
/**
 * Ledger replay tool (#233, 2026-04-20).
 *
 * Phase 0.A-derived. Reconstructs per-agent / per-team state history by
 * walking the signed ledger in seq order and applying each entry's
 * JSON Patch ops to an empty document. Read-only by default — the tool
 * PRINTS the reconstructed state and the op timeline but NEVER writes to
 * registry.json. The tool is intentionally simple: it's a debugging +
 * forensic aid, not an automatic restore path.
 *
 * Supports the full op taxonomy shipped by TRDD-eac02238 step 6 + 7:
 *   create_agent, delete_agent, change_title, change_plugin,
 *   change_client, change_team, change_name, change_folder,
 *   change_avatar, change_cli_args, change_model, hibernate_role_missing,
 *   hibernate_role_missing_at_boot, change_{skill,agent_def,command,
 *   rule,output_style,mcp,lsp,hook}, …
 *
 * JSON Patch types handled: add, replace, remove. `move`/`copy`/`test`
 * are rejected (none of the Change* pipelines emit them today).
 *
 * Usage:
 *   node scripts/ledger-replay.mjs
 *     → summary of all 4 ledgers
 *   node scripts/ledger-replay.mjs --registry agents --agent <uuid>
 *     → chronological timeline for one agent
 *   node scripts/ledger-replay.mjs --registry agents --state <uuid>
 *     → reconstructed final state for one agent (post-replay)
 *   node scripts/ledger-replay.mjs --registry agents --verify
 *     → verify the hash chain (same as /api/system/ledger-health but CLI)
 *
 * NEVER USE for automatic restore without the operator reviewing every
 * diff. The signed ledger IS authoritative for what-was-written, but the
 * current registry.json may have legitimate divergence (e.g. mutations
 * that happened outside the element-management-service pipeline).
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import crypto from 'crypto'

const HOME = homedir()
const AIMAESTRO_DIR = join(HOME, '.aimaestro')

const REGISTRIES = {
  agents: join(AIMAESTRO_DIR, 'agents', 'registry.json'),
  teams: join(AIMAESTRO_DIR, 'teams', 'teams.json'),
  groups: join(AIMAESTRO_DIR, 'teams', 'groups.json'),
  governance: join(AIMAESTRO_DIR, 'governance.json'),
}

const args = process.argv.slice(2)
const hasFlag = (flag) => args.includes(flag)
const getFlag = (flag) => {
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : null
}

const registryName = getFlag('--registry')
const agentFilter = getFlag('--agent')
const stateFor = getFlag('--state')
const verifyOnly = hasFlag('--verify')

function readLedger(registryPath) {
  const ledgerPath = `${registryPath}.ledger.jsonl`
  if (!existsSync(ledgerPath)) return { entries: [], path: ledgerPath, exists: false }
  const raw = readFileSync(ledgerPath, 'utf-8')
  const entries = raw.split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line) } catch (err) {
      console.error(`[ledger-replay] Bad line ${i + 1} in ${ledgerPath}: ${err.message}`)
      return null
    }
  }).filter(Boolean)
  return { entries, path: ledgerPath, exists: true }
}

function applyPatch(doc, diff) {
  if (!Array.isArray(diff)) return doc
  let out = JSON.parse(JSON.stringify(doc))
  for (const op of diff) {
    if (!op.path) continue
    const segs = op.path.split('/').filter(Boolean)
    if (op.op === 'add' || op.op === 'replace') {
      setAt(out, segs, op.value)
    } else if (op.op === 'remove') {
      removeAt(out, segs)
    }
  }
  return out
}

function setAt(root, segs, value) {
  let cur = root
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = decodeURIComponent(segs[i])
    if (cur[seg] === undefined || cur[seg] === null) cur[seg] = {}
    cur = cur[seg]
  }
  cur[decodeURIComponent(segs[segs.length - 1])] = value
}

function removeAt(root, segs) {
  let cur = root
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = decodeURIComponent(segs[i])
    if (cur[seg] === undefined) return
    cur = cur[seg]
  }
  delete cur[decodeURIComponent(segs[segs.length - 1])]
}

function verifyChain(entries) {
  let prevHash = ''
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.seq !== i) return { ok: false, at: i, reason: `seq mismatch: expected ${i}, got ${e.seq}` }
    if (e.prevHash !== prevHash) return { ok: false, at: i, reason: `prevHash mismatch at seq ${i}` }
    // Compute this entry's hash
    const base = [e.seq, e.ts, e.prevHash, e.op, e.path, e.diff, e.signerHostId, e.signerKeyFingerprint]
    const hasAuth = e.authAction !== undefined || e.authAgentId !== undefined || e.authActor !== undefined
    if (hasAuth) base.push(e.authAction ?? null, e.authAgentId ?? null, e.authActor ?? null)
    prevHash = crypto.createHash('blake2b512').update(JSON.stringify(base)).digest('hex').slice(0, 64)
  }
  return { ok: true, count: entries.length }
}

function summarize(name, ledger) {
  if (!ledger.exists) {
    console.log(`  [${name.padEnd(12)}] no ledger file`)
    return
  }
  const ops = {}
  for (const e of ledger.entries) ops[e.op] = (ops[e.op] ?? 0) + 1
  const topOps = Object.entries(ops).sort((a, b) => b[1] - a[1]).slice(0, 5)
  console.log(`  [${name.padEnd(12)}] entries=${ledger.entries.length.toString().padStart(5)}  top ops: ${topOps.map(([k, v]) => `${k}=${v}`).join(', ')}`)
}

function agentTimeline(entries, agentId) {
  return entries
    .filter(e => typeof e.path === 'string' && e.path.includes(`/agents/${agentId}`))
    .map(e => ({ seq: e.seq, ts: e.ts, op: e.op, path: e.path, diff: e.diff, authActor: e.authActor, authAgentId: e.authAgentId }))
}

function reconstructAgentState(entries, agentId) {
  let state = {}
  for (const e of entries) {
    if (typeof e.path !== 'string' || !e.path.includes(`/agents/${agentId}`)) continue
    state = applyPatch(state, e.diff)
  }
  return state
}

// ── Main ──────────────────────────────────────────────────────

if (!registryName) {
  // Summary of all 4 ledgers
  console.log('═══════════════════════════════════════════════════════')
  console.log(' Signed ledger summary (TRDD-eac02238 replay tool)')
  console.log('═══════════════════════════════════════════════════════')
  for (const [name, path] of Object.entries(REGISTRIES)) {
    const ledger = readLedger(path)
    summarize(name, ledger)
  }
  console.log('───────────────────────────────────────────────────────')
  console.log('Commands:')
  console.log('  --registry <agents|teams|groups|governance> --agent <id>')
  console.log('      Chronological op timeline for one agent.')
  console.log('  --registry <name> --state <id>')
  console.log('      Reconstructed final state via JSON Patch replay.')
  console.log('  --registry <name> --verify')
  console.log('      Verify hash chain (returns 0 on OK, 1 on tamper).')
  console.log('═══════════════════════════════════════════════════════')
  process.exit(0)
}

const registryPath = REGISTRIES[registryName]
if (!registryPath) {
  console.error(`Unknown registry "${registryName}". Valid: ${Object.keys(REGISTRIES).join(', ')}`)
  process.exit(2)
}
const ledger = readLedger(registryPath)
if (!ledger.exists) {
  console.error(`No ledger file found at ${ledger.path}`)
  process.exit(3)
}

if (verifyOnly) {
  const r = verifyChain(ledger.entries)
  if (r.ok) {
    console.log(`[${registryName}] hash chain verified (${r.count} entries)`)
    process.exit(0)
  } else {
    console.error(`[${registryName}] TAMPER at seq ${r.at}: ${r.reason}`)
    process.exit(1)
  }
}

if (agentFilter) {
  const timeline = agentTimeline(ledger.entries, agentFilter)
  console.log('═══════════════════════════════════════════════════════')
  console.log(` Timeline for agent ${agentFilter} in ${registryName} ledger`)
  console.log('═══════════════════════════════════════════════════════')
  if (timeline.length === 0) {
    console.log('(no ledger entries for this agent — either the ID is wrong or the agent predates TRDD-eac02238)')
    process.exit(0)
  }
  for (const t of timeline) {
    const actor = t.authActor ? `${t.authActor}${t.authAgentId ? `:${t.authAgentId.slice(0, 8)}` : ''}` : 'unknown'
    console.log(`seq=${String(t.seq).padStart(4)}  ${t.ts}  op=${t.op.padEnd(28)}  actor=${actor.padEnd(20)}  path=${t.path}`)
    if (Array.isArray(t.diff)) {
      for (const d of t.diff) {
        const v = d.value !== undefined ? ` = ${JSON.stringify(d.value)}` : ''
        console.log(`        └─ ${d.op} ${d.path}${v}`)
      }
    }
  }
  console.log(`───────────────────────────────────────────────────────`)
  console.log(`Total entries for this agent: ${timeline.length}`)
  process.exit(0)
}

if (stateFor) {
  const state = reconstructAgentState(ledger.entries, stateFor)
  console.log('═══════════════════════════════════════════════════════')
  console.log(` Reconstructed state for agent ${stateFor} (via replay)`)
  console.log('═══════════════════════════════════════════════════════')
  console.log(JSON.stringify(state, null, 2))
  console.log('───────────────────────────────────────────────────────')
  console.log('⚠  This is the state IMPLIED by the ledger. Compare with')
  console.log('   the live registry.json before using it for restore.')
  process.exit(0)
}

console.error('No action specified. Use --agent, --state, or --verify.')
process.exit(2)
