/**
 * Sessions Browser Service — agent → project dir → .jsonl file discovery.
 *
 * Claude Code persists every conversation at
 *   ~/.claude/projects/<slugged-project-dir>/<session-uuid>.jsonl
 *
 * The slug rule (empirically verified against real installations —
 * `ls ~/.claude/projects/ | awk '{print substr($0,1,1)}' | sort -u`
 * yields only `-` on any host running Claude Code):
 *   1. Take the agent's absolute workingDirectory.
 *   2. Strip trailing slashes.
 *   3. Replace each '/' with '-'.
 *   4. KEEP the leading '-' that results from an absolute path.
 *
 * Example:
 *   workingDirectory: /Users/emanuele/code/ai-maestro
 *   slug:             -Users-emanuele-code-ai-maestro
 *
 * This service is pure (no side effects other than filesystem reads) so
 * both Next.js route handlers and the headless router can call it.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

import { getAgent } from '@/lib/agent-registry'
import type { SessionSummary, SessionsListResponse } from '@/types/sessions-browser'
import { getJsonlReader } from '@/lib/jsonl-reader'
import type { AnalyzeFileMetadataOkResponse } from '@/lib/jsonl-reader-protocol'
import { validateSession, extractSessionFromCookie } from '@/lib/session-auth'

/**
 * Convert an absolute working directory into Claude's project-dir slug.
 * The leading dash IS preserved — Claude Code's on-disk convention under
 * `~/.claude/projects/` always names absolute-path slugs with a leading
 * `-` (verified by listing the directory on any real host).
 * Returns null if the input is empty or collapses to just `/`.
 */
export function slugifyWorkingDirectory(workingDirectory: string): string | null {
  if (!workingDirectory) return null
  // Normalize: trim trailing slashes, then replace path separators.
  // Accept either Unix-style or Windows-style absolute paths defensively,
  // but Claude Code on macOS/Linux always uses '/'.
  const normalized = workingDirectory.replace(/\\+/g, '/').replace(/\/+$/g, '')
  if (normalized.length === 0) return null
  // Replace each '/' with '-'. Claude Code keeps the leading dash that
  // results from an absolute path — do NOT strip it, or the slug will
  // not match any real `~/.claude/projects/` directory and every agent
  // will appear to have zero sessions.
  const slug = normalized.replace(/\//g, '-')
  return slug.length > 0 ? slug : null
}

/**
 * Return the absolute path to the Claude Code projects directory for the
 * given working directory, or null if slugging fails.
 * Does NOT check that the directory exists — callers decide.
 */
export function projectDirForWorkingDirectory(workingDirectory: string): string | null {
  const slug = slugifyWorkingDirectory(workingDirectory)
  if (!slug) return null
  return path.join(os.homedir(), '.claude', 'projects', slug)
}

/**
 * List `.jsonl` session files in the given directory, sorted by mtime DESC.
 * Each entry carries file size, mtime, and a lazy `messageCount = null`.
 * Non-.jsonl files, hidden files, and sidecar `.aimidx` files are ignored.
 *
 * If the directory does not exist, returns an empty array (not an error).
 */
export function listSessionsInProjectDir(projectDir: string): SessionSummary[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw err
  }

  const summaries: SessionSummary[] = []
  for (const ent of entries) {
    if (!ent.isFile()) continue
    if (ent.name.startsWith('.')) continue
    if (!ent.name.endsWith('.jsonl')) continue
    const abs = path.join(projectDir, ent.name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      continue
    }
    const displayName = ent.name.replace(/\.jsonl$/, '')
    summaries.push({
      path: abs,
      size: stat.size,
      messageCount: null,
      lastModified: stat.mtime.toISOString(),
      displayName,
      id: displayName,
    })
  }

  summaries.sort((a, b) => {
    const ta = Date.parse(a.lastModified)
    const tb = Date.parse(b.lastModified)
    return tb - ta
  })
  return summaries
}

/**
 * Full pipeline: agent id → registry lookup → working dir → slug → list.
 *
 * `agentFetcher` is injectable so unit tests can feed a synthetic agent.
 * In production, it defaults to `getAgent` from the file-based registry.
 */
export interface AgentFetcher {
  (id: string): { id: string; workingDirectory?: string } | null
}

export interface GetSessionsForAgentOptions {
  agentFetcher?: AgentFetcher
  /**
   * Override the list function for tests (so we can simulate a populated
   * project dir without touching the filesystem).
   */
  lister?: (projectDir: string) => SessionSummary[]
}

