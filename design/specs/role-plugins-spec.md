# SPEC — AI Maestro ROLE-PLUGINS (on-disk structure, `.agent.toml`, quad-identity)

- **spec-version:** 1.2.0
- **status:** authoritative
- **authority:** PRRD ▶ SPEC ▶ TRDD. This SPEC governs the on-disk shape of every role-plugin.
- **scope:** what makes a Claude Code plugin a *role-plugin*, its file tree, the `.agent.toml`
  schema, the quad-identity (fourfold) rule + verification, the element prefix mechanism, the
  naming/marketplace model, and the build + validation pipeline.
- **sources (VERIFIED on disk, 2026-07-22):** the 8 cached predefined role-plugins
  (`~/.claude/plugins/cache/ai-maestro-plugins/*`), `lib/ecosystem-constants.ts`,
  `services/role-plugin-service.ts`, `CLAUDE.md` ("Fourfold Identity Rule", "Plugin Architecture"),
  and the local structure note. Where the 8-day-old structure note disagreed with current disk
  reality (the `.agent.toml` shape), **disk wins** — see `RP-TOML-SHAPE` below.

---

## RP-DEF — What IS a role-plugin

`RP-DEF-01` A **role-plugin** is a normal Claude Code plugin PLUS two things: (a) a
`<P>.agent.toml` at the plugin root carrying the two AI-Maestro-mandatory fields
`compatible-titles` + `compatible-clients`, and (b) a **quad-matched main-agent**
(`agents/<P>-main-agent.md`). Any plugin meeting both is a valid role-plugin, regardless of how
it was authored (predefined, Haephestos-generated, cross-client-converted, hand-written).

`RP-DEF-02` A role-plugin defines an agent's **ROLE** (behaviour) — the `--agent <P>-main-agent`
persona `claude` loads. ROLE is orthogonal to **TITLE** (governance class) and **PERSONA** (the
running instance). `compatible-titles` is the bridge: it declares which TITLE(s) this ROLE may
satisfy. (TITLE/ROLE/PERSONA model: `CLAUDE.md` "Agent Terminology".)

`RP-DEF-03` "Role-plugin" is NOT defined by storage location. The source may live in a GitHub
repo, a local marketplace under `~/agents/{role,custom}-plugins/`, or a bare folder — as long as
a marketplace manifest's `source` points at it. Storage-vs-install: a plugin is *installed* in
the client's own cache (`~/.claude/plugins/cache/…`), never at its source (`CLAUDE.md` R20.29).

---

## RP-QUAD — The QUAD-IDENTITY rule (all four MUST match; mismatch ⇒ rejected)

`RP-QUAD-01` The canonical identity is `plugin.json` `name` = `<P>`. Four values key off it:

| # | value | location | required form |
|---|---|---|---|
| 1 | plugin name | `.claude-plugin/plugin.json` → `name` | `<P>` |
| 2 | folder name | the plugin directory (repo/source root) | `<P>` |
| 3 | `[agent].name` | `<P>.agent.toml` → `[agent] name =` | `<P>` |
| 4 | main-agent frontmatter | `agents/<P>-main-agent.md` → `name:` | `<P>-main-agent` |

`#1 == #2 == #3 == <P>`, and `#4 == <P>-main-agent`. Verified true on disk for **all 8**
predefined role-plugins (incl. MANAGER: plugin `ai-maestro-assistant-manager-agent`, main-agent
`ai-maestro-assistant-manager-agent-main-agent`).

