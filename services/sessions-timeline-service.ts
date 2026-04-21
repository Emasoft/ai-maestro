/**
 * Sessions Timeline Service — cross-file timeline enumeration + Rust bridge.
 *
 * This is the Phase 6 back-end entry point for the "one continuous
 * transcript per agent" feature. Responsibilities:
 *
 *   - `resolveTimelineSources(agentId)` — enumerate every `.jsonl` that
 *     belongs to the agent's timeline: main-thread files, sibling
 *     `--claude-worktrees-*` project dirs, and in-session `subagents/`
 *     sidecar files. Plan §3.2.
 *   - `openTimeline(agentId)` — build the Rust-side timeline handle and
 *     return the full manifest (cached per agent; invalidated on any
 *     file mtime change).
 *   - `readTimelineRange(tlId, from, to)` — dispatch to Rust.
 *   - `searchTimeline(tlId, query, …)` — dispatch to Rust.
 *   - `contextAt(tlId, target)` — dispatch to Rust.
 *
 * Keep this module pure (aside from the in-process manifest cache and
 * fs reads) so both Next.js routes and the headless router can call it.
 *
 * Invariants:
 *   - The enumeration NEVER asks the user for paths — worktrees and
 *     subagents are auto-detected per the rules in plan §3.2.
 *   - Files are only included when they actually exist (stat check) AND
 *     their first-line `cwd` matches the agent's workingDirectory when
 *     we can read it — this is the "belongs to this agent" gate.
 *   - Cache key is the concatenation of every source file's `path:size:mtime`
 *     so ANY change (new file, resized file, rewritten file) invalidates
 *     the manifest without touching disk state.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

import { getAgent } from '@/lib/agent-registry'
import type {
  TimelineFile,
  TimelineManifest,
  TimelineContextResult,
  TimelineSearchMatch,
  VirtualRow,
} from '@/types/sessions-browser'
import { getJsonlReader } from '@/lib/jsonl-reader'
import { slugifyWorkingDirectory } from '@/services/sessions-browser-service'
import type { SearchKind } from '@/lib/jsonl-reader-protocol'

// ---------------------------------------------------------------------------
// Types + injection hooks for tests
// ---------------------------------------------------------------------------

export interface AgentFetcher {
  (id: string): { id: string; workingDirectory?: string } | null
}

export interface TimelineServiceOptions {
  agentFetcher?: AgentFetcher
  /** Override homedir lookup for tests (maps to `~/.claude/projects/`). */
  homedirFn?: () => string
}

export interface OpenTimelineResult {
  ok: boolean
  status: number
  data?: TimelineManifest
  error?: string
}

// ---------------------------------------------------------------------------
// File enumeration
// ---------------------------------------------------------------------------

