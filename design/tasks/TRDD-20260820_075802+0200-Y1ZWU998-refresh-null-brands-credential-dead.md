---
trdd-id: Y1ZWU998
title: A transient refresh failure brands the credential DEAD and arms a human-only retry ban
column: todo
created: 2026-08-20T07:58:02+0200
updated: 2026-08-20T09:10:13+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-20T07:58:02+0200
derived: true
derived-kind: eht
parent-trdd: MN0Q1IA2
npt: []
eht: []
blocked-by: []
implementation-commits: []
priority: 0
severity: high
effort: medium
labels: [oauth-rotator, continuity, janitor-228-class]
external-refs: [https://github.com/Emasoft/ai-maestro-janitor/issues/228]
release-via: none
---

# A transient refresh failure brands the credential DEAD and arms a human-only retry ban

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-20 08:00

**MEASURED LIVE, and it is not hypothetical — every slot on this host is in the defect state.**
Read from the janitor's own `oauth-rotator/state.json` minutes after the XV9BLQC5 alert fix
deployed (07:51 alert, 08:00 read):

| slot | `refresh_failures` | `last_refresh_failure` (the OWNER's classification) | `refresh_dead_fp` (OURS) |
|---|---|---|---|
| fmuaddib | 567 | **`network`** | **SET** |
| emanuele.sabetta | 219 | **`network`** | **SET** |
| ipazia (LIVE) | 775 | **`network`** | **SET** |

**Not one slot was ever judged `credential-dead` by the endpoint.** The janitor classifies all
three as TRANSPORT failures, and our `tick.ts` branded all three DEAD anyway — arming the
human-only retry ban on credentials nothing has rejected. That is this card's defect, at 100% of
the population.

**IT ALSO CORRECTS AN EARLIER USER-FACING CLAIM.** TRDD-XV9BLQC5's 2026-08-20 01:45 re-measure
surfaced *"the two alternate slots have dead refresh tokens and need a human re-login"* — read
off `nextAction: reauth-needed / reason: refresh-dead`, which is exactly the verdict this defect
manufactures. Per the owner's own classifier the correct statement is: **the refresh transport is
failing (network), the credentials were never judged, and a re-login is NOT established as
necessary.** Surfaced to the USER as a correction.

**`refresh_dead_fp` is OURS — verified first-hand, with a positive control:** 4 write/read sites
in `lib/oauth-rotator/*.ts`, and **0** hits across all 3 cached janitor versions (3.3.16/17/18)
while the control string `refresh_failures` returns 17 files in each. So the fix is entirely on
our side; no upstream dependency.

**A SECOND question this raises, worth its own probe:** 775/567/219 consecutive `network`
failures is not a blip — something in the refresh transport has been failing persistently
(possibly since 2026-08-07, when `reauth-needed/refresh-dead` first went continuous). Diagnosing
THAT is separate from stopping the mis-branding, and the mis-branding is what makes it
unrecoverable without a human.


## Problem

`lib/oauth-rotator/tick.ts:829-836` is the **janitor#228 defect ported into our own
TypeScript**, found while fixing the alert TEXT that describes it (TRDD-XV9BLQC5, 9793fca6):

```ts
const fresh = await refreshOauthToken(blob, netDeps(deps))
if (fresh === null) {
  meta.refresh_failures = ... + 1
  meta.refresh_dead_fp = fingerprint(blob)   // ← brands the credential DEAD
}
```

`refreshOauthToken` returns `null` for **any** failure — timeout, DNS, Cloudflare 1010,
malformed 200, and a genuine `invalid_grant` alike. So one transient network blip writes
`refresh_dead_fp` and arms the retry ban at `:825`, whose own comment says it un-gates only
when a human re-login writes a blob with a NEW fingerprint.

**A benign, retryable failure is thereby made unrecoverable without a human** — the false claim
XV9BLQC5 removed from the alert text, turned into real behavior one layer down. `refresh_dead_fp`
is written by ai-maestro (`tick.ts:833,881`), not by the janitor; it appears in no cached
janitor version, so this is ours to fix.

Live corroboration: two alternate slots have carried `refresh-dead` continuously since
2026-08-07 (XV9BLQC5's adverse re-measure) — a state this code cannot distinguish from a
fortnight of Cloudflare blocks.

## Proposed fix

The janitor already classifies (their #228 shipped `_CHALLENGE_MARKERS_RE` + a
Cloudflare-vs-dead distinction), and `supervisor.ts` now carries their four-constant vocabulary
(`REFRESH_FAIL_CAUSES`). Make `refreshOauthToken` report WHICH failure it saw and brand
`refresh_dead_fp` **only** on `credential-dead`; every other cause increments the counter and
stays retryable. Reuse the existing vocabulary — do not mint a fifth taxonomy.

## Estimated risk

MEDIUM-HIGH — this is the data path that decides credential rotation for the whole fleet. Wants a
fresh context, the current behavior kept as the fallback for an unclassifiable failure (fail
toward "not dead" is the safe direction here, since the retry ban is the irreversible half), and
a differential test over a known fixture before the switch is trusted.

## Acceptance

- [ ] `refresh_dead_fp` is written ONLY for a credential the endpoint actually rejected; every other failure class increments the counter and stays retryable
- [ ] the failure cause reuses `REFRESH_FAIL_CAUSES` (no fifth taxonomy)
- [ ] a neuter that re-brands any-null-as-dead reds exactly the transient-failure test
- [ ] the two live `refresh-dead` slots are re-measured after the fix to see which class they actually are

## Approval log

- 2026-08-20T07:58:02+0200 — MANDATE issued as Tier-0 self-mandate (derived EHT of [[XV9BLQC5]], server-internal).
  No approval request sent.
