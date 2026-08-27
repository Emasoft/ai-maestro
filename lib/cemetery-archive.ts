/**
 * TRDD-3Q4G9ZK6 — the cemetery archive filename grammar, in ONE place.
 *
 * Two verbs need the same answer. `GET /api/agents/cemetery` parses the agent name out of
 * each filename to list archives; `DELETE` now needs it to find the registry TOMBSTONE an
 * archive belongs to, so the purge can complete the deletion it is the last step of.
 *
 * A second copy of a filename grammar is how a listing and a deletion come to disagree
 * about which agent a file is for — and here that disagreement lands on a destructive
 * path. So it is a leaf module both import, not a regex written twice.
 *
 * A route file cannot host it: Next.js constrains a route module's exports to the HTTP
 * verbs and a fixed config set, and exporting anything else is a build-time type error.
 */

/** `<name>-export-<ISO-with-hyphens>.zip` — a SOFT-delete archive, revivable. */
const ZIP_RE = /^(.+?)-export-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.zip$/
/** `<name>-tombstone-<ts>.json` — a HARD-delete audit record, NOT revivable. */
const TOMBSTONE_RE = /^(.+?)-tombstone-(.+)\.json$/

/** The agent NAME an archive filename belongs to, or null when it does not parse. */
export function agentNameFromArchive(filename: string): string | null {
  const zip = filename.match(ZIP_RE)
  if (zip) return zip[1]
  const tomb = filename.match(TOMBSTONE_RE)
  if (tomb) return tomb[1]
  return null
}
