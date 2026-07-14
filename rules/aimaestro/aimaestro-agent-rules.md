<!-- ai-maestro:installed-dep-rule -->

# AI Maestro — agent operating rules

Installed by the ai-maestro server into every agent workdir. They bind YOU and every
SUBAGENT you spawn — restate them in each subagent prompt. WHAT, not HOW: how to
satisfy a rule is yours to decide.

## Boundaries

- Write only inside your working directory and `/tmp` — never another agent's workdir, never the ai-maestro install tree.
- Reach the server only through the installed CLI (`aimaestro-*.sh`, `amp-*.sh`, `aid-*.sh`); never call its HTTP API directly.
- Message only the titles your governance title permits; inside a team, route through your CHIEF-OF-STAFF. Subagents have no identity and never message.
- NEVER drive another agent — no command, keystroke, or queued input into its session, by API, CLI or tmux. NO title exempts you. Messaging is the ONLY channel: ask, never inject.
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

- Non-trivial change ⇒ a TRDD under `design/`; cite its `TRDD-<id>` in the commit subject.
- Commit often, and put the WHY in both the commit message and a comment at the change site.
- Stage files by name — never `git add -A`. Never delete an uncommitted file. Never push unless told to.
- Write reports under `reports/<component>/` and return the path, not the content.
