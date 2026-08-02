---
name: two-server-modes-the-headless-router-reimplements-routes
description: "I added the guard in lib/ and the tests are green — but is it actually enforced? the same request behaves differently in headless mode / the route still returns 200 / a central edit was supposed to close every route"
ocd: 2026-07-14
lmd: 2026-08-02
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: architecture-and-runtime
---

**ai-maestro serves every API route TWICE, from two independent code paths, and the headless
one REIMPLEMENTS the handlers — it does not call them.** So a rule added to a shared module in
`lib/` binds full mode and, unless that specific handler happens to call it, **does not bind
headless at all**.

- **full mode** (`MAESTRO_MODE` unset): `server.mjs` → Next.js → `app/api/**/route.ts`. These
  handlers call `requireSudoToken` (→ `lib/sudo-guard.ts` → `lib/authorization.ts::authorize`).
- **headless mode**: `server.mjs` → `services/headless-router.ts`, a hand-maintained array of
  `{method, pattern, handler}`. Some handlers delegate to a service (and inherit whatever that
  service checks); others **inline the work** — including raw `execSync('tmux send-keys …')`.

**Why:** headless is API-only (no Next.js, ~1s boot, ~100MB) for worker nodes. The duplication
is the price. The two modes are two independent lists of who-checks-what, and a route added to
one is simply *absent* from the other — **silently, and in the permissive direction**.

**How to apply.** Before you believe that a central edit "closes route X", **check whether X's
handler is on the call graph you just edited.** Grep the headless router for the route pattern
and read the handler. This is not paranoia — it is the difference between a shipped fix and a
fix that is green in CI and absent in production:

```bash
grep -n "pattern: .*api\\\\/<the-route>" services/headless-router.ts   # does headless serve it?
# then READ the handler: does it call authorize() / the service that does?
```

**A claim about what a central edit closes is a claim about the CALL GRAPH.** Verify the call
graph; never infer it from the architecture you expect. "It's all funnelled through
`authorize()`" is exactly the kind of belief that is true of the design and false of the code.

## Notes and lessons learned

[^1]: [ocd:2026-07-14 lmd:2026-07-14] Cost a near-miss the day this page was written. The plan
  for R42 (TRDD-BF3JN4TL) stated that one edit to `lib/authorization.ts` "closes all six routes
  in **both** server modes at once". It did not. `services/headless-router.ts` reimplements
  `POST /api/sessions/[id]/stop` and `/restart` with raw `execSync` + `authenticateAgent` and
  never calls `authorize()`. Shipping the plan as written would have left R42 **enforced in
  full mode, unenforced in headless, and the whole suite green** — reintroducing, in the fix
  for it, the very authn-substituting-for-authz shape the audit existed to catch. Caught only
  by opening `headless-router.ts:864` instead of trusting the card.
  **Lesson: verify the call graph before trusting "one central edit closes everything".**

[^2]: [ocd:2026-07-14 lmd:2026-07-14] The same sweep — done *because* of [^1], not because
  anything pointed at it — found `POST /api/agents/[id]/chat` in the headless router with **no
  auth call at all**, not even `authenticateAgent`, ending in `sendKeys(session, msg, {literal,
  enter})`. An unauthenticated command-injection endpoint into any agent's pane. The Next.js
  twin carried both checks. **Lesson: when you find ONE instance of this drift, sweep the whole
  router — the defect is structural, so it is never alone.** And note how it hid: nobody thinks
  of a route called "chat" as a control surface. Fixed in `6dcc57fd`; the systemic fix (drive
  headless from the same declarative table, fail closed on an undeclared strict route) is
  `TRDD-HGE9T6VT` and is still OPEN.

[^3]: [ocd:2026-07-14 lmd:2026-07-14] Why no test caught either: a missing authorization guard
  produces a **SUCCESS**, not an error, so a happy-path suite is constitutionally blind to it —
  see [[an-unenforced-rule-produces-a-success-not-an-error]]. The parity test that *would* have
  caught all of them on the day they were written: **for every route served by both modes, the
  two modes must reach the same authorization decision for the same caller.**

## See also

- [[governance-enforcement-ratchet]] — the map row for a parity rule must cite BOTH modes'
  guards comma-separated (a rule enforced in full mode only is exactly the drift this page
  describes), and its own $7$-assertion suite is what makes such an omission build-red.
