---
trdd-id: 44RGLOO8
title: The published web-scenario-tester ships the live governance credential in its rules doc
column: human_review
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T14:05:00+0200
created: 2026-07-10T06:23:25+0200
updated: 2026-08-16T01:43:20+0200
current-owner: ai-maestro-session
created-by: ai-maestro-session
priority: 1
severity: major
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
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
test-requirements: []
audit-requirements: [security-scan]
review-requirements: [human-review]
runtime-targets: []
impacts: []
external-refs: ["https://github.com/Emasoft/ai-maestro-web-scenario-tester", "https://github.com/Emasoft/ai-maestro-web-scenario-tester/issues/3"]
---

# TRDD-44RGLOO8 — the publish carried the credential out of the repo

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10, AMENDED 2026-08-16

**⚠ SUPERSEDED — do NOT carry forward (amended 2026-08-16T01:43, verified, not inferred):**

- **✗ "The credential is confirmed live, not stale."** It WAS, on 2026-07-10. **Rotation landed
  2026-07-17** (`TRDD-E9BZ5P7S`, archived `completed`), so every copy — the tags, the plugin
  caches, this one — carries a DEAD string. Proof without touching either value: that repo's
  `pushedAt` is **2026-07-08T16:48Z**, nine days BEFORE the rotation, so what is public cannot be
  the current credential. A date comparison settles it; comparing values would mean handling the
  secret to prove the secret is safe.
- **✗ "Do not file a public issue until the credential is rotated."** That precondition is now
  MET, so the card's own disclosure order no longer forbids an issue. I still filed none, for a
  different and smaller reason: the string is dead, so an issue would add a signpost and buy
  nothing. That is a judgment call, not the standing prohibition it looks like above.
- **✓ STILL TRUE, and still the point.** Re-measured today: the repo is `visibility: PUBLIC` and
  `references/SCENARIOS_TESTS_RULES.md` still carries **1** `governance_password:` line with a
  NON-env literal and **0** mentions of `AIM_GOVERNANCE_PASSWORD`. **The live risk is the MANDATE,
  not the literal** — the field is still documented as *"The actual password value, in quotes"*,
  so the next scenario authored in that plugin publishes the CURRENT credential into a public
  repo. Today's literal is spent; the instruction that produced it is not.

**Do not act on this without the USER.** An agent must never rotate a credential.

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

## ⏵ ROTATION LANDED — the gate is OPEN and the leak is DEAD (verified 2026-07-30)

**Supersedes the STATE block's "the credential is confirmed live, not stale."** It is stale now.

| checked | method | result |
|---|---|---|
| is the published literal still the live password? | fetched the blob at `v0.1.3`, compared against `$AIM_GOVERNANCE_PASSWORD` in a pipeline whose ONLY output was a boolean — env → sed → fd → `grep -qFf`, never argv, never disk, never a model's context; guarded by a positive control that the pattern is non-empty and matches itself | **SUPERSEDED** |
| same, at `master` | ditto | **no live credential** |
| `passwordSetAt` in `~/.aimaestro/governance.json` | metadata read only | **2026-07-17T07:50:55Z** — a week after this card was authored |
| is the CURRENT password anywhere in THIS repo? | `git ls-files -z \| xargs -0 grep -lFf <(extract)` | **0 tracked files** |
| …in recent history? | `git grep -IFf` across the last 60 commits | **absent** |
| is `.env.local` ignored? | `git check-ignore -v` | yes, `.gitignore:33` (`.env*.local`) |

So **step 1 of the forced order is DONE** — the USER rotated, which is what makes every copy
(the 32 here, the 2 there, every tag, every already-installed plugin cache) worthless. The
standing warning *"no public issue may be filed until after the rotation"* is therefore
**satisfied**, and step 2 became ordinary hygiene, in the open.

**What is still live is not the secret — it is the MANDATE.** At `master`, the doc still
*requires* the literal (`L546` `governance_password: "<password>"   # The actual password value,
in quotes.`; `L576` *"Actual password in quotes. Referenced verbatim in steps."*), while the
plugin's own `scenarios.config.json` spec defines `governancePasswordRef:
env:AIM_GOVERNANCE_PASSWORD` and says the key holds *a REFERENCE — never the literal secret*.
The config spec forbids what the rules doc requires, so the next scenario authored re-creates
the exposure. Scrubbing two occurrences without amending the rule fixes the symptom for exactly
one commit.

**Filed: `Emasoft/ai-maestro-web-scenario-tester#3`** — root cause (the two rule lines), the
verified-dead status stated up front so nobody treats it as an incident, the 197-literals /
34-files evidence for why "be careful" is not a fix, the `1e6246ff` reference implementation
(*helpers take no password argument*), a shape-not-value CI regression check, and the divergence
of the second shipped copy at `skills/amwst-scenarios-rules/references/`. Method 1 per the
cross-project rule; this session did not touch that tree, and offered a fork+PR if the owner
wants the patch instead of the report.

