---
trdd-id: MSLBWEDK
title: Live install and update of the parameterized installer against a clean target host
column: todo
created: 2026-08-22T18:19:33+0200
updated: 2026-08-22T18:19:33+0200
current-owner: user
created-by: user
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T18:19:33+0200
---

# Live install and update of the parameterized installer against a clean target host

## Problem

`TRDD-95IKXQI6` shipped `--repo` / `--branch` / `--allow-downgrade` on `scripts/remote-install.sh`
and `install-messaging.sh`, with 16 committed unit tests and 2 measured neuters over
`_normalize_repo_url` / `_version_gt`. Eight of its nine acceptance boxes were verified. The ninth —
**one live install AND one live update against a clean target** — is a PHYSICAL act on a machine
this session does not have, so it is carved out here rather than left holding the parent open.

## Why it cannot be run on the dev box (sharper than the parent's own reason)

The parent deferred it because *"running it against `~/ai-maestro` would have the update path's
`git stash`/`pull` touch the live dev branch."* True, and **not the binding constraint** — the real
one is worse and applies to the INSTALL path too, so "just install into a fresh `--dir`" does not
escape it:

- **The install directory is parameterized; the pm2 app IDENTITY is not.** `--dir` accepts any path
  under `$HOME` (`scripts/remote-install.sh:280-283`), but the script then does
  `pm2 start … --only ai-maestro` (`:1438`) / `pm2 start "yarn start" --name ai-maestro` (`:1442`)
  and `pm2 save` (`:1444`). There is exactly ONE `ai-maestro` pm2 app on this machine and it is the
  live server this session authenticates against on `:23000`. A scratch-dir install would re-point
  that single app at the scratch tree and PERSIST it — so a reboot resurrects the scratch install.
- **It also touches machine-global Claude state** — `claude plugin uninstall` /
  `claude plugin marketplace remove` (`:524-525`).
- There is **no `--dry-run`** on either script (grepped: zero hits).

So the act needs a machine where hijacking the global `ai-maestro` pm2 identity is acceptable: a
clean host, a VM, or a container — not this development box.

## Correction to the parent's rationale, recorded because it changes what a tester expects

An update run here would **not** reach `git stash` at all. Two pre-mutation guards fire first, in
this order (`scripts/remote-install.sh`):

1. `:1171` the downgrade guard — compares `origin/<branch>`'s `package.json` version BEFORE
   mutating the tree.
2. `:1186` the unpushed-vs-remote guard (`unpushed_vs_remote`, TRDD-0N792LL5) — *"Refusing update:
   N commit(s) on '<branch>' are not on origin/<branch>"*. This box carries ~140 such commits, so
   the run would be refused here regardless of versions.

The parent's stash/pull worry is therefore about a line the guards make unreachable on THIS
checkout. The reason to defer is the pm2/plugin hijack above, not the stash.

## What WAS verified live on 2026-08-22, so the tester need not redo it

- `bash scripts/remote-install.sh --help` lists all four flags (`-d/--dir`, `--repo`, `--branch`,
  `--allow-downgrade`) — the flags are wired into the shipped script, not merely documented.
- **D5's refusal path executed for real**, zero network I/O:
  `bash install-messaging.sh --branch governance-rules` → `exit=1`,
  `❌ --branch requires --repo (no source repo to clone)` (guard at `install-messaging.sh:128`).

## Acceptance

- [ ] on a clean target (VM / container / spare host), a live INSTALL:
      `bash scripts/remote-install.sh --repo <owner/repo|url|local path> --branch <name> -d <dir> -y`
      completes, and the tree at `<dir>` is on the requested repo+branch
- [ ] on that same target, a live UPDATE re-run picks up a newer commit on the requested branch and
      pulls it (D4: branch-aware pull, not a hardcoded `git pull origin main`)
- [ ] the downgrade guard REFUSES a live update pointed at an older-versioned branch, and
      `--allow-downgrade` overrides it — the message at `:1172` observed verbatim, not inferred
- [ ] `--repo` accepts a LOCAL repo path end-to-end on that target (the dev-workflow source the
      USER's 2026-07-21 correction added), not just `owner/repo`
- [ ] the run is recorded here with the commands and their output pasted verbatim

## Verification

Paste each command and its real output onto this card. A tester's summary of a run is not the run;
the parent card was closed on exactly this distinction.

## Approval log

- 2026-08-22T18:19:33+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
