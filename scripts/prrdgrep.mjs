#!/usr/bin/env node
/**
 * prrdgrep — query and EDIT the PRRD corpus (`design/requirements/PRRD.md`).
 *
 * NAMED BY LAW (USER, 2026-07-30): every corpus tool is `<document type>grep` —
 * memgrep, trddgrep, prrdgrep, specgrep. A tool whose name cannot be GUESSED from the
 * corpus it reads is not installed, whatever the filesystem says (TRDD-217AYEOT).
 *
 * FOUR LINES ON PURPOSE. The implementation is `lib/pillar/cli.ts`, shared verbatim
 * with specgrep — two near-identical CLIs would drift the day one gained a flag, and
 * each would keep passing its own tests while doing so. What differs between the two
 * pillars is entirely captured by the `PillarKind` handed in here.
 *
 * `scripts/pillar-cli` (the launcher, installed to ~/.local/bin under each pillar name)
 * already dispatches on `basename $0` and looks for `$ROOT/scripts/<name>.mjs`, and
 * install-messaging.sh already loops `trddgrep prrdgrep specgrep` installing whichever
 * has an implementation. So this file EXISTING is the whole installation step.
 */
const { PRRD_KIND } = await import('../lib/pillar/kinds.ts')
const { runPillarCli } = await import('../lib/pillar/cli.ts')

await runPillarCli(PRRD_KIND, process.argv.slice(2))
