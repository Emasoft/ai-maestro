---
trdd-id: 3PLTV6QW
title: Three API routes are latently build-time cached behind an auth gate
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-02T19:49:02+0200
updated: 2026-08-05T06:28:15+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T19:49:02+0200
severity: low
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
implementation-commits: [de7ed6cdd75ec5d550567b98ae698469e57a3ce8]
release-via: none
labels: [nextjs, caching, latent-defect, amp]
---

# Three API routes are latently build-time cached behind an auth gate

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-05 — **DONE**

**All three fixed. The build now classifies `○ /api` as ZERO**, and each of the three shows `ƒ
(Dynamic)` by name. Verdicts below are grounded in each handler's read code, not in the route's
name — the card's "do NOT blanket-apply" instruction was honoured by giving each its own reading,
and they happened to agree:

| route | what the handler actually reads | verdict |
|---|---|---|
| `/api/agents/directory` | `getDirectory()` → `rebuildLocalDirectory()` then the live registry; `entries`/`stats` are a snapshot of which agents exist right now | runtime-varying → FIXED |
| `/api/config` | **all five fields**: `version.json` via fs (rewritten by `bump-version.sh`), `ENABLE_LOGGING` + `PORT` from env, `os.platform()`, and `process.version` | runtime-varying → FIXED |
| `/api/github/orgs` | `listOrgs()` shells out to `gh api /user/orgs` — live org membership **and** whether `gh` is authenticated on this host | runtime-varying → FIXED |

**The `/api/config` case is the one that would have misled worst.** `nodeVersion: process.version`
exists to answer "what is the server ACTUALLY running on" — Node 22 is a hard ABI constraint here
(node-pty is built for NODE_MODULE_VERSION 127). Cached, it answers "what built the bundle", which
is the single answer that cannot diagnose an ABI mismatch. The env fields fail the same way for a
different reason: `pm2 restart ecosystem.config.js --update-env` changes them with **no rebuild**.

**Verified by the BUILD, not by the source.** `grep` for the three route names shows `ƒ` for each,
and the same anchor still matches the 13 legitimately-static page routes — a positive control, so
the zero is a real zero rather than a mistyped needle. `tsc --noEmit` 0 lines; build exit 0.

**One thing NOT proven, and worth stating:** the `curl … x-nextjs-cache` half of the Verification
block was not run, because all three still 401 at middleware — which is the very reason this card
existed. The build classification is the check that actually decides; the curl was only ever a
confirmation for a reachable route.

### Prior state (2026-08-02, for context)

After fixing the two live instances (`06452c06` `/api/v1/health`, `65287674` `/api/v1/info`), the
build classified **3** API routes as `○ (Static)`:

```
○ /api/agents/directory
○ /api/config
○ /api/github/orgs
```

All three currently return **401** — middleware refuses the request before the cached response is
reachable — so they are **LATENT, not live**. That is the whole reason they were not fixed in the
same commit.

**NEXT ACTION:** for each of the three, decide whether static is genuinely wrong *for that route*,
then add `export const dynamic = 'force-dynamic'` where it is. Do NOT blanket-apply: the point of
the sweep was to find routes whose response is runtime-varying, and a route whose body is a true
compile-time constant is correctly static.

```bash
# the authoritative instrument — the build labels every route, no probing needed
bash scripts/with-node.sh yarn build > /tmp/b.txt 2>&1
grep -E "^[├└│ ]*○ /api" /tmp/b.txt
```

## The defect shape (why these were found at all)

Next.js full-route-caches a GET handler that **never reads its Request**. Being *unauthenticated*
and *request-independent* — the two properties that make a discovery/liveness endpoint useful — are
exactly what make it static. `cache-control: no-store` does NOT prevent it: that header instructs
the CLIENT, while the full route cache lives server-side.

Measured on the live server before the fixes: `x-nextjs-cache: HIT`, with `/api/v1/health`
reporting `uptime_seconds: 3` on every poll while the process had been up 274 775 s.

## Why "latent" is worth a card rather than a shrug

The 401 that protects them is in **middleware**, i.e. a *different layer* from the thing that is
wrong. The route is still built as a static asset holding a build-time snapshot. So the safety
property is "the auth gate happens to run first", and that is exactly the kind of assumption that
changes without anyone re-checking the routes downstream of it:

- `/api/config` and `/api/github/orgs` return runtime configuration, so a static body is wrong on
  the merits regardless of who can reach it;
- `/api/agents/directory` returns registry-derived data, which changes constantly.

If any of the three is ever made public, or the middleware matcher is narrowed, they begin serving
build-time data with no error and no log line — the same silent, reassuring-direction failure the
two fixed routes had.

## Verification

```bash
bash scripts/with-node.sh yarn build > /tmp/b.txt 2>&1
grep -cE "^[├└│ ]*○ /api" /tmp/b.txt      # target: 0, or a stated, justified remainder
# and per route, live:
curl -s -D - -o /dev/null http://127.0.0.1:23000/<route> | grep -i x-nextjs-cache   # want: absent
```

A fix is only real if the BUILD moves the route out of the `○` set — asserting the export exists in
the source is not the same check, and the build is the artifact that decides.

## Estimated risk

LOW. One-line additive exports; no behaviour change for any currently-reachable caller (all three
401 today). The only way to do harm is to blanket-apply it to a route whose body really is a
compile-time constant, which trades a correct optimisation for nothing.

## Acceptance

- [x] each of the 3 given its own verdict: runtime-varying (fix) or genuinely constant (leave, with the reason recorded here) — see the STATE table; each verdict cites the handler's read code
- [x] `export const dynamic = 'force-dynamic'` added to each route judged runtime-varying — all 3, each with a WHY comment naming its own runtime-varying fields
- [x] build re-run and the `○ /api` set is 0, or the remainder is named with its justification — **0**, verified by presence (`ƒ` per route) with a positive control on the anchor
- [x] a note added to the repo's Next.js conventions so the next unauthenticated GET does not repeat it — new wikimem aspect page `[[nextjs-full-route-cache-freezes-api-responses]]`, indexed into CLAUDE.md + the overview, cross-linked both ways with `two-server-modes-…` and `env-vars-and-the-governance-password`

## Approval log

- 2026-08-02T19:49:02+0200 — SELF-MANDATE (min-approval-requirement: none). Bugfix inside the
  authoring agent's own scope: no baseline deviation, no cross-team reach, no governance change,
  reversible. No approval request was sent.
