// Daemon-response path constants — a LEAF module, deliberately.
//
// These lived in `lib/janitor-daemon-publisher.ts`, but the publisher imports
// `services/agent-hibernation-service`, and the service now needs these same constants to READ the
// transition archive (the derived `since` field, TRDD-X2JGDOSM / ai-maestro#113). Importing them
// back from the publisher would close a service → publisher → service cycle; a partially-evaluated
// module in that cycle fails only at runtime, and only sometimes. So the constants moved here and
// the publisher re-exports them — one source of truth, zero cycle.
//
// The on-disk contract these names compose is cross-repo (`ai-maestro-janitor#194`/`#196`,
// `ai-maestro-plugin#55`): consumers read `<projectRoot>/.janitor/daemon_responses/hibernation.json`
// by literal path. Renaming any constant's VALUE is a breaking change to repos that never see this
// file.

import * as path from 'path'

/** Where a janitor looks, relative to its own project root. Inside the project, never /tmp. */
export const DAEMON_RESPONSES_DIR = path.join('.janitor', 'daemon_responses')

/** The response filename for this query. One file per query kind, so a consumer never parses a mux. */
export const HIBERNATION_RESPONSE_FILE = 'hibernation.json'

/** Timestamped copies live beside the live file, never replacing it. */
export const RESPONSE_ARCHIVE_DIR = 'archive'

/** The transition archive for one project root — where the daemon deposits a timestamped copy of
 *  the hibernation response whenever its `data` actually changed (one file per REAL transition). */
export function hibernationArchiveDir(projectRoot: string): string {
  return path.join(projectRoot, DAEMON_RESPONSES_DIR, RESPONSE_ARCHIVE_DIR)
}
