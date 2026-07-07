<!-- ai-maestro:installed-dep-rule -->

# ai-maestro overlay — PRRD governance authority and routing

> **DEP overlay — installed by the ai-maestro server** into each
> registered agent workdir's `.claude/rules/`. It EXPANDS the IND base
> `prrd-design-rules.md` (the PRRD format, golden/silver model, rule
> identity/versioning, citation grammar, scripts — shipped globally by
> the ai-maestro-janitor and assumed present); base content is NOT
> restated here. This overlay defines WHO may mutate the PRRD in the
> multi-agent system and HOW proposals route.

## Per-title mutation authority

The IND base's two-actor table (USER = golden, the project's Claude =
silver) generalizes to:

| Actor | Can modify GOLDEN rules? | Can modify SILVER rules? | Can propose changes? |
|---|---|---|---|
| **USER** | YES — only USER can edit, add, delete, promote, or demote golden rules | YES — by demoting to silver first, or directly | n/a (USER doesn't propose; USER decides) |
| **MANAGER** | NO — even MANAGER cannot revise golden rules; can only forward USER intent | YES — can add, revise, delete, promote silver rules without USER approval | n/a (MANAGER is the approver, not the proposer) |
| **CHIEF-OF-STAFF** | NO | NO — cannot edit directly | YES — funnels proposals from team agents to MANAGER |
| **Team-internal agents** (ORCH/ARCH/INT/MEMBER) | NO | NO | YES — but must route through their COS (R6 v3 routing constraint) |
| **AUTONOMOUS, MAINTAINER** | NO | NO | YES — propose directly to MANAGER (governance-layer peer) |

**Authority enforcement.** The `prrd-edit.py` script verifies the
caller holds the MANAGER governance title (via `$AID_AUTH` resolution
against the AI Maestro server). A non-MANAGER attempt to revise a
silver rule is refused with `403 — propose via COS`. A MANAGER attempt
to revise a golden rule is refused with `403 — golden rules are
user-only`. (`prrd-edit.py --user` — the standalone escape hatch the
IND base documents — remains valid for the human at the keyboard.)

## Proposal routing

The IND base's proposal queue gains two routing elements:

- Proposal frontmatter carries **`routed-via: <cos-session-name>`**.
- The team's CHIEF-OF-STAFF reviews and forwards to MANAGER via AMP;
  MANAGER decides (**accept** → runs `prrd-edit.py`, marks `accepted`;
  **reject** → replies via COS with rationale, recorded in the
  proposal body's `## MANAGER decision` section; **forward to USER**
  for golden-rule changes — the user's decision propagates back the
  same chain).

## Recommended baseline golden rule G1 — GitHub authorship self-identification

Every AI Maestro project PRRD SHOULD carry, as its first golden rule
(`G1.1`), the GitHub authorship self-identification rule:

> Every agent that writes to GitHub (issue, issue comment, PR, PR
> comment, PR review, discussion, release note) MUST begin the body
> with a one-line self-identification of which agent/role/plugin
> authored it, because all AI Maestro agents share the single
> human-owner GitHub identity (the owner's `gh` CLI auth). Recommended
> leading line: `_Posted by the Claude developing **<plugin-or-role>**
> (via the shared @owner gh auth)._` Commit messages SHOULD carry an
> `Agent: <plugin-slug>` trailer (the plugin's stable package slug,
> e.g. `Agent: ai-maestro-maintainer-agent` — greppable ecosystem-wide
> and rename-surviving, vs a freeform role).

This is GOLDEN (user-set, immutable to MANAGER) because it is a
clarity/anti-impersonation convention the MANAGER must not be able to
weaken. It mirrors the ecosystem-wide governance rule (R22 in
`GOVERNANCE-RULES.md`). Bootstrap it into a new project's PRRD via:

```bash
get-prrd.py --init
prrd-edit.py --user add golden "<the rule text above>"
```
