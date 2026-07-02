import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// getAgent must be mocked before we import the service module.
vi.mock('@/lib/agent-registry', () => ({
  getAgent: vi.fn(),
}))

// Mock the jsonl-reader so we don't spawn the real Rust child in unit tests.
// We stub only the methods the timeline service calls; the existing
// sessions-browser-service tests do the same for `analyzeFileMetadata`.
vi.mock('@/lib/jsonl-reader', () => ({
  getJsonlReader: vi.fn(),
}))

import {
  resolveTimelineSources,
  openTimeline,
  readTimelineRange,
  searchTimeline,
  contextAt,
  clearTimelineManifestCache,
} from '@/services/sessions-timeline-service'
import { getAgent } from '@/lib/agent-registry'
import { getJsonlReader } from '@/lib/jsonl-reader'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake `~/.claude/projects/` tree under a tmp dir. */
function setupFakeHomedir(): {
  home: string
  projects: string
  cleanup: () => void
} {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-timeline-'))
  const projects = path.join(home, '.claude', 'projects')
  fs.mkdirSync(projects, { recursive: true })
  return {
    home,
    projects,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  }
}

function writeJsonl(filePath: string, lines: Array<Record<string, unknown>>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  fs.writeFileSync(filePath, text)
}

function writeMeta(filePath: string, meta: Record<string, unknown>) {
  fs.writeFileSync(filePath, JSON.stringify(meta))
}

// ---------------------------------------------------------------------------
// resolveTimelineSources
// ---------------------------------------------------------------------------

