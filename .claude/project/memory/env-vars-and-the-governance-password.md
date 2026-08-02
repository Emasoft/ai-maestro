---
name: env-vars-and-the-governance-password
description: "which env vars does ai-maestro actually read / I set an env var and nothing happened / where is the governance password stored / can I put the password in a scenario file or a shell command / why does a test need AIM_GOVERNANCE_PASSWORD / is .example.env safe to commit"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: security-and-auth
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