export interface GetSessionsForAgentResult {
  ok: boolean
  status: number
  data?: SessionsListResponse
  error?: string
}

/**
 * Validate the `aim_session` cookie against the server session store.
 *
 * Supersedes the presence-only `hasSessionCookie` (TRDD-9e1e4b29): a forged
 * `aim_session=anything` MUST NOT pass — only a token the session store
 * actually issued (via the login round-trip) and that is still live is
 * accepted. Returns false for an absent / empty / forged / expired cookie.
 *
 * WHY this matters: every `/api/sessions-browser/*` route exposes complete
 * agent transcripts + context/token economics. Network reachability is already
 * confined to localhost / Tailscale (`server.mjs:isAllowedSource()`), but that
 * is not authentication — a presence-only gate let any reachable client read
 * every agent's conversation by sending a junk cookie. This is the single
 * shared validating gate the routes (Next + headless) call.
 *
 * Synchronous: both `extractSessionFromCookie` and `validateSession` are sync,
 * so the route gates stay synchronous (no handler signature change).
 */
export function hasValidSession(cookieHeader: string | null | undefined): boolean {
  const token = extractSessionFromCookie(cookieHeader ?? null)
  return token !== null && validateSession(token)
}

/**
 * Confine a caller-supplied `?path=` to the Claude Code transcript store
 * (`~/.claude/projects/<slug>/...<uuid>.jsonl`). The raw `?path=` is
 * attacker-controlled — any authenticated session can pass `?path=/etc/passwd`
 * — and the downstream reader (`ensureOpenForPath` → Rust `open` →
 * `fs.readFile`) does NOT confine it, so the gate lives here at the request
 * boundary. `path.resolve` collapses any `..` traversal, so a post-resolve
 * `.jsonl`-suffix + projects-root-prefix check is the correct lexical
 * confinement (no symlink follow — the reader does none either).
 *
 * SINGLE SOURCE OF TRUTH (TRDD-5df6f7da): the range / search / context-breakdown
 * routes (Next + headless) all import THIS one definition, so this security
 * control can never silently drift across copies. Any future hardening (e.g.
 * `fs.realpath` symlink resolution) is made here once. Returns the resolved
 * absolute path, or `null` to reject.
 */
export function confineToProjectsStore(rawPath: string): string | null {
  const resolved = path.resolve(rawPath)
  if (!resolved.endsWith('.jsonl')) return null
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects')
  if (!resolved.startsWith(projectsRoot + path.sep)) return null
  return resolved
}

/**
 * Reverse-lookup map: session UUID → absolute .jsonl path.
 *
 * Populated whenever `getSessionsForAgent` runs. Route handlers that
 * receive a `:sid` path-param use this to resolve the path and then
 * open the Rust-side session on demand.
 *
 * Entries never time out (the dashboard process holds them for its
 * lifetime) but are replaced on each re-list — so if a session is
 * deleted, its entry naturally ages out the next time the list runs.
 */
const sidToPath = new Map<string, string>()

export function recordSessionMapping(sessionId: string, absolutePath: string): void {
  sidToPath.set(sessionId, absolutePath)
}

export function resolveSessionPath(sessionId: string): string | null {
  return sidToPath.get(sessionId) ?? null
}

/** Test hook — wipe the reverse map between cases. */
export function clearSessionMappings(): void {
  sidToPath.clear()
}

export function getSessionsForAgent(
  agentId: string,
  opts: GetSessionsForAgentOptions = {},
): GetSessionsForAgentResult {
  const fetch = opts.agentFetcher ?? ((id: string) => getAgent(id))
  const agent = fetch(agentId)
  if (!agent) {
    return { ok: false, status: 404, error: 'agent_not_found' }
  }
  const wd = agent.workingDirectory
  if (!wd) {
    // Agent with no working dir has no project dir. Return empty list, not 404.
    return {
      ok: true,
      status: 200,
      data: { projectDir: null, sessions: [] },
    }
  }
  const projectDir = projectDirForWorkingDirectory(wd)
  if (!projectDir) {
    return {
      ok: true,
      status: 200,
      data: { projectDir: null, sessions: [] },
    }
  }
  const lister = opts.lister ?? listSessionsInProjectDir
  const sessions = lister(projectDir)
  for (const s of sessions) {
    recordSessionMapping(s.id, s.path)
  }
  return {
    ok: true,
    status: 200,
    data: { projectDir, sessions },
  }
}

