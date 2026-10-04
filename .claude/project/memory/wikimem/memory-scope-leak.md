---
name: memory-scope-leak
description: "the janitor's memory-scope-leak detector flagged PROJECT pages for machine-host or PII — is this finding real or a false positive / what must I check before demoting a memory page to LOCAL / a detector says my PROJECT memory page carries machine-private data / does the machine-host rule fire on myteam.local or default.local scope placeholders / does pii:us_passport match a governance verdict id like G20260731 / can settings.local.json as a filename trip the leak detector / will demoting a correct PROJECT page remove shared knowledge from the pushed corpus / where does machine-private project memory belong / how do I verify a memory-scope-leak finding before acting / the janitor surfaced a scope-leak candidate on this page / is the memory-scope-leak detector's demote-to-LOCAL prescription safe to follow blindly / what is a shape match versus a meaning match in the leak detector / why does the janitor only surface leaks and never edit pages / RULE 0 for memory pages / what does re-running the scope-leak detector do to the proposal file / did the detector output change again / why is custom-server-and-websocket-pty flagged machine-host / which pages are the leak candidates in the current output / did the maint-staging row vanish from the leak list again / why did the haephestos-creation-helper and settings-file-watcher rows disappear from the leak list"
ocd: 2026-09-25
lmd: 2026-10-04
publish-globally: false
metadata:
  node_type: memory
  type: reference
  tier: component
---

# memory-scope-leak


^ATOM-EJ83-DSBX [desc: "The PROJECT memory scope is git-tracked and pushed, so it must not carry machine/user-private material; a leak-candidate page's material may belong in the LOCAL scope instead.", keywords: PROJECT_memory_scope_git_tracked_pushed machine_user_private_material_must_not_reach_it where_does_private_project_memory_belong leak_class_may_belong_in_LOCAL_scope pushed_corpus_privacy memory_page_carries_machine_private_data demote_to_LOCAL_never_pushed scope_leak_proposal_page_explains claude_project_memory_privacy_rule what_scope_holds_machine_private_project_notes LOCAL_scope_never_pushed_home_private private_material_in_the_pushed_wiki, ocd: 2026-09-25, lmd: 2026-09-26, claude_mem_hash: 9c9a14ecc608fafe, claude_mem_ref: memory-scope-leak-proposed.md]
The PROJECT memory scope (`<git-root>/.claude/project/memory/`) is git-tracked
and PUSHED, so it MUST NOT carry machine/user-private material. The pages below
carry a leak class that MAY belong in the LOCAL scope
(`~/.claude/projects/<slug>/memory/`, never pushed).


^ATOM-1SKI-CPX5 [desc: "Every leak finding is a SHAPE match, not a meaning match — open the page and confirm the token is genuinely private before acting; a wrong demote destroys shared knowledge.", keywords: verify_each_match_before_acting shape_match_not_meaning_match false_positive_is_common demoting_correctly_PROJECT_page_removes_shared_knowledge acting_on_unverified_hit_destroys_knowledge open_the_page_find_the_token confirm_genuinely_machine_private leak_detector_findings_are_candidates check_before_demoting_memory_page false_positive_rate_scope_leak_detector never_act_on_unverified_detector_finding memory_scope_leak_candidate_not_verdict how_to_verify_a_leak_hit, ocd: 2026-09-25, lmd: 2026-09-26, claude_mem_ref: memory-scope-leak-proposed.md, claude_mem_hash: 9c9a14ecc608fafe]

**VERIFY EACH MATCH BEFORE ACTING — these are SHAPE matches, not meaning
matches, and a false positive is COMMON.** Demoting a correctly-PROJECT page
removes it from the pushed corpus every contributor shares, so acting on an
unverified hit DESTROYS shared knowledge. Open the page, find the token, and
confirm it is genuinely machine/user-private. Known systematic collisions:


^ATOM-9Q0O-UQXH [desc: "The machine-host rule fires on ANY .local suffix — legitimate non-host senses include scope/team placeholders (default.local, myteam.local, org.local) and the filename settings.local.json.", keywords: machine_host_fires_on_any_local_suffix scope_team_placeholders_default_local myteam_local_org_local_are_not_hosts filename_settings_local_json_flagged page_documenting_that_config_file systematic_collision_machine_host local_suffix_false_positive is_myteam_local_a_hostname why_settings_local_json_trips_leak_detector collision_class_one_of_the_leak_detector amp_address_format_uses_local_suffix scope_placeholder_names_in_tests, ocd: 2026-09-25, lmd: 2026-09-26, claude_mem_ref: memory-scope-leak-proposed.md, claude_mem_hash: 9c9a14ecc608fafe]

- `machine-host` fires on ANY `.local` suffix. Legitimate non-host senses seen
  in practice: scope/team placeholders (`default.local`, `myteam.local`,
  `org.local`) and the FILENAME `settings.local.json` — a page documenting that
  config file is flagged for naming its own subject.


