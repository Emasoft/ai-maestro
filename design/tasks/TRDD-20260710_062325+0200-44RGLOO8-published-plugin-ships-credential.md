---
trdd-id: 44RGLOO8
title: The published web-scenario-tester ships the live governance credential in its rules doc
column: dev
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T14:05:00+0200
created: 2026-07-10T06:23:25+0200
updated: 2026-07-13T14:05:00+0200
current-owner: ai-maestro-session
created-by: ai-maestro-session
priority: 0
severity: CRITICAL
effort: S
task-type: security
labels: [security, credential, scenario-testing, plugin, cross-repo]
parent-trdd: TRDD-f181a4ae
derived: true
derived-kind: eht
npt: []
eht: []
blocked-by: []
min-approval-requirement: user
mandate: false
approved: false
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
test-requirements: []
audit-requirements: [security-scan]
review-requirements: [human-review]
runtime-targets: []
impacts: []
external-refs: ["https://github.com/Emasoft/ai-maestro-web-scenario-tester"]
---

# TRDD-44RGLOO8 — the publish carried the credential out of the repo

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**Do not act on this without the USER. Do not file a public issue on the plugin repo
until the credential is rotated** — see "Why no issue yet" below. An agent must never
rotate a credential.

**What was found.** While settling TRDD-91LLU879 part 3 (consume-the-plugin vs
keep-the-copy), I checked whether the published plugin's copy of the scenario rules
doc had drifted from this repo's. It had — but not in the way I was looking for.

`Emasoft/ai-maestro-web-scenario-tester` is a **public** repo (`visibility: public`,
default branch `master`). At tag **v0.1.3** exactly one of its 69 blobs carries the
live governance-password literal:

| Blob (at `v0.1.3`) | Occurrences |
|---|---|
| `references/SCENARIOS_TESTS_RULES.md` | 2 (a worked example, and a step's Action line) |

The second copy of the same doc, `skills/amwst-scenarios-rules/references/SCENARIOS_TESTS_RULES.md`,
does **not** carry it — so the two shipped copies have already diverged. Verified by
fetching each blob at the tag and grepping; the literal is deliberately not quoted here.

Also verified, and clean: **no blob in the plugin carries the author's absolute home
path.** The de-path defect that TRDD-91LLU879 part 1 fixed in this repo never
propagated into the published artifact.

**Why this is worse than the 32 files in this repo.** `web-scenario-tester` is
registered in the `ai-maestro-plugins` marketplace and its install was smoke-tested
end-to-end (`claude plugin install web-scenario-tester@ai-maestro-plugins`). So the
credential is not merely *committed to a public branch* — it is **shipped to the
plugin cache of anyone who installs the plugin**, and it is inside a tagged release
(v0.1.1–v0.1.3), i.e. in artifacts that a rewrite of `master` would not reach.

**The credential is confirmed live, not stale.** Verified 2026-07-10T06:47 against
`~/.aimaestro/governance.json` (argon2id, `passwordSetAt: 2026-03-29`): the committed
literal still verifies. Method and the verify-that-writes trap it avoided are recorded
on `TRDD-E9BZ5P7S`. So this is not a dead string in an old tag.

**Blast radius, stated honestly.** The password gates sudo-mode: every `strict` route
in `security-registry.json` (delete agent, delete team, purge cemetery, change title,
stop/restart a session, change the password itself). AI Maestro binds to localhost +
the owner's Tailscale CGNAT range only (`isAllowedSource()`), so possessing the
password does not by itself grant network reach. It bounds the impact. It does not
excuse it.

## Why no issue yet — the disclosure order matters

The reflex is to open an issue on the plugin repo. **Do not.** A public issue that
says "a credential literal is committed at `references/SCENARIOS_TESTS_RULES.md`
line 615" is a signpost pointing at a live secret, in the same public namespace, with
a notification fan-out the file itself does not have. It makes the exposure worse
while pretending to fix it.

The order is forced:

1. **USER rotates the governance password.** (TRDD-E9BZ5P7S. An agent must never
   rotate a credential — this step is not mine and never will be.) Rotation is what
   makes every copy — the 32 here, the 2 there, and every one in git history and in
   every already-installed plugin cache — worthless. It is the only step that
   actually fixes anything.
2. *Then* the remaining work is hygiene, and can be done in the open: scrub the
   literal from the plugin's rules doc, re-publish, and open the issue.

**Instruction to whoever promotes this TRDD:** on promotion out of `proposal`, this
page MUST immediately carry `blocked-by: [TRDD-E9BZ5P7S]`, and therefore
`column: blocked` with `pre-block-column: planned`, until rotation lands.

It does **not** carry `blocked-by:` today, and that is deliberate rather than an
oversight. `blocked-by:` asserts that work in flight is stalled; a proposal has no
work in flight, because nobody may execute an unapproved Tier-3 TRDD. Its
`column: proposal` *is* its blocker. Writing `blocked-by:` on a proposal would place
the same page in the pending zone and the RED open-work column simultaneously — the
corpus invariant scanner rejects exactly that, and it rejected this page's first
draft.

## The work, once unblocked

Cross-repo, so it is an **issue + PR on the plugin's own repo** — never an edit of its
tree from this session (`~/.claude/rules/how-to-fix-issues-of-other-projects.md`).

1. Replace both occurrences in `references/SCENARIOS_TESTS_RULES.md` with the
   reference form the plugin's own `scenarios.config.json` spec already mandates:
   `governancePasswordRef: env:AIM_GOVERNANCE_PASSWORD`. The spec is explicit that
   this key holds "a REFERENCE to the test password — never the literal secret", so
   the plugin is already self-contradicting: its config spec forbids exactly what its
   rules doc mandates.
2. Amend the doc's own rule that *requires* the literal — the `governance_password`
   frontmatter field is documented as "The actual password value, in quotes" and
   "Referenced verbatim in steps". That mandate is the root cause; scrubbing the two
   occurrences without amending it re-creates them on the next scenario authored.
3. Re-publish (`publish.py --patch`) so the marketplace resolves a clean version.
4. Decide, with the USER, whether the tagged releases v0.1.1–v0.1.3 are deleted or
   left standing. After rotation they carry a dead string, so "left standing" is a
   defensible answer and avoids a history rewrite.

## Why this is an EHT of f181a4ae, and not of E9BZ5P7S

E9BZ5P7S is repo-scoped: the credential sits in 32 tracked files here, and most of
them predate the publish. Parenting E9BZ5P7S under f181a4ae would assert the publish
caused that, which is false.

What the publish *did* cause is narrower and real: it **propagated a pre-existing
leak into a public, installable, tagged artifact in a second repository.** That is a
hole the change opened, so it is the change's platelet. Its remedy (scrub the plugin,
re-publish) is a different action, in a different repo, from E9BZ5P7S's remedy
(rotate, then de-literalize this repo).

