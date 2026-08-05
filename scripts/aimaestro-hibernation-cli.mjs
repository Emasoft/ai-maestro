#!/usr/bin/env node
/**
 * aimaestro-hibernation-cli.mjs — the node entrypoint behind scripts/aimaestro-hibernation.sh
 * (TRDD-14HI8ZPR, USER directive 2026-08-05).
 *
 * ANSWERS ONE QUESTION: for every agent in the ai-maestro harness, is it deliberately asleep, or
 * broken? Nothing in the registry answers that — `Agent['status']` is `active | offline | deleted`,
 * so a hibernated agent, a crashed one and one never woken all read `offline`. The derivation lives
 * in `lib/agent-hibernation.ts` and is shared with the server's fleet-liveness watchdog, so this CLI
 * and the running server can never disagree about what "hibernated" means.
 *
 * WHY A CLI AND NOT AN ENDPOINT. The janitor's daemon holds no `$AID_AUTH`, and
 * `aimaestro-agent.sh list` answers HTTP 401 to any caller without one (verified live 2026-07-17;
 * see `harness_backend.instance_is_server_owned`, which falls back to "anything under ~/agents/ is
 * server-owned" precisely because the authenticated list is unreachable). janitor#100 owes an
 * auth-free canonical probe; this is it. It is also read-only and reads no server state beyond the
 * two files the server itself writes, so it answers correctly whether or not the server is up.
 *
 * READ-ONLY BY CONSTRUCTION: it opens the registry and the persistence record for reading, runs one
 * `tmux list-sessions`, and writes nothing anywhere. If you add a code path here that writes, you
 * have changed what this tool is — a probe a guardian runs on a cadence must never mutate the thing
 * it observes.
 *
 * Usage:
 *   aimaestro-hibernation.sh [--json|--tsv] [--agent <id-or-name>]
 *
 * EXIT CODES — grep's trichotomy, and `1` is deliberately NOT used:
 *   0 = the query was answered (whatever the answer was)
 *   2 = COULD NOT RUN (registry unreadable, tmux missing, bad arguments)
 * A caller must never be able to read "I could not look" as "I looked and nothing was wrong". That
 * is why there is no "1 = found something" code: every state this reports, including `crashed`, is
 * a normal answer to a normal question, and overloading 1 would make `if probe; then` silently mean
 * something different depending on the fleet's health.
 */
import process from 'process'
import { execFileSync } from 'child_process'

const { buildHibernationRoster } = await import('../lib/agent-hibernation.ts')
const { listAgents } = await import('../lib/agent-registry.ts')
const { loadPersistedSessions } = await import('../lib/session-persistence.ts')
const { computeSessionName } = await import('../types/agent.ts')

/** Print to stderr and exit 2 — "could not run", never conflated with an answer. */
function cannotRun(msg) {
  process.stderr.write(`aimaestro-hibernation: ${msg}\n`)
  process.exit(2)
}

/**
 * Every live tmux session name, in ONE subprocess.
 *
 * Deliberately not `runtime.sessionExists` per agent: that spawns one `tmux has-session` per agent,
 * so a roster over N agents pays N process spawns to answer a question one call already answers.
 *
 * A tmux server that is not running exits non-zero with "no server running on ..." — that is NOT a
 * failure to run, it is the legitimate answer "zero sessions exist", and it is the normal state of a
 * host whose agents are all hibernated. Conflating it with an error would make the tool exit 2 in
 * exactly the case it is most often asked about.
 */
function liveTmuxSessions() {
  try {
    const out = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))
  } catch (err) {
    const stderr = String(err?.stderr ?? '')
    if (/no server running|no sessions/i.test(stderr)) return new Set()
    if (err?.code === 'ENOENT') cannotRun('tmux is not installed or not on PATH')
    cannotRun(`tmux list-sessions failed: ${stderr.trim() || err?.message || err}`)
  }
}

function parseArgs(argv) {
  const opts = { format: 'json', agent: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--json') opts.format = 'json'
    else if (a === '--tsv') opts.format = 'tsv'
    else if (a === '--agent') {
      opts.agent = argv[i + 1]
      i += 1
      if (!opts.agent) cannotRun('--agent needs a value (agent id or name)')
    } else if (a === '--help' || a === '-h') opts.help = true
    else cannotRun(`unknown argument: ${a}`)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))

if (opts.help) {
  process.stdout.write(
    'usage: aimaestro-hibernation.sh [--json|--tsv] [--agent <id-or-name>]\n' +
      '  states: running | hibernated | crashed | never_woken\n' +
      '  exit:   0 = answered, 2 = COULD NOT RUN (1 is never used)\n',
  )
  process.exit(0)
}

let summaries
try {
  summaries = listAgents(false) // live agents only — a deleted agent is not part of the harness
} catch (err) {
  cannotRun(`cannot read the agent registry: ${err?.message || err}`)
}

let persisted
try {
  persisted = loadPersistedSessions()
} catch (err) {
  cannotRun(`cannot read the session-persistence record: ${err?.message || err}`)
}

const tmux = liveTmuxSessions()

const roster = buildHibernationRoster({
  agents: summaries.map((s) => {
    const name = s.name || 'unknown'
    return {
      id: s.id,
      name: s.name,
      sessionName: computeSessionName(name, 0),
      // "has the registry EVER recorded a session" — NOT getAgentSessionStatus().hasSession, which
      // is true for any named agent and so could never surface `never_woken`. See the field's
      // docstring in lib/agent-hibernation.ts.
      hasSession: (s.sessions?.length ?? 0) > 0,
    }
  }),
  persisted,
  liveTmuxSessions: tmux,
})

// A single-agent query FILTERS the roster rather than building a different one, so one agent and the
// whole fleet can never be answered by two different code paths. The orphan section is fleet-level
// and is dropped for a single-agent query — it is not a fact about any one agent.
if (opts.agent) {
  const needle = opts.agent
  const hit = roster.agents.find((a) => a.agentId === needle || a.name === needle)
  if (!hit) cannotRun(`no live agent matches "${needle}" (by id or name)`)
  if (opts.format === 'tsv') process.stdout.write(`${hit.agentId}\t${hit.name ?? ''}\t${hit.state}\t${hit.reason}\n`)
  else process.stdout.write(`${JSON.stringify(hit, null, 2)}\n`)
  process.exit(0)
}

if (opts.format === 'tsv') {
  // TAB-separated so `cut -f3` is exact even when a name or reason contains spaces.
  for (const a of roster.agents) {
    process.stdout.write(`${a.agentId}\t${a.name ?? ''}\t${a.state}\t${a.reason}\n`)
  }
  for (const o of roster.orphanedPersistedSessions) {
    process.stdout.write(`${o.agentId ?? ''}\t${o.name ?? ''}\torphaned\t${o.reason} (session ${o.sessionId})\n`)
  }
} else {
  process.stdout.write(`${JSON.stringify(roster, null, 2)}\n`)
}
process.exit(0)
