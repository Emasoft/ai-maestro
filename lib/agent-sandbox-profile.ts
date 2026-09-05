/**
 * Per-agent macOS seatbelt (sandbox-exec) profile — TRDD-O0RHX7K6 / TRDD-0GX8FOCJ.
 *
 * Confines one agent so it cannot reach another agent, under the owner's three fixed
 * constraints: the shared tmux server stays, all agents keep one uid, no containers.
 *
 * VERIFIED 2026-08-26 (wikimem ATOM-QUX1-YP3Q): `sandbox-exec -f <profile> claude -p "…"`
 * completes a full boot + API call (exit 0) while that same profile denies the tmux socket,
 * a raw AF_UNIX connect to it, a LaunchAgent plist drop, ~/.zshrc, server.mjs,
 * registry.json, and another agent's private.pem. BOTH halves are the evidence: a profile
 * that permits everything passes the boot test, and one that denies everything passes the
 * deny test.
 *
 * THREE RULES THAT LOOK OPTIONAL AND ARE NOT — each was found by measurement, and each
 * silently PERMITS or silently BREAKS the agent if you get it wrong:
 *
 *  1. A UNIX-socket connect is governed by `network-outbound`, NOT `file-read*`, and
 *     seatbelt matches the RESOLVED path (/private/tmp, never /tmp). Get either wrong and
 *     the rule quietly allows. An earlier card concluded "sandboxing cannot rescue this"
 *     from exactly that pair of mistakes.
 *  2. `(deny signal)` alone BREAKS the agent's own child management. It must be paired with
 *     `(allow signal (target self))` and `(target children)`.
 *  3. ~/.claude/shell-snapshots must be READ-allowed and WRITE-denied — Claude Code's Bash
 *     tool sources a snapshot from there on the hot path.
 *
 * WHAT THIS DOES NOT DO: it cannot stop `sysctl(KERN_PROCARGS2)` reading another process's
 * argv. No seatbelt rule blocks it — blanket `(deny sysctl-read)` included, measured. That
 * is why credential-free identity (kernel peer credentials over a UDS) is REQUIRED and not
 * an alternative to this file. `/bin/ps` being setuid-blocked under seatbelt is concealment,
 * not protection; do not count it.
 *
 * AND IT IS A DENY-LIST, NOT A BOUNDARY. A container denies by construction; this permits by
 * construction and denies what someone enumerated. The enumeration grew by six entries in the
 * session that produced it. TRDD-6PIXX1AY owns keeping it honest: the positively-stated
 * boundary and the per-channel inventory live in `lib/agent-sandbox-channel-inventory.ts`,
 * checked non-vacuously by `tests/security/sandbox-channel-inventory.test.ts` — every deny
 * rule below must have an entry there, and the test suite reddens if it does not.
 */
import { homedir } from 'os'
import path from 'path'

/** Where generated profiles live. Under ~/.aimaestro, which the profile itself denies writes
 *  to — so an agent cannot rewrite its own sandbox before the next spawn. That
 *  self-protection is the reason for this location and must not be "tidied" elsewhere. */
export function sandboxProfileDir(): string {
  return path.join(homedir(), '.aimaestro', 'sandbox-profiles')
}

export interface AgentSandboxInput {
  /** The agent's UUID — used for its private key store and as the profile filename. */
  agentId: string
  /** Absolute path to the agent's working directory (its own, and only its own). */
  workingDirectory: string
  /** Claude Code project slug for this agent's transcripts, e.g. `-Users-me-agents-bot`. */
  projectSlug: string
  /** The shared tmux socket DIRECTORY, e.g. /tmp/tmux-501. Resolved before use. */
  tmuxSocketDir: string
  /**
   * Absolute path to the ai-maestro INSTALL tree — the server's own code.
   *
   * Passed in rather than derived, because guessing it wrong fails SILENTLY in the
   * dangerous direction: a rule aimed at a path the server does not live in denies nothing
   * and reads as protection. TRDD-K4BEKT3L measured 353 runtime-reachable first-party files
   * here, `lib/agent-registry.ts` — the identity-resolution code — among them.
   *
   * NOTE this is write-protection only, and it is NOT the safeguard K4BEKT3L asks for. It
   * stops a CONFINED agent; it does nothing about an unconfined one, and the flag defaults
   * off. Root-owning the tree is still required and is the owner's call.
   */
  installRoot: string
}