/** Read the first non-empty line of a .jsonl file, or `null` on failure. */
function peekFirstLine(absPath: string): Record<string, unknown> | null {
  try {
    // Small-read optimization: open with a bounded buffer so we don't
    // read the whole file when we only need the first ~4 KB.
    const fd = fs.openSync(absPath, 'r')
    try {
      const buf = Buffer.allocUnsafe(16 * 1024)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      if (n <= 0) return null
      const slice = buf.subarray(0, n).toString('utf-8')
      const nl = slice.indexOf('\n')
      const line = nl === -1 ? slice : slice.slice(0, nl)
      const trimmed = line.trim()
      if (trimmed.length === 0) return null
      return JSON.parse(trimmed) as Record<string, unknown>
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

/**
 * List `.jsonl` files inside a project dir (one level deep) and return
 * their absolute paths + fs stats. Excludes hidden files and the
 * `.aimidx` sidecar. Never throws — returns [] on any fs error.
 */
function listJsonlInDir(dir: string): Array<{ abs: string; size: number; mtime: Date }> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Array<{ abs: string; size: number; mtime: Date }> = []
  for (const e of entries) {
    if (!e.isFile()) continue
    if (e.name.startsWith('.')) continue
    if (!e.name.endsWith('.jsonl')) continue
    const abs = path.join(dir, e.name)
    try {
      const st = fs.statSync(abs)
      out.push({ abs, size: st.size, mtime: st.mtime })
    } catch {
      continue
    }
  }
  return out
}

/**
 * Enumerate sibling worktree project dirs for an agent. Claude Code
 * names worktree projects with the agent's workingDirectory slug plus a
 * `--claude-worktrees-<branch>` suffix (see plan §3.2). We match via
 * prefix on the sluggified dir name.
 *
 * Also matches the temp-worktree pattern that appears when a
 * scenario/runner spawns the agent in `/private/tmp/agents/<name>/…`:
 * `-private-tmp-*agents-<agentName>*--claude-worktrees-*`.
 */
function findWorktreeProjectDirs(
  agentSlugPrefix: string,
  agentName: string,
  projectsRoot: string,
): string[] {
  let names: string[]
  try {
    names = fs.readdirSync(projectsRoot)
  } catch {
    return []
  }
  const matches = new Set<string>()
  const agentNameSafe = agentName.replace(/[^a-zA-Z0-9_-]/g, '')
  for (const n of names) {
    // 1) Slug-prefix worktrees: `<agent-slug>--claude-worktrees-*`.
    if (
      n.startsWith(`${agentSlugPrefix}--claude-worktrees-`) &&
      n !== agentSlugPrefix
    ) {
      matches.add(path.join(projectsRoot, n))
      continue
    }
    // 2) Temp-worktree pattern driven by runner/scenario agents.
    if (
      agentNameSafe.length > 0 &&
      n.startsWith('-private-tmp-') &&
      n.includes(`agents-${agentNameSafe}`) &&
      n.includes('--claude-worktrees-')
    ) {
      matches.add(path.join(projectsRoot, n))
    }
  }
  return Array.from(matches).sort()
}

/**
 * Enumerate in-session `subagents/*.jsonl` sidecar files for a main-thread
 * session. Claude Code puts them at `<projectDir>/<sessionId>/subagents/`.
 */
function listSubagentsForSession(
  projectDir: string,
  sessionId: string,
): Array<{ abs: string; size: number; mtime: Date; agentId: string | null; slug: string | null }> {
  const sessionSub = path.join(projectDir, sessionId, 'subagents')
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(sessionSub, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Array<{
    abs: string
    size: number
    mtime: Date
    agentId: string | null
    slug: string | null
  }> = []
  for (const e of entries) {
    if (!e.isFile()) continue
    if (!e.name.endsWith('.jsonl')) continue
    const abs = path.join(sessionSub, e.name)
    let st: fs.Stats
    try {
      st = fs.statSync(abs)
    } catch {
      continue
    }
    // Try to read agentId + slug from the sidecar .meta.json (same base
    // name, different extension). Fall back to first-line values.
    const metaPath = abs.replace(/\.jsonl$/, '.meta.json')
    let agentId: string | null = null
    let slug: string | null = null
    try {
      const raw = fs.readFileSync(metaPath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed['agentId'] === 'string') agentId = parsed['agentId'] as string
      if (typeof parsed['slug'] === 'string') slug = parsed['slug'] as string
    } catch {
      const firstLine = peekFirstLine(abs)
      if (firstLine) {
        if (typeof firstLine['agentId'] === 'string') agentId = firstLine['agentId'] as string
        if (typeof firstLine['slug'] === 'string') slug = firstLine['slug'] as string
      }
    }
    out.push({ abs, size: st.size, mtime: st.mtime, agentId, slug })
  }
  return out
}

/**
 * Whether the file's first-line `cwd` belongs to the agent's working dir.
 * Returns true when the check cannot be performed (we err on the side of
 * inclusion — the Rust side still skips malformed rows).
 */
function cwdMatchesAgent(absPath: string, agentWorkDir: string): boolean {
  const first = peekFirstLine(absPath)
  if (!first) return true
  const cwd = first['cwd']
  if (typeof cwd !== 'string' || cwd.length === 0) return true
  // Both-direction prefix match: a worktree's cwd may be a descendant of
  // the agent's workingDirectory, or vice-versa on macOS where
  // `/var/folders/...` and `/private/var/folders/...` alias the same tree.
  return cwd.startsWith(agentWorkDir) || agentWorkDir.startsWith(cwd)
}

// ---------------------------------------------------------------------------
// resolveTimelineSources
// ---------------------------------------------------------------------------

export async function resolveTimelineSources(
  agentId: string,
  opts: TimelineServiceOptions = {},
): Promise<{
  ok: true
  data: {
    agentWorkDir: string
    mainFiles: TimelineFile[]
    worktreeFiles: TimelineFile[]
    subagentFiles: TimelineFile[]
    projectDirs: string[]
  }
} | {
  ok: false
  status: number
  error: string
}> {
  const fetcher = opts.agentFetcher ?? ((id: string) => getAgent(id))
  const agent = fetcher(agentId)
  if (!agent) {
    return { ok: false, status: 404, error: 'agent_not_found' }
  }
  const wd = agent.workingDirectory
  if (!wd) {
    return {
      ok: true,
      data: {
        agentWorkDir: '',
        mainFiles: [],
        worktreeFiles: [],
        subagentFiles: [],
        projectDirs: [],
      },
    }
  }
  const homedir = opts.homedirFn ? opts.homedirFn() : os.homedir()
  const projectsRoot = path.join(homedir, '.claude', 'projects')
  const agentSlug = slugifyWorkingDirectory(wd)
  // Reuse the shared slug helper but compose the path against the
  // (possibly overridden) homedir — `projectDirForWorkingDirectory` uses
  // the real `os.homedir()` unconditionally, which breaks unit tests
  // that use a tmp home.
  const mainProjectDir = agentSlug ? path.join(projectsRoot, agentSlug) : null
  if (!agentSlug || !mainProjectDir) {
    return {
      ok: true,
      data: {
        agentWorkDir: wd,
        mainFiles: [],
        worktreeFiles: [],
        subagentFiles: [],
        projectDirs: [],
      },
    }
  }

  // Read the agent's name from the registry — used for the temp-tmp
  // worktree detection pattern (`-private-tmp-*agents-<name>*...`).
  // Fall back to the last segment of the workingDirectory if name is
  // missing — that's often the agent's folder name.
  const agentNameLike =
    (agent as { name?: string }).name ??
    path.basename(wd.replace(/\/+$/g, ''))

  const projectDirsSet = new Set<string>()

  // 1) Main-thread files.
  const mainRaw = listJsonlInDir(mainProjectDir)
  const mainFiles: TimelineFile[] = []
  if (mainRaw.length > 0) projectDirsSet.add(mainProjectDir)
  for (const m of mainRaw) {
    if (!cwdMatchesAgent(m.abs, wd)) continue
    const sessionId = path.basename(m.abs, '.jsonl')
    mainFiles.push({
      absPath: m.abs,
      sessionId,
      kind: 'main',
      laneId: 'main',
      parentSessionId: null,
      agentId: null,
      slug: null,
      size: m.size,
      lastModified: m.mtime.toISOString(),
    })
  }

  // 2) Worktree project dirs for the same agent slug.
  const worktreeDirs = findWorktreeProjectDirs(agentSlug, agentNameLike, projectsRoot)
  const worktreeFiles: TimelineFile[] = []
  for (const wdir of worktreeDirs) {
    const wRaw = listJsonlInDir(wdir)
    if (wRaw.length > 0) projectDirsSet.add(wdir)
    // Derive a branch-ish label from the dir suffix.
    const dirName = path.basename(wdir)
    const ix = dirName.indexOf('--claude-worktrees-')
    const branch = ix >= 0 ? dirName.slice(ix + '--claude-worktrees-'.length) : dirName
    for (const f of wRaw) {
      if (!cwdMatchesAgent(f.abs, wd)) continue
      const sessionId = path.basename(f.abs, '.jsonl')
      worktreeFiles.push({
        absPath: f.abs,
        sessionId,
        kind: 'worktree-main',
        laneId: `worktree:${branch}`,
        parentSessionId: null,
        agentId: null,
        slug: null,
        size: f.size,
        lastModified: f.mtime.toISOString(),
      })
    }
  }

  // 3) Subagent sidecar files — one per main-thread session that has
  // a `<sid>/subagents/` directory.
  const subagentFiles: TimelineFile[] = []
  for (const mf of mainFiles) {
    const subs = listSubagentsForSession(mainProjectDir, mf.sessionId)
    for (const s of subs) {
      subagentFiles.push({
        absPath: s.abs,
        sessionId: path.basename(s.abs, '.jsonl'),
        kind: 'subagent',
        // Prefer slug-based lane label; fall back to agentId; otherwise
        // `subagent` with the short-id suffix for uniqueness in the UI.
        laneId: s.slug
          ? `subagent:${s.slug}`
          : s.agentId
          ? `subagent:${s.agentId.slice(0, 8)}`
          : `subagent:${path.basename(s.abs, '.jsonl').slice(0, 12)}`,
        parentSessionId: mf.sessionId,
        agentId: s.agentId,
        slug: s.slug,
        size: s.size,
        lastModified: s.mtime.toISOString(),
      })
    }
  }
  // Also collect subagents under worktree sessions.
  for (const wf of worktreeFiles) {
    const wDir = path.dirname(wf.absPath)
    const subs = listSubagentsForSession(wDir, wf.sessionId)
    for (const s of subs) {
      subagentFiles.push({
        absPath: s.abs,
        sessionId: path.basename(s.abs, '.jsonl'),
        kind: 'worktree-subagent',
        laneId: s.slug
          ? `subagent:${s.slug}`
          : s.agentId
          ? `subagent:${s.agentId.slice(0, 8)}`
          : `subagent:${path.basename(s.abs, '.jsonl').slice(0, 12)}`,
        parentSessionId: wf.sessionId,
        agentId: s.agentId,
        slug: s.slug,
        size: s.size,
        lastModified: s.mtime.toISOString(),
      })
    }
  }

  return {
    ok: true,
    data: {
      agentWorkDir: wd,
      mainFiles,
      worktreeFiles,
      subagentFiles,
      projectDirs: Array.from(projectDirsSet).sort(),
    },
  }
}

// ---------------------------------------------------------------------------
// openTimeline + manifest cache
// ---------------------------------------------------------------------------

interface ManifestCacheEntry {
  /** Fingerprint of the source file set — invalidates on any change. */
  fingerprint: string
  manifest: TimelineManifest
}

const manifestCache = new Map<string, ManifestCacheEntry>()

/** Test hook — wipe the manifest cache between cases. */
export function clearTimelineManifestCache(): void {
  manifestCache.clear()
}

function computeFingerprint(files: TimelineFile[]): string {
  // Sort by absPath so the fingerprint is insensitive to enumeration
  // order — then concat `abs:size:mtime` for each. Any file add, resize,
  // or rewrite changes the fingerprint.
  const parts = files
    .map((f) => `${f.absPath}:${f.size}:${f.lastModified}`)
    .sort()
  return parts.join('|')
}

export async function openTimeline(
  agentId: string,
  opts: TimelineServiceOptions = {},
): Promise<OpenTimelineResult> {
  const resolved = await resolveTimelineSources(agentId, opts)
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error }
  }

  const { agentWorkDir, mainFiles, worktreeFiles, subagentFiles, projectDirs } =
    resolved.data
  const allFiles: TimelineFile[] = [...mainFiles, ...worktreeFiles, ...subagentFiles]

  // Empty timeline: still return a valid manifest so the UI can render
  // the "no sessions yet" state.
  if (allFiles.length === 0) {
    const emptyManifest: TimelineManifest = {
      timelineId: `tl-empty-${agentId}`,
      agentId,
      files: [],
      totalLines: 0,
      projectDirs,
      generatedAt: new Date().toISOString(),
      lanes: [],
    }
    return { ok: true, status: 200, data: emptyManifest }
  }

  const fingerprint = computeFingerprint(allFiles)
  const cached = manifestCache.get(agentId)
  if (cached && cached.fingerprint === fingerprint) {
    return { ok: true, status: 200, data: cached.manifest }
  }

  // Dispatch to Rust.
  try {
    const reader = getJsonlReader()
    const resp = await reader.openTimeline(
      allFiles.map((f) => ({ path: f.absPath, laneId: f.laneId })),
    )
    // The Rust side sorts files by first-timestamp; pull that order
    // back out by using the order of `fileIndexes` inside each lane
    // manifest. We reconstruct the flat file order from the lane
    // manifests, preserving their relative order of appearance.
    const orderedFiles = reorderFilesFromManifest(allFiles, resp.lanes)
    const manifest: TimelineManifest = {
      timelineId: resp.timelineId,
      agentId,
      files: orderedFiles,
      totalLines: resp.globalLineCount,
      projectDirs,
      generatedAt: new Date().toISOString(),
      lanes: resp.lanes.map((l) => ({
        laneId: l.laneId,
        fileIndexes: l.fileIndexes,
        firstTimestampIso: l.firstTimestampIso,
        lastTimestampIso: l.lastTimestampIso,
        lineCount: l.lineCount,
      })),
    }
    manifestCache.set(agentId, { fingerprint, manifest })
    // Reference `agentWorkDir` so lint/no-unused does not flag it — it
    // is captured for future auditing and kept here deliberately.
    void agentWorkDir
    return { ok: true, status: 200, data: manifest }
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: (err as Error).message || 'timeline_open_failed',
    }
  }
}