^ATOM-MUO2-Y2NR [desc: "pii:us_passport is [A-Z] + 8 digits, which is also the shape of a governance/verdict id (G20260731) and of many date-suffixed ids — a corpus minting ids in that shape collides with it systematically.", keywords: pii_us_passport_is_uppercase_plus_eight_digits governance_verdict_id_shape_collision G20260731_matches_passport_pattern date_suffixed_ids_collide corpus_minting_ids_in_that_shape us_passport_regex_too_loose why_trdd_conventions_page_flagged verdict_id_not_a_passport_number collision_class_two_of_the_leak_detector passport_detector_false_positive_ids, ocd: 2026-09-25, lmd: 2026-09-26, claude_mem_ref: memory-scope-leak-proposed.md, claude_mem_hash: 9c9a14ecc608fafe]

`pii:us_passport` is `[A-Z]` + 8 digits, which is also the shape of a
governance/verdict id (`G20260731`) and of many date-suffixed ids. A corpus
that mints ids in that shape collides with it systematically.


^ATOM-85YO-EWJB [desc: "Only when a hit is REAL: demote the fact to LOCAL or rewrite the page portable; a false positive is left alone — the janitor surfaces only and never edits a page (RULE 0).", keywords: only_when_hit_is_real_demote_to_LOCAL move_or_rewrite_the_page_portable false_positive_leave_the_page_alone do_not_fix_do_not_delete_knowledge janitor_only_surfaces_never_edits RULE_0_memory_pages_never_edited_by_detector neither_should_an_agent_acting_on_unverified_match what_to_do_when_leak_hit_is_real remedy_for_a_real_scope_leak portable_rewrite_of_project_page no_usernames_paths_hosts_secrets, ocd: 2026-09-25, lmd: 2026-09-26, claude_mem_hash: 9c9a14ecc608fafe, claude_mem_ref: memory-scope-leak-proposed.md]
Only when the hit is REAL: demote the offending fact to LOCAL (move it, or
rewrite the page portable). If the hit is a false positive, leave the page
ALONE — do not 'fix' it, and do not delete the knowledge. The janitor only
SURFACES — it never edits a page (RULE 0), and neither should an agent acting
on an unverified match.




^ATOM-ZE77-92C9 [desc: "Detector output 2026-10-04, hash 54b01413b205272f: 5 rows — overview, amp-messaging, custom-server (machine-host), trdd-conventions (pii), wikimem self-row (both); haephestos + watcher rows vanished.", keywords: detector_output_regenerated_2026_10_04 which_pages_are_leak_candidates_now current_leak_row_list haephestos_creation_helper_row_vanished settings_file_watcher_ledger_row_vanished two_rows_dropped_from_leak_list content_hash_54b01413b205272f transient_rows_vanish_between_runs rows_are_per_run_snapshots demote_to_LOCAL_scope_prescription machine_host_row_list_current trdd_conventions_pii_us_passport_row custom_server_and_websocket_pty_flagged_machine_host no_maint_staging_row_this_run, ocd: 2026-10-04, lmd: 2026-10-04, claude_mem_hash: 54b01413b205272f, claude_mem_ref: memory-scope-leak-proposed.md]

The proposal file this page mirrors (`memory-scope-leak-proposed.md`) is the
`memory-scope-leak` detector's own OUTPUT — regenerated whenever the finding
set changes (content hash 54b01413b205272f, verified current 2026-10-04), so the
row list below is a snapshot, not a stable registry. Its rows:
`ai-maestro-overview.md`, `amp-messaging.md`, `custom-server-and-websocket-pty.md` (machine-host)
and `trdd-conventions.md` (pii:us_passport) plus this page's own self-row
(`wikimem/memory-scope-leak.md`, machine-host + pii:us_passport — the documented
"page naming its own subject" collision) — each prescribed "demote to LOCAL scope".
Measured 2026-08-02 on this store: 9 findings, 9 false positives — treat every row as a
CANDIDATE to verify, never a verdict. The 2026-09-28 output's `haephestos-creation-helper.md`
and `settings-file-watcher-ledger.md` machine-host rows are GONE from the 2026-10-04
output — no `.maint-staging` transient row appeared this run (the pass's staging dir
existed only mid-pass, before the detector re-ran). Rows are per-run snapshots.

- `.claude/project/memory/ai-maestro-overview.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/amp-messaging.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/custom-server-and-websocket-pty.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/trdd-conventions.md` — pii:us_passport — demote to LOCAL scope
- `.claude/project/memory/wikimem/memory-scope-leak.md` — machine-host, pii:us_passport — demote to LOCAL scope

## See also

- [[public-repo-personal-data]]

## Superseded