/**
 * TRDD-0GX8FOCJ — profile injection.
 *
 * Agent names and paths are user-supplied, and a value containing `"` or `)` would close the
 * string and append attacker-chosen policy to an S-expression the attacker is then sandboxed
 * by. So values are not interpolated: they are EMITTED through this function, which REFUSES
 * anything it cannot represent. Refusing is correct — a profile that cannot be built safely
 * must stop the spawn, never fall back to a weaker one.
 */
function sbString(value: string): string {
  if (value.includes('"') || value.includes('\\') || /[\x00-\x1F]/.test(value)) {
    throw new Error(
      `[agent-sandbox-profile] refusing to emit a profile: value contains a character that ` +
        `cannot be safely represented in a seatbelt string literal: ${JSON.stringify(value)}`,
    )
  }
  return `"${value}"`
}

/** macOS symlinks /tmp -> /private/tmp and /var -> /private/var, and seatbelt matches the
 *  RESOLVED path. A rule written against the unresolved form silently matches nothing. */
function resolveMacPath(p: string): string {
  if (p === '/tmp' || p.startsWith('/tmp/')) return `/private${p}`
  if (p === '/var' || p.startsWith('/var/')) return `/private${p}`
  return p
}

export function buildAgentSandboxProfile(input: AgentSandboxInput): string {
  const home = homedir()
  const S = sbString
  const tmuxDir = resolveMacPath(input.tmuxSocketDir)
  const workdir = resolveMacPath(input.workingDirectory)

  const keyStore = path.join(home, '.agent-messaging', 'agents')
  const ownKeys = path.join(keyStore, input.agentId)
  const projects = path.join(home, '.claude', 'projects')
  const ownProject = path.join(projects, input.projectSlug)

  return `;; GENERATED — do not edit. Source: lib/agent-sandbox-profile.ts (TRDD-O0RHX7K6).
;; Agent ${input.agentId}
(version 1)
(allow default)

;; -- borrowed hands: the shared tmux server. network-outbound, NOT file-read*, and the
;; -- RESOLVED path. This also blocks a raw AF_UNIX connect: the check is on connect(2),
;; -- so writing a custom client instead of using the tmux binary does not bypass it.
(deny network-outbound (subpath ${S(tmuxDir)}))

;; -- other panes' terminals: read steals another agent's input, write spoofs its output
(deny file-read* file-write* (regex #"^/dev/ttys"))

;; -- signals: self and own children only. Denying outright breaks the agent (rule 2 above).
(deny signal)
(allow signal (target self))
(allow signal (target children))

;; -- AID/AMP signing keys: own agent only. This is the root of impersonation — holding
;; -- another agent's private.pem impersonates it regardless of transport.
(deny  file-read* file-write* (subpath ${S(keyStore)}))
(allow file-read* file-write* (subpath ${S(ownKeys)}))

;; -- transcripts: own project only
(deny  file-read* file-write* (subpath ${S(projects)}))
(allow file-read* file-write* (subpath ${S(ownProject)}))

;; -- persistence: launchd runs these OUTSIDE the sandbox, so a drop here is an escape
(deny file-write* (subpath ${S(path.join(home, 'Library', 'LaunchAgents'))}))
(deny file-write* (subpath ${S(path.join(home, 'Library', 'LaunchDaemons'))}))

;; -- shell startup files execute in EVERY future shell, including other agents'.
;; -- shell-snapshots is READ-allowed by the deny above being write-only (rule 3).
(deny file-write* (literal ${S(path.join(home, '.zshrc'))}))
(deny file-write* (literal ${S(path.join(home, '.zprofile'))}))
(deny file-write* (subpath ${S(path.join(home, '.claude', 'shell-snapshots'))}))

;; -- shared Claude config: readable (plugins, settings), never writable. A hook written
;; -- into settings.json executes in every other agent's session.
(deny  file-write* (subpath ${S(path.join(home, '.claude'))}))
(allow file-write* (subpath ${S(ownProject)}))
(allow file-write* (subpath ${S(path.join(home, '.claude', 'statsig'))}))
(allow file-write* (subpath ${S(path.join(home, '.claude', 'todos'))}))

;; -- the guarantor: the server's own code and the identity map it resolves PIDs through.
;; -- ~/.aimaestro also holds this profile, so an agent cannot rewrite its own sandbox.
(deny file-write* (subpath ${S(path.join(home, '.aimaestro'))}))
(deny file-write* (subpath ${S(resolveMacPath(input.installRoot))}))

;; -- other agents' working directories: own workdir stays writable
(deny  file-write* (subpath ${S(path.join(home, 'agents'))}))
(allow file-read* file-write* (subpath ${S(workdir)}))
`
}
