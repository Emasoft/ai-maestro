---
trdd-id: 95IKXQI6
title: Parameterize install/update scripts with a custom git repo+branch and a version-downgrade guard
column: completed
created: 2026-07-21T20:51:42+0200
updated: 2026-08-22T16:20:24.101Z
current-owner: ai-maestro
task-type: infra
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-21T20:51:42+0200
relevant-rules: []
labels: [installer, updater, remote-install, decoupling, destructive-safety]
release-via: none
implementation-commits: [a5485043, 139ae56f, 93472eb4, eba494a9]
---

# Parameterize install/update scripts with a custom git repo+branch and a version-downgrade guard

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-21

**USER mandate (verbatim intent):** *"update the install and update scripts (remote or not)
to accept a custom git repo as parameter, to use instead of the official one. then you can
install/update from any branch you need. but watch out for installing a previous version on a
new version by error. and, btw, the updater and the installer does not install or update the
plugins from ai-maestro-plugins marketplace — that is a job done by ai-maestro itself when
creating a new agent or by the janitor when armed."*

**Two scripts, both installers of the SCRIPT LAYER (never marketplace plugins):**
- `scripts/remote-install.sh` — the `curl|bash` remote installer/updater of the whole app.
- `install-messaging.sh` — the local installer of the `~/.local/bin` frozen scripts.

**Deliverables (this TRDD):**
1. `--repo <SRC>` + `--branch <b>` on BOTH (env `AIMAESTRO_REPO`/`AIMAESTRO_BRANCH` on the
   remote one). `<SRC>` = `owner/repo` shorthand → `https://github.com/owner/repo.git`, a full
   URL (passed through), OR a **local repo path** (absolute, `.`/`..`, `file://`, quoted `~/…`
   → all passed through un-mangled; a bare `~/*` case pattern tilde-EXPANDS and must not be used).
2. **remote-install.sh default `REPO_URL` STAYS `23blocks-OS/ai-maestro`** (the current official
   upstream). See the SUPERSEDED note — the flip to the Emasoft fork waits for merge→main→push;
   until then the fork's main is stale and defaulting to it would install an OLDER version. For
   DEV, install/update from the LOCAL governance-rules checkout via `--repo ~/ai-maestro --branch
   governance-rules` (or just run install-messaging.sh, which installs from its local tree by
   default).
3. **Version-downgrade guard** on remote-install.sh UPDATE path: fetch the target branch, read
   its `package.json` version, REFUSE if the installed version is strictly newer, unless
   `--allow-downgrade`. `_version_gt` via `sort -V`.
4. remote-install.sh update pull is **branch-aware** (was hardcoded `git pull origin main`) —
   pulls the explicitly-requested `--branch`, else the currently-checked-out branch; re-points
   `origin` only when `--repo` is explicitly passed.
5. install-messaging.sh `--repo/--branch` = **opt-in** clone-to-temp then install scripts from
   there; with NEITHER flag it does ZERO network I/O and uses its own checked-out tree (already
   "the current branch") — preserving the destructive-safety property.

**Deliberately NOT done (with reasons):**
- No downgrade guard in install-messaging.sh: it installs **versionless** shell files to
  `~/.local/bin` from a source the user explicitly named; there is no clean "installed script
  version" to compare, and coupling it to the app-install location (`~/ai-maestro/version.json`)
  is fragile. The version guard belongs to the one script that manages the versioned app.
- No touching of the marketplace-plugin path (install-messaging.sh option 2/3 skill install):
  per the USER clarification that is NOT the script-installer's job; agent plugins are
  ai-maestro's (on create) / the janitor's (when armed). Left unchanged.
- Gateways repo (`GATEWAYS_REPO`, separate `23blocks-OS/aimaestro-gateways`) left as-is —
  out of scope; the USER's concern is the main app source.

**VERIFIED (2026-07-21):** both scripts `bash -n` clean; `_normalize_repo_url` (shorthand→URL,
`.git` idempotent, URL/ssh passthrough) and `_version_gt` (refuses 0.57.10>0.57.3 numeric
downgrade, allows equal/upgrade) unit-tested in isolation and correct; no NEW shellcheck issues
(remaining info items are pre-existing, outside the edited regions).

**DEFERRED — live end-to-end install/update run.** Not exercised here: running the installer
requires a clean TARGET machine, and running it against `~/ai-maestro` (the live dev tree) is
unsafe — the new guard would correctly REFUSE a main-over-governance-rules downgrade, but the
update path's `git stash`/`pull` would still touch the dev branch. The human exercises the
custom-source path on a real target (`bash scripts/remote-install.sh --repo Emasoft/ai-maestro
--branch governance-rules`, or `bash install-messaging.sh --repo Emasoft/ai-maestro --branch
governance-rules`). This is why column=testing, not complete.

## Verification
- `bash -n scripts/remote-install.sh && bash -n install-messaging.sh` → 0 errors. ✓
- `_normalize_repo_url` / `_version_gt` isolated logic tests → all cases correct. ✓
- `--repo`/`--branch`/`--allow-downgrade` in remote-install `show_help`; `--repo`/`--branch` in
  install-messaging `-h`. ✓
