---
trdd-id: XCQ9TDSK
title: trddgrep move out of blocked leaves blocked-by populated, which the 3-pillars spec calls drift
column: complete
created: 2026-09-05T11:25:38+0200
updated: 2026-09-05T11:38:31+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: bugfix
min-approval-requirement: none
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-05T11:25:38+0200
implementation-commits: [d27978d9]
---

# trddgrep move out of blocked leaves blocked-by populated, which the 3-pillars spec calls drift

`trddgrep move <id> complete` on a `blocked` card renames it into archived/ and sets the column but leaves `blocked-by:` populated. Measured 2026-09-05 on DQVPODKW (blocked-by [1LFRP6GJ], moved blocked→complete after 1LFRP6GJ closed): the next `trddgrep validate` raised GRAPH-DANGLING-BLOCKER on a now-frozen card, and the repair had to be a `set blocked-by '[]'` on a terminal card plus an approval-log line (5d400f01, e64d448d). The WHY, read from HEAD lib/trdd-store.ts:755-835 and :1023-1085: TRDD-ISGUYYLN already put the clear into `advanceColumn` — leaving `blocked` refuses while any named blocker is open (or `--clear-blocker` overrides), else sets `blocked-by: []`, blanks `pre-block-column`, and appends "Cleared blocked-by (all blockers terminal)" — but `advanceColumn` serves ONLY moves whose target zone is tasks/ and hands every terminal column to `archiveTrdd` ("advance does not move folders; use the promote/refuse/archive verb"), and `archiveTrdd` contains no blocked-by handling at all (grep of its body: none). So a blocked→terminal move is the one exit from `blocked` that skips the invariant `blocked-by` non-empty ⟺ `column: blocked` (3P-KAN-06; 3-pillars-spec.md:297 calls the resulting state drift). Fix = copy the leaving-blocked block (refuse-while-open / clear / note) into `archiveTrdd`, citing ISGUYYLN; extraction into a shared function is NOT required. Memory: ATOM-N9Y2-EFZH on trdd-conventions. Start after TRDD-MUB7NTRF lands — both change `archiveTrdd`.

## Acceptance

- [x] `trddgrep move` out of `blocked` into ANY column (terminal or working) clears `blocked-by:` and names the cleared blockers in the appended approval-log line
- [x] a test pins blocked→complete on a fixture card: blocked-by empty afterwards, and a neuter that skips the clear reddens exactly that test
- [x] `trddgrep validate` on a fresh blocked→complete move raises no GRAPH-DANGLING-BLOCKER

## Approval log

- 2026-09-05T11:25:38+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:26:07+0200 — column → todo by manager. Tier 0 self-mandate (min-approval-requirement: none): bounded tool fix against a spec clause the tool already violates (3P-KAN-06 corollary, 3-pillars-spec.md:297). Ready once MUB7NTRF lands in the same move-verb source. Authorization: USER /goal 2026-09-05 'complete all TRDD and pending tasks'.
- 2026-09-05T11:38:31+0200 — COMPLETE by manager. Landed in d27978d9. archiveTrdd now carries the leaving-blocked block (refuse-while-open / clear / note) copied from advanceColumn per ISGUYYLN. Verified first-hand: 51/51, tsc 0; worker neuter reddened exactly the 3 new tests; temp-dir PATH run produced blocked-by [] in archived/. Box 3: the live corpus validate is at its 5-WARN floor with no GRAPH-DANGLING-BLOCKER, and the fixture move showed the state that rule checks cannot recur. Sibling 1G8FBSKZ (entry path) is open. Authorization: USER /goal 2026-09-05 'complete all TRDD and pending tasks'..
