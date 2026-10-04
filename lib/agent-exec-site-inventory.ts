/**
 * TRDD-NB70FKKT — the exec-from-agent-writable-tree inventory, as an artifact.
 *
 * The card found the general form: CONFINEMENT IS DEFEATED BY ANYTHING UNCONFINED THAT
 * CONSUMES ATTACKER-WRITABLE INPUT — a script, a config that names a command, an env var
 * that selects a binary. This file is the census the card asks box 1 for, stated as data a
 * test can check (same pattern as lib/agent-sandbox-channel-inventory.ts): every site in
 * THIS repo where an unconfined process executes something from a path the agent uid can
 * write, plus the two fleet classes that live in the plugin caches.
 *
 * THE SANDBOXED COLUMN IS DELIBERATELY `false` FOR EVERY ENTRY, TYPED AS THE LITERAL —
 * no process on this machine runs confined today (the TRDD-O0RHX7K6 profile is built and
 * deliberately unwired), so `false` everywhere is measured, not assumed. The day the
 * profile is wired into the spawn path, every entry must be RE-ANSWERED rather than
 * inherited — the literal type makes flipping it a visible code change.
 *
 * THE GATE (box 4): O0RHX7K6 does not ship its profile as a claimed boundary while any
 * entry here is still `open`. `execSiteShipGate` is the executable form; the test drives
 * both branches synthetically and reads the real spawn path for the wiring markers.
 */
export type ExecSiteStatus = /** fixed or verified before exec in THIS repo */ "remediated" | /** deliberately kept, documented here with its ceiling */ "accepted-hole" | /** remedy stated, owner named, not yet landed */ "open"

export interface ExecSiteEntry {
  /** Stable id — used in test names and in the ship-gate failure text. Never reused. */
  id: string
  /** Card class 1-5 (Remedies table in TRDD-NB70FKKT): 1 env-var CLI, 2 plugin-cache
   *  self-component, 3 pre-realpath pluginRoot, 4 repo-tree exec, 5 generic PATH. */
  execClass: 1 | 2 | 3 | 4 | 5
  /** What is executed, from where, and by which process. */
  description: string
  /** The process that executes it — box 1's executing-process column. */
  executingProcess: string
  /** Whether the executing process runs confined. Typed literal `false`: re-answer the
   *  day the O0RHX7K6 profile is wired (see module doc). */
  sandboxed: false
  status: ExecSiteStatus
  /** Where the remedy lives — a landed change, an accepted-ceiling rationale, or the
   *  owning card (TRDD-K4BEKT3L owns relocation; the janitor owns its own tree). */
  remedy: string
}