**Severity re-ranked CRITICAL → major, priority 0 → 1.** Not closed: a dead credential in a
public tagged release is still bad hygiene and a false signal to any reader, and the mandate is
a live root cause. But it is no longer an exposure, and leaving it ranked P0/CRITICAL would make
the board's own top-priority signal a lie.

**Still the owner's alone (unchanged):** whether tags `v0.1.1`-`v0.1.3` are deleted or left
standing. Now that the string is dead, *leave them standing* is defensible and avoids a history
rewrite — the issue says so and proposes neither.

## Acceptance

Transcribed 2026-08-05 from what this card already states — the four numbered items under
*"The work, once unblocked"* and the verified results under *"ROTATION LANDED"*. Nothing here is
authored from the title; every box quotes a promise the card had already made in prose, which is
why it could be written at all (a checklist invented from a title is fabrication).

**Ours — all done, and this is why the card is not an exposure any more:**

- [x] the forced order's step 1 satisfied: the USER rotated (`passwordSetAt` 2026-07-17), so the
      published literal is **SUPERSEDED** at both `v0.1.3` and `master` — verified by a comparison
      whose ONLY output was a boolean (env → sed → fd → `grep -qFf`; never argv, never disk, never
      a model's context), guarded by a positive control that the pattern matches itself
- [x] the CURRENT password is absent from this repo — **0 tracked files**, absent across the last
      60 commits, and `.env.local` is gitignored (`.gitignore:33`)
- [x] the upstream issue filed with the ROOT CAUSE, not just the symptom —
      `Emasoft/ai-maestro-web-scenario-tester#3`, carrying the two rule lines, the verified-dead
      status stated up front so nobody treats it as a live incident, the 197-literals / 34-files
      evidence for why "be careful" is not a fix, the `1e6246ff` reference implementation
      (*helpers take no password argument*), and a shape-not-value CI regression check. Method 1
      per the cross-project rule — this session did not touch that tree, and offered a fork+PR if
      the owner prefers the patch
- [x] severity re-ranked CRITICAL → major, priority 0 → 1, with the reason recorded: a dead
      credential in a public tag is bad hygiene and a false signal, but leaving it P0/CRITICAL
      would make the board's own top-priority signal a lie

**Upstream — the owner's repo, NOT ours to edit.** `#3` is OPEN with 0 comments as of 2026-08-05:

- [ ] the two literal occurrences in `references/SCENARIOS_TESTS_RULES.md` replaced with
      `governancePasswordRef: env:AIM_GOVERNANCE_PASSWORD`
      **RE-MEASURED 2026-08-16T01:43 — STILL PUBLISHED, and STILL PUBLIC. But the value is DEAD,
      and that ordering is the whole severity question, so it is proved here rather than assumed.**
      `Emasoft/ai-maestro-web-scenario-tester` is `visibility: PUBLIC`, and
      `references/SCENARIOS_TESTS_RULES.md` still carries **1** `governance_password:` line whose
      value is a NON-env literal, with **0** mentions of `AIM_GOVERNANCE_PASSWORD`. (Checked by
      SHAPE, never by value — the field's presence and whether its RHS is an env reference; the
      credential was not read, printed, or compared.)
      **Proof it is the pre-rotation value, without touching either string:** that repo's
      `pushedAt` is **2026-07-08T16:48Z** and rotation landed **2026-07-17** (TRDD-E9BZ5P7S STATE,
      archived `completed`). The publication PRE-DATES the rotation by 9 days, so what is public
      cannot be the current credential. A date comparison answers this; a value comparison would
      have required handling the secret to prove the secret is safe.
      **So this box is now hygiene + audit trail, not an active leak** — the same conclusion the
      card's own "Yours alone" tag question rests on ("after rotation they carry a dead string").
      **THE LIVE RISK IS THE BOX BELOW, NOT THIS ONE.** The mandate still documents the field as
      *"The actual password value, in quotes"*, so the next scenario authored in that plugin
      re-publishes the CURRENT credential into a PUBLIC repo. Today's literal is spent; the
      instruction that produced it is not.
      Nothing was filed upstream: an issue on a public tracker naming the exposure would point at
      it, which is the one action that makes a dead-but-public string worse.
- [ ] **the MANDATE amended** — the frontmatter field documented as *"The actual password value, in
      quotes"* / *"Referenced verbatim in steps"* is the root cause. Scrubbing the two occurrences
      without amending it re-creates the exposure on the next scenario authored, so this box is the
      one that actually closes the defect; the one above only closes today's instance
- [ ] the SECOND shipped copy at `skills/amwst-scenarios-rules/references/` converged — it
      diverges from the first, so fixing one leaves the other mandating the literal
- [ ] re-published (`publish.py --patch`) so the marketplace resolves a clean version

**Yours alone:**

- [ ] **USER DECISION — tags `v0.1.1`–`v0.1.3`: deleted, or left standing?** Now that the string is
      dead, *left standing* is defensible and avoids a history rewrite. The issue proposes neither,
      deliberately. This is the box that keeps the card in `human_review`.

## Notes and lessons learned
