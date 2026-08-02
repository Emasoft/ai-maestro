---
name: agent-workdir-invariants-and-policy
description: "why did my agent's shipped rule file come back / why is aimaestro-rules.md read-only / where are agent workdir guarantees declared / why can't this agent use this directory / can an agent adopt an existing project folder / what does checkAuthorizedAgentWorkdir do / is the workdir policy a security sandbox / why is core-plugin invariant wake-only"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: agents
---

# agent-workdir-invariants-and-policy

## Agent-workdir invariants — ONE list, ONE runner, ONE watchdog (TRDD-VYQ8N4KR)

**Everything ai-maestro guarantees about an agent's working directory is declared in
`lib/agent-invariants.ts`. To add a guarantee, add a row — never a call site.**

| id | guarantee | triggers |
|---|---|---|
| `claude-dir` | `.claude/` exists | create · wake · periodic |
| `dep-rules` | the shipped `aimaestro-*.md` rules: present, unmodified, read-only | create · wake · periodic |
| `git-exclude` | a git-repo workdir carries the managed git-exclude block | create · wake · periodic |
| `core-plugin` | `ai-maestro-plugin` (R17) installed + enabled at local scope | **wake only** |
| `role-plugin` | the agent's title-compatible role-plugin (R9.13) installed + enabled at any scope | **wake only** |

- `enforceAgentInvariants(ctx)` runs the rows matching `ctx.trigger`. A throwing
  invariant becomes a `failed` outcome and the rest still run.
- `startAgentInvariantsWatchdog()` — the **single** periodic loop (5 min;
  `AIM_INVARIANTS_WATCHDOG_INTERVAL_MS`, 0 disables), started from `server.mjs`
  after a boot sweep over the whole fleet.
- Callers: CreateAgent (`trigger: 'create'`, emitting the stable `G05`/`G05b`/`G05c`
  op labels), `ensureCorePluginInstalled` (`'wake'`), server boot + watchdog
  (`'periodic'`).

**Why `triggers` exists, and why `core-plugin` is wake-only.** Its repair is
`claude plugin install` — network I/O, a package manager, a registry write. A
background loop that silently reinstalls plugins fleet-wide is a categorically bigger
promise than "rewrite a file", and R17 deliberately has no periodic loop. A test pins
`core-plugin.triggers === ['wake']` so a future edit can't quietly turn the watchdog
into a background plugin installer.

**Two holes this closes.** *Coverage:* a per-agent hook only fires when that agent is
TOUCHED, so an agent that is never woken never receives a guarantee shipped after it
was created. *Tampering:* a guarantee enforced only on wake is enforced by the very
agent that may have broken it — the suspect choosing when the repair lands. The boot
sweep closes the first; the watchdog closes the second.

The sweep gates each workdir on `checkAuthorizedAgentWorkdir` (`lib/agent-workdir-policy.ts`
— the ONE workdir authority, TRDD-WLWHVMKT), which admits an adopted `~/Code/<project>`
and rejects a bogus entry. This is not cosmetic: a legacy `default` agent in the registry
carries `workingDirectory: "/"`.

## Agent workdir policy — ONE authority (TRDD-WLWHVMKT)

**`lib/agent-workdir-policy.ts` is the single authority** for "may an agent use this
directory?". Every enforcement point consults it. Do NOT re-derive the rule anywhere
else — that is exactly what broke before: the `~/agents/`-only invariant was copied
into five places, TRDD-57EBNB72 widened only one of them (`CreateAgent`'s G03 gates),
and the result was an adopted agent whose registry entry was written and whose session
could then **never start** (`validateCwd` threw, boot-restore skipped it, `browse-dir`
403'd it). The registry write succeeding made it *look* like the feature worked.

Two distinct questions, two functions:

| Function | When | Rule |
|---|---|---|
| `checkAdoptableWorkdir(dir, allowExternal)` | **creation** (agent doesn't exist yet) | path policy only + the `allowExternalFolder` flag |
| `checkAuthorizedAgentWorkdir(cwd, agentName?)` | **runtime** (start session, boot-restore, browse) | under `~/agents/` **or** a workdir the **registry** records for that agent |

Always denied, no flag overrides them: outside `$HOME`; `$HOME` itself and the
user-data roots (Desktop/Documents/Downloads/Library); and **the ai-maestro install
tree** — an agent whose workdir is the server's own source would rebuild and restart
the very server managing it. Developing ai-maestro from an agent needs an isolated
container, never an in-place workdir.

**This is authorization, not containment.** On a shared UID no cwd policy is a
security boundary (a same-UID process can chdir/write anywhere; `agent-shell-guard.sh`
only overrides `cd`/`pushd`, so it never stopped an absolute-path write). Real
containment is TRDD-a1019073 / container agents. Do not read this as "external
workdirs are now sandboxed".

## Folder adoption — `allowExternalFolder` (TRDD-57EBNB72, fixed by TRDD-WLWHVMKT)

`POST /api/agents` accepts `allowExternalFolder: true` (zod schema in `lib/create-agent-schema.ts`) to ADOPT an existing folder in place instead of creating `~/agents/<name>/`. This is how a MAINTAINER agent takes over an existing project (e.g. `~/Code/<plugin>`) without it being moved or copied. Pipeline semantics:

- **G03-CLAMP**: the flag is honored only for folders under `$HOME`; anything outside (e.g. `/Volumes/...`) has the flag ignored (ops line `G03-CLAMP`) and the workdir is forced back to `~/agents/<name>/`. G03-ENFORCE/G03-SAFETY are unchanged; team titles remain force-pathed.
- **G05c**: for git-repo workdirs, a managed ignore block (marker `ai-maestro:managed-gitignore`) is seeded into `.git/info/exclude` — never `.gitignore`, which repos track — via `lib/workdir-gitignore-seed.ts`; the wake path (`ensureCorePluginInstalled`) self-heals it. Resolver covers `.git` dir, submodule gitdir-file, and linked-worktree `commondir` shapes.
- **Folders route** (`GET /api/agents/folders`): soft-deleted agents' folders are no longer marked taken (tombstone filter), and the browsed path is enriched with `githubRepo` (pure-fs read of `.git/config`).
- **Maintainer wizard order** is `title → folder → github-repo → summary`, with `githubRepo` prefilled from the browsed folder's origin (Gate 9a requires it for MAINTAINER, R19.3).
- Deletion semantics: SOFT delete keeps the folder and the registry tombstone (re-adoption over a tombstone works); HARD delete (`?hard=true&deleteFolder=true`) honors `deleteFolder` and removes both — folder removal only ever applies under `~/agents/` (G03-SAFETY guard).

## See also

## Notes and lessons learned