describe('resolveTimelineSources', () => {
  let homedir: string
  let projects: string
  let cleanup: () => void

  beforeEach(() => {
    const h = setupFakeHomedir()
    homedir = h.home
    projects = h.projects
    cleanup = h.cleanup
    clearTimelineManifestCache()
    vi.mocked(getAgent).mockReset()
    vi.mocked(getJsonlReader).mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('returns agent_not_found when the registry has no entry', async () => {
    const res = await resolveTimelineSources('ghost', {
      agentFetcher: () => null,
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(404)
      expect(res.error).toBe('agent_not_found')
    }
  })

  it('returns empty lists for an agent without workingDirectory', async () => {
    const res = await resolveTimelineSources('a1', {
      agentFetcher: () => ({ id: 'a1' }),
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.mainFiles).toEqual([])
      expect(res.data.worktreeFiles).toEqual([])
      expect(res.data.subagentFiles).toEqual([])
      expect(res.data.projectDirs).toEqual([])
    }
  })

  it('enumerates main-thread files under the agent slug dir', async () => {
    const agentWorkDir = '/workspace/myproj'
    const slug = '-workspace-myproj'
    const dir = path.join(projects, slug)
    writeJsonl(path.join(dir, 'sess-1.jsonl'), [
      { cwd: agentWorkDir, role: 'user', content: 'hi' },
    ])
    writeJsonl(path.join(dir, 'sess-2.jsonl'), [
      { cwd: agentWorkDir, role: 'user', content: 'ciao' },
    ])

    const res = await resolveTimelineSources('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.mainFiles).toHaveLength(2)
    const ids = res.data.mainFiles.map((f) => f.sessionId).sort()
    expect(ids).toEqual(['sess-1', 'sess-2'])
    expect(res.data.mainFiles.every((f) => f.laneId === 'main')).toBe(true)
    expect(res.data.mainFiles.every((f) => f.kind === 'main')).toBe(true)
    expect(res.data.projectDirs).toContain(dir)
  })

  it('enumerates sibling worktree project dirs by slug prefix', async () => {
    const agentWorkDir = '/workspace/myproj'
    const slug = '-workspace-myproj'
    const mainDir = path.join(projects, slug)
    const wtDir1 = path.join(projects, `${slug}--claude-worktrees-fix-a`)
    const wtDir2 = path.join(projects, `${slug}--claude-worktrees-fix-b`)
    writeJsonl(path.join(mainDir, 'main-sess.jsonl'), [
      { cwd: agentWorkDir, role: 'user', content: 'm' },
    ])
    writeJsonl(path.join(wtDir1, 'wt1-sess.jsonl'), [
      { cwd: agentWorkDir, role: 'user', content: 'wt1' },
    ])
    writeJsonl(path.join(wtDir2, 'wt2-sess.jsonl'), [
      { cwd: agentWorkDir, role: 'user', content: 'wt2' },
    ])

    const res = await resolveTimelineSources('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.worktreeFiles).toHaveLength(2)
    const laneIds = res.data.worktreeFiles.map((f) => f.laneId).sort()
    expect(laneIds).toEqual(['worktree:fix-a', 'worktree:fix-b'])
    // Both worktree dirs should appear in projectDirs alongside main.
    expect(res.data.projectDirs.length).toBeGreaterThanOrEqual(3)
  })

  it('enumerates temp-tmp worktrees matching -private-tmp-*agents-<name>*', async () => {
    const agentWorkDir = '/Users/alice/work/myproj'
    const slug = '-Users-alice-work-myproj'
    const mainDir = path.join(projects, slug)
    // Temp worktree pattern surfaces when scenario/runner spawns agents.
    const tmpWt = path.join(
      projects,
      '-private-tmp-foo-agents-my-agent-name--claude-worktrees-aux-b',
    )
    writeJsonl(path.join(mainDir, 'main.jsonl'), [
      { cwd: agentWorkDir, role: 'user', content: 'm' },
    ])
    writeJsonl(path.join(tmpWt, 'tmp-wt.jsonl'), [
      { cwd: agentWorkDir, role: 'user', content: 'temp wt' },
    ])

    const res = await resolveTimelineSources('a1', {
      agentFetcher: () => ({
        id: 'a1',
        workingDirectory: agentWorkDir,
        name: 'my-agent-name',
      }),
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.worktreeFiles).toHaveLength(1)
    expect(res.data.worktreeFiles[0].laneId).toBe('worktree:aux-b')
  })

  it('skips files whose first-line cwd does not match the agent workDir', async () => {
    const agentWorkDir = '/workspace/myproj'
    const slug = '-workspace-myproj'
    const mainDir = path.join(projects, slug)
    // Belongs (prefix match).
    writeJsonl(path.join(mainDir, 'keeper.jsonl'), [
      { cwd: `${agentWorkDir}/subdir`, role: 'user', content: 'k' },
    ])
    // Does NOT belong — unrelated cwd.
    writeJsonl(path.join(mainDir, 'stranger.jsonl'), [
      { cwd: '/elsewhere/nope', role: 'user', content: 's' },
    ])

    const res = await resolveTimelineSources('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.mainFiles).toHaveLength(1)
    expect(res.data.mainFiles[0].sessionId).toBe('keeper')
  })

  it('enumerates subagent sidecar files under each main session', async () => {
    const agentWorkDir = '/workspace/myproj'
    const slug = '-workspace-myproj'
    const mainDir = path.join(projects, slug)
    const sid = 'parent-sess'
    writeJsonl(path.join(mainDir, `${sid}.jsonl`), [
      { cwd: agentWorkDir, role: 'user', content: 'start' },
    ])
    // Subagent jsonl + meta.
    const subDir = path.join(mainDir, sid, 'subagents')
    writeJsonl(path.join(subDir, 'agent-aabbcc.jsonl'), [
      {
        cwd: agentWorkDir,
        isSidechain: true,
        role: 'user',
        content: 'sub start',
        agentId: 'aabbcc-full-id',
        slug: 'helper',
      },
    ])
    writeMeta(path.join(subDir, 'agent-aabbcc.meta.json'), {
      agentId: 'aabbcc-full-id',
      slug: 'helper-from-meta',
    })

    const res = await resolveTimelineSources('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.subagentFiles).toHaveLength(1)
    const sf = res.data.subagentFiles[0]
    expect(sf.kind).toBe('subagent')
    expect(sf.parentSessionId).toBe(sid)
    // meta.json takes precedence over first-line values.
    expect(sf.slug).toBe('helper-from-meta')
    expect(sf.agentId).toBe('aabbcc-full-id')
    expect(sf.laneId).toBe('subagent:helper-from-meta')
  })

  it('falls back to first-line agentId/slug when meta.json is absent', async () => {
    const agentWorkDir = '/workspace/myproj'
    const slug = '-workspace-myproj'
    const mainDir = path.join(projects, slug)
    const sid = 'p'
    writeJsonl(path.join(mainDir, `${sid}.jsonl`), [
      { cwd: agentWorkDir, role: 'user' },
    ])
    const subDir = path.join(mainDir, sid, 'subagents')
    writeJsonl(path.join(subDir, 'agent-xx.jsonl'), [
      { cwd: agentWorkDir, isSidechain: true, agentId: 'xx-id', slug: 'inline-slug' },
    ])

    const res = await resolveTimelineSources('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.subagentFiles[0].slug).toBe('inline-slug')
    expect(res.data.subagentFiles[0].laneId).toBe('subagent:inline-slug')
  })
})

// ---------------------------------------------------------------------------
// openTimeline + manifest cache
// ---------------------------------------------------------------------------

describe('openTimeline cache', () => {
  let homedir: string
  let projects: string
  let cleanup: () => void

  beforeEach(() => {
    const h = setupFakeHomedir()
    homedir = h.home
    projects = h.projects
    cleanup = h.cleanup
    clearTimelineManifestCache()
    vi.mocked(getAgent).mockReset()
    vi.mocked(getJsonlReader).mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  function seedOneFile() {
    const agentWorkDir = '/workspace/myproj'
    const slug = '-workspace-myproj'
    const dir = path.join(projects, slug)
    const filePath = path.join(dir, 'only.jsonl')
    writeJsonl(filePath, [{ cwd: agentWorkDir, role: 'user' }])
    return { agentWorkDir, filePath }
  }

  it('returns an empty manifest when no source files exist', async () => {
    const result = await openTimeline('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: '/workspace/empty' }),
      homedirFn: () => homedir,
    })
    expect(result.ok).toBe(true)
    expect(result.data?.files).toEqual([])
    expect(result.data?.totalLines).toBe(0)
  })

  it('dispatches to the Rust reader on first call and caches the manifest', async () => {
    const { agentWorkDir, filePath } = seedOneFile()
    const openMock = vi.fn().mockResolvedValue({
      ok: true,
      timelineId: 'tl-cached-1',
      globalLineCount: 1,
      lanes: [
        {
          laneId: 'main',
          fileIndexes: [0],
          firstTimestampIso: '2026-01-01T00:00:00.000Z',
          lastTimestampIso: '2026-01-01T00:00:01.000Z',
          lineCount: 1,
        },
      ],
    })
    vi.mocked(getJsonlReader).mockReturnValue({ openTimeline: openMock } as any)

    const first = await openTimeline('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(first.ok).toBe(true)
    expect(openMock).toHaveBeenCalledTimes(1)

    const second = await openTimeline('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(second.ok).toBe(true)
    expect(openMock).toHaveBeenCalledTimes(1) // cache hit — no second dispatch.
    expect(second.data?.timelineId).toBe('tl-cached-1')

    // Reference unused binding to satisfy lint (filePath captured for future tests).
    void filePath
  })

  it('invalidates the cache when the source file mtime changes', async () => {
    const { agentWorkDir, filePath } = seedOneFile()
    let callCount = 0
    const openMock = vi.fn().mockImplementation(async () => {
      callCount += 1
      return {
        ok: true,
        timelineId: `tl-mt-${callCount}`,
        globalLineCount: 1,
        lanes: [
          {
            laneId: 'main',
            fileIndexes: [0],
            firstTimestampIso: '2026-01-01T00:00:00.000Z',
            lastTimestampIso: '2026-01-01T00:00:01.000Z',
            lineCount: 1,
          },
        ],
      }
    })
    vi.mocked(getJsonlReader).mockReturnValue({ openTimeline: openMock } as any)

    const first = await openTimeline('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(first.data?.timelineId).toBe('tl-mt-1')

    // Advance mtime by writing to the same file.
    // Use a real fs.utimes so the mtime is reliably different across
    // filesystems with coarse timestamp resolution.
    const future = new Date(Date.now() + 60_000)
    fs.utimesSync(filePath, future, future)

    const second = await openTimeline('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(second.data?.timelineId).toBe('tl-mt-2')
    expect(openMock).toHaveBeenCalledTimes(2)
  })

  it('returns 502 when the Rust reader throws', async () => {
    const { agentWorkDir } = seedOneFile()
    const openMock = vi.fn().mockRejectedValue(new Error('simulated rust failure'))
    vi.mocked(getJsonlReader).mockReturnValue({ openTimeline: openMock } as any)

    const res = await openTimeline('a1', {
      agentFetcher: () => ({ id: 'a1', workingDirectory: agentWorkDir }),
      homedirFn: () => homedir,
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(502)
  })
})

// ---------------------------------------------------------------------------
// dispatchers
// ---------------------------------------------------------------------------

describe('readTimelineRange / searchTimeline / contextAt', () => {
  beforeEach(() => {
    vi.mocked(getJsonlReader).mockReset()
    clearTimelineManifestCache()
  })

  it('readTimelineRange maps rows verbatim', async () => {
    const readMock = vi.fn().mockResolvedValue({
      ok: true,
      rows: [
        {
          sessionId: 'sid-1',
          laneId: 'main',
          fileIndex: 0,
          localLineIndex: 5,
          globalLineIndex: 5,
          raw: { foo: 'bar' },
        },
      ],
    })
    vi.mocked(getJsonlReader).mockReturnValue({
      readTimelineRange: readMock,
    } as any)

    const res = await readTimelineRange('tl-1', 0, 10)
    expect(res.ok).toBe(true)
    expect(res.data?.rows).toHaveLength(1)
    expect(res.data?.rows[0].raw).toEqual({ foo: 'bar' })
  })

  it('readTimelineRange maps timeline_not_found → 404', async () => {
    const readMock = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('no'), { code: 'timeline_not_found' }))
    vi.mocked(getJsonlReader).mockReturnValue({
      readTimelineRange: readMock,
    } as any)
    const res = await readTimelineRange('tl-missing', 0, 10)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
    expect(res.error).toBe('timeline_not_found')
  })

  it('searchTimeline maps matches verbatim', async () => {
    const searchMock = vi.fn().mockResolvedValue({
      ok: true,
      matches: [
        {
          globalLineIndex: 3,
          laneId: 'main',
          sessionId: 'sid-x',
          fileIndex: 0,
          localLineIndex: 3,
          byteOffset: 42,
          snippet: '…hit…',
        },
      ],
    })
    vi.mocked(getJsonlReader).mockReturnValue({
      searchTimeline: searchMock,
    } as any)
    const res = await searchTimeline('tl-1', 'hit', {
      kind: 'substring',
      caseInsensitive: true,
    })
    expect(res.ok).toBe(true)
    expect(res.data?.matches[0].snippet).toBe('…hit…')
    expect(searchMock).toHaveBeenCalledWith('tl-1', 'hit', {
      kind: 'substring',
      caseInsensitive: true,
    })
  })

  it('contextAt rejects a call with no anchor', async () => {
    const res = await contextAt('tl-1', {})
    expect(res.ok).toBe(false)
    expect(res.status).toBe(400)
    expect(res.error).toBe('anchor_required')
  })

  it('contextAt maps the cumulative/phaseHistory fields through', async () => {
    const cxMock = vi.fn().mockResolvedValue({
      ok: true,
      anchorGlobalLine: 7,
      cumulative: {
        systemPrompt: 10,
        systemTools: 0,
        mcpTools: 0,
        customAgents: 0,
        memory: 0,
        messages: 50,
        cacheRead: 5,
        total: 60,
        freeSpace: 199_940,
        modelContextLimit: 200_000,
        approximate: false,
        modelId: 'claude-sonnet-4-6',
      },
      exactAtCursor: {
        systemPrompt: 10,
        systemTools: 0,
        mcpTools: 0,
        customAgents: 0,
        memory: 0,
        messages: 50,
        cacheRead: 5,
        total: 60,
        freeSpace: 199_940,
        modelContextLimit: 200_000,
        approximate: false,
        modelId: 'claude-sonnet-4-6',
      },
      phaseHistory: [
        { phaseId: 0, pre: 0, peak: 60, post: null },
      ],
    })
    vi.mocked(getJsonlReader).mockReturnValue({ contextAt: cxMock } as any)
    const res = await contextAt('tl-1', { anchorUuid: 'uuid-abc' })
    expect(res.ok).toBe(true)
    expect(res.data?.anchorGlobalLine).toBe(7)
    expect(res.data?.phaseHistory).toHaveLength(1)
    expect(cxMock).toHaveBeenCalledWith('tl-1', { anchorUuid: 'uuid-abc' })
  })
})
