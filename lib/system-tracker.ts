/**
 * System-level config tracker (TRDD-7123d51a §9 follow-up, task #242).
 *
 * The per-agent subconscious tracker (TRDD-7123d51a §3.1) catches drift
 * inside each agent's workdir, but marketplaces + client-binary versions
 * live OUTSIDE any single agent's scope — they're user-global. Tracking
 * them per-agent would produce N copies of the same drift entry on every
 * marketplace update, and would never record "a brand-new version of
 * `claude` showed up on PATH".
 *
 * This module owns a single-instance 60s tracker that:
 *   - Reads `~/.claude/plugins/marketplaces/` and diffs the marketplace
 *     directory set + each `marketplace.json` against a baseline. Emits
 *     `add_marketplace` / `remove_marketplace` / `update_marketplace`.
 *   - Runs `<client> --version` for the 5 known clients (claude, codex,
 *     gemini, opencode, kiro) and emits `change_client_version` when a
 *     version string changes.
 *
 * DESIGN
 * ------
 * - One process-wide instance. `SystemTracker.start()` is called once
 *   from server.mjs startup; `stop()` from the shutdown hook.
 * - Ledger emits are fire-and-forget (same pattern as the per-agent
 *   tracker). Failure is logged but non-fatal.
 * - Cadence is 60s — looser than the per-agent 30s because system-level
 *   changes are rare (minutes-to-hours between events).
 * - First tick sets the baseline WITHOUT emitting, matching the
 *   per-agent tracker's §4.4 behaviour, so a clean server restart
 *   doesn't spam the ledger with `add_marketplace` for every existing
 *   marketplace.
 * - State is in-memory only. A restart resets the baseline; the next
 *   scan treats current state as the new ground truth. Any drift that
 *   happened during the downtime is invisible — acceptable trade-off
 *   for simplicity (the ledger entries that the UI DID emit during
 *   uptime are the authoritative record).
 *
 * WHY NOT subconscious-based
 * --------------------------
 * Putting system-level scans inside the subconscious would force the
 * 30+ agent subconscious instances to coordinate on "who scans the
 * system state this tick?" — either with N-way dedup (fragile) or with
 * N duplicate emits (wasteful). A single system-owned tracker is
 * cleaner.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { emitAgentOp } from '@/lib/ledger-emit'
import type { LedgerOp } from '@/types/ledger'

const execFileAsync = promisify(execFile)

export interface SystemTrackerConfig {
  /** Scan interval in ms. Default 60_000 (60s). 0 disables. */
  intervalMs?: number
  /**
   * Timeout for each `<client> --version` call in ms. Default 5_000.
   * A hung binary must not block the whole scan.
   */
  versionTimeoutMs?: number
}

/** Known AI clients we version-track. Order preserved for deterministic log output. */
const KNOWN_CLIENTS: ReadonlyArray<string> = ['claude', 'codex', 'gemini', 'opencode', 'kiro']

class SystemTrackerImpl {
  private intervalMs: number
  private versionTimeoutMs: number
  private timer: NodeJS.Timeout | null = null
  private isRunning = false
  private hasBaseline = false

  /** Most recent marketplace JSON content per marketplace directory name. */
  private marketplaceBaseline: Map<string, string> = new Map()
  /** Most recent `<client> --version` output per client. `null` = binary absent. */
  private clientVersionBaseline: Map<string, string | null> = new Map()
  /** For observability (UI follow-up). */
  private lastScanAt: number | null = null
  private scanCount = 0
  private driftCount = 0

  constructor(config: SystemTrackerConfig = {}) {
    this.intervalMs = config.intervalMs ?? 60_000
    this.versionTimeoutMs = config.versionTimeoutMs ?? 5_000
  }

  start(): void {
    if (this.intervalMs <= 0) {
      console.log('[SystemTracker] Disabled (intervalMs=0)')
      return
    }
    if (this.isRunning) return
    this.isRunning = true
    console.log(`[SystemTracker] Starting — cadence ${this.intervalMs / 1000}s`)
    // First scan 2s after start so server-startup log noise clears.
    setTimeout(() => {
      this.runScan().catch(err => console.error('[SystemTracker] Initial scan failed:', err))
    }, 2_000)
    this.timer = setInterval(() => {
      this.runScan().catch(err => console.error('[SystemTracker] Scan failed:', err))
    }, this.intervalMs)
    // Allow the Node event loop to exit cleanly in tests / shutdown.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.isRunning = false
  }

