---
name: password-and-credential-system
description: "which password or token do I need / I set an env var and auth still fails / 403 sudo_required / 429 sudo_token_quota_exceeded / how do I authenticate a script or run tests with the owner away / is this token an agent's or a human's / where is the governance password stored / how do I mint a dev-mode token / there is no wiki page for this topic and the knowledge is scattered / I learned it from a code comment / where should this fact live / no spec exists for the password system"
ocd: 2026-08-22
lmd: 2026-08-22
metadata:
  node_type: memory
  type: reference
  tier: hub
  topic: security-and-auth
  functionality: Every credential class in ai-maestro: what it is, where it lives, who mints it, what it authorizes, and how long it lasts.
  globs: [lib/governance.ts, lib/aid-token.ts, lib/sudo-auth.ts, lib/dev-mode-token.ts, lib/dev-mode-token-constants.ts, lib/agent-auth.ts, lib/sudo-guard.ts, app/api/auth/**, app/api/v1/auth/**]
publish-globally: false
---

# password-and-credential-system


^ATOM-VNXX-NROI [desc: "The seven credential classes, their prefixes, stores, minters and lifetimes — the inventory, read out of the source.", keywords: which_token_do_I_need credential_classes token_prefix aim_tk amp_live_sk mst_ am-_prefix aim_session what_authenticates_what, type: reference, ocd: 2026-08-22, lmd: 2026-08-22]

**Every credential class in ai-maestro, read out of the source (prefixes are `grep`-confirmed
declarations, not prose).**

| class | shape | lives in | minted by | authorizes | TTL |
|---|---|---|---|---|---|
| governance password | plaintext in env | `.env.local` → `AIM_GOVERNANCE_PASSWORD`; hash in `governance.json.passwordHash` | the owner, via the dashboard | minting sudo tokens; login | n/a |
| dev-mode login token | `am-…` | `.env.local` → `AI_MAESTRO_DEV_MODE_TOKEN`; SHA-256 in `governance.json.devModeLogin.tokenHash` | `POST /api/auth/dev-token` — **password AND passkey**, never password alone | stands in for the password at `POST /api/auth/login` ⇒ a USER session | until revoked |
| sudo token | `X-Sudo-Token` header | in-memory (`lib/sudo-auth.ts`) | `POST /api/auth/sudo-password` | ONE strict route call | **60 s**, one-shot |
| human session | `Cookie: aim_session=…` | `~/.aimaestro/cli-session`, mode `0600` | `POST /api/auth/login` | every `aimaestro-*.sh` / `amp-*.sh` call as the owner | session |
| AID governance token | `aim_tk_` + 64 hex | `governance.json` token list (hashed) | `POST /api/v1/auth/token`, Ed25519 proof-of-possession | governance ops, scoped by embedded title + team | **3600 s** |
| server session secret | `mst_…` | server-issued | the server | server-to-self / agent auth | — |
| AMP API key | `amp_live_sk_…` | AMP store | AMP | message routing only, NOT governance | — |

**The two that trip people up:** `aim_tk_` is ONE prefix minted for BOTH subject classes
(`lib/aid-token.ts:375` agent, `:426` user) — the discriminator is the record's `subject_type`,
never the prefix. And a **passkey is not a credential you hold**; it is the second factor gating
the dev-token mint, so a stolen governance password alone can never mint one.

See also [[env-vars-and-the-governance-password]] for the dev-mode enable-vs-token split. [^1]


^ATOM-G59T-8U0O [desc: "How to call a STRICT route from a script: mint a sudo token per call. Cap is 2 outstanding, TTL 60s, and a mint-then-abort burns a slot.", keywords: 403_sudo_required 429_sudo_token_quota_exceeded too_many_outstanding_confirmations strict_route_from_a_script how_to_authenticate_a_script unattended_testing X-Sudo-Token, type: reference, ocd: 2026-08-22, lmd: 2026-08-22]

**A strict route needs a sudo token ON TOP of a session — and a script can mint one, despite the
prose saying otherwise.**

`403 sudo_required` means the session authenticated fine and the route is classified `strict`. The
CLIs only INJECT `AIMAESTRO_SUDO_TOKEN`; they have no mint path. Mint with
`POST /api/auth/sudo-password` `{password}` → `{token, expiresAt}`, then send `X-Sudo-Token`.

**The enforced gate is `if (!ctx.isSystemOwner)` → `403 sudo_user_only`** — it refuses AGENTS, not
scripts. The comment above it says *"ONLY via the UI"*, and that is INTENT, not the predicate: an
owner session from a shell mints successfully (measured 2026-08-22, `HTTP 200`). Agents never need
one — they authorize by AID + title (R32.1/R32.3).

**The constants that decide whether an unattended run survives** (`app/api/auth/sudo-password/route.ts`):

- `MAX_OUTSTANDING_USER_SUDO_TOKENS = 2`
- `SUDO_GLOBAL_MAX_ATTEMPTS = 200`
- TTL **60 s**, one-shot, optionally bound to one `(method, pathTemplate)`

**The trap:** a token is spent only by a route that ACCEPTS it. Mint one and then abort locally —
a wrapper-side validation failure, a typo, a dry run — and the slot stays occupied for the full
60 s. With a cap of 2, three such aborts return `429 sudo_token_quota_exceeded` ("Too many
outstanding confirmations"), which reads like a rate limit on YOU and is really your own unspent
tokens. So: mint AFTER local validation passes, one per call, never in a loop that may not fire.


^ATOM-B6AR-MQGE [desc: "A Claude developing ai-maestro is OUTSIDE the harness and can never hold an AID token; it authenticates as the OWNER's console, and that is the only path open to it.", keywords: why_cant_I_get_an_AID_token aid_no_ledger_history 403_on_the_token_exchange who_am_I_to_the_ai-maestro_server can_the_developer_session_authenticate_as_an_agent am_I_an_agent_or_the_owner sudo_user_only which_identity_does_the_CLI_session_carry, type: reference, ocd: 2026-08-22, lmd: 2026-08-22]

**A Claude that DEVELOPS ai-maestro is not an agent OF ai-maestro, and there is no route by which
it could become one mid-session.** Only three ways exist to register an agent — **created** inside
the server, **imported** into it, or **migrated** from another host — and the server is the sole
guarantor and notarizer of every identity and permission (USER ruling, 2026-08-22). A developer
session took none of those three routes, *and rightfully so: to develop ai-maestro you must be
outside it.*

This is not merely policy — the token exchange enforces it, so an attempt fails rather than
degrading into something ambiguous. `POST /api/v1/auth/token` (`app/api/v1/auth/token/route.ts`)
requires, in order: a REGISTERED agent record (it passes `agent.id` / `agent.name` /
`governanceTitle` / `teamId` straight into `issueGovernanceToken`, `lib/aid-token.ts:367`), an
**Ed25519 proof-of-possession** against that agent's registered public key, and — under
`ledger.enforceAidAssociation` — a **signed-ledger association on this host**, else
`403 aid_no_ledger_history` (R34.1, `:205`). An unregistered caller fails at the first gate: it has
no agent record to name.

**So the developer session's identity is the OWNER's, never an agent's, and the code says which:**
`buildAuthContext` (`lib/agent-auth.ts:373`) derives `isSystemOwner` from the ABSENCE of an
`agentId` — legacy model `!agentId`; user-authority model ON, additionally
`userTitle ∈ {maestro, maestro-delegate}`. A dev-mode CLI login yields a web-session-class caller
with **no `agentId`**, hence the owner. Measured 2026-08-22: `GET /api/auth/session` →
`{"authenticated":true,"recoverySetupComplete":true}` — no agent identity in it at all.

**The two paths are complements, not alternatives, and R32 is why.** An agent authorizes by
AID + title + portfolio token and is REFUSED a sudo token (`if (!ctx.isSystemOwner)` →
`403 sudo_user_only`); the owner has no AID and uses exactly that sudo route. Neither can borrow
the other's credential, which is the design working. Practically: when a strict verb needs
authorization here, the answer is never *"get an AID"* — it is the owner's dev-mode session plus a
per-call sudo token (see [[password-and-credential-system]] ATOM-G59T-8U0O).

## Notes and lessons learned

[^1]: [id: ATOM-53G7-HJOV, status: valid, desc: "Why this hub exists: the credential system had no page and no spec, so its contract was being re-derived from code comments each time.", keywords: "no_wiki_page_for_the_topic the_knowledge_is_scattered I_learned_it_from_a_code_comment where_should_this_fact_live no_spec_exists topic-centred_wiki", ocd: 2026-08-22, lmd: 2026-08-22] DO NOT establish a security contract from CODE COMMENTS and file the result wherever recall happened to land, BECAUSE a comment is evidence about the line it sits on and nothing more, and a fact filed on a neighbouring page leaves the TOPIC itself absent — so the next session re-derives it from the same comments, at the same risk, and no one can tell the topic is missing because every individual page looks fine. Measured 2026-08-22: the credential contract was scattered across ~8 pages in 3 scopes with NO page owning it and NO spec in `design/specs/` (8 specs, none about auth), and the first version of this knowledge was written onto an ENV-VAR page because that is where `recall` ranked. DO ask "which page SHOULD own this?" before "which page came back?" — if the answer is a page that does not exist, that absence is the finding. Create the topic page, give it a `metadata.topic:` and regenerate the index (a page with no topic never appears in CLAUDE.md's index, so it is invisible even once written), and derive the contract from the CODE, citing file:line, with comments as corroboration only.
