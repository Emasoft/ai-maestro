# SCENARIOS_TESTS_RULES Remediation — 2026-04-16T22:55Z

**Source audit:** `reports/kraken/2026-04-17T0118Z-scenarios-rules-audit.md` (from branch `feature/team-governance`, commit `2b5ed2d1`)
**Target file:** `tests/scenarios/SCENARIOS_TESTS_RULES.md`
**Canonical copy verified:** `.claude/rules/SCENARIOS_TESTS_RULES.md` is a symlink to `../../tests/scenarios/SCENARIOS_TESTS_RULES.md` (still preserved; unaffected by edits).
**Rule numbering verified:** Rules 1-13 still sequential, each with `## Rule N:` heading.

---

## Per-rule verdicts

| # | Rule | Audit severity | Action taken | Reason |
|---|------|---------------|--------------|--------|
| 1 | Rule 6 (L153) — chrome-devtools/CDC reference is stale | HIGH ❌ | **FIXED** | True correctness fix — Rule 8 (2026-04-15) deprecates chrome-devtools-mcp; Rule 6 now reads "via `dev-browser` per Rule 8. Legacy chrome-devtools-mcp support is deprecated." |
| 2 | Rule 9 (L249) — result enum missing STUCK | HIGH ⚠️ | **FIXED** | True correctness fix — Rule 13 explicitly uses `STUCK` verdict (L936). Enum now `PASS \| FAIL \| PARTIAL \| STUCK`. |
| 3 | Rule 9 (L258) — missing `screenshots_purged` frontmatter field | MEDIUM ⚠️ | **FIXED** | True correctness fix — Rule 10 auto-purge (L543) and Rule 13 state file both require this field. Added to frontmatter list. |
| 4 | Scenario File Format (L363-L369) — example `required_tools` lists chrome-devtools-mcp | HIGH ❌ | **FIXED** | True correctness fix — directly contradicts Rule 8. Replaced with `browser_stack: dev-browser` as canonical; legacy list kept as commented reference. |
| 5 | Scenario File Format (L400) — field-rules table mandates chrome-devtools | HIGH ❌ | **FIXED** | True correctness fix — split into `browser_stack` (required) + `required_tools` (optional, legacy). |
| 6 | Scenario File Format (L373) — prereqs example "Chrome browser open with DevTools accessible via CDP" | MEDIUM ⚠️ | **FIXED** | Reworded to "dev-browser handles browser launch" to match Rule 8. |
| 7 | Rule 12 (L627) — cemetery route shape wrong | HIGH ⚠️ | **FIXED** | True correctness fix — verified against `security-registry.json`: entry is `DELETE_/api/agents/cemetery`, NOT `DELETE_/api/agents/cemetery/[id]`. A scenario following the old rule would 404. |
| 8 | Rule 12 (L632) — wrong resource group for stop endpoint | HIGH ⚠️ | **FIXED** | True correctness fix — `security-registry.json` shows `POST_/api/sessions/[id]/stop`, NOT `/api/agents/[id]/stop`. A scenario calling the old route would hit the wrong endpoint (or 404). |
| 9 | Rule 12 — missing `PATCH /api/settings/security` row | MEDIUM ⚠️ | **FIXED** | True correctness fix — `security-registry.json` classifies this as `strict`; omitted from Rule 12 table meant scenarios editing security settings would not know to expect sudo modal. |
| 10 | Rule 12 (L638) — modal pattern heading mentions only Chrome DevTools MCP | MEDIUM ⚠️ | **FIXED** | Correctness fix — modal recognition pattern applies to both stacks. Retitled heading, added separate `dev-browser` and legacy `chrome-devtools-mcp` invocation blocks. |
| 11 | Rule 13 (L866 → now L876) — formatting typo: `Pass:** <N>  Fail:** <N>  Partial:** <N>  Stuck:** <N>` missing opening `**` markers | LOW ⚠️ | **FIXED** | Correctness fix — markdown rendered incorrectly. Now `**Pass:** <N>  **Fail:** <N>  **Partial:** <N>  **Stuck:** <N>`. |
| 12 | Remediation #12 in audit — migrate 24 scenario `.scen.md` files' YAML frontmatter to drop `mcp__chrome-devtools__*` | HIGH (policy) | **DEFERRED** | Out of scope — this agent edits `SCENARIOS_TESTS_RULES.md` only. Bulk scenario migration is a separate task (TRDD-f79f6047 §4.3). Rule 8 text already forbids chrome-devtools-mcp; the scenario files' migration is a downstream cleanup. |

**Low-priority audit notes also deferred (not FAIL-or-WARN in audit):**
- Rule 3 state-backup dir note
- Rule 3 cross-reference to Rule 13 state dir
- Rule 5 cross-reference to Rule 9
- Rule 10 `.txt` snapshot fallback note
- Rule 13 L816 aim_screenshot specifier

These are stylistic / cross-reference enhancements that do not change rule semantics, so they are left for a future pass.

---

## Final counts

- **Fixed: 11** (all 2 FAILs + 5 WARNs resolved; and 4 derived sub-fixes inside those rules' remediation rows #4-6, #9-10 in the queue)
- **Deferred: 1** (scenario file bulk migration — out of scope for this agent)
- **Not-a-bug: 0**

## Files changed

- `tests/scenarios/SCENARIOS_TESTS_RULES.md` — 11 edits applied (see per-rule table above)

## Symlink integrity

Verified after all edits:

```
$ ls -la .claude/rules/SCENARIOS_TESTS_RULES.md
lrwxr-xr-x  1  46 ... .claude/rules/SCENARIOS_TESTS_RULES.md -> ../../tests/scenarios/SCENARIOS_TESTS_RULES.md
```

Symlink is intact. The loaded copy (`.claude/rules/...`) and canonical tracked file (`tests/scenarios/...`) cannot drift.

## Rule numbering integrity

Verified all 13 rule headings present and sequential:

```
Rule 1: CLEAN-AFTER-YOURSELF
Rule 2: 0-IMPACT
Rule 3: STATE-WIPE
Rule 4: FIX-AS-YOU-GO
Rule 5: TRACK-AND-REPORT
Rule 6: STICK-TO-UI
Rule 7: SAFE-SETUP
Rule 8: DEV-BROWSER
Rule 9: REPORT-FORMAT
Rule 10: PHOTOSTORY
Rule 11: 11th-HOUR
Rule 12: SUDO-MODE
Rule 13: AUTONOMOUS-PROTOCOL
```

## Evidence sources

Each correctness fix was verified against a ground-truth source, not just the audit's claim:

- **Rule 12 fixes (#7, #8, #9):** verified against `security-registry.json` @ commit `2b5ed2d1` — the canonical classification file.
- **Rule 9 STUCK enum (#2):** verified against Rule 13 body at existing L936 which uses `STUCK` as a verdict keyword.
- **Rule 9 `screenshots_purged` (#3):** verified against Rule 10 (L543) which introduces the auto-purge mechanism and its flag.
- **Rule 6 / Scenario File Format (#1, #4, #5, #6):** verified against Rule 8's body which explicitly deprecates chrome-devtools-mcp as of 2026-04-15.
- **Rule 13 typo (#11):** verified by reading the line directly — indeed missing opening `**` before `Fail:`, `Partial:`, `Stuck:`.
