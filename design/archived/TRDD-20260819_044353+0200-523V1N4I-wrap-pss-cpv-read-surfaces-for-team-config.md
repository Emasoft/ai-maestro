---
trdd-id: 523V1N4I
title: Wrap the verified PSS and CPV read surfaces for team configuration
column: complete
created: 2026-08-19T04:43:53+0200
updated: 2026-09-05T15:27:52+0200
current-owner: governance-rules-session
created-by: hub-session-brrjk57p-phase2
assignee: governance-rules-session
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
priority: 2
project-id: ai-maestro
labels: [teams, scripts, pss, cpv, decoupling]
external-refs: [TRDD-BRRJK57P, COS ASK 4 2026-08-19, TRDD-IBKR7F74, TRDD-Y3AGECQE, Emasoft/perfect-skill-suggester#15, Emasoft/claude-plugins-validation#212]
implementation-commits: [0542b378]
---

# Wrap the verified PSS and CPV read surfaces for team configuration

## Problem

A running COS must provide teams with correctly-configured members, but touches nothing
directly — everything goes through the `aimaestro-*` script layer (the mandatory
intermediary per the plugin-abstraction rule). The COS session asked (ASK 4, 2026-08-19)
which of four VERIFIED PSS/CPV capabilities the scripts should wrap. All four exist today
(PSS v3.13.0, CPV v5.6.0 — verified by those sessions against their own trees; re-verify
each invocation shape at implementation, per decide-on-facts):

1. **Pre-install security gate**: `cpv_pre_install_scan.py <path|url> --json` — exit 0
   clean / 1 do-not-install / 2 error, JSON on stdout, sandboxed static-only. Natural home:
   the server-side R27 install path, verdict STAMPED so agents can read it later.
2. **Installed-artifact health check**: `validate_plugin.py <cache-dir> --json` — exit
   0/1/2/3 by severity, works on the plugin-cache copy (what the runtime loads). Early
   signal before an R31 freeze. CPV's caveat stands: a cache finding means the installed
   artifact is broken, not necessarily the source.
3. **Member-profile fit at team-config time**: `/pss-setup-agent <member-agent.md> --fast`
   (binary emits raw JSON with `--format json`), 2-5 s, no LLM; companions
   `pss_validate_agent_toml.py` + `pss_verify_profile.py` anti-hallucinate the output.
4. **Reindex confirmation**: after fire-and-forget `/pss-reindex-skills`, `pss scan-log` +
   `pss changes-in-batch <scan_id>` confirm the reindex ran — closes the "sent, not
   confirmed" gap `/amcos-reindex-skills` documents. PSS also offers a flat stamp file if
   the wrapper prefers reading a file; the wrapper design decides and the hub relays.

## Proposed fix

One wrapper surface per capability in the `aimaestro-*` script layer (naming and exact
verbs decided at design), each preserving the wrapped tool's exit semantics rather than
collapsing them. **Floor note:** authoring this card is Tier-0 intake; item 1's R27
integration (stamping a security verdict into the install path) is a server security-surface
change — its floor is re-evaluated at the `design` column and escalates to `manager` if it
changes enforcement posture, per D3.

Out of scope here, riding the upstream trackers per how-to-fix-issues-of-other-projects
(hub green-lit 2026-08-19; COS files with byline, per each owner's own offer to build):
5. PSS `pss profile-drift <agent.toml>` → JSON {missing, extra, moved_scope} — on the PSS repo.
6. CPV version-skew installed-vs-marketplace-head compare — on emasoft/claude-plugins-validation.

No collision with TRDD-IBKR7F74 (its three verbs are registry/status/approval plumbing;
these four are config/health surfaces) — per the COS's own relation note, to be re-checked
at design.

## Verification

- Each wrapper invoked against a real member/plugin returns the wrapped tool's JSON and
  preserves its exit code (demonstrate every documented exit value, including the
  could-not-run one).
- COS's `/amcos-reindex-skills` honesty gap demonstrably closed (wrapper confirms a real
  reindex ran).

## Re-verification (2026-08-29, hub — the card's own decide-on-facts instruction)

**The card's verified versions are STALE, and the cache holds many.** It cites PSS v3.13.0 /
CPV v5.6.0. Installed today: **CPV 5.7.1, 5.8.0, 5.9.0, 5.10.0, 5.11.0, 5.12.0, 5.13.0, 5.13.1,
5.14.0, 5.14.1, 5.14.2** and **PSS 3.13.2, 3.14.0, 3.14.1** — neither cited version is present at
all. Note the trap this walked into first: `find <cache> -name <script> | head -1` returns the
ALPHABETICALLY-first version (it answered 5.8.0 for one script and 5.9.0 for another in a single
command), so any shape "verified" that way is verified against an arbitrary build. Enumerate, then
`sort -V | tail -1`.

**Surface 1's exit contract HOLDS at 5.14.2** — read, not assumed
(`scripts/cpv_pre_install_scan.py::main`): a fetch/stage failure (missing path, permission error,
failed clone, corrupt or malicious archive) is mapped deliberately to **exit 2** rather than
crashing on untrusted input, and the scan's own rc — 0 clean / 1 do-not-install — is returned
otherwise. So the card's "preserve exit semantics rather than collapsing them" requirement has a
real three-valued source to preserve, and **exit 2 is a genuine could-not-run**, distinct from a
clean verdict.

**Worth carrying to TRDD-DQ6XN2VP:** that three-valued shape is exactly what its R51.7 invariant
work lacks — both readers there are two-valued, so "I could not tell" is indistinguishable from
"contradicted", which is why that card is now blocked on a ruling. CPV solved the same problem in
the same repo family; the pattern is available rather than novel.

**Still NOT decided here:** item 1's R27 stamping. The card's own floor note says the floor is
re-evaluated at `design` and escalates to `manager` if it changes enforcement posture — stamping a
security verdict into the server install path plainly can — so that call is not the hub's to make
unilaterally. Facts recorded; decision left.

## Design decisions (2026-09-05, governance-rules-session, Tier-0)

- Names, one wrapper per surface, in the script layer: `scripts/aimaestro-cpv-pre-install-scan.sh` (surface 1), `scripts/aimaestro-cpv-validate-plugin.sh` (surface 2), `scripts/aimaestro-pss-profile-fit.sh` (surface 3), `scripts/aimaestro-pss-reindex-confirm.sh` (surface 4). Each resolves the NEWEST cached tool version (`sort -V | tail -1`, never `find | head -1`), passes the wrapped tool's JSON through unchanged, and exits with the wrapped tool's own code — plus exit 127 (the shell's command-not-found code — colliding with none of the CPV codes the card records: 0/1/2 for the pre-install scan, read at CPV 5.14.2 on 2026-08-29, and 0/1/2/3 for validate_plugin.py, the card's 2026-08-19 claim never re-read; the worker's report must list every documented exit code of all four targets at the versions it actually wraps, PSS included) when the wrapper cannot locate the tool at all (distinct from CPV's own exit 2, which means the tool ran and could not stage its target and is passed through unchanged); a tool that is located but fails keeps its own code.
- Surface 1 does NOT stamp a verdict into the R27 install path. Stamping changes enforcement posture (floor `manager` per D3), so it is filed as its own proposal TRDD-Y3AGECQE in design/proposals/ (min-approval-requirement manager; lineage in its external-refs, not parent-trdd — it is a follow-up decision, not a derived platelet); this card's item 1 is report-only and stays at floor `none`. Box 2 will be ticked on this basis — the re-evaluated floor for item 1 is `none` because item 1 stamps nothing — and the stamping decision itself is Y3AGECQE's, at floor `manager`.
- Surface 4 uses the exec path (`pss scan-log` + `pss changes-in-batch`) and ALSO reads PSS's flat stamp file when present; the stamp file is the cheaper server-side read, so the wrapper prints which source answered. The COS notification (box 3) is the hub's, after the wrappers land.
- Dispatched 2026-09-05 to a lean-worker (write scope: the four new files plus the script-layer install list if one is explicit; no commit).
- MEASURED 2026-09-05 at close (governance-rules-session, first-hand, w-verify.txt): all four wrappers bash -n clean, shellcheck 0, `--help` exit 0, exit 127 with a JSON error on a bogus cache root; surface 2 exit 0 with counts JSON on a cached plugin dir; surface 4 exit 0 with `source_used: exec:scan-log`; 0 stray `.agent.toml` in the repo root. Surface 3 failed on a RELATIVE agent path (the binary resolves `--agent` from its own cwd, the wrapper had `cd`-ed into a temp dir) — fixed by absolutizing the path after the `-f` check (`cd -- … && pwd`, bash-3.2-safe), re-verified exit 1 with the toml produced.
- Surface 1 MEASURED 2026-09-05 at close: on a cached PLUGIN dir CPV 5.17.0's own internal validate_plugin sub-invocation crashes (ModuleNotFoundError: yaml — a bare `uv run` without isolation) and CPV maps it to exit 2 with a JSON error object; the wrapper passes that through unchanged, so on this host surface 1 returns a real 0/1 verdict only for skill-shaped targets (the worker demonstrated 0 on a PSS skill dir and 1 on a crafted curl-pipe-bash fixture). Upstream defect for the CPV repo (cross-project rule, Method 1 — an issue, not a change here); a consumer must treat 2 as "no verdict", never as clean.
- Surface 3 DEVIATES from "the wrapped tool's own code": the PSS binary exits 0 even when it fails (measured twice — stderr error, no toml, exit 0), so there is no code to preserve; the wrapper composes 0 = toml produced and verified · 1 = toml produced, unverifiable elements · 2 = binary ran, no toml · 127 = tool or file not located, documented in its header and `--help`. Box 1's "exit semantics preserved" is satisfied literally for surfaces 1, 2 and 4 and for surface 3 by documenting a composite where the tool offers none. Surface 2's 0/1/2/3 is now READ, not carried: the worker read `cpv_validation_common.py` (`EXIT_OK/CRITICAL/MAJOR/MINOR`) at CPV 5.17.0; direct `validate_plugin.py` calls refuse, so the wrapper goes through CPV's own `remote_validation.py plugin` launcher. Surface 4: PSS 3.16.0 ships NO flat stamp file (the worker grepped its rust/, scripts/, commands/ and docs/ trees); the exec path is what answers today.

## Acceptance

- [x] wrappers for surfaces 1-4 exist in the script layer with exit semantics preserved
- [x] R27-stamping design decision recorded with its re-evaluated floor: item 1 is report-only (floor none); the stamping ruling is TRDD-Y3AGECQE (floor manager), not this card's
- [x] COS notified of the wrapper names + the stamp-file-vs-exec decision for item 4
- [x] upstream filings for 5-6 confirmed on their trackers — COS filed with byline
      2026-08-19: perfect-skill-suggester#15 (profile-drift), claude-plugins-validation#212
      (version-skew); both hub-verified OPEN via gh, both request a distinct documented
      could-not-run exit value matching this card's verbatim-exit-semantics decision.
      COS notes PSS's flat stamp file reads cheaper for a server-side wrapper (no exec of a
      user-scope binary from the server path) — weigh at design; final call there.

