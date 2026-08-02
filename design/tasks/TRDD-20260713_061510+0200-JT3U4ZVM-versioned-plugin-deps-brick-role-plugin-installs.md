---
trdd-id: JT3U4ZVM
title: fleet blocker — role-plugin installs fail because releases lack the {name}--v{version} tags the dependency resolver requires
column: ai_review
created: 2026-07-13T06:15:10+0200
updated: 2026-08-02T15:55:24+0200
current-owner: ai-maestro-dev-session
assignee: ai-maestro-dev-session
priority: 0
severity: CRITICAL
effort: S
labels: [fleet-blocker, plugins, claude-code-upstream, role-plugins]
task-type: bugfix
scope: project
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T06:15:10+0200
created-by: ai-maestro-dev-session
derived: false
parent-trdd: null
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: cross-repo-issues
target-branch: governance-rules
test-requirements: [manual]
audit-requirements: []
review-requirements: []
impacts: [agent-lifecycle, role-plugins, fleet]
attempts: 0
implementation-commits: []
external-refs: ["cc-version:2.1.207", "docs:https://code.claude.com/docs/en/plugin-dependencies.md", "gh:Emasoft/ai-maestro-plugin#24", "gh:Emasoft/ai-maestro-plugin#25(PR)", "gh:Emasoft/ai-maestro-architect-agent#25", "gh:Emasoft/ai-maestro-assistant-manager-agent#25", "gh:Emasoft/ai-maestro-chief-of-staff#25", "gh:Emasoft/ai-maestro-orchestrator-agent#28", "gh:Emasoft/ai-maestro-integrator-agent#22", "gh:Emasoft/ai-maestro-programmer-agent#26", "gh:Emasoft/ai-maestro-maintainer-agent#28", "gh:Emasoft/ai-maestro-autonomous-agent#13"]
---

# TRDD-JT3U4ZVM — The dependency resolver wants `{name}--v{version}` tags; we never published them

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-13 (CORRECTED 06:40)

- **State:** ROOT CAUSE PROVEN AND CORRECTED. It is **NOT** a Claude Code bug — it is a
  **spec requirement we never met**. The fix is one git tag in `ai-maestro-plugin`.
