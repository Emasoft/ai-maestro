// The server-published plugin-reload signal — the cross-process contract the JANITOR named
// (2026-08-20, their hub session, follow-on to TRDD-JBFM8XR0's parity note):
//
//     ~/.aimaestro/state/plugins-updated.json
//     { "updated_at_epoch": <int seconds>, "updated": ["<plugin>@<marketplace>", ...],
//       "by": "fleet-plugins-update", "count": <int> }
//
// WE publish (atomically, temp+rename), THEY consume: the janitor's dispatcher compares
// `updated_at_epoch` against a last-consumed stamp in ITS OWN state dir and surfaces
// `[janitor-reload]` when newer. The boundary holds in both directions — they never modify this
// file, we never write into their data dir (the reason the lane could not set their
// reload-needed.flag in the first place). Overwrite-in-place on every NON-EMPTY sweep; an empty
// sweep does not touch the file (their semantics: only a newer stamp means anything).
//
// Kept OUT of lib/fleet-plugins-update.ts so that module keeps its provable property — zero fs
// write primitives; its mutation channels are exactly the CLI subprocess and THIS helper, whose
// one target lives under ~/.aimaestro (our own state root), outside every plugin cache and every
// scanned tree (the KCRMSNL7 requirement-2 geometry).

import fs from 'node:fs'
import path from 'node:path'
import { statePath } from '@/lib/ecosystem-constants'

export function pluginsUpdatedSignalPath(): string {
  return statePath('state', 'plugins-updated.json')
}

/** Publish one non-empty sweep's result. Best-effort, never throws — a lost signal degrades to
 *  the pre-contract behavior (sessions notice on their own reload cadence). No-op on []. */
export function writePluginsUpdatedSignal(
  updated: readonly string[],
  nowMs: number = Date.now(),
  dest: string = pluginsUpdatedSignalPath(),
): void {
  if (updated.length === 0) return
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const tmp = `${dest}.tmp.${process.pid}`
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        updated_at_epoch: Math.floor(nowMs / 1000), // SECONDS — the consumer compares epochs
        updated: [...updated],
        by: 'fleet-plugins-update',
        count: updated.length,
      }),
      'utf8',
    )
    fs.renameSync(tmp, dest) // atomic on POSIX — the consumer never sees a half-written file
  } catch {
    // best-effort by design (see the doc comment)
  }
}