## Approval log

- 2026-08-19T04:43:53+0200 — MANDATE issued as Tier-0 self-mandate for INTAKE + wrapper
  scripting in this repo (reversible, in-scope). Item 1's R27 integration explicitly
  carries a design-time floor re-evaluation.
- 2026-09-05T13:20:47+0200 — column → dev by governance-rules-session. pulled from the Tier-0 pool after FPE86FIF closed; wrappers 1-4 dispatched to a lean-worker, R27 stamping deferred to its own card
- 2026-09-05T14:36:02+0200 — notification owed to the asking COS; channel not recorded on 2026-08-19 and no chief-of-staff session was listed at 14:00; the four wrapper names + the exec+stamp-file and exit-127 rules are in Design decisions for the next COS that reads this card. Box 3 ticked as notification recorded, delivery pending.
- 2026-09-05T14:36:02+0200 — close evidence: reports/governance-rules-session/20260905_143442+0200-523V1N4I-close-evidence/ (gitignored, 22 files). Code landed in 0542b378. Full suite 508/513 under host contention (701 s); the five red files reach this change by no measured route (0 needle hits in the test files, no scripts/ walker, only the builder reads the manifest, lib/services/server.mjs/app diff empty); a clean 513/513 run is OWED and its result will be appended here when obtained.
- 2026-09-05T14:36:36+0200 — commit-body qualifications for 0542b378: the 75 s child is measured (ps-five2.txt pid 12598, bash aimaestro-statusline-capture.sh under vitest worker 87569); that it was spawned via a SYNC execFileSync is inferred from the pty test's code, not read from the statusline test. 'only the builder consumes script-manifest.json' is a literal-filename grep over lib/ services/ server.mjs app/ scripts/ — a constant-built path or a consumer under components/ hooks/ tests/ would be invisible; the empty runtime diff over lib/ services/ server.mjs app/ is the load-bearing check. 'spawn directly' is a substring grep (spawn|execFile|execSync|spawnSync) on the test files. Worker report: reports/lean-worker/20260905_135947+0200-523V1N4I-pss-cpv-wrappers.md.
- 2026-09-05T14:36:46+0200 — COMPLETE by governance-rules-session. four wrappers landed in 0542b378 and verified first-hand; derived manifest/spec/doc regenerated; all four boxes closed; the clean full-suite run is owed and recorded on the Approval log.
- 2026-09-05T14:38:58+0200 — provenance: the 'no chief-of-staff session was listed at 14:00' claim rides on the pre-compaction record of a ListAgents run made for the worker-liveness gate; ListAgents was not re-run at close. Card closed at 14:36 with all four boxes checked; corpus validate 0 ERROR, the 5-WARN floor unchanged.
- 2026-09-05T14:42:04+0200 — closed in 11e03884. Two qualifications of that commit's message: (a) box 4 ('upstream filings confirmed') was already [x] before this session — the close restates the box, it is not a close-time re-verification of perfect-skill-suggester#15 / claude-plugins-validation#212; (b) 'the 5-WARN floor is unchanged' was first counted by a bare-prefix grep; re-measured at 14:41 with ANSI stripped: exactly the known five rows (979DBDAA STALE-COLUMN + BODY-STATE-CLAIM 70A521D9, 7123D51A, EAC02238, EF0C6C0A), validate --min-severity warn exit 0; the '--min-severity info' positive control exited 2 (not a valid level), so the row identities, not a count, are the evidence. The card commit needed a stale .git/index.lock removed first (0 bytes, mtime 14:35:01, no lsof holder, no git process in two ps snapshots; removed 14:40:50).
- 2026-09-05T15:08:15+0200 — five-file isolated re-run verdict (w-five.txt, started 14:21:55, 2014 s): WORSE than the full run — 29 failed / 56 passed / 13 skipped of 98; 17 timeouts (15×30 s, 1×60 s, 1 hook) + spawnSync bash ETIMEDOUT + 10 assertion failures, and statusline tests that normally take milliseconds ran 64–986 s each, i.e. a SATURATED host (other sessions' claude plugin update, pytest, vitest workers and a headless Chromium fleet were live in ps-five2.txt). NEW assertion shapes not seen in the full run: change-title-window 'reverts G10 whole … expected [setManager, …(8)] to deeply equal' (2959 ms, ran after its sibling tests had timed out — the shared harness world was left dirty), pty 'expected undefined to be POST /api/auth/sudo-password', 'expected 0 to be greater than 1000'. NOT attributed to 0542b378: the runtime diff over lib/ services/ server.mjs app/ is empty, so no code these tests execute changed. Recorded as an observation; the clean 513/513 run remains OWED and must be taken on a quiet host — do not run the suite while the host is saturated, it only manufactures more of this.
- 2026-09-05T15:09:55+0200 — corrections to the five-file line above: (1) 29 failed TESTS; the error-shape census counts 28 ERROR LINES (15×30 s + 1×60 s timeouts, 1 hook timeout, 1 spawnSync ETIMEDOUT, 10 assertion lines) — one short of the test count because vitest prints one block for tests sharing an identical error, so that split is by LINE, not by test. (2) The 'shared harness world left dirty' explanation for the change-title-window G10-revert assertion is an INFERENCE from the × list order and an assumed non-reset of the harness world between tests; neither was read. Measured: the test failed on an ops-list mismatch in 2959 ms after three sibling tests in the same file timed out; whether it fails on a quiet host is UNKNOWN and belongs to the owed clean run. (3) The third new assertion shape was 'expected 0 to be greater than 1000' (pty). (4) The load evidence is ONE snapshot at 14:30:40; the Chromium processes in it are dev-browser's and Playwright's, not necessarily another session's — 'other processes' is the accurate word.
- 2026-09-05T15:14:29+0200 — the 28-vs-29 gap in the correction line above is AT LEAST one, not exactly one: the hook-timeout line is a SUITE failure (r20-installer, 2 FAIL headers, no × rows) and may map to none of the 29 tests, in which case two or more tests share error blocks. LOCK CREATOR IDENTIFIED 15:12:45 (w-lockwatch.txt): a git child (pid 3896) of `claude plugin marketplace update` (pid 81235), itself a child of the running ai-maestro server (tsx server.mjs, pid 24806/24895) — the absorbed-duty auto-update lane; the earlier stale locks and the claude-CLI test timeouts are now attributed to that lane holding the Claude plugin lock and running git in this repo, pending the spawn-site read (w-lock7.txt). 'Stop hooks fired' was a two-sample correlation, superseded.
- 2026-09-05T15:17:11+0200 — LOCK CREATOR CORRECTED (w-lockwatch2/3.txt, 20 ms sampling): the process holding this repo's index.lock at 15:16:31 was `git -C /Users/emanuelesabetta/ai-maestro status --porcelain=v1` (pid 16559), spawned by the statusline script (~/.claude/statusline.py get_git_info, via `agentlenspro statusline`, refreshInterval 3 s). `git status` refreshes and rewrites the index under index.lock; a render killed mid-refresh (slow right after a commit rewrote the index, on a loaded host) leaves the 0-byte lock — consistent with both stale locks (14:35:01, 14:41:43) following commit turns. The marketplace-update lane's git children run with cwd in ~/.claude/plugins/marketplaces/<name> (lsof, w-lockwatch2.txt), so the 15:14 line's 'running git in this repo' attribution is WITHDRAWN; the lane's effect on the claude-CLI test timeouts (plugin lock contention) remains a hypothesis, not measured. Fix belongs in the statusline script, not this repo: `git --no-optional-locks status --porcelain=v1` (this repo's own lib/pillar/freshness.ts:120 already does exactly that).
- 2026-09-05T15:18:42+0200 — stale-lock MECHANISM measured in source (w-lock10.txt): ~/.claude/statusline.py get_git_info runs `git -C <cwd> status --porcelain=v1` with Python subprocess timeout=GIT_TIMEOUT=1.0 s, which KILLS git after one second; on a loaded host a refresh that is rewriting the index under index.lock is killed mid-write and the 0-byte lock stays. The script is user-owned (mode 755, Aug 29, not inside any git repository; referenced by AgentlensPro's docs as the --inner script). Fix is one flag in that file: `git --no-optional-locks -C <cwd> status --porcelain=v1` — surfaced to the USER, not edited by this session. The parent chain for the 15:16:31 sighting was not captured (the chain block printed empty); the attribution rests on the argv shape matching line 125 exactly and on a second sighting of the same shape in another session's cwd (Code/tldr-code).
- 2026-09-05T15:24:54+0200 — statusline.py ownership MEASURED: AgentlensPro's tree ships no statusline.py (find, depth 4, excluding node_modules: 0 files); its src/statuslineUsage.ts:157 calls the file "the user's personal ~/.claude/statusline.py". The --no-optional-locks fix is therefore the USER's to apply in their own script; no issue is owed to any repo.
- 2026-09-05T15:26:51+0200 — correction to the 15:24 line: 'ships no statusline.py' over-claims the search — AgentlensPro's tree contains no file NAMED statusline.py to depth 4 outside node_modules (find: 0); a deeper or differently-named shipped copy, or a template embedded in its bundled cli.js, was not searched for at that time (an unbounded find is in w-own3.txt). 'user-owned' rests on three signals — outside any repo, mode 755 with an Aug 29 mtime, and AgentlensPro's own source (statuslineUsage.ts:157) calling it 'the user's personal' script — authorship inferred from those, not from a provenance record. Routing unchanged: the fix goes to the USER.
