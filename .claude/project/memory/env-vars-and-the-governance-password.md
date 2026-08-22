---
name: env-vars-and-the-governance-password
description: "which env vars does ai-maestro actually read / I set an env var and nothing happened / where is the governance password stored / can I put the password in a scenario file or a shell command / why does a test need AIM_GOVERNANCE_PASSWORD / is .example.env safe to commit / how do I run tests while the owner is AWAY or absent / I set AI_MAESTRO_DEV_MODE=true and nothing happened / how do I enable dev mode / where does the dev-mode login token live"
ocd: 2026-08-02
lmd: 2026-08-22
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: security-and-auth
publish-globally: false
---

# env-vars-and-the-governance-password

Every AI Maestro environment variable is optional and has a sensible default. **`.example.env` is
the canonical, verified list** — it documents each user-facing variable with the default read from
source, and every entry is commented out because the code defaults are the safe ones.

| var | default | what it does |
|---|---|---|
| `PORT` | `23000` | server port (set in the PM2 config) |
| `NODE_ENV` | — | `development` \| `production` |
| `HOSTNAME` | `127.0.0.1` | bind address; auto-upgraded to `::` when Tailscale is detected |
| `MAESTRO_MODE` | `full` | `full` = Next.js UI + API · `headless` = API only |
| `ENABLE_LOGGING` | `false` | session logging; **only the exact string `"true"`** enables it |
| `NOTIFICATIONS_ENABLED` | `true` | AMP tmux push; **only the exact string `"false"`** disables it |
| `AIMAESTRO_ORG` | `default` | AMP tenant — the "org" in `alice@org.local` |

Set them in **`.env.local`** (gitignored — never commit it). `.example.env` **is** committed, so it
must never contain a real secret.

## A phantom knob is worse than an undocumented one

**Never add a variable to `.example.env` or the docs without grepping that the code reads it.**
Both files once documented four knobs — `WS_RECONNECT_DELAY`, `WS_MAX_RECONNECT_ATTEMPTS`,
`TERMINAL_FONT_SIZE`, `TERMINAL_SCROLLBACK` — that nothing has ever read from `process.env`.
`WS_MAX_RECONNECT_ATTEMPTS` is a real symbol, but a local `const` derived from
`WS_RECONNECT_BACKOFF.length` in `hooks/useWebSocket.ts` — same name, not configuration. Someone
sets a phantom knob, nothing happens, and they debug the wrong layer.[^1]

## The governance password — where it lives, and why it never passes through a model

`AIM_GOVERNANCE_PASSWORD`, in the gitignored **`.env.local`**. That is the one place.

Every caller resolves it **itself** from there. `tests/scenarios/scripts/dev-browser-helpers/`
sources the file and pipes the value straight into the browser script's stdin, which is why the
helpers (`aim_login`, `aim_sudo_modal`, `aim_delete_agent`) deliberately take **no password
argument**. Unset ⇒ fail fast; there is no default, because a default would be a secret in a
committed file.

**The value never passes through a model** — not in a prompt, a report, a shell command, a scenario
step, or a commit. Write the variable NAME, never the literal. A scenario's frontmatter says
`governance_password: "$AIM_GOVERNANCE_PASSWORD"`; a step says *"call `aim_sudo_modal`"*, never
*"type the password"*. A step that instructs anyone to type it is a bug in that step.[^2]


^ATOM-M5K8-POQ1 [desc: "Dev mode is TWO halves with DIFFERENT homes: the ENABLE switch is dashboard-only in governance.json (no env var exists, deliberately); only the TOKEN is an env var, and the SHELL CLI reads it, never t", keywords: dev_mode AI_MAESTRO_DEV_MODE set_the_env_var_to_true_and_nothing_happened test_while_the_owner_is_away test_without_the_owner_present unattended_testing dev_mode_token AI_MAESTRO_DEV_MODE_TOKEN am-_prefix devModeLogin enable_dev_mode, type: reference, ocd: 2026-08-22, lmd: 2026-08-22]

**Dev-mode login (`TRDD-A9335BZ6`) is split across two homes, and setting an env var to enable it
does nothing.** Measured in `lib/dev-mode-token.ts` + `lib/dev-mode-token-constants.ts`:

