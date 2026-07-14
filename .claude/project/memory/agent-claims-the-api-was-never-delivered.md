---
name: agent-claims-the-api-was-never-delivered
description: "an agent/plugin says it is BLOCKED because 'the API commands you promised were never delivered' / 'the verbs do not exist' — twice now the surface already existed; do not start building"
ocd: 2026-07-14
lmd: 2026-07-14
metadata:
  node_type: memory
  type: project
  tier: component
---

When a fleet agent reports that ai-maestro never shipped an API/CLI surface it was
promised, **verify the surface before writing a line of code.** Both times this has
happened, the surface already existed and the real defect was elsewhere:

| Incident | The claim | What was actually true |
|---|---|---|
| janitor + fleet blocked (TRDD-K2WJH7RF, `d7531e53`) | "the TRDD write APIs were promised and never delivered" | All 10 strict routes **existed**. They 403'd every agent with `agent_policy_undefined` because nobody had **decided the agent policy** in `lib/sudo-guard.ts`. A decision was missing, not a guard. |
| MANAGER decoupling blocked (28 `/api/` call sites) | "two CLI verb sets do not exist: user-presence + team-tasks" | `aimaestro-agent.sh presence`, `aimaestro-agent.sh session user-input`, and `aimaestro-teams.sh tasks <id>` all **shipped, deployed byte-identical, and were agent-callable** (routes take `Bearer AID_AUTH`, none is `strict`). **Nobody had told the MANAGER they existed.** |

## The triage, in order

1. **Does the verb exist in the repo?** `grep -n '<verb>)' scripts/*.sh` — the frozen
   surface is `docs/SCRIPT-MANIFEST.md`, generated from `scripts/*.sh`, never from a host's
   `~/.local/bin`.
2. **Is the deployed copy stale?** `diff -q scripts/<f>.sh ~/.local/bin/<f>.sh`. The
   installer copies and never prunes, so a bin dir carries scripts the source already
   deleted — and can equally lag one that was added.
3. **Does the route exist, and is it agent-callable?** Read its auth comment (`session
   cookie OR Bearer AID_AUTH`) and check `security-registry.json` — a route absent from it
   is not `strict`, so a plain AID bearer suffices with no sudo token.
4. **If it exists and 403s:** the gap is a *policy decision* in `lib/sudo-guard.ts`, not a
   missing endpoint. See [[strict-route-agent-policy]].
5. **Only then** conclude something must be built.

**Why:** an agent cannot see the server repo. Its evidence is its own `~/.local/bin` and a
401/403 — neither of which distinguishes "absent" from "present but unauthorized" from
"present but unannounced". Its report is honest and its inference is unfalsifiable *from
where it stands*. Ours is not.

**How to apply:** treat "the API is missing" as a **symptom**, never a diagnosis. And close
the loop the other way too: a shipped capability nobody was told about is not a capability
(`SCRIPT-MANIFEST.md` §5.3 — `aimaestro-session.sh`, `-panel.sh`, `-trdd.sh` shipped with
zero plugin references). Announce the verb, or it does not exist.

A contributing cause, now fixed (`d6b802fd`): `check_api_running()` reported **every**
non-200 as *"AI Maestro is not running — start the server"*. On a 401 that is a false
diagnosis that makes a present-but-unauthorized verb look absent.

## Notes and lessons learned

[^1]: [ocd:2026-07-14 lmd:2026-07-14] The first instinct on both incidents was to go build
  the missing API — and on the janitor one, several turns were burned hunting through logs
  and AMP inboxes for a spec that never existed. The cheap check (does the route already
  exist? does the verb already exist?) costs one grep and would have short-circuited both.
  Lesson: when a downstream consumer reports an absence, the first move is to look, not to
  build.