`RP-QUAD-02` **REPO NAME ≠ PLUGIN NAME is allowed — the load-bearing gotcha.** The quad-match
keys off the PLUGIN name `<P>`, not the GitHub repo. If the wanted main-agent is
`foo-main-agent`, then `<P>` MUST be `foo` (#1/#2/#3) even if the repo is
`Emasoft/ai-maestro-foo`. The marketplace `source` points at the repo URL; install resolves by
`<P>`. **Derive `<P>` from the main-agent stem you want, never from the repo name.**

`RP-QUAD-03` `ROLE_PLUGIN_MAIN_AGENTS` in `lib/ecosystem-constants.ts` is an internal map and
is NOT the quad-identity authority; one entry (`MANAGER → amama-assistant-manager-main-agent`)
disagrees with the on-disk file stem (`ai-maestro-assistant-manager-agent-main-agent`). The
on-disk `agents/<P>-main-agent.md` frontmatter `name:` is authoritative (#4). Flag the constant
as a drift target; do not treat it as the naming rule.

`RP-QUAD-04` **Verification** — reject the plugin if any of #1–#4 fail. `role-plugin-service.ts`
enforces this (`generatePluginFromToml` / `listRolePlugins`). Greppable check:
```bash
P=$(jq -r .name .claude-plugin/plugin.json)
[ "$(basename "$PWD")" = "$P" ] || echo "FAIL folder != $P"
grep -q "^name = \"$P\"" "$P.agent.toml" || echo "FAIL [agent].name != $P"
grep -q "^name: $P-main-agent" "agents/$P-main-agent.md" || echo "FAIL main-agent != $P-main-agent"
```

---

## RP-TOML — The `.agent.toml` schema

`RP-TOML-MANDATORY` The **only hard `.agent.toml` requirements** for a role-plugin are three
keys inside `[agent]`:
```toml
[agent]
name               = "<P>"            # quad-id #3 — MUST equal plugin.json name
compatible-titles  = ["MEMBER"]       # ⊆ the 8 governance titles (RP-TITLES)
compatible-clients = ["claude-code"]  # ⊆ claude-code | codex | gemini | opencode | kiro
```
`role-plugin-service.ts` reads ONLY `name` + `compatible-titles` + `compatible-clients` (plus the
quad-match). Everything else in the toml is advisory / creation-time metadata.

`RP-TOML-SHAPE` **The full `.agent.toml` shape is NOT standardized — multiple valid shapes coexist
in the shipped set (VERIFIED 2026-07-22).** Do NOT assert one canonical body shape:

| shape | `[agent]` keys | other sections | seen in |
|---|---|---|---|
| **flat / PSS-derived** | `name, source, path, compatible-titles, compatible-clients` | top-level `[requirements] [skills](primary/secondary/specialized) [agents] [commands] [rules] [mcp] [hooks] [lsp] [output_styles]` each `recommended=[]`; `[dependencies].external_skills` | architect, integrator, maintainer, autonomous, **programmer**, **ASSISTANT** |
| **nested / Haephestos** | `name, description, role, main_agent, model, prefix, compatible-titles, compatible-clients` | nested `[agent.persona] [agent.capabilities] [agent.skills](bundled=[…]) [agent.hooks] [agent.rules] [agent.dependencies]` | chief-of-staff |
| **minimal** | `name, description, version, compatible-titles, compatible-clients` | `[agent.role]` | orchestrator |

The `[agent].main_agent = "<P>-main-agent"` key (nested shape) explicitly links #3→#4 and is
recommended but not universal (the flat shape omits it and relies on `path`/quad-match). The
`[agent].path = "agents/<P>-main-agent.md"` key (flat shape) serves the same link.

`RP-TOML-PSS` **The PSS *profile* format is a DIFFERENT, creation-time artifact — do not confuse
it with the shipped toml.** `pss_validate_agent_toml.py` validates a PSS profile
(`[agent]` `additionalProperties:false`, REQUIRED `name`+`path`, REQUIRED top-level `[skills]`
tiers) and will FAIL a nested/Haephestos role-plugin toml, and a PSS profile lacks
`compatible-titles`/`compatible-clients` so AI Maestro won't treat it as a role-plugin. PSS is a
scoring step; the shipped toml is the runtime role descriptor. Do NOT run
`pss_validate_agent_toml.py` against a shipped role-plugin toml expecting a pass.

---

## RP-TITLES — compatible-titles + compatible-clients

`RP-TITLES-01` `compatible-titles` MUST be a subset of the **8 governance titles**:
`MANAGER | CHIEF-OF-STAFF | ARCHITECT | ORCHESTRATOR | INTEGRATOR | MEMBER | MAINTAINER |
AUTONOMOUS`. A freeform value is rejected by the `ChangeTitle` pipeline, which also REJECTS
assigning a ROLE whose `compatible-titles` omits the target title.

`RP-TITLES-02` **N:1 model:** many ROLEs may serve one TITLE, and one ROLE may list several
titles. The UI shows a locked label when exactly 1 compatible plugin exists for a title, a
dropdown when ≥2 (`CLAUDE.md` "N:1 compatibility"). Every persisted agent carries exactly one
ROLE (R9.13); AUTONOMOUS resolves to the mandatory `ai-maestro-autonomous-agent`.

`RP-TITLES-03` `compatible-clients` ⊆ `claude-code | codex | gemini | opencode | kiro`; read by
`ChangeClient`, which re-emits the plugin for the target client. A Claude target keeps the bare
`<P>`; every other client gets a `-<client>` suffix (R20.1).

<!-- @spec:predefined-role-plugins
# The 8 predefined role-plugins (name → prefix → default title). Machine block.
ai-maestro-assistant-manager-agent  amama-  MANAGER
ai-maestro-chief-of-staff           amcos-  CHIEF-OF-STAFF
ai-maestro-architect-agent          amaa-   ARCHITECT
ai-maestro-orchestrator-agent       amoa-   ORCHESTRATOR
ai-maestro-integrator-agent         amia-   INTEGRATOR
ai-maestro-programmer-agent         ampa-   MEMBER
ai-maestro-maintainer-agent         amma-   MAINTAINER
ai-maestro-autonomous-agent         amaua-  AUTONOMOUS
-->

`RP-TITLES-04` The 8 predefined names + prefixes + default titles are the machine block above,
mirroring `PREDEFINED_ROLE_PLUGIN_NAMES` / `PLUGIN_COMPATIBLE_TITLES` / `TITLE_PLUGIN_MAP` in
`lib/ecosystem-constants.ts`. The **ASSISTANT** role-plugin (`ai-maestro-assistant-role-agent`,
title `ASSISTANT`, a code-only 9th role per R39) is deliberately **absent** from
`PREDEFINED_ROLE_PLUGIN_NAMES` — it is a LOCAL/D4 source, not a published GitHub role-plugin
(R39.2). See `RP-ASSISTANT`.

---

## RP-PREFIX — The element prefix mechanism (`<pfx>-`)

`RP-PREFIX-01` A plugin declares ONE prefix (`amXX-`) and applies it to **every element EXCEPT
the main-agent**:

| element | file + frontmatter `name` | prefixed? |
|---|---|---|
| main-agent | `agents/<P>-main-agent.md` | **NO** — canonical `<P>-main-agent` |
| subagents | `agents/<pfx>*.md` | YES (file + `name:`); NO `model:`, NO `hooks:` (plugin agents can't carry hooks) |
| skills | `skills/<pfx>*/SKILL.md` | YES (dir + `name:`); `user-invocable:false`; `agent:<P>-main-agent` |
| commands | `commands/<pfx>*.md` | YES; `user-invocable:true`; `argument-hint`; `allowed-tools` |
| hook ids | `hooks/hooks.json` `_id` | YES |
| scripts | `scripts/<pfx>_*.py` | YES — **underscore** `<pfx>_` (Python module naming) |

`RP-PREFIX-02` Dual spelling: **kebab `<pfx>-`** for CC element names, **underscore `<pfx>_`**
for Python script filenames. Predefined prefixes are the machine block in `RP-TITLES`.

---

## RP-TREE — Minimum-required files + full tree

`RP-TREE-01` **Minimum for a VALID role-plugin:** `.claude-plugin/plugin.json` + `<P>.agent.toml`
(with `compatible-titles` & `compatible-clients`) + `agents/<P>-main-agent.md`. Everything else is
optional payload. (The ASSISTANT plugin is exactly this minimum + the two mandatory fields.)

`RP-TREE-02` The shipped tree (repo/source root; a client cache adds a `<version>/` wrapper +
`.in_use/` that are NOT in the source):
```
<source-root>/
├── .claude-plugin/plugin.json      # name/version/description/author/repository/license
├── <P>.agent.toml                  # the role profile (REQUIRED) — RP-TOML
├── agents/
│   ├── <P>-main-agent.md           # quad-id #4 — NOT prefixed; model policy: see RP-MODEL
│   └── <pfx>*.md                   # subagents (prefixed; NO model:, NO hooks:)
├── skills/<pfx>*/SKILL.md          # + references/ ; user-invocable:false ; agent:<P>-main-agent
├── commands/<pfx>*.md              # user-invocable:true ; argument-hint ; allowed-tools
├── hooks/hooks.json                # _id:<pfx>* → python3 ${CLAUDE_PLUGIN_ROOT}/scripts/<pfx>_*.py
├── scripts/<pfx>_*.py + publish.py + validate_*.py (CPV)
├── README.md CHANGELOG.md LICENSE pyproject.toml uv.lock cliff.toml .markdownlint.json
└── .github/workflows/{validate,release,notify-marketplace}.yml + .githooks/pre-push
```

---

## RP-STORE — Source-vs-install + marketplaces (naming)

`RP-STORE-01` Predefined role-plugins: one independent `Emasoft/ai-maestro-<agent>` GitHub repo
each, listed in the `ai-maestro-plugins` marketplace (`MARKETPLACE_NAME`). Named
`ai-maestro-<agent>`.

`RP-STORE-02` Custom (Haephestos) + converted role-plugins: SOURCE under
`~/agents/role-plugins/<marketplace-dir>/<P>/`, registered in the local
`ai-maestro-local-roles-marketplace` (`LOCAL_MARKETPLACE_NAME`, dir `role-plugins`). Converted
ordinary plugins go under `~/agents/custom-plugins/` (`ai-maestro-local-custom-marketplace`).

`RP-STORE-03` These `~/agents/{role,custom,core}-plugins/` dirs are SOURCE/publishing containers,
NOT installed plugins (R20.29). AI Maestro writes there only when it AUTHORS/CONVERTS a plugin;
it never deletes from them (R20.31). Install always targets the client's own cache via the
client's protocol.

---

## RP-MODEL — the `model:` pinning convention (flagged inconsistency)

`RP-MODEL-01` **CORRECTED 2026-08-08 — the previous universal ("every shipped role-plugin PINS
`model: opus` on the main-agent") is FALSE, measured against the shipped releases:** `opus` ×4
(assistant-manager 2.14.3, chief-of-staff 2.21.1, orchestrator 1.9.5, integrator 1.3.7) · **no
`model:` key** ×2 (architect 2.11.1, programmer 1.4.7) · `inherit` ×1 (maintainer 1.7.21) ·
`sonnet` ×1 (autonomous 1.5.5). Half the fleet follows the "pattern"; the decisive counterexample
is `ai-maestro-autonomous-agent` — a plugin `RP-TITLES-02` in this same document calls mandatory —
pinning `sonnet`. Two further facts moved under the old text: CC 2.1.219 re-pointed the bare
`opus` token (Opus 5, 1M ctx, different price), so a pinned token's meaning drifts with the
platform. A second correction, 2026-08-08 (AMAMA counterexample + fleet re-measure): *"subagents
already omit `model:` everywhere"* was ALSO false — `amama-report-generator` pinned `opus` through
v2.16.1, and a re-measure at current remote tips (2026-08-08T12:47:50+0200) counts **15 pinned
subagents**: integrator ×10 (`sonnet` ×8, `opus` ×2), orchestrator ×5 (all `opus`). The ruling
below binds MAIN agents only; subagent pinning policy is deliberately OPEN — a cheap-tier pin
(`sonnet` on a bounded mechanical worker) is the delegation-tiering guidance applied, while an
`opus` subagent pin spends the operator's budget exactly as a main-agent pin does and deserves the
same scrutiny when the owning plugin next touches the file.

**RULED 2026-08-08 (ai-maestro#136, closing `TRDD-TYB3Q1NJ`): role-plugin MAIN agents OMIT
`model:`.** ROLE is orthogonal to model (RP-DEF-02's orthogonality extended):
model choice is a cost/capability decision belonging to whoever launches the session — a pin lets
the role author spend the operator's budget, is the only spelling that silently degrades under an
org model-restriction, and conflicts with the CPV CA-04 cache-warmth default. The measured table
above stays as the historical record of the pre-ruling drift. **Migration is on-next-release**:
the six plugins carrying a key (`opus` ×4, `sonnet` ×1, `inherit` ×1 — `inherit` included, since
omission expresses it without a second spelling) drop it at their next publish; carrying a key
past that publish is a conformance failure, before it is not.

---

## RP-SKILL-MENU — the main agent enumerates its own skills

`RP-SKILL-MENU-01` (added 2026-08-08, `TRDD-0FCR6KOW`) Every role-plugin MAIN agent whose plugin
ships one or more skills MUST carry a compact **skill menu** in its persona body: one line per
shipped skill — the skill name plus when to reach for it. **Guard-implementation note (three
independent failures measured 2026-08-08, from three sessions):** a menu-conformance check must
scope its matcher to the menu SECTION — not the whole persona (a prose MENTION of a skill counts
as an entry, so drop-a-listed-skill stays green) and not "any backticked name in any table cell"
(an unrelated tool table over-counts, fabricating a stale-entry finding against a correct menu).
A count-only gate fails in BOTH directions; prove the guard by falsifying both
(add-unlisted-skill AND drop-listed-skill). Subagents are exempt (they receive
task-scoped prompts). Rationale, from a measured incident: an agent that cannot SEE its skill
inventory does not reach for it — skill descriptions alone under-trigger for role-specific
procedures, and the fleet's `disable-model-invocation` preload exclusion (found and fixed
2026-08-08) shipped agents that booted without knowing their own procedures. A STALE menu is
worse than none: the menu MUST be updated in the same change that adds, renames, or removes a
skill, and a publish gate SHOULD compare menu entries against shipped `SKILL.md` count. Shipped
state at ruling time (menus present: COS, AMAMA, programmer — the programmer row corrected
2026-08-08 same-day: its 6-for-6 menu table shipped in v2.0.0 at 10:28Z, before this ruling; the
"partial" reading was measured at v1.4.7, a claim true when taken and stale when cited; partial:
AMOA, maintainer, integrator, autonomous) migrates on-next-release, same policy as RP-MODEL-01.

---

## RP-BUILD — Build blueprint (checklist)

`RP-BUILD-01`
1. Choose `<P>` (= main-agent stem) and `<pfx>-`.
2. `.claude-plugin/plugin.json`: `name=<P>`, version, description, author (Emasoft + noreply
   email), `repository` (repo URL — MAY differ from `<P>`), `license` MIT.
3. `<P>.agent.toml`: `[agent] name=<P>` + **`compatible-titles`** + **`compatible-clients`**
   (RP-TOML-MANDATORY). Pick a body shape (flat or nested — RP-TOML-SHAPE); the flat shape is the
   simplest for a minimal plugin.
4. `agents/<P>-main-agent.md`: frontmatter `name: <P>-main-agent`, description, optional
   `skills:` list, then the persona body. OMIT `model:` (inherit the session) — RULED, see
   `RP-MODEL-01`. Include the skill menu (`RP-SKILL-MENU-01`).
5. (optional payload) skills/subagents/commands/hooks per RP-PREFIX.
6. **VERIFY quad-identity** (RP-QUAD-04) — the #1 rejection cause.
7. Plugin-abstraction (CLAUDE.md): NO element may call `/api/...` directly — go through the
   `aimaestro-*` / `amp-*` CLI layer; no embedded API syntax in prompt-elements.
8. Validate + ship: CPV `--strict` + `publish.py` (USER-gated). PSS validators apply to a PSS
   *profile* (format A) only, never to a shipped nested toml (RP-TOML-PSS).

---

## RP-ASSISTANT — conformance of the `ai-maestro-assistant-role-agent` plugin

`RP-ASSISTANT-01` The ASSISTANT role-plugin (R39; `~/Code/ai-maestro-assistant-role-agent`, the
USER-provided source) conforms to this SPEC as a **minimum-tree LOCAL/D4** role-plugin:
- **Quad-identity ✓** — plugin.json `name` = folder = `[agent].name` = `ai-maestro-assistant-role-agent`;
  `agents/ai-maestro-assistant-role-agent-main-agent.md` frontmatter `name:` = `…-main-agent`.
- **Mandatory toml fields ✓** — `compatible-titles = ["ASSISTANT"]`, `compatible-clients = ["claude-code"]`.
- **Toml shape** — flat/PSS-derived (RP-TOML-SHAPE), `[dependencies].external_skills` =
  planning / agent-messaging / agent-identity / team-kanban (deliberately NO `team-governance`, R39.8).
- **Minimum tree ✓** — plugin.json + `.agent.toml` + main-agent only (no bundled payload).
- **model:** ✓ conformant with the RULED policy — no `model:` key (RP-MODEL-01, ruled 2026-08-08).
- **PUBLISHED** (1.0.1 correction — the 1.0.0 text said "no published GitHub repo; the Emasoft
  404 is by design", stale since 2026-07-22): `Emasoft/ai-maestro-assistant-role-agent` is
  PUBLIC and listed in the `ai-maestro-plugins` marketplace manifest, while remaining absent
  from `PREDEFINED_ROLE_PLUGIN_NAMES` — an OPEN QUESTION on ai-maestro#86 F2 (consumers
  assume exactly 8 predefined plugins; do not "fix" the count to 9).

`RP-ASSISTANT-02` The persona itself (behaviour) is governed by GOVERNANCE-RULES R39
(R39.1–R39.10) + the governance SPEC, not by this SPEC — this SPEC covers only the plugin's
STRUCTURE.

---

## RP-VAL — validation checklist (for a plugin-quality tool)

`RP-VAL-01` quad-identity #1–#4 all match (RP-QUAD-04).
`RP-VAL-02` `.agent.toml` has `[agent].name == <P>` + `compatible-titles` (⊆ 8 titles) + `compatible-clients` (⊆ 5 clients).
`RP-VAL-03` `agents/<P>-main-agent.md` exists, frontmatter `name: <P>-main-agent`.
`RP-VAL-04` every non-main element carries the declared `<pfx>-` (kebab) / `<pfx>_` (python).
`RP-VAL-05` no prompt-element embeds `/api/...` / a `:23000` URL / a raw server HTTP call (plugin-abstraction).
`RP-VAL-06` subagents carry NO `model:` and NO `hooks:`.
`RP-VAL-07` do NOT run `pss_validate_agent_toml.py` against a shipped role-plugin toml (RP-TOML-PSS).

---

## RP-CITATION — PRRD citation + rule-version integrity (ratified ai-maestro#145, 2026-08-21)

`RP-CITATION-01` **MANDATORY** for every role-plugin repo whose PRRD carries at least one
pinned citation (`G<n>.<v>` / `S<n>.<v>`): the repo MUST carry a committed citation-integrity
gate implementing the four points below. A repo whose PRRD has no pinned citations is
**vacuously satisfied — not opted out** (the gate has nothing to check; that is not a licence
to remove it). Authority: SILVER (MANAGER-revisable). The derivation — three trees, both
defect directions (dangling pin / silent mutation), every constraint below a measured defect —
is on ai-maestro#145; this section is the ratified shape.

1. **Stable coordinate in prose.** Living prose (skills, scripts, tests, personas) cites by
   NUMBER (`PRRD G1`) — the number is the identity and never rots. A version pin (`G1.2`) is
   a CLAIM about the rule's text and belongs only where the version itself is load-bearing.
2. **Citation→version gate.** Every pinned citation must resolve against the repo's own PRRD:
   number exists, tier letter matches, version current. A pin to a superseded version is a
   finding unless exempt per RP-CITATION-02.
3. **Text→version hash gate.** Each rule's body is hashed against its version, so a text edit
   without a version bump reds. This is the half a resolution check cannot see: a stale
   pointer announces itself on the first lookup; a pointer to silently-mutated content never
   does.
4. **Exempt by PROPERTY, never by a path list.** Archived terminal cards are exempt by
   `column:` — a property of the card; a path list either over-covers or goes stale on the
   next archival.

`RP-CITATION-02` Site classification — the action is decided by what the sentence DOES with
the version, never by where the file lives:

| shape | property | action |
|---|---|---|
| rule definition | the version IS the claim | bump with the text |
| living prose | the version is incidental | float to the bare number |
| archived terminal card | `column:` terminal | exempt (a frozen card must not lie about what it was written against) |
| grammar example | the version is the subject being demonstrated | exempt, KEEP pinned |
| historical narration | names the successor in the same sentence (`G1.1 → G1.2`, "fixed:") | exempt |
| synthetic fixture | the PRRD is constructed by the test | exempt (the format under test, not a citation) |

The last three have no frontmatter to key on and need heuristics, and heuristics produce false
negatives. **Take the checker that misses a real dangle over one that reds on a grammar
example** — the first fails at the hand-measured rate, the second gets deleted, after which
both defect directions run free.

`RP-CITATION-03` Implementation constraints — each one a defect measured in a shipped gate:

- **Capture the whole rule block** (bullet → next bullet / next heading / EOF). A one-line
  regex under `re.M` silently truncates wrapped rules, so an edit to a continuation line
  hashes identically — the gate's own defect class, reproduced inside the gate.
- **Normalize whitespace before hashing.** A reflow is not a revision; a gate that reds on
  reflow trains the author to regenerate the fixture without reading it.
- **Scope the corpus.** The checker excludes itself, AND excludes test fixtures that
  construct their own PRRD — the corpus is part of the selector.
- **Non-vacuity keys on INPUT CONSUMED.** Count and print the scanned population; zero files
  scanned is exit 2 (could-not-run), never a pass. Zero citations over a real scan is the
  legitimate vacuous green of RP-CITATION-01.
- **Failure messages point at the likely repair.** A hash mismatch reads as "the fixture is
  stale"; the correct response is usually the opposite — say "bump the rule, THEN set the
  hash". Where a red has two candidate culprits, name both and state what was ruled out.
- **Scope statement.** A green run asserts citations and rule versions ONLY. Container-level
  stamps (`prrd-version:`, `updated:`) have no citation pointing at them and are invisible to
  this gate by construction; they need their own independent witness (recorded open on
  ai-maestro#145).

`RP-CITATION-04` Acceptance is **"seeded both directions and observed"** — never "a check
exists" (every failure the derivation thread found was a check that existed). Minimum control
set, each pinning ONE direction with its own named input, as COMMITTED tests over synthetic
text (never mutate-and-restore of the live PRRD — an interrupted run corrupts the repo):

| control | seeded input | expectation |
|---|---|---|
| A | word changed on a continuation line | REDS (no silent under-coverage) |
| B | pure reflow, no wording change | GREEN (no false positive) |
| C | a fixture that distinguishes the correct parser from the naive one-line one | REDS if it cannot |
| D | the naive parser installed | A and C observed red before any control is trusted |

The acceptance record names the INPUT each direction was seeded with and the TREE it was
measured in — a guard's coverage is a property of a repository, not of a design.