- **The one-liner:** dependency version constraints resolve against tags named
  **`{plugin-name}--v{version}`** (`claude plugin tag --push`; feature landed CC 2.1.110,
  documented at <https://code.claude.com/docs/en/plugin-dependencies.md>). Our releases
  are tagged **`v2.8.0`**, not **`ai-maestro-plugin--v2.8.0`**, so the resolver's
  prefix filter matches nothing and every constrained dependency reports
  `no matching tag` (surfaced as `has no git tag satisfying …`). The tags exist; they
  are named wrong for this lookup.
- **Consequence:** all 8 role-plugins pin `^2.x` on `ai-maestro-plugin` ⇒ every
  role-plugin install fails ⇒ ChangeTitle G15/G16 + CreateAgent fail ⇒ R9.13 rejects an
  agent with zero role-plugins ⇒ **no agent can be given a ROLE**. This — not the
  harness — is what stops the fleet from standing up.
- **Verified for OUR layout** (hub-and-spoke: plugins in their own repos, `url` source):
  the `{name}--v{version}` tag must live on the **plugin's OWN repo**. It does *not*
  need to be on the marketplace repo. Proven on a synthetic marketplace: same
  constrained install fails with `v1.0.0`-style tags and succeeds (auto-installing the
  dependency) once a `prov--v1.0.0` tag exists.
- **DONE:** filed **Emasoft/ai-maestro-plugin#24** — backfill `ai-maestro-plugin--v2.8.0`
  (2.8.0 satisfies every declared range: `^2.6.0`, `^2.7.0`, `^2.7.9`, and the resolver
  takes the highest satisfying tag) + add `claude plugin tag --push` to its `publish.py`.
  The 8 role-plugin issues were **corrected and retitled**: their pins STAY; their only
  (optional) ask is the same tag step in their own publish pipelines.
- **✅ RESOLVED 2026-07-13 07:45 — the fleet is UNBLOCKED.** The USER authorized the direct
  tag push; `ai-maestro-plugin--v2.8.0` -> c0cf169 (the v2.8.0 release commit; its
  plugin.json reads 2.8.0, which the spec requires) is live on the remote. Verified
  immediately: `claude plugin marketplace update ai-maestro-plugins`, then
  `claude plugin install ai-maestro-maintainer-agent@ai-maestro-plugins --scope local`
  → **✔ installed (+ 1 dependency: ai-maestro-plugin)** — the exact call that had been
  failing for every agent. assistant-manager installs too. Scratch installs cleaned up.
- **NEXT ACTION:** stand up MANAGER + one MAINTAINER through the dashboard and watch
  ChangeTitle G15/G16 reach `installed` instead of `WARN — Failed to install`. Residual:
  merge PR #25 so the NEXT release carries the tag automatically — without it, 2.8.1 ships
  untagged for the resolver and the fleet breaks again at the next version bump.

**▶ UPDATE 2026-07-13 12:05 — column `dev` → `ai_review`. The rescue half is DONE and
independently confirmed in a real agent workdir**, not just by my own scratch install:
`~/agents/jack-bot` (the live MANAGER) now shows, via `claude plugin list --json` (the ground
truth — never `settings.local.json`), `ai-maestro-assistant-manager-agent@ai-maestro-plugins
v2.12.12` **installed** at local scope with its dependency resolved as
`ai-maestro-plugin@ai-maestro-plugins v2.8.0-c0cf169e83b6` — the version string carries the
commit our new `ai-maestro-plugin--v2.8.0` tag points at, which is the resolver quoting the fix
back at us. Its pane runs Claude 2.1.207, not a fallen-back `zsh`.

**The DURABILITY half is NOT done and is NOT mine to finish.** `Emasoft/ai-maestro-plugin`
PR #25 (adds the tag step to that repo's `publish.py`) is `MERGEABLE`, all checks green, and
sits at **`REVIEW_REQUIRED`**. I will not approve/merge my own cross-repo PR under the shared
owner identity — that is the impersonation the governance rule exists to prevent, and the
cross-project rule says the fix lands as a PR in *their* queue. **If it is never merged, v2.8.1
ships without the resolver tag and the entire fleet breaks again at the next version bump** —
the backfilled tag is a one-time rescue, not a fix. This is the single highest-value open item
in the whole ecosystem right now, and it is one click. Filed as the lead ask on
ai-maestro-plugin#26 (fleet-status issue).

Fleet exposure swept: `claude-plugins-validation` pins `claude-menu-system >=0.1.5`, and that
repo has **zero** `claude-menu-system--v*` tags → CPV is uninstallable-from-clean today, unnoticed
because an already-installed copy keeps working. Filed as claude-menu-system#2 / CPV#163.
- **SUPERSEDED — do NOT carry forward:**
  - ✗ "Claude Code 2.1.207 cannot resolve ANY versioned plugin dependency / it is an
    upstream bug." **False.** The resolver works; it was looking for a tag name we never
    published. **No upstream issue was filed** (the USER stopped it — correctly).
  - ✗ "The fix is to drop the `version` field from the role-plugins' dependency entry."
    **Retracted.** It *works* (an unversioned dep needs no tag) but it is the wrong fix:
    it throws away the breaking-change protection the pin exists for.
  - ✗ "`v`-prefixed vs bare tags" and "`url` vs `github` source type" — both were dead
    ends; neither is the variable that matters. The variable is the tag NAME PREFIX.

## ⏱ VERIFIED 2026-08-02 — every external item is CLOSED, and the durability half SHIPPED

This card's STATE calls PR `ai-maestro-plugin#25` *"the single highest-value open item in the whole
ecosystem … one click"*, and warns that without it **"v2.8.1 ships without the resolver tag and the
entire fleet breaks again at the next version bump"**. Checked live today:

| item | state | evidence |
|---|---|---|
| `ai-maestro-plugin#25` (the durability PR) | **landed** | CLOSED 2026-07-13T19:07 — *not* abandoned. Its 4 commits were **rebased onto `main`** and shipped in **v2.9.0** (`2394013`), because that repo's `.githooks/pre-push` refuses any push whose ancestry is not `publish.py`, so a feature branch's CI can never be greened from a normal clone. Merging it "properly" would have required the bypass the hook exists to prevent |
| the tag step is DURABLE | **yes** | `scripts/publish.py:1618` in that repo today: `dep_tag = f"{plugin_name}--v{new_ver}"` |
| the feared regression | **did not happen** | tags exist for `--v2.9.0`, `--v2.10.0`, `--v2.11.0`; latest release is **v2.11.0** (2026-07-26). Three releases past the rescue, each carrying its own resolver tag |
| `ai-maestro-plugin#24` (backfill) | CLOSED | |
| `claude-menu-system#2` / `CPV#163` (the swept fleet exposure) | CLOSED | `claude-menu-system--v0.2.0/0.2.1/0.2.2` now exist — CPV is installable from clean again |

**So the card has sat at `ai_review` for 20 days with every one of its external items already
resolved.** That is the third card in this same column found parked on stale external state
(cf. [[O8NCNRWO]] ← `ai-maestro-plugin#17`, closed 17 days before anyone looked). Nothing
re-checks an external blocker — see the sweep on [[5YRLA53W]].

## ⏵ CI STATE of PR ai-maestro-plugin#25 (branch `fix/dependency-resolution-tag`) — GREEN 2026-07-13 07:35

- **All checks pass** (Lint, Test, Test matrix ubuntu+macos, Commitlint, Socket). 4 commits:
  the publish.py fix + tests, then two CI-config commits, then the dictionary top-up.
- **What the Lint failures actually were — legacy debt, not this PR's code.** The repo runs
  MegaLinter with `VALIDATE_ALL_CODEBASE: false`, so a file's lint debt is invisible until
  someone EDITS it, and then their PR fails for code they never wrote. `main` is green
  because nobody had touched `publish.py`. The chain, and it is worth remembering because
  it bit twice:
  1. editing `scripts/publish.py` surfaced **49 pre-existing bandit findings** in it
     (B404/B603/B607 = imports subprocess / no shell=True / partial path — exactly what
     release tooling IS) + **31 cspell words**, every one a pre-existing identifier;
  2. fixing that required editing `.mega-linter.yml`, which put THAT file in the
     changed-set and surfaced **its** pre-existing words (MYPY, JSONLINT, SHELLCHECK,
     SHFMT, testdata, externalizer). Same trap, one layer out.
  Fix: `PYTHON_BANDIT_ARGUMENTS: "--skip B101,B404,B603,B607"` + a `.cspell.json` project
  dictionary. Verified locally against the exact CI input set before each push.
- **Discipline that paid off:** the first run's log was unavailable (the run was wedged on
  a `Validate` job, and MegaLinter's log only publishes at run completion). I did NOT
  speculatively "fix" yamllint on a hunch — and when the log finally landed, yamllint had
  never fired at all and bandit was already green; only cspell remained.
- **NEXT ACTION:** the PR is mergeable, but merging it does NOT unblock the fleet — it only
  takes effect on the NEXT release. The fleet needs the **backfill tag on v2.8.0** (issue
  #24), which a PR cannot deliver: someone with push rights runs
  `git tag -a 'ai-maestro-plugin--v2.8.0' 'v2.8.0^{}' -m '…' && git push origin 'ai-maestro-plugin--v2.8.0'`.
  Then: `claude plugin marketplace update ai-maestro-plugins` → a role-plugin install must
  succeed → stand up MANAGER + one MAINTAINER.

## Problem

`claude plugin install <role-plugin>@ai-maestro-plugins` fails for **every** role-plugin:

```
✘ Failed to install plugin "ai-maestro-maintainer-agent@ai-maestro-plugins":
  Dependency "ai-maestro-plugin@ai-maestro-plugins" has no git tag satisfying >=2.7.9 <3.0.0-0 >=2.7.0
```

`ai-maestro-plugin` has annotated tags `v2.7.0 … v2.8.0` AND matching GitHub releases.
`git ls-remote --tags` lists them. The resolver sees none of them.

## Root cause (the spec, then the proof)

**The spec** — [Constrain plugin dependency versions](https://code.claude.com/docs/en/plugin-dependencies.md)
(feature since CC 2.1.110):

> Version constraints resolve against git tags. **Tag each release as
> `{plugin-name}--v{version}`**, where `{version}` matches the `version` field in that
> commit's `plugin.json`. […] Claude Code lists the tags, **filters to those starting
> with `secrets-vault--v`**, and fetches the highest version satisfying the range.

We tag releases `v2.8.0`. The resolver looks for `ai-maestro-plugin--v*`. The filter
matches nothing ⇒ `no-matching-tag`, surfaced as `has no git tag satisfying <range>`.
`claude plugin tag --push` is the command that creates the correctly-named tag (it
exists on 2.1.207 and validates that `plugin.json` and the marketplace entry agree).

**The proof, on a synthetic marketplace that mirrors our hub-and-spoke layout**
(plugins in their own git repos, referenced by a `url` source):

| tags on the dependency's own repo | constrained install (`^1.0.0`) |
|---|---|
| `v1.0.0` (v-prefixed) | ✘ `no git tag satisfying >=1.0.0 <2.0.0-0` |
| `1.0.0` (bare semver) | ✘ same |
| **`prov--v1.0.0`** (the spec name) | ✅ **installs, and auto-installs the dependency** |

Two further facts established there:
- the spec-named tag must live on the **plugin's OWN repo** — putting it on the
  *marketplace* repo is unnecessary (both were tested);
- an **unversioned** dependency (`{"name":"dep"}`) always installs, because no tag
  lookup happens — which is why `ai-maestro-autonomous-agent` looked different, and why
  "drop the pin" *appeared* to be a fix.

Dead ends, recorded so nobody re-walks them: `v`-prefixed vs bare tags; `url` vs
`github` marketplace source type; lightweight vs annotated+GitHub-released tags;
`https://` vs `file://` transport. None of them is the variable that matters. **The
variable is the tag-name prefix.**

**Why even the innocent plugin fails.** The constraint set is the UNION over every
*installed* dependent, so `ai-maestro-autonomous-agent` (dependency declared with no
version) still fails, inheriting `>=2.7.0` from the other role-plugins already
installed — and installing the core plugin *by itself* fails for the same reason. This
is documented behaviour ("Claude Code intersects their ranges"), not a defect. **One
correctly-named tag on the core plugin satisfies the whole union at once.**

## Blast radius

| repo | version | declared dependency |
|---|---|---|
| ai-maestro-plugin (core) | 2.8.0 | — (none) |
| ai-maestro-architect-agent | 2.11.0 | `^2.7.0` |
| ai-maestro-assistant-manager-agent | 2.12.12 | `^2.6.0` |
| ai-maestro-chief-of-staff | 2.20.6 | `^2.6.0` |
| ai-maestro-orchestrator-agent | 1.9.3 | `^2.6.0` |
| ai-maestro-integrator-agent | 1.3.7 | `^2.7.0` |
| ai-maestro-programmer-agent | 1.4.4 | `^2.7.0` |
| ai-maestro-maintainer-agent | 1.7.9 | `^2.7.9` |
| ai-maestro-autonomous-agent | 1.5.3 | *(no version — still blocked by the union)* |

Downstream: `ChangeTitle` Gates 15-16 and `CreateAgent` install the role-plugin; R9.13
hard-rejects an agent with zero role-plugins. The server logs have been carrying
`G16: WARN — Failed to install "ai-maestro-architect-agent"` since at least 2026-07-11.

## Fix

1. **In `Emasoft/ai-maestro-plugin` (the dependency) — this alone unblocks the fleet.**
   Backfill the correctly-named tag on the 2.8.0 release commit:
   ```bash
   git tag -a 'ai-maestro-plugin--v2.8.0' 'v2.8.0^{}' -m 'ai-maestro-plugin v2.8.0'
   git push origin 'ai-maestro-plugin--v2.8.0'
   ```
   `2.8.0` satisfies **every** declared range (`^2.6.0`, `^2.7.0`, `^2.7.9`) and the
   resolver takes the highest satisfying tag, so ONE tag fixes all 8 role-plugins.
   Filed as **Emasoft/ai-maestro-plugin#24**.
2. **Make it permanent:** **PR Emasoft/ai-maestro-plugin#25** (open) — `publish.py` now
   derives `{name}--v{version}` from the manifest, creates it with git directly, and
   pushes it in the SAME `--atomic` transaction as the release; 5 regression tests. It
   also deletes the call that *looked* like it did this already: `claude plugin tag
   <tag>` passed the tag where the CLI wants a PATH and swallowed the result with
   `check=False`, so it silently created nothing on every release. Merging it does NOT
   unblock today — it takes effect on the next release; the backfill in (1) is what
   clears the fleet now. The same step belongs in each role-plugin's `publish.py`,
   after the version bump + release commit. Keep the existing `v{version}` tag — that is
   what GitHub Releases and the marketplace notify chain use; the two coexist, and only
   `{name}--v{version}` is read by the dependency resolver. (This is the one remaining
   ask on the 8 role-plugin issues, now retitled.)
3. **KEEP the version pins.** They are correct and they are what protects each
   role-plugin from a breaking core release. (Dropping them also works — an unversioned
   dep needs no tag — but it trades away the protection for nothing.)
4. **Verify:** `claude plugin marketplace update ai-maestro-plugins` then
   `claude plugin install ai-maestro-maintainer-agent@ai-maestro-plugins --scope local`
   in a scratch dir must succeed.
5. **No upstream bug report.** The resolver behaves as documented.

## Verification

- `claude plugin install ai-maestro-maintainer-agent@ai-maestro-plugins --scope local`
  succeeds in a scratch dir.
- Creating an agent with a MAINTAINER title through the dashboard reaches
  `G16: installed` instead of `G16: WARN — Failed to install`.

## Approval log

- 2026-07-13T06:15:10+0200 — **MANDATE** (Tier 0 authoring: an investigation TRDD in this
  repo's own design corpus; the code fix is delivered as issues on the plugin repos, per
  the cross-project rule). Root cause established empirically before authoring.

## Acceptance

Transcribed from this card's own STATE — its DONE list, its residual, and its NEXT ACTION. Every
external item re-verified live on 2026-08-02 (see the VERIFIED block above), not taken from the
card's own record of them.

- [x] root cause proven and CORRECTED — the resolver wants `{plugin-name}--v{version}`; our tags
      were `v2.8.0`. Not an upstream bug: a spec requirement never met
- [x] verified for OUR hub-and-spoke layout — the tag must live on the plugin's OWN repo, not the
      marketplace's. Proven on a synthetic marketplace by flipping one variable at a time
- [x] the rescue: `ai-maestro-plugin--v2.8.0` → `c0cf169` pushed (USER-authorized), and the exact
      call that had been failing for every agent now succeeds with its dependency auto-installed
- [x] independently confirmed in a REAL agent workdir, not a scratch install — `~/agents/jack-bot`
      via `claude plugin list --json` (the ground truth, never `settings.local.json`)
- [x] the 8 role-plugin issues corrected and retitled — their pins STAY; the ask is the same tag
      step in their own pipelines
- [x] fleet exposure swept beyond our own repos — `claude-menu-system#2` / `CPV#163` filed, both
      now CLOSED with the tags published
- [x] **the DURABILITY half** — `ai-maestro-plugin` PR #25 landed in **v2.9.0** by rebase onto
      `main` (the repo's own sanctioned release path; the merge button could not be used without
      bypassing its pre-push hook). The tag step is in that repo's `publish.py` today, and three
      subsequent releases each carry their resolver tag. **The regression this card feared did not
      happen**
- [ ] the card's own NEXT ACTION: stand up a MANAGER + one MAINTAINER **through the dashboard** and
      watch ChangeTitle G15/G16 report `installed` rather than `WARN — Failed to install`. The
      OUTCOME is confirmed (jack-bot carries the plugin, dependency resolved, pane on Claude 2.1.207
      rather than a fallen-back `zsh`) but the pipeline observation itself was never recorded, and
      that is what this box asks for

## Notes — the investigation's own post-mortem

The synthetic marketplaces were deleted after use (and the temporary marketplace entries
they added to the user's Claude config were removed). Rebuilding one takes minutes: two
git repos (a provider and a consumer whose `dependencies` entry is the only variable) +
a `marketplace.json` with `url` sources, then flip ONE thing at a time.

**The mistake worth remembering.** I concluded "upstream Claude Code bug" from a
thorough-looking elimination — I varied the tag *prefix* (`v` vs bare), the *source
type*, the *tag kind*, the *transport*, and the *range operator*, and every one failed.
What I never varied was the thing the docs actually specify: the tag's **name prefix**
(`{plugin-name}--v`). A complete-looking matrix over the wrong axes reads exactly like
proof. The USER stopped the bogus upstream report and said "read the spec" — the spec
answered it in one paragraph. **Read the vendor's spec BEFORE concluding the vendor is
broken**, especially when the failing feature is recent (this one landed in CC 2.1.110)
and our packaging predates it.