Consequently `TRDD-f181a4ae` stays `column: blocked` with `pre-block-column: published`.
Its publish shipped a live credential; calling that publish `completed` while the
credential is live would be exactly the false completion the flock gate exists to
prevent.

## Approval log

- 2026-07-13T14:05:00+0200 — **APPROVED by the USER (tier 3).** Directed the fix
  and it is half done. USER, verbatim:

  > improve the skill making the governance password read from an env var like the
  > other secrets api keys. then replace the password mentions in clear with the
  > name of the env var, and instructing the web scenarios tester to read it from
  > the env var (or even better: use a script to paste it into the dialog input
  > field automatically, without the model ever read it).

  **DONE (commit `1e6246ff`, this repo — the "even better" option was taken):** the
  helpers take **no password argument** at all; they resolve it themselves from
  `AIM_GOVERNANCE_PASSWORD` and pipe it env → bash → the dev-browser script's
  stdin, so the model never sees, types, or handles the value. 197 literals across
  34 files became the env var NAME; `tests/e2e/helpers.ts` fails fast if it is
  unset; Rule 12 states the invariant; a guard test enforces the SHAPE (not the
  value — pinning today's literal would be worthless after rotation and would
  itself be a committed copy of the secret). Tracked as TRDD-E9BZ5P7S.

  **NOT DONE, and not mine to do — two acts, in this order:**
  1. **The USER rotates the governance password.** It is public at
     `ai-maestro-web-scenario-tester` **v0.1.3** and in that repo's history; no
     amount of redaction here un-publishes it. **An agent must never rotate a
     credential.** Everything above is what makes the *rotated* password safe to
     hold — it is not a substitute for rotating it.
  2. **Only then**, the public repo is cleaned (purge the literal from history,
     republish). Per the cross-project rule this session may not edit that tree —
     it is an issue or a fork+PR — and per this TRDD's own standing warning **no
     public issue may be filed until after the rotation**, because the issue would
     itself advertise the live credential to anyone reading the tracker.

- 2026-07-10T06:23:25+0200 — AUTHORED as a proposal by ai-maestro-session
  (min-approval-requirement: user). Not a mandate: the author's authority is below the
  tier this TRDD requires. Touches a shared credential and a public artifact, so the
  D3 objective floor is `user`. No approval has been requested or granted.

## Notes and lessons learned
