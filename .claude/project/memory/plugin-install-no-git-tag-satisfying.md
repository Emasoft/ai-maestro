---
name: plugin-install-no-git-tag-satisfying
description: "a plugin install fails with 'has no git tag satisfying >=X <Y' even though the tags exist — role-plugins refuse to install, ChangeTitle G16 warns, agents end up with no ROLE"
ocd: 2026-07-13
lmd: 2026-07-13
metadata:
  node_type: memory
  type: project
  tier: component
  topic: plugins-and-marketplaces
---

^plugin-dep-tags-need-the-name-prefix [desc:"version_constrained_plugin_dependencies_resolve_only_against_tags_named_pluginname__vversion", keywords:"has_no_git_tag_satisfying no-matching-tag plugin_dependency_version_constraint claude_plugin_tag_--push role_plugin_will_not_install", ocd: 2026-07-13, lmd: 2026-07-30]
**A version-constrained plugin dependency resolves ONLY against git tags named
`{plugin-name}--v{version}`** — not `v{version}`, not bare `{version}`. Claude Code lists
the dependency's tags, **filters by the `{plugin-name}--v` prefix**, and takes the
highest one satisfying the range; if the filter matches nothing it reports
`no-matching-tag`, surfaced to the user as **`has no git tag satisfying <range>`** even
though the repo is full of tags. Spec:
<https://code.claude.com/docs/en/plugin-dependencies.md> (feature since CC 2.1.110).

- The correctly-named tag is created by **`claude plugin tag --push`** (validates that
  `plugin.json` and the marketplace entry agree on the version; refuses on a dirty tree).
- In a **hub-and-spoke** marketplace (plugins in their own repos, `url` source — our
  layout) the tag must live on the **plugin's OWN repo**. It does NOT need to be on the
  marketplace repo. *(Both were tested.)*
- Keep the ordinary `v{version}` tag too — GitHub Releases and the marketplace notify
  chain use it. The two coexist; only `{name}--v{version}` is read by the resolver.
- An **unversioned** dependency (`{"name":"dep"}`) needs no tag at all and always
  installs — which is why dropping a version pin *looks* like a fix. It is not one: it
  throws away the breaking-change protection the pin exists for.
- Constraints from **all installed dependents are intersected**, so a plugin that pins
  nothing still fails while any other installed plugin pins the same dependency — and
  one correctly-named tag on the dependency satisfies the whole union at once.

^plugin-dep-fleet-impact-role-plugins [desc:"why_a_missing_tag_name_stopped_every_agent_from_getting_a_role", keywords:"no_agent_can_get_a_role CreateAgent_fails_role_plugin ChangeTitle_G16_failed_to_install R9.13_rejects_agent_with_zero_role_plugins fleet_cannot_stand_up", ocd: 2026-07-13, lmd: 2026-07-30]
All 8 ai-maestro role-plugins pin `^2.x` on `ai-maestro-plugin`, whose releases were
tagged `v2.8.0` rather than `ai-maestro-plugin--v2.8.0` — so **every role-plugin install
failed**. `ChangeTitle` (Gates 15-16) and `CreateAgent` install the role-plugin, and R9.13
hard-rejects an agent with zero role-plugins, so this one missing tag name is what stopped
the MANAGER/MAINTAINER fleet from standing up. The server had been logging
`G16: WARN — Failed to install …` since at least 2026-07-11.

Fix: backfill `ai-maestro-plugin--v2.8.0` on the core repo (2.8.0 satisfies every declared
range, and the resolver takes the highest satisfying tag, so ONE tag unblocks all 8), then
add `claude plugin tag --push` to each plugin's `publish.py`. Tracked as TRDD-JT3U4ZVM;
filed as Emasoft/ai-maestro-plugin#24 (cross-project rule: never edit another project's
tree — file an issue or a PR).

## Notes and lessons learned

[^1]: [ocd:2026-07-13 lmd:2026-07-13] This page first said **"Claude Code 2.1.207 cannot
  resolve ANY versioned plugin dependency — it is an upstream bug"**, and I filed 8 issues
  prescribing "drop the version pin". Both were WRONG, and I retracted them. The WHY is
  worth more than the fact: I ran what *looked* like an exhaustive elimination — varying
  the tag prefix (`v` vs bare), the marketplace source type (`url` vs `github`), the tag
  kind (lightweight vs annotated+released), the transport (`https` vs `file://`) and the
  range operator (exact/`>=`/`^`/`~`) — and since every cell failed, I concluded the
  feature was broken. **A complete-looking matrix over the wrong axes reads exactly like
  proof.** The one axis I never varied was the one the docs specify: the tag's NAME PREFIX
  (`{plugin-name}--v`). Lesson: when a vendor tool says a resource does not exist and you
  can see it does, **read the vendor's spec for that feature BEFORE concluding the vendor
  is broken** — especially when the feature is recent (this one landed in CC 2.1.110) and
  our packaging predates it. The USER caught it with one instruction: "read the specs".

[^2]: [ocd:2026-07-13 lmd:2026-07-13] Second-order lesson, from the same episode: I filed
  8 public issues on other repos *before* checking the spec, and their Claudes could have
  acted on a wrong prescription. Cross-repo issues are an outward-facing, hard-to-recall
  action — the bar for "am I sure?" is higher than for a local commit. Verify against the
  authoritative source first; a retraction costs more than the delay would have.
