/**
 * Single authority for "may an agent use this directory as its working directory?"
 *
 * WHY THIS FILE EXISTS (TRDD-WLWHVMKT)
 * ------------------------------------
 * The `~/agents/`-only invariant used to be re-derived independently in FOUR
 * places — `lib/agent-runtime.ts::validateCwd`, `services/boot-restore-service.ts`,
 * `app/api/agents/browse-dir/route.ts`, and `ChangeFolder`'s G01b gate — plus a
 * fifth, `CreateAgent`'s G03 gates, which TRDD-57EBNB72 then widened for external
 * adoption. Widening one of five copies is how we ended up shipping a feature that
 * wrote the registry entry and then could never start a session: the outer gate said
 * yes, the runtime said no, and nothing reconciled them. One authority, consulted by
 * every enforcement point, is the fix.
 *
 * THE TWO QUESTIONS (they are NOT the same question)
 * --------------------------------------------------
 *  - `assertAdoptableWorkdir(dir)` — CREATION time. The agent does not exist yet, so
 *    there is nothing to check it against; only the path policy applies.
 *  - `assertAuthorizedAgentWorkdir(cwd, …)` — RUNTIME. The agent exists, so we can do
 *    better than a path shape: we verify the directory against the REGISTRY, i.e.
 *    against a workdir this system actually authorized for that agent.
 *
 * SECURITY POSTURE — read before touching this
 * --------------------------------------------
 * On a shared UID **none of this is a security boundary** and it never was: a
 * same-UID process can chdir and write anywhere the kernel allows, and
 * `agent-shell-guard.sh` only overrides `cd`/`pushd`, so it never stopped an
 * absolute-path write. `lib/agent-runtime.ts`'s original comment says exactly this.
 * What this module provides is an *authorization* check — the system agreeing with
 * itself about which directory it handed an agent — not containment. Real containment
 * is the controlled-execution-environment work (TRDD-a1019073) and the container
 * agents that supersede it.
 *
 * So this file deliberately does NOT do the easy thing (allow anything under $HOME).
 * External adoption is allowed ONLY for a directory the registry records as that
 * agent's own working directory — a directory that already passed the creation gates.
 * The ai-maestro install tree is blocked outright, because an agent whose workdir is
 * the server's own source tree is the recursion the owner explicitly called out:
 * it would rebuild and restart the very server managing it.
 */

import { homedir } from 'os'
import { resolve } from 'path'

import { loadAgents, getAgentByNameAnyHost } from '@/lib/agent-registry'
// The PURE path half lives in its own module so lib/agent-registry.ts — which this
// file imports — can enforce it at the single writer without an import cycle
// (TRDD-QMD7X3FB). There is exactly one copy of the forbidden-directory rules.
import {
  AGENTS_ROOT,
  checkWorkdirPathPolicy,
  isUnder,
  type WorkdirVerdict,
} from '@/lib/workdir-path-policy'

const HOME = homedir()

export { AGENTS_ROOT }
export type { WorkdirVerdict }

/**
 * CREATION-time gate. Use when the agent does not exist yet (CreateAgent G03,
 * ChangeFolder G01b, importAgent). Enforces the path policy only — there is no
 * registry entry to check against yet.
 *
 * `allowExternal` mirrors the `allowExternalFolder` request flag: without it, the
 * directory must be under `~/agents/` (the default for every agent that is not being
 * deliberately pointed at an existing project).
 */
export function checkAdoptableWorkdir(dir: string, allowExternal: boolean): WorkdirVerdict {
  const policy = checkWorkdirPathPolicy(dir)
  if (!policy.ok) return policy

  const resolved = resolve((dir as string).startsWith('~') ? (dir as string).replace(/^~/, HOME) : dir)

  if (!isUnder(resolved, AGENTS_ROOT) && !allowExternal) {
    return {
      ok: false,
      reason: `outside ${AGENTS_ROOT} and allowExternalFolder was not set (${resolved})`,
    }
  }
  return { ok: true }
}

/**
 * RUNTIME gate. Use wherever the system is about to ACT on an agent's workdir —
 * start a tmux session, restore it at boot, browse its tree.
 *
 * A cwd is authorized iff:
 *   - it is under `~/agents/` (the ordinary case), OR
 *   - it is (or is under) the working directory the REGISTRY records for that agent.
 *
 * We consult the registry rather than trusting a caller-supplied path, because a
 * caller-supplied "authorized workdir" would be self-authorizing and prove nothing.
 *
 * @param agentName when known (the tmux session name IS the agent name), the cwd must
 *   match THAT agent's registration — so agent A cannot start a session in agent B's
 *   adopted project. When omitted, any live agent's registered workdir is accepted.
 */
export function checkAuthorizedAgentWorkdir(cwd: string, agentName?: string): WorkdirVerdict {
  // An empty cwd used to be treated as legal here ("tmux inherits the server's
  // cwd"). That was a hole, and the worst-shaped one available: the server's cwd IS
  // the ai-maestro install tree — the single directory this policy most needs to keep
  // an agent out of (an agent there rebuilds and restarts the server managing it). So
  // `/` was refused while "" quietly granted something worse. checkWorkdirPathPolicy
  // now refuses an empty workdir outright (TRDD-QMD7X3FB).
  const policy = checkWorkdirPathPolicy(cwd)
  if (!policy.ok) return policy

  const resolved = resolve(cwd.startsWith('~') ? cwd.replace(/^~/, HOME) : cwd)

  // The ordinary case: an agent living under ~/agents/. No registry read needed.
  if (isUnder(resolved, AGENTS_ROOT)) return { ok: true }

  // External workdir — it must be one this system actually handed to an agent.
  let registered: string[] = []
  try {
    if (agentName) {
      const agent = getAgentByNameAnyHost(agentName)
      registered = agent?.workingDirectory ? [agent.workingDirectory] : []
    } else {
      registered = loadAgents()
        .filter((a) => !a.deletedAt && a.workingDirectory)
        .map((a) => a.workingDirectory as string)
    }
  } catch (err) {
    // A registry we cannot read is not an authorization. Fail closed.
    return {
      ok: false,
      reason: `agent registry unreadable, cannot authorize external workdir (${(err as Error).message})`,
    }
  }

  const authorized = registered.some((wd) => isUnder(resolved, resolve(wd)))
  if (!authorized) {
    return {
      ok: false,
      reason:
        `${resolved} is outside ${AGENTS_ROOT} and is not the registered working ` +
        `directory of ${agentName ? `agent "${agentName}"` : 'any live agent'}. ` +
        `External folders must be adopted at creation time (allowExternalFolder).`,
    }
  }
  return { ok: true }
}

/** Throwing form of {@link checkAuthorizedAgentWorkdir}. */
export function assertAuthorizedAgentWorkdir(cwd: string, agentName?: string): void {
  const verdict = checkAuthorizedAgentWorkdir(cwd, agentName)
  if (!verdict.ok) {
    throw new Error(`[agent-workdir-policy] Invalid cwd: ${verdict.reason}`)
  }
}
