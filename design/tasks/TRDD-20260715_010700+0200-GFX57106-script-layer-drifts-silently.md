---
trdd-id: GFX57106
title: Nothing keeps the installed script layer in sync, so the fleet cannot reach verify
column: backburner
min-approval-requirement: none
priority: 1
severity: high
effort: small
task-type: infra
created: 2026-07-15T01:07:00+0200
updated: 2026-08-27T18:50:33+0200
scope: project
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:36:05+0200
labels: [scenario-improvement, scen-029]
current-owner: scenario-runner
external-refs:
  - reports/scenarios-runner/SCEN-029_20260714T212851Z.report.md
---

# The installed CLI is stale, and no invariant notices

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-27T18:33:43+0200

**The live harm is FIXED; the DESIGN is still open, and the body's proposal is WRONG IN SHAPE.**

### Measured 2026-08-27T18:33 (all first-hand, re-derive before trusting)

| fact | measurement |
|---|---|
| drift, repo `scripts/*.sh` vs `~/.local/bin` | 91 files: 79 identical, **5 differ**, **7 missing** |
| by manifest tier | differ = 3 **Tier A** (`amp-kanban-create-task/list/move.sh`) + 1 Tier B (`ecosystem-config.sh`) + 1 Tier C (`remote-install.sh`); all 7 missing are **Tier C** |
| what the Tier A drift WAS | installed CLIs advertised **"14 TRDD-v2 pipeline stages"**; repo says **19** (+3 exception = the 22 columns TRDD-UNTF690M ratified 2026-08-23). **The ratification never reached the CLI agents actually invoke.** |
| clobber risk in this set | **none** — `ecosystem-config.sh`'s installed-only keys (`AMP/AID_PLUGIN_NAME/REPO`) were deliberately dropped by commit `9b3474a5` and have **zero consumers**: `grep -rIl` over `~/.claude/plugins ~/agents ~/.local/share ~/.local/bin` returns nothing. **The first check was UNDER-SCOPED** — it covered only this repo and `~/.local/bin`, i.e. not `~/.claude/plugins/`, which is where a consumer of constants named `AMP_PLUGIN_REPO`/`AID_PLUGIN_NAME` would most plausibly live (both are installed plugins) — and it was made AFTER the overwrite. A review fork caught it; the wider check returned zero too. **The ORDERING was wrong, but the risk was never actually taken:** the copy erased a *definition*, and a consumer is a *different* file, so the grep returns zero whenever it runs and could not be contaminated by the act it validates. (The backup is a restore path, not evidence — it holds the definition, not a consumer census.) Widen before acting anyway: here it was luck that the mutation could not hide the evidence |
| installer intent | `install-messaging.sh:755` globs `"$SCRIPTS_DIR"/*.sh` minus exactly 4 exclusions (`aimaestro-message-*` + 3 named files — whole loop head read, no other `continue`), so "everything ships" IS the intent; nothing re-runs it, nothing checks. None of the 7 missing is excluded (verified item-by-item), and the loop is **top-level** — brace-counted, `migrate_old_messages` ends at 490 so the loop is not inside it — i.e. it always runs when the installer runs. That count is drift, not policy |
| reverse drift (never measured before) | the loop only ever COPIES, never removes, so a deleted script persists as residue — the installer says so itself at `install-messaging.sh:748`: *"a deployed bin dir must never be treated as the source of truth for what AI Maestro ships"* (commit `b862c6b0`). Measured: **24** `.sh` files in `~/.local/bin` this repo no longer ships. **Provenance unverified** — `~/.local/bin` is shared and several (`docs-*`, `graph-*`, `memory-*`, `wifi-watchdog.sh`) look like other tools'. The number bounds the question; it does not answer it. Delete nothing on this evidence |
| Tier A installer coverage | **50 / 50 covered** (install-agent-cli.sh's explicit 10-file list + the glob). The twice-recorded "missing from the explicit list" bug (panel CLI, continuity CLI) is **not live today** |
| the verification gap | **no test compares repo scripts to installed ones.** `script-manifest-announces-every-script.test.ts` + `build-script-manifest.test.ts` verify the manifest as a **document** (every script announced, tier counts agree) — never as a **deployment** |
| manifest claim that is FALSE on this host | §4: *"`install-messaging.sh` copies `scripts/*.sh` by glob, so these land in `~/.local/bin` too"* — 7 Tier C scripts are absent |

### Done

Deployed the 4 consequential files (Tier A trio + `ecosystem-config.sh`) repo → `~/.local/bin`,
backed up first to `/private/tmp/claude-501/-Users-emanuelesabetta-ai-maestro/8ac348e6-5fba-4811-a525-781a5da95b7a/scratchpad/local-bin-backup-20260827_182625+0200/`, verified byte-identical by `cmp`,
and confirmed each runs (`--help` exit 0; `ecosystem-config.sh` sources clean). Remaining drift:
`remote-install.sh` + the 7 missing, **all Tier C** — which the manifest itself calls *"not a
plugin API. A plugin must never call them."*

### The body's `## Proposed fix` is wrong in shape — do NOT implement it as written

1. **Not a per-agent row.** `agent-invariants.ts` rows are per-AGENT-workdir guarantees, run once
   per agent per sweep. `~/.local/bin` is **per-HOST and shared**, so a `script-layer` row with
   `triggers: create·wake·periodic` would run N× per sweep against one directory, racing itself —
   the exact mistake the sweep's own comment already documents for the keychain check
   (`lib/agent-invariants.ts:433` — *"ONCE per sweep, BEFORE the per-agent loop — never
   per-agent … running it per-agent would both waste the sweep and turn one root cause into N
   alarm lines"*, TRDD-78J4I4QS). If a runtime sweep is wanted at all, the shape is
   `sweepTmuxServerKeychain()`'s: a host-level function called from that fleet-level block.
2. **"every `scripts/*.sh` … byte-identical" is the wrong SSOT.** `docs/SCRIPT-MANIFEST.md`
   tiers are the SSOT; Tier A is the contract, Tier C is explicitly not.

### DECIDED 2026-08-27T18:50 — build nothing; park on a runnable probe

**Advisor consulted; it never returned — the run was KILLED by the user at ~25 min** (fable-advisor).
So no advisor verdict exists for this decision and none is coming: recorded per advisor-rules,
which requires an explicit note when the advisor path fails. The decision is the
CONSERVATIVE one, which is the direction an advisor would be least likely to overturn: no new
runtime writer.

**Verdict: (c) + a check.** The harm this card exists to prevent was 4 stale files, fixed by one
`cp`. Everything still drifted is Tier C — *"not a plugin API. A plugin must never call them."* A
5-minute watchdog writing into a shared `~/.local/bin` forever, with clobber risk, to automate a
step that fails a few times a year, is the trade going the wrong way. The per-agent row the body
proposes is additionally wrong in shape (see above).

What shipped instead: **`scripts/check-script-drift.sh`** — Tier-A-only (the contract set), exit
0 clean / 1 drift / 2 could-not-run. Positive control recorded: seeding one stale Tier A script
makes it print `STALE <name>` and exit 1; restoring returns exit 0.

**This card is now PARKED on that check, not on a memory.** `blocker-probe: bash
scripts/check-script-drift.sh` + `blocker-holds-if: exit-0` (TRDD-CV5KDCB7's convention, shipped
this morning): the reason to stay parked — *no Tier A drift, so no watchdog is warranted* — is
re-derivable by a machine forever. If Tier A drifts again the probe exits 1, the blocker no longer
holds, and this card comes back with evidence instead of a hunch. THAT is the trigger to
reconsider (b), the host-level sweep — not before.

### Superseded — do NOT carry forward

The body's `## Proposed fix` (a `script-layer` row in `lib/agent-invariants.ts`, triggers
create·wake·periodic). Wrong home (per-HOST resource in a per-AGENT registry), wrong SSOT
(`scripts/*.sh` instead of the manifest tiers), and unwarranted by the measured harm.

### Former NEXT ACTION — a DESIGN decision, not code

Advisor consulted 2026-08-27T18:33 (verdict pending at the time of writing; record it here before
building). The open question is whether a runtime writer should exist **at all**: the harm this
card exists to prevent was 4 stale files fixed by one `cp`, and a 5-minute watchdog writing into
`~/.local/bin` forever is a permanent background writer with clobber risk. The cheaper reading is
that this is a **deploy** step — nothing re-runs the installer when the repo changes — and the
repo already owns a deploy step (`yarn build`). Decide between:
(a) wire the existing copy loop to the build; (b) the host-level sweep of §1; (c) close as
over-built now the live drift is gone. Do not implement the body's per-agent row under any of them.

## Problem

`~/.local/bin/aimaestro-trdd.sh` on this host **has no `verify` verb**. The repo copy
has had it since commit `7d6a9e31` ("the verification surface — an approval you can
check, not just read", ai-maestro#47). `aimaestro-portfolio.sh` — the whole
mint/list/revoke surface — **is not installed at all**.

The diff is exactly the feature:

```
$ diff scripts/aimaestro-trdd.sh ~/.local/bin/aimaestro-trdd.sh
95,96c95      # the human-auth hint
126,129d124   # the `verify` help text
198,248d192   # cmd_verify — the entire function
378d321       # the dispatcher line
```

So the fleet cannot verify a mandate even if it wanted to: the verb is not on PATH.
`approve` is byte-identical (the mint happens server-side), which is why a token can
be *created* on a host that cannot *check* one.

## Root cause

`install-messaging.sh` copies `scripts/*.sh` → `~/.local/bin/` **only when the
installer is run**. Nothing re-runs it, and nothing checks. Meanwhile the app has an
`agent-invariants` registry (`lib/agent-invariants.ts`) that already guarantees
`.claude/`, the DEP rules, the git-exclude block, and the core plugin — on create, on
wake, and on a 5-minute watchdog. The script layer, which the plugin-abstraction
principle names as *the* boundary every plugin depends on, has no such guarantee.

A host can therefore run a server that ships a feature its agents cannot invoke, and
every symptom looks like an agent behaving badly.

## Proposed fix

Add a **`script-layer` row to `lib/agent-invariants.ts`** — the same shape as
`dep-rules`:

- **guarantee**: every `scripts/*.sh` the server ships is present in `~/.local/bin/`
  and byte-identical to the shipped copy;
- **repair**: copy + chmod (pure file I/O — no network, no package manager, so unlike
  `core-plugin` it is safe on the `periodic` trigger too);
- **triggers**: `create · wake · periodic`.

Emit a one-line ops record when it repairs, exactly as `[InvariantsWatchdog] …
dep-rules=repaired` does today, so drift is visible rather than inferred.

## Verification

- Delete `verify` from the installed `aimaestro-trdd.sh`; within one watchdog
  interval it is restored byte-identical.
- `command -v aimaestro-portfolio.sh` resolves on a host that has never re-run the
  installer.
- A unit test pins the row's `triggers`, mirroring the existing `core-plugin`
  wake-only test.

## Estimated risk

LOW. It is a file copy into a directory the installer already owns. The only care
needed is not clobbering a file the user has deliberately edited — compare against
the shipped copy and log, don't overwrite blindly, or gate the overwrite on the
managed-file marker the DEP rules already use.

## Approval log

- 2026-08-21T22:36:05+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: none). Re-measured: the SPECIFIC reported symptom is gone on this host — `~/.local/bin/aimaestro-trdd.sh` now has `verify` (someone re-ran the installer since filing) and `aimaestro-portfolio.sh` (mtime Jul 21) is installed too. But the ROOT CAUSE this proposal targets is still unaddressed: `lib/agent-invariants.ts` has no `script-layer` row alongside the existing `dep-rules`/`core-plugin`/`git-exclude` guarantees, so nothing prevents the same silent drift from recurring on this or any other host. Premise still holds at the root-cause level; approved.