/**
 * Resolve a UI-level session id to the absolute .jsonl path it refers to.
 *
 * The route handlers accept session ids in two forms:
 *   1. The Rust-side sessionId returned by a previous `open` call — safe,
 *      just pass through to the reader.
 *   2. A fresh UI-side identifier (the session's displayName, i.e. the UUID).
 *      In this case we must first figure out which agent's project dir owns
 *      it, then call `reader.open(absolutePath)`.
 *
 * Rather than doing a reverse-index across every agent on every request,
 * we accept a `?path=/abs/to/session.jsonl` query param on the route
 * handlers as the authoritative form. The session list endpoint returns
 * `path` for every entry; the UI sends it back verbatim.
 *
 * This helper opens (or reuses) the reader-side session for `absolutePath`
 * and returns the Rust-side sessionId.
 */
export async function ensureOpenForPath(absolutePath: string): Promise<string> {
  const resolved = path.resolve(absolutePath)
  const reader = getJsonlReader()
  const resp = await reader.open(resolved)
  return resp.sessionId
}

// ---------------------------------------------------------------------------
// Phase 5 §4 — metadata enrichment for the sessions list.
// ---------------------------------------------------------------------------
//
// `getSessionsForAgent` returns the cheap file-system rows (path, size,
// mtime). The UI now wants a richer row that includes a first-user
// preview, an ongoing flag, and a compaction count. Those fields come
// from the Rust `analyze_file_metadata` streaming analyzer, which is
// too expensive to run on every list request — so we cache its output
// in-process keyed by (path, size, mtime). Any change to size or mtime
// invalidates the entry.
//
// The cache is deliberately tiny (in-process, Map<string, entry>) so
// worker-reboot resets it. That matches the other caches in this module
// (the sid→path reverse map) and keeps us from introducing disk I/O
// for what is essentially a UI affordance.

interface MetadataCacheEntry {
  size: number
  mtime: string // SessionSummary.lastModified — ISO-8601
  value: AnalyzeFileMetadataOkResponse
}

const metadataCache = new Map<string, MetadataCacheEntry>()

/** Test hook — wipe the metadata cache between cases. */
export function clearMetadataCache(): void {
  metadataCache.clear()
}

/**
 * Return a cached analyze_file_metadata response for `summary`, running
 * the analyzer on cache miss. Never throws — on analyzer failure we
 * return `null` and the caller leaves the metadata fields undefined.
 */
async function analyzeWithCache(
  summary: SessionSummary,
): Promise<AnalyzeFileMetadataOkResponse | null> {
  const cached = metadataCache.get(summary.path)
  if (
    cached &&
    cached.size === summary.size &&
    cached.mtime === summary.lastModified
  ) {
    return cached.value
  }
  try {
    const reader = getJsonlReader()
    const resp = await reader.analyzeFileMetadata(summary.path)
    metadataCache.set(summary.path, {
      size: summary.size,
      mtime: summary.lastModified,
      value: resp,
    })
    return resp
  } catch {
    // Swallow — the caller will leave the metadata fields undefined.
    // We do NOT poison the cache on failure (so a transient error
    // doesn't permanently hide metadata for this session).
    return null
  }
}

/**
 * Agent → project dir → list → metadata-enriched list.
 *
 * Mirrors `getSessionsForAgent` but augments each session with the
 * Phase 5 metadata fields (`firstUserText`, `isOngoing`, `compactionCount`).
 * The rest of the logic — 404 on missing agent, empty list for missing
 * workingDirectory, sid→path mapping — is identical.
 */
export async function getSessionsForAgentWithMetadata(
  agentId: string,
  opts: GetSessionsForAgentOptions = {},
): Promise<GetSessionsForAgentResult> {
  const base = getSessionsForAgent(agentId, opts)
  if (!base.ok || !base.data) return base

  const enriched: SessionSummary[] = []
  for (const s of base.data.sessions) {
    const meta = await analyzeWithCache(s)
    if (meta) {
      enriched.push({
        ...s,
        firstUserText: meta.firstUserMessagePreview,
        isOngoing: meta.isOngoing,
        compactionCount: meta.compactionCount,
      })
    } else {
      // Analyzer failed — leave metadata fields undefined, keep the rest.
      enriched.push(s)
    }
  }

  return {
    ok: true,
    status: 200,
    data: {
      projectDir: base.data.projectDir,
      sessions: enriched,
    },
  }
}