/**
 * Rebuild the TypeScript-side ordered file list to match the Rust-side
 * manifest. The Rust reader sorted by first-timestamp and reports its
 * ordering via the per-lane `fileIndexes` field (indexes into the list
 * it received, i.e. our `allFiles`). We iterate lanes and pull files
 * in that order, deduplicating on absPath in case a file appears twice.
 */
function reorderFilesFromManifest(
  allFiles: TimelineFile[],
  lanes: Array<{ laneId: string; fileIndexes: number[] }>,
): TimelineFile[] {
  const seen = new Set<string>()
  const ordered: TimelineFile[] = []
  for (const lane of lanes) {
    for (const idx of lane.fileIndexes) {
      if (idx < 0 || idx >= allFiles.length) continue
      const f = allFiles[idx]
      if (seen.has(f.absPath)) continue
      seen.add(f.absPath)
      ordered.push(f)
    }
  }
  // Append any files that the lane manifests missed (shouldn't happen,
  // but defensive).
  for (const f of allFiles) {
    if (!seen.has(f.absPath)) ordered.push(f)
  }
  return ordered
}

// ---------------------------------------------------------------------------
// Range / Search / ContextAt dispatch
// ---------------------------------------------------------------------------

export async function readTimelineRange(
  timelineId: string,
  fromGlobal: number,
  toGlobal: number,
): Promise<{ ok: boolean; status: number; data?: { rows: VirtualRow[] }; error?: string }> {
  try {
    const reader = getJsonlReader()
    const resp = await reader.readTimelineRange(timelineId, fromGlobal, toGlobal)
    const rows: VirtualRow[] = resp.rows.map((r) => ({
      sessionId: r.sessionId,
      laneId: r.laneId,
      fileIndex: r.fileIndex,
      localLineIndex: r.localLineIndex,
      globalLineIndex: r.globalLineIndex,
      raw: r.raw,
    }))
    return { ok: true, status: 200, data: { rows } }
  } catch (err) {
    return mapReaderError(err)
  }
}

