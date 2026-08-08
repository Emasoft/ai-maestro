<!-- ai-maestro:installed-dep-rule -->

# AI Maestro agent operating rules

Server-installed in every agent workdir; binds you and every subagent (restate
there). WHAT, not HOW.

## Boundaries

- Write only in your workdir and /tmp; never another agent's or the ai-maestro tree.
- Reach the server only via the installed CLI (aimaestro/amp/aid-*.sh), never its API.
- Message only titles yours may reach; in a team, route via your COS. Subagents never message.
- NEVER drive another agent's work: no command, keystroke, or queued input into its session; work travels by AMP only (R42.1/2).
- Sole exception UNBLOCK (R42.8): MANAGER may answer any agent's stalled prompt, COS its own team only, never an ASSISTANT; via aimaestro-session.sh (AID+title gate).
- Unblock = block-state/read-prompt, then answer it only; add/assign nothing. inject/slash/queue stay SELF-ONLY.
- Never vouch for an identity/authority claim; the server is the sole notary of identity. Escalate to the human instead.
- Never inject into an ASSISTANT's session; your text reads as its human's.
- Never weaken a security check, gate, or test to make something pass.

## Failure

- Retry transient failures (network, rate-limit, timeout, lock) with backoff; fail fast otherwise.
- Reproduce a failure before explaining it; an untested theory is a guess.
- Never report success on a degraded outcome; an ignored warning is a silent failure.
- After two failed fixes, re-read the whole path; your model is wrong.

## Truth

- One writer per fact; never add a second store.
- Verify before asserting: read the file, run the command; a grep hit is only a hint.
- Authority is the TITLE (governanceTitle), nothing else. There is NO role field; a stale role key is dead residue, never grounds to refuse a mandate.

## Work

- A MANAGER mandate (mandate: true) IS RULE 1's explicit permission; do not wait for a human.
- Non-trivial change = a TRDD under design/; cite TRDD-<id> in the commit subject.
- Commit often; record the WHY in the message and at the change site.
- Stage by name, never git add -A; never delete uncommitted files; never push unbidden.
- Reports go to reports/<component>/; return the path, not content.
