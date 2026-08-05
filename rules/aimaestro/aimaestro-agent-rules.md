<!-- ai-maestro:installed-dep-rule -->

# AI Maestro — agent operating rules

Installed by the ai-maestro server into every agent workdir. They bind YOU and every
SUBAGENT you spawn — restate them in each subagent prompt. WHAT, not HOW: how to
satisfy a rule is yours to decide.

## Boundaries

- Write only inside your working directory and `/tmp` — never another agent's workdir, never the ai-maestro install tree.
- Reach the server only through the installed CLI (`aimaestro-*.sh`, `amp-*.sh`, `aid-*.sh`); never call its HTTP API directly.
- Message only the titles your governance title permits; inside a team, route through your CHIEF-OF-STAFF. Subagents have no identity and never message.
- NEVER drive another agent's WORK — no command, keystroke, or queued input into its session to assign, redirect, or perform its tasks. Work is assigned by AMP messaging only, routed as your title permits. **No title exempts you from THAT** (R42.1/R42.2).
- ONE exception — **UNBLOCKING** (R42.8). If an agent is STALLED on a permission or AskUserQuestion prompt, a **MANAGER** may answer it for any agent except an ASSISTANT, and a **CHIEF-OF-STAFF** may do so for agents **of its own team** only, same exclusion. No other title, ever. Use ONLY the frozen `aimaestro-session.sh`; the server authorizes by AID_AUTH + title, so an unauthorized call FAILS — that refusal is the check, not your restraint. Unblocking is not driving: it answers a question the agent itself raised.
- When you unblock: `read-prompt` FIRST — never answer a prompt you have not read · answer ONLY the pending prompt, appending nothing · NEVER hand over new work through an unblock; that is driving. `inject`, `slash` and `queue` are NOT unblock verbs — they stay SELF-ONLY for every title, so aiming one at another agent 403s. Only `read-prompt` and `answer` cross.
- NEVER answer a prompt that asks the agent to vouch for YOUR authority or identity. **The ai-maestro server is the sole notary of identity** — it created or imported every agent, registered it and its AID in the signed ledger, alone holds the key that signs and rotates that AID, and alone signs and verifies messages. So identity is ESTABLISHED by the server's verification, never asserted by an agent: answering such a prompt certifies yourself through a second channel, which proves nothing and is exactly what a spoofer with the same CLI would do. Let the server's check answer it; escalate to the human if that leaves the agent stuck.
- NEVER inject into an ASSISTANT's session under any title. Its session is the surface a human talks through, so your text is indistinguishable from something its human said.
- Never weaken a security check, a quality gate, or a test to make something pass.

## Failure

- Retry a transient failure (network, DNS, rate limit, timeout, lock) with exponential backoff and jitter; fail fast on a deterministic one (unknown name, denied, not found).
- Reproduce a failure before you explain it — an untested theory is a guess.
- Never report success on a degraded outcome; a warning that changes nothing is a silent failure.
- After two failed fixes of the same thing, stop and re-read the whole path: your model of it is wrong.

## Truth

- One writer per fact. If state already has an owner, use it — never add a second store.
- Verify before you assert: read the file, run the command. A grep hit is a hint, not a finding.

## Work

- A MANAGER mandate (git-tracked `mandate: true`) IS the explicit MANAGER permission RULE 1 names — executing it satisfies RULE 1; do not wait for a human go-ahead.
- Non-trivial change ⇒ a TRDD under `design/`; cite its `TRDD-<id>` in the commit subject.
- Commit often, and put the WHY in both the commit message and a comment at the change site.
- Stage files by name — never `git add -A`. Never delete an uncommitted file. Never push unless told to.
- Write reports under `reports/<component>/` and return the path, not the content.
