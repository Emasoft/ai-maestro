---
trdd-id: 3PLTV6QW
title: Three API routes are latently build-time cached behind an auth gate
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T19:49:02+0200
updated: 2026-08-02T19:49:02+0200
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
release-via: none
labels: [nextjs, caching, latent-defect, amp]
---

# Three API routes are latently build-time cached behind an auth gate

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

After fixing the two live instances (`06452c06` `/api/v1/health`, `65287674` `/api/v1/info`), the
build classifies **3** API routes as `○ (Static)`:

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

- [ ] each of the 3 given its own verdict: runtime-varying (fix) or genuinely constant (leave, with the reason recorded here)
- [ ] `export const dynamic = 'force-dynamic'` added to each route judged runtime-varying
- [ ] build re-run and the `○ /api` set is 0, or the remainder is named with its justification
- [ ] a note added to the repo's Next.js conventions so the next unauthenticated GET does not repeat it

## Approval log

- 2026-08-02T19:49:02+0200 — SELF-MANDATE (min-approval-requirement: none). Bugfix inside the
  authoring agent's own scope: no baseline deviation, no cross-team reach, no governance change,
  reversible. No approval request was sent.
