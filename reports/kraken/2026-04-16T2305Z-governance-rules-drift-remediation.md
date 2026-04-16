# docs/GOVERNANCE-RULES.md — drift remediation — 2026-04-16T2305Z

**Source audit:** `reports/kraken/2026-04-16T2255Z-docs-drift-audit.md`
**Scope:** `docs/GOVERNANCE-RULES.md` ONLY (one file).
**Branch:** `worktree-agent-a63f7282` (worktree branched from `feature/team-governance`).
**Base for verification:** `feature/team-governance` tip (commit `78c61b1c`).

Every `## docs/GOVERNANCE-RULES.md` item from the drift report was triaged below, one row per item. The table maps to the section-level findings (audit lines 64–90) and the per-section remediation queue (audit lines 180–187).

---

## Per-item triage

| Audit item | Summary | Outcome | Notes |
|---|---|---|---|
| Line 70 — `lib/communication-graph.ts` marked ❌ "file does not exist" | Drift audit flagged this file as missing; it's R6 enforcement. | **NOT-A-BUG** (kept) | Verified on `feature/team-governance`: `git show feature/team-governance:lib/communication-graph.ts` returns content beginning `/** Communication Graph — Title-based message routing rules.`. File exists; audit was wrong. No edit applied. |
| Line 71 — `PLUGIN_COMPATIBLE_TITLES` marked ⚠️ "not found in snapshot" | Audit uncertain whether the export exists in `lib/ecosystem-constants.ts`. | **NOT-A-BUG** (kept) | Verified: `git show feature/team-governance:lib/ecosystem-constants.ts | grep PLUGIN_COMPATIBLE_TITLES` returns `export const PLUGIN_COMPATIBLE_TITLES: Record<string, string[]> = {`. Audit was cautious but wrong. No edit applied. |
| Line 72 — `lib/team-registry.ts` | ✅ — no action needed. | **N/A** | Audit marked this ✅ on the same doc; acknowledged. |
| Line 73 — `lib/sudo-fetch.ts` marked ⚠️ "not verified" | Audit uncertain whether the file exists. | **NOT-A-BUG** (kept) | Verified: `git show feature/team-governance:lib/sudo-fetch.ts` returns source. File exists. No edit applied. |
| Line 74 — `app/api/agents/[id]/title/route.ts` marked ⚠️ "not verified" | Audit suspected this route may not exist. | **FIXED** | Verified: `git show feature/team-governance:app/api/agents/[id]/title/route.ts` returns `fatal: path does not exist`. The title-change flow actually dispatches via `PATCH /api/agents/[id]` which delegates to `ChangeTitle` in `element-management-service.ts`. Removed the `title/route.ts` row from §0.6 and expanded the `app/api/agents/[id]/route.ts` row to say "Title change dispatcher (delegates to `ChangeTitle` in element-management-service), auth gate, sudo-mode gate for strict operations". |
| Line 75 — SCEN-005 ⚠️ "unverified" | Audit just flagged uncertainty; stylistic. | **SKIPPED** | No concrete fix requested beyond "verify"; SCEN-005 filename matches what the doc says. No edit. |
| Line 76 — SCEN-018/019/020/021/022 table stops, missing SCEN-023/024 | Scenarios 23 and 24 exist on branch, missing from §0.8 table. | **FIXED** | Verified via `git ls-tree -r feature/team-governance --name-only | grep SCEN-`. SCEN-023 (`SCEN-023_r17-exhaustive-surface-audit.scen.md`) and SCEN-024 (`SCEN-024_delete-team-revert-cos.scen.md`) both exist. Also corrected the SCEN-019 and SCEN-021 filenames: actual branch has `SCEN-019_marketplace-and-plugin-lifecycle.scen.md` (not `marketplace-install-uninstall`) and `SCEN-021_user-local-scope-isolation.scen.md` (not `user-vs-local-scope`). Two new rows appended with rule IDs (R17 for 023, R1/R3/R5 for 024). |
| Line 77 — `scripts/validate-governance.sh (if present)` | "(if present)" hedge — acceptable as optional pointer. | **SKIPPED** | Verified `git show feature/team-governance:scripts/validate-governance.sh` returns `fatal: path does not exist`. The hedge `(if present)` in the doc already covers this. Acceptable as-is per audit. No edit. |
| Line 78 — R9.13 "ai-maestro-autonomous-agent" ✅ | No action needed. | **N/A** | Acknowledged. |
| Line 79 — R11.12 mandatoriness ✅ | No action needed. | **N/A** | Acknowledged. |
| Line 80 — R11.10 `-<client>` suffix ✅ | No action needed. | **N/A** | Acknowledged. |
| Line 81 — Title → Default Role-Plugin mapping ✅ | No action needed. | **N/A** | Acknowledged. |
| Line 82 — Codex marketplace claim ⚠️ "authoritative, not cross-checked" | Spec-source claim; audit recommends keeping as authoritative. | **SKIPPED** | Acknowledged — keep as authoritative per audit's own disposition. No edit. |
| Line 83 — R20.1 "Three default marketplaces" vs Overview "three default plugin marketplaces" | Overview says "three default plugin marketplaces (R20)" but the actual model is 1 remote marketplace + 2 local containers (+ 1 core container for non-Claude). | **FIXED** | Rewrote Overview paragraph (lines 226-230 pre-edit) to "one remote marketplace plus two local plugin containers (role-plugins + custom-plugins) and — for non-Claude clients only — a third local core-plugins container (R20)". This matches R20.1 / R20.25 exactly. |
| Line 84 — R20.25 "core-plugins container (v3.7.1)" but frontmatter v3.7.0 | Body references v3.7.1 tag; frontmatter version says 3.7.0. | **FIXED** | Bumped frontmatter `version: "3.7.0"` → `"3.7.1"`, `date: 2026-04-15` → `2026-04-16`, and prepended a new changelog entry describing the remediation pass. |
| Line 85 — R20.27 v3.7.1 tag in 3.7.0 doc | Same version-mismatch as above. | **FIXED** | Covered by the same frontmatter bump. R20.27 tag `(v3.7.1)` now matches the `version:` field. |
| Line 86 — R20.28 title "Six canonical" but enumerates 5 patterns | Count error: title claims six, body lists 1..5. | **FIXED** | Changed R20.28 title to "Five canonical local marketplace folder patterns" and "exactly these five patterns" in the body. The enumeration (five items) was already correct; only the count word was wrong. Note: not adding a sixth pattern — the five listed exhaustively cover the R20.1 / R20.25 containers; a sixth pattern would contradict R20.25 (Claude absent from core-plugins). |
| Line 87 — Invariant 8 title-plugin ✅ | No action needed. | **N/A** | Acknowledged. |
| Line 88 — Invariant 22 vs `install-messaging.sh` registering container dir | Audit suspected installer registers the container folder (`~/agents/role-plugins/`), violating Invariant 22. | **NOT-A-BUG** (kept) | Verified `install-messaging.sh` on `feature/team-governance`: it defines `create_per_client_marketplaces()` which takes a container name (`role-plugins`, `custom-plugins`, `core-plugins`) and iterates per-client marketplace subdirs; the `claude plugin marketplace add "$MKT_DIR"` call registers `$MKT_DIR` which is the per-client marketplace subfolder, not the container. Invariant 22 is consistent with the installer. No edit applied. |