export const EXEC_SITE_INVENTORY: ExecSiteEntry[] = [
  {
    id: "agent-cli-script",
    execClass: 4,
    description:
      "scripts/aimaestro-agent.sh — the founding seed: world-executable, agent-uid-owned, " +
      "in the agent-writable repo tree. Nothing in this repo executes it; the executors are " +
      "external (the janitor harness: plugin_manage.py:194, terminal_trigger, harness_backend).",
    executingProcess: "external — janitor harness CLI (unconfined)",
    sandboxed: false,
    status: "open",
    remedy: "TRDD-K4BEKT3L — root-own the repo tree so the agent uid cannot write it.",
  },
  {
    id: "jsonl-reader-binary",
    execClass: 4,
    description:
      "lib/jsonl-reader.ts resolveBinaryPath() spawns scripts/aim-jsonl-reader from the repo " +
      "tree. The env-var override (AIM_JSONL_READER_PATH RCE) was already removed (TRDD-CC9PY337).",
    executingProcess: "the ai-maestro server",
    sandboxed: false,
    status: "open",
    remedy: "TRDD-K4BEKT3L relocation, or digest-verify the binary at spawn (build script already writes the fixed path).",
  },
  {
    id: "plugin-builder-build-script",
    execClass: 4,
    description:
      "services/plugin-builder-service.ts copies build-plugin.sh out of the marketplaces cache " +
      "(:623-625) and execFile's the copy in a same-uid tmpdir (:938). The cache is the " +
      "attacker-influenced input; the copy inherits it.",
    executingProcess: "the ai-maestro server",
    sandboxed: false,
    status: "open",
    remedy: "TRDD-K4BEKT3L relocation, or digest-verify the copy against the marketplace source before exec.",
  },
  {
    id: "keychain-probe-script",
    execClass: 4,
    description:
      "lib/agent-keychain-probe.ts writes ~/.aimaestro/agent-keychain-probe.sh; every agent " +
      "pane executes it via `sh \"<path>\"` (preflightPaneKeychain) and so does the fleet watchdog.",
    executingProcess: "agent panes (file written by the server)",
    sandboxed: false,
    status: "remediated",
    remedy:
      "This card (A4): the installer digest-verifies the file on EVERY call (sha256 of the " +
      "expected body) and the module-level `installed` short-circuit is gone, so a rewrite " +
      "after install is detected and repaired at the next launch. Remaining ceiling, named " +
      "honestly: the TOCTOU window between ensure() and the pane's `sh` is not closable " +
      "server-side — closing it means the pane itself verifies, a different design.",
  },
  {
    id: "mcp-discovery-pluginroot",
    execClass: 3,
    description:
      "app/api/settings/mcp-discover/route.ts and app/api/settings/element-content/route.ts " +
      "derived pluginRoot from the PRE-realpath path and fed it to ${CLAUDE_PLUGIN_ROOT} " +
      "substitution AND the child env — a symlinked config walked the containment gate.",
    executingProcess: "the ai-maestro server",
    sandboxed: false,
    status: "remediated",
    remedy: "Commit 070249691 — both routes derive pluginRoot from realResolved; pinned by the inventory test.",
  },
  {
    id: "mcp-discovery-script-source",
    execClass: 4,
    description:
      "scripts_dev/mcp_discovery.py is executed via `uv run` by both discovery routes. It lives " +
      "in a GITIGNORED tree (A5) — an exec'd script no review or CI gate ever sees.",
    executingProcess: "the ai-maestro server",
    sandboxed: false,
    status: "open",
    remedy: "Relocate into the reviewed tree or digest-verify; independent of the class-3 route fix above.",
  },
  {
    id: "external-handoff-clear",
    execClass: 2,
    description:
      "lib/external-compaction.ts resolveExternalClearScript() picks the newest cached " +
      "external_handoff_clear.py from the janitor plugin cache and execFile's it (A3).",
    executingProcess: "the ai-maestro server",
    sandboxed: false,
    status: "open",
    remedy:
      "TRDD-K4BEKT3L (cache not agent-writable) or digest-verify. Class already subsumed per the " +
      "card: an agent that can write the cache owns the fleet before any call site runs.",
  },
  {
    id: "dispatcher-stub",
    execClass: 2,
    description:
      "lib/cold-cache-clear.ts spawnStub() runs the janitor dispatcher-stub.py from the plugin " +
      "data dir via `uv run`, per heartbeat beat. Its verified walk is FAIL-OPEN BY DESIGN — " +
      "deleting the manifest suffices to pass it.",
    executingProcess: "the ai-maestro server",
    sandboxed: false,
    status: "accepted-hole",
    remedy:
      "Deliberate (card ruling): the stub is an AVAILABILITY mechanism, not a confinement " +
      "boundary — a bricked heartbeat needs a human, which is strictly worse in the single-uid " +
      "world. It must never be cited as the pattern for a hard-fail exec gate.",
  },
  {
    id: "fleet-env-var-cli",
    execClass: 1,
    description:
      "Env-var-selected CLIs in the plugin caches: $MEMGREP_BIN (5 sites in 4 modules, cached " +
      "3.3.26; the every-edit hook and the heartbeat detector reach it unattended), $AIMAESTRO_CLI " +
      "+ 5 siblings in the COS (every default a bare NAME → PATH decides), " +
      "$CLAUDE_PLUGIN_OPTION_HEARTBEAT_COST_COMMAND, $..._HANDOFF_VERIFY_CONTEXT_COMMAND, and the " +
      "default-ON agentlenspro probe (shlex.split of a config command).",
    executingProcess: "janitor daemon (every beat), hooks (every prompt/edit), COS plugin — all external",
    sandboxed: false,
    status: "open",
    remedy:
      "Rank 1 of the card. Resolve to an absolute path under a non-agent-writable root and verify " +
      "before exec; owned by the janitor's own cards (their TRDD-KHM8XOYN tree), linked here " +
      "because they defeat the same fleet boundary.",
  },
  {
    id: "fleet-generic-path-lookup",
    execClass: 5,
    description:
      "~45 shutil.which sites for gh/uv/git/jq/npx/claude (11 in the human-run publish.py) — " +
      "identical for every program on the machine.",
    executingProcess: "various",
    sandboxed: false,
    status: "accepted-hole",
    remedy:
      "Deliberately accepted (card ruling): only relevant if the sandbox constrains PATH itself; " +
      "padding a security list with this class is how the specific entries get discounted. " +
      "daemon_path.py's explicit path= is the in-tree example of the constrained way.",
  },
]

/**
 * The wiring markers for the O0RHX7K6 spawn path (lib/agent-runtime.ts). Any of these
 * appearing in that file means the sandbox profile has left the "built, deliberately
 * unwired" state — the day this flips, every inventory entry's sandboxed column must be
 * re-answered and the ship gate starts enforcing.
 */
export const SANDBOX_WIRING_MARKERS = [
  "agent-sandbox-profile",
  "buildAgentSandboxProfile",
  "sandbox-exec",
] as const

/** True when a source text shows the sandbox profile is wired into the spawn path. */
export function sandboxProfileWiredIn(source: string): boolean {
  return SANDBOX_WIRING_MARKERS.some((m) => source.includes(m))
}

/**
 * TRDD-NB70FKKT box 4, executable: the profile must not ship as a claimed boundary while
 * any exec-from-writable-tree entry is still unresolved (neither remediated nor documented
 * as an accepted hole). Returns null when shipping is permitted, else the failure naming
 * every blocking entry. Pure — the test drives both branches synthetically and wires the
 * real spawn-path source through sandboxProfileWiredIn.
 */
export function execSiteShipGate(sandboxProfileWired: boolean): string | null {
  if (!sandboxProfileWired) return null
  const blockers = EXEC_SITE_INVENTORY.filter(
    (e) => e.status !== "remediated" && e.status !== "accepted-hole",
  )
  if (blockers.length === 0) return null
  return (
    `[exec-site gate] the agent sandbox profile is wired into the spawn path while ` +
    `${blockers.length} exec-from-agent-writable-tree site(s) remain unresolved: ` +
    `${blockers.map((b) => b.id).join(", ")}. Remediate each, or document it as an accepted ` +
    `hole with its owning card, BEFORE the profile can ship as a boundary (TRDD-NB70FKKT box 4).`
  )
}
