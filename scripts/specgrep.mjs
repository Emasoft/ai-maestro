#!/usr/bin/env node
/**
 * specgrep — query and EDIT the SPEC corpus (`design/specs/`).
 *
 * NAMED BY LAW (USER, 2026-07-30): every corpus tool is `<document type>grep` —
 * memgrep, trddgrep, prrdgrep, specgrep.
 *
 * The sibling of prrdgrep, and deliberately its identical twin: both are per-line
 * pillars, so both get the same verbs from `lib/pillar/cli.ts` and differ only in the
 * `PillarKind` handed in. A spec clause is DECLARED line-anchored in backticks
 * (`` `3P-KAN-06` **name** — … ``) and CITED anywhere in prose; only the declaration
 * yields a record, which is what keeps the 18 known provenance mentions from being
 * reported as 18 phantom clauses.
 */
const { SPEC_KIND } = await import('../lib/pillar/kinds.ts')
const { runPillarCli } = await import('../lib/pillar/cli.ts')

await runPillarCli(SPEC_KIND, process.argv.slice(2))
