# SPEC — AI Maestro ROLE-PLUGINS (on-disk structure, `.agent.toml`, quad-identity)

- **spec-version:** 1.0.0
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
│   ├── <P>-main-agent.md           # quad-id #4 — NOT prefixed; model: opus (see RP-MODEL)
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

`RP-MODEL-01` Every shipped role-plugin PINS `model: opus` on the main-agent (frontmatter) and in
the toml, and OMITS `model:` on subagents (they inherit the session model). This contradicts the
general "omit `model:`, inherit session" guidance (CLAUDE.md distillation / CPV CA-04); it
validates + installs fine today and is the established pattern. Recorded as a live inconsistency,
not resolved — a new role-plugin SHOULD copy the pattern (pin on main+toml, omit on subagents).

---

## RP-BUILD — Build blueprint (checklist)

`RP-BUILD-01`
1. Choose `<P>` (= main-agent stem) and `<pfx>-`.
2. `.claude-plugin/plugin.json`: `name=<P>`, version, description, author (Emasoft + noreply
   email), `repository` (repo URL — MAY differ from `<P>`), `license` MIT.
3. `<P>.agent.toml`: `[agent] name=<P>` + **`compatible-titles`** + **`compatible-clients`**
   (RP-TOML-MANDATORY). Pick a body shape (flat or nested — RP-TOML-SHAPE); the flat shape is the
   simplest for a minimal plugin.
4. `agents/<P>-main-agent.md`: frontmatter `name: <P>-main-agent`, description, `model: opus`,
   optional `skills:` list, then the persona body.
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
- **model:** opus on the main-agent (RP-MODEL).
- **LOCAL/D4** — not in `PREDEFINED_ROLE_PLUGIN_NAMES`, no published GitHub repo; the Emasoft 404
  is by design (R39.2). Publishing is a USER-owned decision (would flip it to a predefined-style
  published role-plugin + require R39.2 + `PREDEFINED_ROLE_PLUGIN_NAMES` updates).

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
