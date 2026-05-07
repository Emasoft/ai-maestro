/**
 * Element-inventory ledger — append-only history of which elements
 * (memory files, skills, agents, MCP server tool descriptors, hooks,
 * etc.) were installed for an agent at any given point in time.
 *
 * Why this exists: the JSONL Session Browser wants to show "what was
 * loaded into the context window at THIS message in the transcript".
 * Today we re-tokenize the on-disk filesystem, which only reflects the
 * *current* state. If the user has since edited a CLAUDE.md, toggled a
 * plugin, or reinstalled a skill, the displayed numbers no longer
 * match what Claude actually saw at the time. Phase C of the 14-bug
 * review (items 13-14) closes this gap: a SessionStart / reload-plugins
 * hook in ai-maestro-plugin POSTs an inventory snapshot here. Reading
 * the latest snapshot at-or-before the session line's timestamp gives
 * us the historical truth.
 *
 * Storage shape: append-only JSONL at
 *   `~/.aimaestro/element-inventory/<agentId>.jsonl`
 * — one record per `{trigger}` event. Records are NEVER overwritten;
 * the file grows over time and is the audit trail. Even if the user
 * uninstalls a plugin we still keep its historical sizes available
 * for past sessions.
 *
 * CozoDB note: the existing CozoDB infrastructure is being retired
 * per TRDD-70a521d9 (Claude Code's built-in memory replaced the RAG
 * subsystem). Adding a new cozo table just for this would re-litigate
 * that retirement, so we use a flat append-only JSONL file instead.
 * Lookup cost is O(N) but N is small (one record per session start /
 * reload-plugins per agent — typically <100/day even on heavy use).
 */

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type InventoryTrigger = 'session_start' | 'reload_plugins' | 'manual'

export interface LedgerElement {
  /** Display name (typically `pluginName:elementName`). */
  name: string
  /** Token cost at the time of recording. */
  tokens: number
  /** Where the element lives. */
  scope: 'user' | 'project' | 'plugin' | 'builtin'
  /** Free-form path or identifier — must NOT contain secrets. */
  detail?: string
  /** Bucket the element belongs to in the breakdown. */
  bucket: 'memory' | 'skills' | 'customAgents' | 'mcpTools' | 'systemTools' | 'hooks' | 'commands' | 'output_styles' | 'lsp' | 'rules'
}

export interface InventorySnapshot {
  /** ISO 8601 timestamp when the inventory was captured. */
  ts: string
  /** Which event produced the snapshot. */
  trigger: InventoryTrigger
  /** The agent the inventory belongs to (for the file path). */
  agentId: string
  /** Every element loaded into context at this point in time. */
  elements: LedgerElement[]
}

const LEDGER_DIR_NAME = 'element-inventory'

function ledgerDir(): string {
  return path.join(homedir(), '.aimaestro', LEDGER_DIR_NAME)
}

function ledgerFile(agentId: string): string {
  // Sanitize the agent id so it can't escape the ledger dir.
  const safe = agentId.replace(/[^a-zA-Z0-9_.@-]/g, '_')
  return path.join(ledgerDir(), `${safe}.jsonl`)
}

/**
 * Append a snapshot to the agent's ledger. Creates the parent
 * directory if needed. Atomic via fs.appendFile (single write).
 */
export async function appendInventorySnapshot(
  snapshot: Omit<InventorySnapshot, 'ts'> & { ts?: string },
): Promise<void> {
  const ts = snapshot.ts ?? new Date().toISOString()
  const fullSnapshot: InventorySnapshot = {
    ts,
    trigger: snapshot.trigger,
    agentId: snapshot.agentId,
    elements: snapshot.elements,
  }
  await fs.mkdir(ledgerDir(), { recursive: true })
  const line = JSON.stringify(fullSnapshot) + '\n'
  await fs.appendFile(ledgerFile(snapshot.agentId), line, 'utf8')
}

/**
 * Read the latest snapshot for `agentId` whose `ts` is <= `cutoffTs`.
 * Returns null when the agent has no ledger or no snapshot in scope.
 *
 * The lookup is O(N) over the file — for N ~ a few hundred records
 * this is well under 5 ms. We don't bother indexing.
 */
export async function getLatestInventoryAtOrBefore(
  agentId: string,
  cutoffTs: string,
): Promise<InventorySnapshot | null> {
  let raw: string
  try {
    raw = await fs.readFile(ledgerFile(agentId), 'utf8')
  } catch {
    return null
  }
  const lines = raw.split('\n')
  let best: InventorySnapshot | null = null
  for (const line of lines) {
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // Skip corrupted lines silently — append-only files can carry
      // partial writes from kill mid-write; the rest of the file is
      // still usable.
      continue
    }
    if (!isInventorySnapshot(parsed)) continue
    if (parsed.ts > cutoffTs) continue
    if (best === null || parsed.ts > best.ts) {
      best = parsed
    }
  }
  return best
}

/**
 * List every ledger file currently on disk. Used by debugging /
 * housekeeping.
 */
export async function listLedgerAgents(): Promise<string[]> {
  try {
    const entries = await fs.readdir(ledgerDir())
    return entries
      .filter(e => e.endsWith('.jsonl'))
      .map(e => e.slice(0, -'.jsonl'.length))
  } catch {
    return []
  }
}

function isInventorySnapshot(v: unknown): v is InventorySnapshot {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.ts !== 'string') return false
  if (typeof o.trigger !== 'string') return false
  if (typeof o.agentId !== 'string') return false
  if (!Array.isArray(o.elements)) return false
  return true
}