- Live install/update against a clean target → DEFERRED to the human (see above).

## ⏱ VERIFIED 2026-08-02 — the two guards were unpinned, and one fixture passed by accident

**1. Everything the card asserts, re-checked live and true.** Both scripts `bash -n` clean;
`_normalize_repo_url` (`scripts/remote-install.sh:241`) and `_version_gt` (`:263`) present and
correct; `--repo` / `--branch` / `--allow-downgrade` all in `show_help` (`:373-375`) and
`--repo` / `--branch` in install-messaging's `-h` (`:57-59`); the downgrade refusal wired at
`:1167` with the `--allow-downgrade` escape named in its own message at `:1169`. **The USER
correction held**: the default is still `23blocks-OS/ai-maestro` (`:49`), not the Emasoft fork.

**2. THE TWO GUARDS WERE PINNED BY NOTHING.** The Verification list says *"isolated logic tests →
all cases correct ✓"* — those were ad hoc and are gone; no committed test named either function.
`_version_gt` IS the guard the USER's mandate asked for by name (*"watch out for installing a
previous version on a new version by error"*), and its failure is **silent**: a wrong comparison
does not error, it lets the older version install over the newer one.

Written and pinned (`tests/unit/remote-install-guards.test.ts`, 16 tests, `93472eb4`). By
EXTRACTION, not by sourcing — `remote-install.sh` is a `curl | bash` installer, so single-file is a
design constraint and its last line is `main "$@"`; sourcing it would RUN THE INSTALLER. Bounded
`^_name() {$` → the first bare `}`, because brace-COUNTING desyncs on `${r%.git}` and
`${r/#\~\//$HOME/}`, whose braces are not block braces.

**3. AND THE NEUTERS FOUND A FIXTURE THAT PASSED FOR AN ACCIDENTAL REASON** (`eba494a9`).
`../ai-maestro` was resolved against vitest's CWD — the repo root, whose PARENT contains a directory
of that name — so `[ -d ]` caught it and the case under test never ran. It stayed **green** under
the neuter that deletes the very case it exists to pin. Now run from an empty temp dir. Both of my
written predictions were wrong and are corrected in the file's neuter record; the surviving point is
that the `0.57.10 > 0.57.3` case is the ONLY one able to tell a numeric comparison from a
lexicographic one (rollover and equality agree under both).

**4. The two implementing commits were unrecorded.** `a5485043` + `139ae56f` are named in the prose
but the frontmatter had no `implementation-commits:` — the backtracking field. Added.

## SUPERSEDED — do NOT carry forward
- The first pass (commit a5485043) flipped the remote-install.sh default `REPO_URL` from
  `23blocks-OS/ai-maestro` → `Emasoft/ai-maestro`, reasoning from CLAUDE.md that Emasoft is
  canonical. **USER corrected this (2026-07-21): the default IS and STAYS 23blocks-OS/ai-maestro.**
  The Emasoft-fork flip is future work gated on merge→main→push (the fork's main is stale, so the
  premature default would install an OLDER version — the very downgrade the guard exists to catch).
  Reverted in the follow-up commit; `--repo` (now incl. local paths) is the override for dev.

## Acceptance

Transcribed 2026-08-02 from this card's own `## Verification` list and its 5 numbered Deliverables,
re-run live. The last box stays OPEN and is owed by the **human**, not by this card's code — the card
says so itself, and it is why `column: testing` is correct rather than `complete`.

- [x] **D1** `--repo <SRC>` + `--branch` on BOTH scripts, `AIMAESTRO_REPO`/`AIMAESTRO_BRANCH` on the
      remote one (`remote-install.sh:49-55`, `install-messaging.sh:35-44`). `<SRC>` accepts
      `owner/repo`, a full URL, and a LOCAL path (absolute, `./`, `../`, `file://`, quoted `~/…`)
- [x] **D2** the default `REPO_URL` STAYS `23blocks-OS/ai-maestro` (`:49`) — the USER's correction,
      not the first pass's flip to the Emasoft fork. See SUPERSEDED below
- [x] **D3** version-downgrade guard on the UPDATE path: refuses when the installed version is
      strictly newer, unless `--allow-downgrade` (`:1167`, message at `:1169`)
- [x] **D4** the update pull is branch-aware (was a hardcoded `git pull origin main`); `origin` is
      re-pointed only when `--repo` is explicitly passed
- [x] **D5** install-messaging `--repo`/`--branch` are OPT-IN — with neither flag it does ZERO
      network I/O and installs from its own checked-out tree, preserving the destructive-safety
      property (`--branch` without `--repo` is refused, `:128`)
- [x] `bash -n scripts/remote-install.sh && bash -n install-messaging.sh` → 0 errors
- [x] `_normalize_repo_url` / `_version_gt` logic correct — **now by committed test rather than by
      an ad-hoc run that left no trace**: 16 tests + 2 measured neuters (`93472eb4`, `eba494a9`)