  /**
   * Observability hook — surfaced on the /api/system/ledger-health
   * endpoint in a future task (#243 sibling). Kept tiny; no map
   * contents, just counts, so a malicious filesystem can't bloat it.
   */
  getStatus(): {
    isRunning: boolean
    intervalMs: number
    lastScanAt: number | null
    scanCount: number
    driftCount: number
    trackedMarketplaces: number
    trackedClients: number
  } {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      lastScanAt: this.lastScanAt,
      scanCount: this.scanCount,
      driftCount: this.driftCount,
      trackedMarketplaces: this.marketplaceBaseline.size,
      trackedClients: this.clientVersionBaseline.size,
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private async runScan(): Promise<void> {
    this.lastScanAt = Date.now()
    this.scanCount++
    const current = await this.collectCurrentState()
    if (!this.hasBaseline) {
      this.marketplaceBaseline = current.marketplaces
      this.clientVersionBaseline = current.clientVersions
      this.hasBaseline = true
      return
    }
    this.diffMarketplaces(current.marketplaces)
    this.diffClientVersions(current.clientVersions)
    this.marketplaceBaseline = current.marketplaces
    this.clientVersionBaseline = current.clientVersions
  }

  private async collectCurrentState(): Promise<{
    marketplaces: Map<string, string>
    clientVersions: Map<string, string | null>
  }> {
    const marketplaces = this.readMarketplaces()
    const clientVersions = await this.readClientVersions()
    return { marketplaces, clientVersions }
  }

  private readMarketplaces(): Map<string, string> {
    const out = new Map<string, string>()
    const marketplacesDir = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces')
    if (!fs.existsSync(marketplacesDir)) return out
    let entries: string[]
    try {
      entries = fs.readdirSync(marketplacesDir)
    } catch {
      return out
    }
    for (const name of entries) {
      const marketplaceJson = path.join(marketplacesDir, name, 'marketplace.json')
      try {
        if (!fs.existsSync(marketplaceJson)) continue
        // Store the raw contents so diff sees BOTH structural changes
        // (plugin list edits) and metadata changes (versions, owners).
        out.set(name, fs.readFileSync(marketplaceJson, 'utf-8'))
      } catch {
        // Unreadable → skip. A future scan will catch it if it becomes readable.
      }
    }
    return out
  }

  private async readClientVersions(): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>()
    for (const client of KNOWN_CLIENTS) {
      try {
        const { stdout } = await execFileAsync(client, ['--version'], {
          timeout: this.versionTimeoutMs,
          maxBuffer: 64 * 1024,
        })
        // Normalize — some tools print multi-line banners; we only
        // compare the first line (the canonical version string).
        out.set(client, stdout.split('\n')[0].trim())
      } catch {
        // Binary missing, timed out, or exited non-zero → `null`.
        // Storing `null` lets diff detect "claude disappeared from PATH"
        // just as reliably as "claude updated to 1.2.3".
        out.set(client, null)
      }
    }
    return out
  }

  private diffMarketplaces(current: Map<string, string>): void {
    const baseline = this.marketplaceBaseline
    // Additions + updates
    for (const [name, json] of current) {
      const old = baseline.get(name)
      if (old === undefined) {
        this.emit('add_marketplace', `/system/marketplaces/${name}`, {
          op: 'add',
          path: `/system/marketplaces/${name}`,
          value: this.summarizeMarketplace(json),
        })
      } else if (old !== json) {
        this.emit('update_marketplace', `/system/marketplaces/${name}`, {
          op: 'replace',
          path: `/system/marketplaces/${name}`,
          value: this.summarizeMarketplace(json),
        })
      }
    }
    // Removals
    for (const [name] of baseline) {
      if (!current.has(name)) {
        this.emit('remove_marketplace', `/system/marketplaces/${name}`, {
          op: 'remove',
          path: `/system/marketplaces/${name}`,
        })
      }
    }
  }

  private diffClientVersions(current: Map<string, string | null>): void {
    const baseline = this.clientVersionBaseline
    for (const [client, version] of current) {
      const old = baseline.get(client)
      if (old === version) continue
      // Emit for genuine transitions only — both directions (installed,
      // uninstalled, upgraded) are interesting. Explicit null check so
      // undefined-vs-null false-negatives don't sneak through.
      if (old === undefined && version === null) {
        // First scan noticed the binary is absent — not a drift event.
        continue
      }
      this.emit('change_client_version', `/system/clientVersions/${client}`, {
        op: 'replace',
        path: `/system/clientVersions/${client}`,
        value: { client, old: old ?? null, new: version },
      })
    }
  }

  /**
   * Keep ledger entries compact. Marketplace JSON can be ~KB; the
   * `summarize` reduces it to `{plugins: [...], version?}` so the
   * signed hash stays cheap and replays run quickly.
   */
  private summarizeMarketplace(json: string): Record<string, unknown> {
    try {
      const parsed: { plugins?: Array<{ name?: string }>; version?: string; owner?: unknown } = JSON.parse(json)
      return {
        pluginCount: Array.isArray(parsed.plugins) ? parsed.plugins.length : 0,
        pluginNames: Array.isArray(parsed.plugins)
          ? parsed.plugins.map(p => p?.name).filter((n): n is string => typeof n === 'string').sort()
          : [],
        version: typeof parsed.version === 'string' ? parsed.version : undefined,
        owner: parsed.owner ?? undefined,
      }
    } catch {
      return { parseError: true, rawLength: json.length }
    }
  }

  private emit(op: LedgerOp, _path: string, patchOp: { op: 'add' | 'replace' | 'remove'; path: string; value?: unknown }): void {
    this.driftCount++
    try {
      const diff = patchOp.op === 'remove'
        ? [{ op: 'remove' as const, path: patchOp.path }]
        : [{
            op: patchOp.op as 'add' | 'replace',
            path: patchOp.path,
            value: patchOp.value,
          }]
      emitAgentOp(op, diff, {
        action: `system-tracker-${op}`,
        agentId: null,
        actor: 'system',
      })
    } catch (err) {
      console.error(`[SystemTracker] Emit failed for ${op}:`, err)
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────

let _instance: SystemTrackerImpl | null = null

/**
 * Get (or lazily create) the process-wide tracker instance. Do NOT
 * call `start()` from here — that's the caller's responsibility so
 * a test can construct the instance without side effects.
 */
export function getSystemTracker(config?: SystemTrackerConfig): SystemTrackerImpl {
  if (!_instance) _instance = new SystemTrackerImpl(config)
  return _instance
}

/** Reset the singleton — test-only hook. */
export function __resetSystemTrackerForTests(): void {
  _instance?.stop()
  _instance = null
}

export type SystemTracker = SystemTrackerImpl