| half | where it lives | how it is set |
|---|---|---|
| the **ENABLE switch** | `governance.json` → `devModeLogin.enabled` | **dashboard only** — Settings → Security, behind the governance password AND a verified passkey |
| the **TOKEN** | `.env.local` → `AI_MAESTRO_DEV_MODE_TOKEN` (value prefixed `am-`) | pasted by the owner; read **by the SHELL CLI only, never by this server** |

**There is no `AI_MAESTRO_DEV_MODE` env var and you must not add one** — the file says so in its
own header, citing the USER-ratified rule of `TRDD-CC9PY337` that a security-weakening setting
WITH a dashboard equivalent is DELETED rather than gated, because *"a dev box is NOT a safe host:
agents run under the SAME UID as the server, so a prompt-injected agent appends one `export` to
~/.zshrc and the next restart picks it up"*. A `process.env` read there also trips the regression
fence in `tests/unit/test-only-env.test.ts`.

**The token is a CREDENTIAL, not a weakening setting** — which is why it is allowed in
`.env.local` at all: possessing it *is* the authentication, the same category as the governance
password. It stands in for that password at `POST /api/auth/login`, so it yields a **user-authority
session**, and it is minted once (`mintDevToken()` is the only place it exists in cleartext),
revocable (`revokeDevToken()`), and stored only as a SHA-256 hash.

**What this buys, and it is the whole point of the feature: an agent can obtain user authority and
run end-to-end tests with the owner ABSENT.** Treat the value exactly like the governance password
— the shell resolves it from the environment, it never passes through a model, and no file names
it. Check whether it is armed by reading `governance.json` → `devModeLogin.enabled` /
`tokenHash` (booleans only; never print the hash).

Part of [[password-and-credential-system]] — the hub that inventories every credential class.

Related: [[env-var-security-delete-not-gate]] (the delete-not-gate rule this obeys). The
agent-vs-human authority split it crosses is summarised on the hub above — deliberately NOT linked
to the LOCAL page that details it, because this page is PROJECT-scope and PUSHED, so a downward
link would dangle for every other cloner.

## See also

- [[nextjs-full-route-cache-freezes-api-responses]] — one concrete cause of "I set an env var and
  nothing happened": an API route that returns env-derived fields can be full-route-cached at build
  time, so it reports the environment of whatever machine ran `yarn build`. `pm2 restart
  ecosystem.config.js --update-env` changes the process env with no rebuild, which is exactly the
  workflow that leaves such a route permanently stale.

## Notes and lessons learned

[^1]: [id:ATOM-ENV-PHANTOM, status:valid, keywords:"env_var_documented_but_never_read set_env_var_nothing_happens phantom_config_knob WS_RECONNECT_DELAY TERMINAL_SCROLLBACK", ocd:2026-08-02, lmd:2026-08-02]
    DO NOT document an environment variable you have not grepped for in the source, BECAUSE a knob
    that is documented and unread sends the next person to debug the layer it appears to control
    instead of the one that actually decides the behaviour — strictly worse than leaving a real
    variable undocumented. DO grep `process.env.<NAME>` before adding a row anywhere. Watch for a
    same-named local `const`, which makes the grep look successful.

[^2]: [id:ATOM-PW-NEVER-ARGV, status:valid, keywords:"governance password in a scenario file password leaked to a public repo AIM_GOVERNANCE_PASSWORD secret in committed file", ocd:2026-08-02, lmd:2026-08-02]
    DO NOT pass the governance password as an argument, type it into a command, or write the
    literal in any file, BECAUSE the earlier contract took it as `$1` — which REQUIRED every
    scenario to spell it out — and **197 copies accumulated across 34 committed files, one of
    which was published to a PUBLIC repo** (TRDD-44RGLOO8, TRDD-E9BZ5P7S). Nobody decided to leak
    it; the format required them to. DO make naming it unnecessary: helpers resolve it from
    `.env.local` themselves and take no password parameter. A secret any file is PERMITTED to name
    eventually appears in every file that CAN name it, so the durable fix is removing the reason to
    name it — not being careful.