- [x] `--repo`/`--branch`/`--allow-downgrade` in remote-install `show_help`; `--repo`/`--branch` in
      install-messaging `-h`
- [~] **live install/update against a clean target** — **DESCOPED 2026-08-22 to `TRDD-MSLBWEDK`.**
      It is a PHYSICAL act on a machine this session does not have, and the standing owner grant
      moves review verdicts, not machines. Ticking it would be a lie; leaving it open would hold a
      finished card hostage to a host nobody has provisioned. So it moves out whole, with its
      reason SHARPENED — see the verdict block, which corrects this box's own stated rationale:
      the binding constraint is the GLOBAL pm2 identity, not the update path's `git stash`

## ✅ REVIEW VERDICT 2026-08-22 — COMPLETE, with one box descoped to `TRDD-MSLBWEDK`

Reviewed under the standing owner grant. Eight of nine boxes were already verified; the ninth is a
physical act. Two things were done rather than asserted.

**1. Part of the deferred box WAS runnable here, and was run.** The box bundled "the flags work" with
"a whole machine gets installed", and only the second half needs a host:

```
$ bash scripts/remote-install.sh --help
  -d, --dir PATH      Install directory (default: ~/ai-maestro)
  --repo SRC          Custom source: owner/repo, a full git URL, or a local repo
  --branch NAME       Branch to install/update from (env: AIMAESTRO_BRANCH)
  --allow-downgrade   Permit updating to an OLDER version than installed

$ bash install-messaging.sh --branch governance-rules      # D5's guard, zero network I/O
exit=1
❌ --branch requires --repo (no source repo to clone)
```

The second is `install-messaging.sh:128` executing for real — D5's opt-in property demonstrated by
its refusal path rather than by reading the source.

**2. The box's stated reason for deferral is WRONG, and the right one is stronger.** It says the
danger is *"the update path's `git stash`/`pull` touch[ing] the live dev branch"*. Read live:

- An update here never REACHES `git stash`. Two pre-mutation guards fire first — the downgrade guard
  (`scripts/remote-install.sh:1171`) and the unpushed-vs-remote guard (`:1186`, TRDD-0N792LL5), the
  latter refusing outright because this checkout carries ~140 commits not on `origin`.
- The real constraint applies to the INSTALL path too, so a fresh `--dir` does NOT escape it: `--dir`
  parameterizes the directory (`:280`) while the pm2 app IDENTITY is hardcoded — `--only ai-maestro`
  (`:1438`) / `--name ai-maestro` (`:1442`) then `pm2 save` (`:1444`). There is ONE `ai-maestro` pm2
  app on this machine and it is the live server on `:23000`. A scratch install would re-point it and
  persist that across reboot. It also runs `claude plugin uninstall` / `marketplace remove`
  (`:524-525`). There is no `--dry-run` on either script.

That correction is the substance of this review: had the deferral been left on its original
rationale, a future tester could reasonably have concluded that a fresh `--dir` made the run safe
here. It does not.

**VERDICT: COMPLETE.** The card's own deliverables D1-D5 all landed, are unit-pinned with measured
neuters, and their argument-parsing surface is now demonstrated live. The clean-target run leaves as
`TRDD-MSLBWEDK` carrying the corrected reason and the two commands already discharged.

## Approval log

- 2026-08-22T18:22:00+0200 — REVIEWED and CLOSED `human_review → complete` under the standing owner
  grant. Eight boxes re-affirmed; the ninth DESCOPED to `TRDD-MSLBWEDK` (a physical act needing a
  clean host — the grant moves verdicts, not machines). Two live runs discharged part of it here;
  the deferral's rationale was corrected from the update-path stash to the global pm2 identity.

- 2026-08-05T01:08:00+0200 — `testing → human_review`. Column only; no work, no boxes, no scope changed.
  `testing` asserts someone is actively working this card, and nobody is — its one box is marked *"DEFERRED to the human, deliberately and for a good reason"* — the installer needs a clean TARGET machine, and running it here would have the update path's `git stash`/`pull` touch the live dev branch.
  `blocked` would be the wrong move: it requires a non-empty `blocked-by:` naming an open
  CARD, and what this waits on is a person, not a card. `human_review` is the column that
  says "done to the point where a human must act", which is true. Re-columned during the
  triage of the 13 stale WORK-column cards, after reading this card's open box individually.

- 2026-07-21T20:51:42+0200 — MANDATE (Tier-0, self, in-scope infra). No approval request sent.
- 2026-07-21T21:12:00+0200 — USER correction folded in: default reverted to 23blocks-OS;
  `--repo` extended to accept local repo paths (the dev-workflow source).
- 2026-08-22T16:20:18.391Z — column → complete. Reviewed under the owner grant; 8 boxes re-affirmed, the live clean-target run descoped to TRDD-MSLBWEDK with a corrected rationale.
- 2026-08-22T16:20:24.101Z — COMPLETED by user. archived → completed.
