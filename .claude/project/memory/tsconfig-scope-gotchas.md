---
name: tsconfig-scope-gotchas
description: "tsc fails on a file git does not track / error in a stray backup .ts file under reports / why does tsc noEmit pick up a file outside src / tsconfig include globbed every .ts including gitignored dirs / type-check fails on a file that is not part of the app / reports folder polluting the typescript compile / how to scope tsconfig include to exclude scratch backups / tsc noEmit reports errors in reports_dev or reports / a gitignored backup .ts file breaks the build check / typescript compiler scanned a file it should never see / tsconfig include pattern is too broad ** / include everything ts under project root / a .ts backup left in reports caused 3 type errors / why is tsc slower or noisier than expected / exclude reports and reports_dev from tsconfig"
ocd: 2026-09-05
lmd: 2026-09-05
publish-globally: false
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: tooling-and-testing
---

# tsconfig-scope-gotchas


^ATOM-NAJ6-KZ0N [desc: "tsconfig include **/*.ts pulled stray backup .ts files under gitignored reports/ into tsc", keywords: tsconfig_exclude reports_folder tsc_noEmit stray_backup_ts_file gitignored_file_breaks_build include_globs_too_broad type-check_error_in_untracked_file reports_vs_reports_dev tsc_picks_up_wrong_file ef37fb6d build_fails_on_scratch_file, ocd: 2026-09-05, lmd: 2026-09-05]

tsconfig.json's include: ['**/*.ts'] pulled in stray .ts backup files sitting under the gitignored reports/ folder, so a plain yarn build / tsc --noEmit could fail on a file git does not track (one such backup carried 3 real type errors that had nothing to do with the app). reports_dev/ was already excluded; reports/ was not. Fixed by adding reports to tsconfig's exclude list alongside reports_dev, commit ef37fb6d.

## Notes and lessons learned