^ATOM-J658-OTRL [desc: "Detector output 2026-09-28 (84b338ed98be48e7): machine-host rows incl. custom-server-and-websocket-pty + trdd-conventions pii:us_passport; a .maint-staging row is the pass's own txn dir, not a leak.", keywords: detector_output_regenerated_2026_09_28 maint_staging_row_transient swept_up_own_staging_dir custom_server_and_websocket_pty_flagged_machine_host why_did_custom_server_page_get_flagged proposal_file_row_list_changed new_row_in_leak_proposal content_hash_84b338ed98be48e7 transient_rows_vanish_between_runs rows_are_per_run_snapshots demote_to_LOCAL_scope_prescription machine_host_row_list_current which_pages_are_leak_candidates_now trdd_conventions_pii_us_passport_row row_naming_maint_staging_is_snapshot harvest_pass_own_txn_swept_up, ocd: 2026-09-28, lmd: 2026-09-28, claude_mem_hash: 84b338ed98be48e7, claude_mem_ref: memory-scope-leak-proposed.md, status: superseded, superseded-by: ATOM-ZE77-92C9]

The proposal file this page mirrors (`memory-scope-leak-proposed.md`) is the
`memory-scope-leak` detector's own OUTPUT — regenerated whenever the finding
set changes (content hash 84b338ed98be48e7, verified current 2026-09-28), so the
row list below is a snapshot, not a stable registry. Its rows:
`ai-maestro-overview.md`, `amp-messaging.md`, `custom-server-and-websocket-pty.md`,
`haephestos-creation-helper.md`, `settings-file-watcher-ledger.md` (machine-host) and
`trdd-conventions.md` (pii:us_passport) — each prescribed "demote to LOCAL scope".
Measured 2026-08-02 on this store: 9 findings, 9 false positives — treat every row as a
CANDIDATE to verify, never a verdict. Transient rows appear and vanish run to run: the
2026-09-26 output carried two (this page's own mid-fix PUBLISHED state; the detector's
staging dir while `.maint-staging` existed mid-pass), and the 2026-09-28 output swept
up THIS harvest pass's own just-committed staging dir
(`.maint-staging/8eff8fac…`) while it existed mid-pass — a row that already
vanished again. A row naming `.maint-staging/` is the detector's snapshot of
its own pass machinery, never a real leak.

- `.claude/project/memory/.maint-staging/8eff8fac28f74b6b849fac7249127bd0/wikimem/memory-scope-leak.md` — machine-host, pii:us_passport — demote to LOCAL scope
- `.claude/project/memory/ai-maestro-overview.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/amp-messaging.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/custom-server-and-websocket-pty.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/haephestos-creation-helper.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/settings-file-watcher-ledger.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/trdd-conventions.md` — pii:us_passport — demote to LOCAL scope
- `.claude/project/memory/wikimem/memory-scope-leak.md` — machine-host, pii:us_passport — demote to LOCAL scope

^ATOM-1MC3-9LZ9 [desc: "Detector output regenerated 2026-09-28 (b11ecbc0464d0f96): 5 machine-host rows incl. custom-server-and-websocket-pty + trdd-conventions pii:us_passport — per-run snapshot, candidates not verdicts.", keywords: detector_output_regenerated_2026_09_28 custom_server_and_websocket_pty_flagged_machine_host why_did_custom_server_page_get_flagged proposal_file_row_list_changed new_row_in_leak_proposal maint_staging_row_vanished content_hash_b11ecbc0464d0f96 transient_rows_vanish_between_runs rows_are_per_run_snapshots demote_to_LOCAL_scope_prescription machine_host_row_list_current which_pages_are_leak_candidates_now trdd_conventions_pii_us_passport_row memory_scope_leak_page_self_row, ocd: 2026-09-25, lmd: 2026-09-28, claude_mem_hash: b11ecbc0464d0f96, claude_mem_ref: memory-scope-leak-proposed.md, status: superseded, superseded-by: ATOM-J658-OTRL]

The proposal file this page mirrors (`memory-scope-leak-proposed.md`) is the
`memory-scope-leak` detector's own OUTPUT — regenerated whenever the finding
set changes (content hash b11ecbc0464d0f96, verified current 2026-09-28), so the
row list below is a snapshot, not a stable registry. Its rows:
`ai-maestro-overview.md`, `amp-messaging.md`, `custom-server-and-websocket-pty.md`,
`haephestos-creation-helper.md`, `settings-file-watcher-ledger.md` (machine-host) and
`trdd-conventions.md` (pii:us_passport) — each prescribed "demote to LOCAL scope".
Measured 2026-08-02 on this store: 9 findings, 9 false positives — treat every row as a
CANDIDATE to verify, never a verdict. The 2026-09-26 output's two transient rows (this
page's own mid-fix PUBLISHED state; the detector's staging dir while `.maint-staging`
existed mid-pass) are gone from the 2026-09-28 output — rows are per-run snapshots.