export async function searchTimeline(
  timelineId: string,
  query: string,
  opts: { kind?: SearchKind; caseInsensitive?: boolean } = {},
): Promise<{
  ok: boolean
  status: number
  data?: { matches: TimelineSearchMatch[] }
  error?: string
}> {
  try {
    const reader = getJsonlReader()
    const resp = await reader.searchTimeline(timelineId, query, opts)
    return {
      ok: true,
      status: 200,
      data: {
        matches: resp.matches.map((m) => ({
          globalLineIndex: m.globalLineIndex,
          laneId: m.laneId,
          sessionId: m.sessionId,
          fileIndex: m.fileIndex,
          localLineIndex: m.localLineIndex,
          byteOffset: m.byteOffset,
          snippet: m.snippet,
        })),
      },
    }
  } catch (err) {
    return mapReaderError(err)
  }
}

export async function contextAt(
  timelineId: string,
  target: { anchorUuid?: string; globalLineIndex?: number },
): Promise<{
  ok: boolean
  status: number
  data?: TimelineContextResult
  error?: string
}> {
  if (!target.anchorUuid && typeof target.globalLineIndex !== 'number') {
    return { ok: false, status: 400, error: 'anchor_required' }
  }
  try {
    const reader = getJsonlReader()
    const resp = await reader.contextAt(timelineId, target)
    return {
      ok: true,
      status: 200,
      data: {
        anchorGlobalLine: resp.anchorGlobalLine,
        cumulative: resp.cumulative,
        exactAtCursor: resp.exactAtCursor,
        phaseHistory: resp.phaseHistory,
      },
    }
  } catch (err) {
    return mapReaderError(err)
  }
}

function mapReaderError(err: unknown): {
  ok: false
  status: number
  error: string
} {
  const anyErr = err as { code?: string; message?: string }
  const code = anyErr.code ?? ''
  if (code === 'timeline_not_found') {
    return { ok: false, status: 404, error: 'timeline_not_found' }
  }
  if (code === 'invalid_request') {
    return { ok: false, status: 400, error: 'invalid_request' }
  }
  if (code === 'binary_missing') {
    return { ok: false, status: 503, error: 'binary_missing' }
  }
  return {
    ok: false,
    status: 502,
    error: anyErr.message ?? 'reader_error',
  }
}
