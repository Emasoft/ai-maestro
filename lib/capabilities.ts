/**
 * The server's public CAPABILITY SET — `{ verb: contract-revision }` (TRDD-TLSE2FEF, ai-maestro#88).
 *
 * WHY THIS EXISTS. Auth runs before routing, so an unauthenticated request to a real route and to a
 * nonexistent one both answer 401. No fleet member could ask "is verb X live on this host?" without
 * a credential, so every consumer that wanted to gate a skill on a deployed capability had to ask
 * the ai-maestro session — a bottleneck on its own restart cadence. `GET /api/capabilities` answers
 * that question with no credential and discloses ONLY what is listed here.
 *
 * THE SHAPE, and the two things it deliberately is NOT:
 *  - a PER-VERB integer revision, never a global version string. A hand-bumped semver says nothing
 *    about whether one verb's contract moved (the CLI's `--version` had exactly this defect,
 *    TRDD-JY6IDFFC / #116). Bump ONE integer when THAT verb's contract changes — an accepted enum
 *    widened (#114 `list --status`), a field added, a behaviour tightened — and nothing else.
 *  - the RUNNING PROCESS's set, never a git ref or an installed-artifact read: this map is compiled
 *    into the bundle the process runs, so what it reports is what it serves. A tree ahead of any
 *    readable ref reports the tree.
 *
 * The keys are the agent-CLI verbs (`scripts/aimaestro-agent.sh --capabilities` prints them; a
 * unit test pins that every key here is one of them). Revisions start at 1. No host, environment,
 * build or semantic version is exposed here — a name plus an integer is the whole disclosure.
 */
export const CAPABILITIES: Readonly<Record<string, number>> = Object.freeze({
  list: 1,
  show: 1,
  config: 1,
  resolve: 1,
  create: 1,
  delete: 1,
  update: 1,
  rename: 1,
  session: 1,
  hibernate: 1,
  wake: 1,
  restart: 1,
  skill: 1,
  plugin: 1,
  export: 1,
  import: 1,
  presence: 1,
  probe: 1,
  hibernation: 1,
  subconscious: 1,
})

/** The response body of `GET /api/capabilities` — one shape for both server modes. */
export function capabilitiesResponse(): { capabilities: Readonly<Record<string, number>> } {
  return { capabilities: CAPABILITIES }
}