- `.claude/project/memory/ai-maestro-overview.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/amp-messaging.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/custom-server-and-websocket-pty.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/haephestos-creation-helper.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/settings-file-watcher-ledger.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/trdd-conventions.md` — pii:us_passport — demote to LOCAL scope
- `.claude/project/memory/wikimem/memory-scope-leak.md` — machine-host, pii:us_passport — demote to LOCAL scope
^ATOM-FUVD-QA0Q [desc: "Detector's own output, regenerated when findings change (buffer hash 1afc70e2154f7d32); every row is a candidate to verify, never a verdict — transient rows appear and vanish run to run.", keywords: the_proposal_file_is_detector_output memory-scope-leak-proposed_regenerated snapshot_of_the_finding_set content_hash_1afc70e2154f7d32 content_hash_9c9a14ecc608fafe list_of_leak_candidate_pages_is_transient ai-maestro-overview_machine-host_row amp-messaging_machine-host_row haephestos-creation-helper_row settings-file-watcher-ledger_row trdd-conventions_pii_us_passport_row measured_2026-08-02_nine_findings_nine_false_positives treat_every_row_as_candidate_not_verdict re-run_clears_proposal_once_leak_gone 2026-09-26_regeneration_removed_transient_PUBLISHED_row wikimem_memory-scope-leak_row_now_plain_demote detector_swept_up_a_maint_staging_path_row transient_row_for_the_pass_own_staging_dir, ocd: 2026-09-25, lmd: 2026-09-26, claude_mem_hash: 1afc70e2154f7d32, claude_mem_ref: memory-scope-leak-proposed.md, status:superseded, superseded-by:ATOM-1MC3-9LZ9]

The proposal file this page mirrors (`memory-scope-leak-proposed.md`) is the
`memory-scope-leak` detector's own OUTPUT — regenerated whenever the finding
set changes (content hash 1afc70e2154f7d32, current as of 2026-09-26), so the
row list below is a snapshot, not a stable registry. Its rows:
`ai-maestro-overview.md`, `amp-messaging.md`, `haephestos-creation-helper.md`,
`settings-file-watcher-ledger.md` (machine-host) and `trdd-conventions.md`
(pii:us_passport) — each prescribed "demote to LOCAL scope". Measured
2026-08-02 on this store: 9 findings, 9 false positives — treat every row as a
CANDIDATE to verify, never a verdict. The 2026-09-26 regeneration removed the
transient row this page itself once carried (the mid-fix PUBLISHED/symlink
state, verified stale 2026-09-25 — preserved verbatim at the bottom). The same
2026-09-26 pass also observed the detector briefly emit a row for its OWN
harvest agent's staging dir (`.maint-staging/<txn>/wikimem/…`) while that dir
existed mid-pass — it vanished when the dir did, confirming rows are
regenerated per-run snapshots, not durable findings.

- `.claude/project/memory/.maint-staging/e31f63e198b643c791cb5cf3c2bed9fc/wikimem/memory-scope-leak.md` — machine-host, pii:us_passport — demote to LOCAL scope
- `.claude/project/memory/ai-maestro-overview.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/amp-messaging.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/haephestos-creation-helper.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/settings-file-watcher-ledger.md` — machine-host — demote to LOCAL scope
- `.claude/project/memory/trdd-conventions.md` — pii:us_passport — demote to LOCAL scope
- `.claude/project/memory/wikimem/memory-scope-leak.md` — machine-host, pii:us_passport — demote to LOCAL scope

PREVIOUS SNAPSHOT (superseded 2026-09-26, preserved verbatim) — the
2026-09-25 regeneration had carried a transient row for this page:

- `.claude/project/memory/wikimem/memory-scope-leak.md` — machine-host, pii:us_passport — PUBLISHED (`publish-globally: true`) — symlinked into the USER root and recalled from EVERY project, so demoting THIS copy retracts nothing; fix the page itself, then reconsider whether it should stay published
  - VERIFIED STALE 2026-09-25: this row recorded a transient mid-fix state. This page's actual flag is `publish-globally: false` with no USER-root symlink — it is a normal unpublished PROJECT page. Its leak-class hits are the documented collision shapes (`.local` suffixes in the collision examples it quotes; id-shaped strings like the hash it cites), i.e. the page trips the detector by naming the detector's own false-positive vocabulary — the exact "a page documenting that config file is flagged for naming its own subject" case the machine-host class documents. Leave the page alone.

_Surfaced by the `memory-scope-leak` detector. Resolve by moving the private fact to the LOCAL scope (the harness `# Memory` dir), or by rewriting the PROJECT page to be portable (no usernames/paths/hosts/secrets). Re-run clears this once the leak is gone._


## Notes and lessons learned
