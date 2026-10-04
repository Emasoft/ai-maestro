---
name: nul-byte-makes-a-file-invisible-to-grep
description: "grep returns no match for a file I KNOW contains the string / grep -c prints nothing at all / ugrep says no match but --text finds it / git diff shows Bin N -> M bytes 0 insertions for a source file / git log -p shows nothing for a .ts file / a file became binary / why is my markdown unsearchable / raw NUL byte in source / writing \\x00 through the file-write tool produced a real NUL"
ocd: 2026-08-05
lmd: 2026-10-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: tooling-and-testing
publish-globally: false
---

# nul-byte-makes-a-file-invisible-to-grep

^KSJ57N8F [desc: "A single raw 0x00 byte anywhere in a text file makes grep (ugrep) silently report no match for the whole file for every pattern: exit code 1, no error, no warning.", keywords: grep_returns_no_match_for_file_I_know_contains_string grep_c_prints_nothing ugrep_says_no_match_but_text_finds_it raw_NUL_byte_in_source file_became_binary why_is_my_markdown_unsearchable NUL_makes_file_invisible_to_grep silent_no_match_exit_1 raw_0x00_byte ugrep_on_PATH lessons_verification_md_measured_2026_08_05, ocd: 2026-08-05, lmd: 2026-10-02]
**A single raw `0x00` byte anywhere in a text file makes `grep` (ugrep, the one on PATH here)
report NO MATCH for the ENTIRE file — for every pattern, silently.** Not an error. Not a warning.
The exit code is 1, "no match", exactly as if the string were absent.

Measured 2026-08-05: `grep -c "neuter" .claude/rules/lessons-verification.md` printed **nothing**
for a word occurring **65** times. `grep --text -c` printed **45** immediately. The file was fine;
the instrument had gone blind.

## How to recognise it in two seconds

^7WU6SLRL [desc: "Two-second diagnosis: grep --text -c finds the pattern where plain grep does not, and python counts NUL bytes; the file command is NOT a reliable tell because NUL is valid UTF-8.", keywords: grep_text_c_finds_it_plain_grep_does_not count_NUL_bytes_python file_command_unreliable_NUL_valid_UTF_8 iconv_misreports_NUL recognise_NUL_in_two_seconds byte_count_vs_git_Bin_verdict diagnose_invisible_file how_to_detect_raw_NUL ugrep_binary_file_detection grep_text_flag Unicode_text_UTF_8_false_verdict, ocd: 2026-08-05, lmd: 2026-10-02]
```bash
grep --text -c "<pattern>" <file>     # if THIS finds it and plain grep does not, you have a NUL
python3 -c "d=open('<file>','rb').read(); print(d.count(b'\x00'), 'NUL bytes')"
```

`file` is NOT a reliable tell — it called the offending 136 KB file `Unicode text, UTF-8 text`,
because a NUL *is* valid UTF-8. `iconv -f UTF-8 -t UTF-8` also mis-reports. Only a byte count and
git's own `Bin` verdict agree with reality.

## The git half is REAL but only sometimes, which is worse than always

^P9775F5A [desc: "Git sniffs only the first 8000 bytes, so a NUL gives opposite symptoms by position: small .ts files showed 'Bin N -> M bytes' with no diff, a 136 KB file with a late NUL diffed normally.", keywords: git_diff_shows_Bin_N_to_M_bytes_0_insertions git_log_p_shows_nothing_for_ts_file git_sniffs_first_8000_bytes NUL_position_decides_git_binary_verdict diffs_look_fine_does_not_clear_a_file code_review_of_binary_flagged_source lessons_verification_md_136KB_byte_103074 three_ts_mjs_sources_Bin_8440 source_file_became_binary_in_git check_the_bytes_not_the_diff git_binary_heuristic, ocd: 2026-08-05, lmd: 2026-10-02]
Git sniffs only the **first 8000 bytes**. So the same defect gives opposite symptoms depending on
where the byte landed:

| file | size | NUL at | `git diff` |
|---|---|---|---|
| three `.ts` / `.mjs` sources | ~8 KB | line 20-144 | **`Bin 8440 -> 8446 bytes, 0 insertions(+), 0 deletions(-)`** — every diff and code review of them showed NOTHING |
| `lessons-verification.md` | 136 KB | byte 103074 | normal, readable diffs |

So "my diffs look fine" does not clear a file. Check the bytes.

## The cause — you did not type it, and you cannot avoid it by being careful

^RYS7MJN1 [desc: "Writing the NUL escape through an agent's file-write tool can materialize a real raw byte; build NUL from a numeric literal (String.fromCharCode(0), Buffer.from([0])) and verify by byte count.", keywords: writing_x00_through_file_write_tool_produced_real_NUL agent_file_write_tool_materializes_escape String_fromCharCode_0 Buffer_from_0 build_NUL_from_numeric_literal verify_by_byte_count_never_by_reading NUL_invisible_in_terminals String_raw_template_vs_plain_string unpredictable_per_occurrence guard_first_draft_three_raw_NULs escape_transformed_by_tool, ocd: 2026-08-05, lmd: 2026-10-02]
**Writing the escape through an agent's file-write tool can materialize it as the raw byte.** The
guard's own first draft asked for the escape in three places and got three raw NULs, and the corpus
test caught its own test file. It is not even predictable per occurrence: in one write the one
inside a `String.raw` template came through as text while a plain string literal became a byte.

Two things that DO work, both used in the guard:

- **Build a NUL from a numeric literal** — `String.fromCharCode(0)`, `Buffer.from([0])`. No escape
  is involved, so nothing can transform it.
- **Verify by byte count, never by reading.** A NUL is invisible in every terminal and every editor
  that would otherwise show it to you.

## The guard

^FXDSTN6B [desc: "tests/governance/no-nul-bytes-in-tracked-text.test.ts scans tracked non-binary-extension files with positive controls; public/images is the one documented extension-less exception.", keywords: no_nul_bytes_in_tracked_text_test tests_governance_guard scan_set_positive_control empty_scan_set_passes_vacuously public_images_extensionless_PNG_exception 2212_of_2572_tracked_files new_extensionless_binary_reddens_build NUL_corpus_guard tracked_files_known_binary_extensions guard_for_raw_NUL detector_positive_control, ocd: 2026-08-05, lmd: 2026-10-02]
`tests/governance/no-nul-bytes-in-tracked-text.test.ts` — scans every tracked file whose extension
is not a known binary one (2212 of 2572 as of 2026-08-05), plus a positive control on the detector
AND on the scan set, because an empty scan set makes the corpus assertion pass over nothing.

`public/images` is its single documented exception: a 3.2 MB PNG committed with **no extension**.
Listed explicitly rather than sniffed, so a NEW extension-less binary reddens the build and gets
looked at — which is how that one was found.

## See also

- [[pillar-tooling-scale-and-index]] — `scripts/trdd-doctor.mjs`, one of the four files that
  carried a NUL and was therefore unsearchable while being a governance tool.

## Notes and lessons learned
