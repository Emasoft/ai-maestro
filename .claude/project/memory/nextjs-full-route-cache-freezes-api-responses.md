---
name: nextjs-full-route-cache-freezes-api-responses
description: "an API endpoint returns stale or frozen data / uptime_seconds never increases / x-nextjs-cache HIT / the health endpoint reports the same value on every poll / /api/config shows the BUILD machine's node version and port / a config change does not propagate until someone rebuilds / gh auth works but the orgs endpoint still 500s / why is my GET route listed as Static in the build output"
ocd: 2026-08-05
lmd: 2026-08-05
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: architecture-and-runtime
---

# nextjs-full-route-cache-freezes-api-responses

**Next.js full-route-caches a GET handler that never reads its `Request`.** The response is
computed once, on the machine that ran `yarn build`, and served forever after. Being
*unauthenticated* and *request-independent* — the two properties that make a discovery, liveness,
or config endpoint useful — are exactly the two that make it static.

**`cache-control: no-store` does not prevent this.** That header instructs the CLIENT; the full
route cache lives server-side, upstream of it. Neither does `async`, nor doing real I/O in the
handler: reading the filesystem, shelling out to a subprocess, and hitting a database are all
things Next.js will happily do once at build time and freeze.

**The fix is one additive line per route:**

```ts
export const dynamic = 'force-dynamic'
```

**The build is the only instrument that decides.** Asserting the export exists in the source is a
different check from the route actually leaving the static set — a stale `.next` will keep serving
the cached asset regardless of what the source says:

```bash
bash scripts/with-node.sh yarn build > /tmp/b.txt 2>&1
grep -E "^[^ ]* [○ƒ] /api" /tmp/b.txt     # ○ = Static (wrong here) · ƒ = Dynamic (correct)
```

Verify by PRESENCE — that each route you fixed now shows `ƒ` — never by the absence of `○` lines,
which a mistyped anchor produces just as readily. Keep a positive control in the same command (the
page routes are legitimately `○`, so a total of zero `○` anywhere means the needle is broken, not
that the corpus is clean).

## Do NOT blanket-apply it

A route whose body is a genuine compile-time constant is *correctly* static, and forcing it dynamic
trades a real optimisation for nothing. Each route gets its own verdict, grounded in what its
handler actually reads. The question is not "is this route important?" but **"can this response
change without the bundle changing?"**

## See also

- [[two-server-modes-the-headless-router-reimplements-routes]] — the headless router reimplements
  routes outside Next.js entirely, so it does **not** inherit this defect. A symptom that appears
  in full mode and vanishes in headless is evidence *for* this cause, not against it.
- [[env-vars-and-the-governance-password]] — env-derived response fields are the most common
  runtime-varying case, and `pm2 restart ecosystem.config.js --update-env` changes them with **no
  rebuild**, so a static body reports some earlier build's environment indefinitely.

## Notes and lessons learned

[^1]: [id:ATOM-NFRC-0001, status:valid, keywords:"endpoint_returns_stale_data uptime_frozen x_nextjs_cache_hit cache_control_no_store_did_not_help health_endpoint_same_value_every_poll route_listed_as_Static_in_build", ocd:2026-08-05, lmd:2026-08-05]
    DO NOT conclude an endpoint is uncacheable because it does real I/O or sets
    `cache-control: no-store`, BECAUSE the full route cache is server-side and runs the handler
    exactly once at build time — measured 2026-08-02, `/api/v1/health` reported
    `uptime_seconds: 3` on every poll while the process had been up 274,775 s. DO check the build
    output's `○`/`ƒ` classification instead, which is the artifact that actually decides.

[^2]: [id:ATOM-NFRC-0002, status:valid, keywords:"route_is_401_so_it_does_not_matter latent_defect_behind_an_auth_gate middleware_protects_it safe_because_unreachable different_layer_from_the_defect", ocd:2026-08-05, lmd:2026-08-05]
    DO NOT treat a statically-built route as harmless because middleware 401s it first, BECAUSE the
    auth gate is a DIFFERENT LAYER from the defect — the route is still built as a static asset
    holding a build-time snapshot, so the safety property is only "the gate happens to run first".
    Narrow the matcher or make the route public and it begins serving build-time data with no error
    and no log line. DO fix the route on its own merits and let the gate be defence in depth.