---

## Summary

- **FIXED**: 5 remediation items
  1. Frontmatter version bump 3.7.0 → 3.7.1 + date + changelog entry
  2. Overview wording clarified (three default marketplaces → 1 remote + 2 local containers + 1 core container)
  3. R20.28 title count corrected (Six → Five) to match enumeration
  4. §0.6 stale `app/api/agents/[id]/title/route.ts` row removed; dispatcher row expanded
  5. §0.8 extended with SCEN-023 and SCEN-024; SCEN-019 and SCEN-021 filenames corrected
- **NOT-A-BUG**: 4 items where the audit was cautious/wrong (`lib/communication-graph.ts`, `PLUGIN_COMPATIBLE_TITLES`, `lib/sudo-fetch.ts`, Invariant 22 vs installer)
- **SKIPPED (stylistic/acceptable)**: 2 items (SCEN-005 unverified hedge; `scripts/validate-governance.sh (if present)` hedge)
- **N/A (✅ rows)**: 5 items the audit already marked as matching code

## Rules touched

No rules were deleted, renumbered, or renamed. All 20 top-level rules (R1..R20) remain sequential. Edits were strictly body/wording/tag/metadata:

- **Frontmatter** (lines 1-17): version bump + new changelog entry.
- **Overview** (lines 222-234): paragraph rewording to clarify marketplace/container topology.
- **§0.6 — API routes table**: removed one stale row (`title/route.ts`) and enriched the PATCH/DELETE row.
- **§0.8 — Scenario test specs table**: corrected two filenames (019, 021); added two rows (023, 024).
- **R20.28 body**: title count "Six" → "Five" and matching sentence.

No rule body text inside R1..R20 was deleted. R20.25 and R20.27 were untouched (their `(v3.7.1)` tags now match the bumped frontmatter).

## Verification commands used

```bash
git show feature/team-governance:lib/communication-graph.ts | head -3      # exists
git show feature/team-governance:lib/ecosystem-constants.ts | grep PLUGIN_COMPATIBLE_TITLES  # exists
git show feature/team-governance:lib/sudo-fetch.ts | head -3               # exists
git show feature/team-governance:app/api/agents/\[id\]/title/route.ts      # NOT FOUND
git show feature/team-governance:scripts/validate-governance.sh            # NOT FOUND
git ls-tree -r feature/team-governance --name-only | grep 'tests/scenarios/SCEN-'  # 24 scenarios, SCEN-023 + SCEN-024 present
git show feature/team-governance:install-messaging.sh | grep 'plugin marketplace add'  # registers $MKT_DIR (per-client subfolder)
```
