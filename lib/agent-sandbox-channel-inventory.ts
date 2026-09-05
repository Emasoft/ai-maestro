/**
 * TRDD-6PIXX1AY — the sandbox profile's channel inventory.
 *
 * `lib/agent-sandbox-profile.ts` builds an `(allow default)` seatbelt profile with targeted
 * `(deny ...)` rules layered on top. That shape permits by construction and denies only what
 * someone enumerated — a living deny-list, not a boundary. This file IS the boundary, stated
 * positively and as an artifact `tests/security/sandbox-channel-inventory.test.ts` can check,
 * not as prose in a card:
 *
 *   An agent may reach exactly: its own working directory, its own AID/AMP key store, its
 *   own Claude Code project (transcripts/statsig/todos), the shared tmux server (as a
 *   client, never as a raw socket peer), the shared Claude config as READ-ONLY, and the
 *   network. Everything else enumerated below is denied.
 *
 * Every entry names the exact deny statement `buildAgentSandboxProfile` must emit for a given
 * input, so that removing or weakening the corresponding rule in the profile builder reddens
 * exactly that entry's own test — and so that a NEW `(deny ...)` rule added to the builder
 * without a matching entry here reddens the coverage test in the same suite (see the test
 * file's "every emitted deny rule has an owner" case). Add the entry FIRST when adding a new
 * denied surface; the coverage test exists to make skipping that step visible.
 */
import path from 'path'
import { homedir } from 'os'
import type { AgentSandboxInput } from './agent-sandbox-profile'

export interface SandboxChannelEntry {
  /** Stable id — used in test names. Never reused for a different channel once assigned. */
  id: string
  /** What this channel is and why it is denied. */
  description: string
  /**
   * Returns the exact literal deny statement (verbatim, not a loosened regex) that
   * `buildAgentSandboxProfile(input)` must emit for this channel to be closed. A literal
   * substring — rather than a pattern matching only the operation keyword — means a rule
   * that keeps the same shape but is quietly narrowed (e.g. `file-write*` dropped to leave
   * only `file-read*` denied) fails the check too, not just an outright deletion.
   */
  denyLine: (input: AgentSandboxInput) => string
}

export const SANDBOX_CHANNEL_INVENTORY: SandboxChannelEntry[] = [
  {
    id: 'tmux-socket',
    description:
      'the shared tmux server socket — outbound connect, including a raw AF_UNIX client ' +
      'that never runs the tmux binary (the check is on connect(2), not on argv[0])',
    denyLine: (i) => `(deny network-outbound (subpath "${resolveMacPath(i.tmuxSocketDir)}"))`,
  },
  {
    id: 'other-terminals',
    description:
      "other panes' /dev/ttys* — read steals another agent's input, write spoofs its output",
    denyLine: () => '(deny file-read* file-write* (regex #"^/dev/ttys"))',
  },
  {
    id: 'foreign-signals',
    description:
      'sending a signal to any process other than self or its own children — paired with an ' +
      'explicit allow for self/children so the rule does not also break child management',
    denyLine: () => '(deny signal)',
  },
  {
    id: 'other-agent-keys',
    description:
      "another agent's AID/AMP signing key store — holding it is unqualified impersonation, " +
      'independent of transport',
    denyLine: () => `(deny  file-read* file-write* (subpath "${keyStore()}"))`,
  },
  {
    id: 'other-agent-transcripts',
    description: "another agent's Claude Code project directory (conversation transcripts)",
    denyLine: () => `(deny  file-read* file-write* (subpath "${projectsDir()}"))`,
  },
  {
    id: 'launch-agents',
    description:
      'writing into ~/Library/LaunchAgents — launchd runs entries here OUTSIDE the sandbox, ' +
      'so a drop here is a persistence escape',
    denyLine: () => `(deny file-write* (subpath "${path.join(homedir(), 'Library', 'LaunchAgents')}"))`,
  },
  {
    id: 'launch-daemons',
    description: 'writing into ~/Library/LaunchDaemons — the root-level twin of the above',
    denyLine: () => `(deny file-write* (subpath "${path.join(homedir(), 'Library', 'LaunchDaemons')}"))`,
  },
  {
    id: 'zshrc',
    description: '~/.zshrc — executes in EVERY future shell, including other agents’ sessions',
    denyLine: () => `(deny file-write* (literal "${path.join(homedir(), '.zshrc')}"))`,
  },
  {
    id: 'zprofile',
    description: '~/.zprofile — same persistence-via-shell-startup channel as .zshrc',
    denyLine: () => `(deny file-write* (literal "${path.join(homedir(), '.zprofile')}"))`,
  },
  {
    id: 'shell-snapshots-write',
    description:
      '~/.claude/shell-snapshots WRITE — must stay read-allowed (the Bash tool sources a ' +
      'snapshot from there on the hot path) while remaining unwritable by the sandboxed agent',
    denyLine: () =>
      `(deny file-write* (subpath "${path.join(homedir(), '.claude', 'shell-snapshots')}"))`,
  },
  {
    id: 'shared-claude-config',
    description:
      '~/.claude itself — readable (plugins, settings) but not writable; a hook written into ' +
      "settings.json executes in every other agent's session",
    denyLine: () => `(deny  file-write* (subpath "${path.join(homedir(), '.claude')}"))`,
  },
  {
    id: 'aimaestro-state',
    description:
      '~/.aimaestro — the server state directory, which also holds this very profile, so an ' +
      'agent must not be able to rewrite its own sandbox before the next spawn',
    denyLine: () => `(deny file-write* (subpath "${path.join(homedir(), '.aimaestro')}"))`,
  },
  {
    id: 'install-root',
    description:
      "the ai-maestro server's own install tree — the identity-resolution code an unconfined " +
      'process trusts',
    denyLine: (i) => `(deny file-write* (subpath "${resolveMacPath(i.installRoot)}"))`,
  },
  {
    id: 'other-agent-workdirs',
    description: "~/agents — every OTHER agent's working directory (its own stays writable)",
    denyLine: () => `(deny  file-write* (subpath "${path.join(homedir(), 'agents')}"))`,
  },
]

// -- helpers mirroring the (unexported) path construction in agent-sandbox-profile.ts. Kept
// -- tiny and duplicated rather than exported from there, so this file states the boundary
// -- from the reader's side rather than importing the implementation's own idea of it.

function keyStore(): string {
  return path.join(homedir(), '.agent-messaging', 'agents')
}

function projectsDir(): string {
  return path.join(homedir(), '.claude', 'projects')
}

function resolveMacPath(p: string): string {
  if (p === '/tmp' || p.startsWith('/tmp/')) return `/private${p}`
  if (p === '/var' || p.startsWith('/var/')) return `/private${p}`
  return p
}
