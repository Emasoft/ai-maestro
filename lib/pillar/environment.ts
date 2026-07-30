/**
 * Which environment is a pillar CLI running in — and therefore which verbs exist.
 *
 * The USER's requirement (2026-07-30) is that the TOOL detects this itself: one
 * `trddgrep`, which works on any `design/` corpus anywhere, and which additionally
 * offers the ai-maestro-only verbs when it happens to be standing in an agent's
 * working directory. So this module answers exactly one question, and the CLI decides
 * what to do with the answer:
 *
 *   standalone — a plain project (the janitor's repo, any clone, this repo). The WHOLE
 *                3-pillar surface is available: search, lint, validate, graph, board,
 *                doctor, fix, index. Corpus-local; no server, no network. "The 3-pillar
 *                system must work in any case" means standalone is never degraded.
 *   agent      — an ai-maestro agent's registered workdir. Adds the verbs that are
 *                IMPOSSIBLE without a live server and an AID: the governance writes
 *                (approve/refuse/promote/archive through the script layer) and the
 *                cross-scope / cross-project boards.
 *
 * ── Two constraints shaped this file, and both are traps a "simpler" version falls into.
 *
 * 1. DETECTION MUST NOT WRITE. The natural detector is `loadAgents()`, and it is
 *    unusable here twice over: it calls `ensureAgentsDir()` BEFORE its own
 *    `existsSync` guard (so merely asking the question MKDIRs `~/.aimaestro/agents/`
 *    on a machine with no ai-maestro), and it carries a `claudeArgs → programArgs`
 *    MIGRATION that SAVES the registry. A read-only query tool that plants ai-maestro
 *    state in a stranger's project — or rewrites the fleet registry — on every
 *    invocation is the "observer that creates what it measures" bug. Hence the
 *    `existsSync` gate first, and a minimal read-only parse instead of the loader.
 *
 * 2. `lib/workdir-path-policy.ts` CANNOT be reused from a global CLI, however much it
 *    looks like the right thing. Its `INSTALL_ROOT` is `resolve(process.cwd())` fixed
 *    at MODULE LOAD, which is true in the server (whose cwd IS the install tree) and
 *    inverted here: an installed `trddgrep` runs with the CALLER's project as cwd, so
 *    `checkWorkdirPathPolicy` would report every caller's own directory as "inside the
 *    ai-maestro installation" — including an agent's own workdir, i.e. exactly the case
 *    this file exists to recognise. Do not "restore the shared policy call" without
 *    first making INSTALL_ROOT injectable.
 *
 * What replaces it is deliberately NOT a copy of that policy: identification is a
 * different question from authorization. `checkAuthorizedAgentWorkdir` answers "may an
 * agent use this directory?" and says yes to ANYTHING under `~/agents/` without reading
 * the registry — right for its purpose, wrong for ours, because `~/agents/role-plugins/`
 * and `~/agents/custom-plugins/` are plugin-SOURCE containers, not agents. We ask the
 * registry which agent (if any) actually lives here.
 */
import fs from 'fs'
import path from 'path'

import { statePath } from '@/lib/ecosystem-constants'

export type PillarEnvironment =
  | { mode: 'standalone'; reason: string }
  | { mode: 'agent'; agentName: string; workdir: string; reason: string }

/** The one row shape this module reads. Anything else in the registry is none of its business. */
interface RegistryRowLike {
  name?: unknown
  workingDirectory?: unknown
  deletedAt?: unknown
}

/** `child` is `parent` or sits beneath it. Separator-aware, so `/a/bc` is not under `/a/b`. */
function isUnder(child: string, parent: string): boolean {
  const c = path.resolve(child)
  const p = path.resolve(parent)
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep)
}

/**
 * Rows that name a directory no agent can actually live in.
 *
 * This is a narrow sanity filter on a DATA row, not a second copy of the workdir
 * policy. It exists because the registry demonstrably carries drift: CLAUDE.md records
 * a legacy `default` agent whose `workingDirectory` is `"/"`, and `isUnder(anything,
 * "/")` is true — so without this filter that ONE stale row would make every directory
 * on the machine report `agent` mode, which is the loudest possible misdetection.
 */
function isPathologicalWorkdir(resolved: string): boolean {
  return resolved === path.parse(resolved).root || resolved === path.resolve(process.env.HOME ?? '~')
}

/**
 * Resolve the environment for `cwd`. Never throws, never writes, and states its reason
 * either way — a mode with no reason is unauditable, and this decides which verbs a
 * caller is offered.
 */
export function resolvePillarEnvironment(cwd: string = process.cwd()): PillarEnvironment {
  const registryFile = statePath('agents', 'registry.json')

  // A pure read, and the gate that makes everything below side-effect-free: if the FILE
  // exists then its directory does, so nothing downstream can create anything. Absent is
  // not a heuristic answer — no registry means no agents, so this cannot be one's workdir.
  if (!fs.existsSync(registryFile)) {
    return {
      mode: 'standalone',
      reason: `no ai-maestro agent registry on this host (${registryFile})`,
    }
  }

  let rows: RegistryRowLike[]
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(registryFile, 'utf-8'))
    if (!Array.isArray(parsed)) {
      return { mode: 'standalone', reason: `agent registry is not an array (${registryFile})` }
    }
    rows = parsed as RegistryRowLike[]
  } catch (err) {
    // An unreadable registry is not an agent environment. Degrade to the full
    // corpus-local surface rather than refusing to run: the pillars do not need it.
    return {
      mode: 'standalone',
      reason: `agent registry unreadable, treating as a plain project (${(err as Error).message})`,
    }
  }

  const resolvedCwd = path.resolve(cwd)
  const candidates = rows
    .filter((r) => !r.deletedAt && typeof r.workingDirectory === 'string' && r.workingDirectory)
    .map((r) => ({ name: String(r.name ?? '(unnamed)'), workdir: path.resolve(r.workingDirectory as string) }))
    .filter((r) => !isPathologicalWorkdir(r.workdir))
    .filter((r) => isUnder(resolvedCwd, r.workdir))
    // MOST SPECIFIC wins. Agent workdirs can nest (an adopted monorepo and a package
    // inside it), and the deeper registration is the one whose agent is standing here.
    .sort((a, b) => b.workdir.length - a.workdir.length)

  const match = candidates[0]
  if (!match) {
    return {
      mode: 'standalone',
      reason: `${resolvedCwd} is not the registered working directory of any live agent`,
    }
  }

  return {
    mode: 'agent',
    agentName: match.name,
    workdir: match.workdir,
    reason: `registered working directory of agent "${match.name}" (${match.workdir})`,
  }
}
