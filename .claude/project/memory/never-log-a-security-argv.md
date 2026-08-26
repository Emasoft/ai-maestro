---
name: never-log-a-security-argv
description: "I want to log which keychain item is slow or failing / can I log the security argv / my log prints argv.join and it looked safe / the -w flag prints to stdout so no secret is on the command line — WRONG for writes / an email address showed up in pm2-error.log / how do I identify a keychain account in a log without leaking it / my fix shipped the next leak / the allowlist proves omission not commission / a test pinned the leak in as a requirement / my safety claim was scoped to the wrong hazard"
ocd: 2026-08-26
lmd: 2026-08-26
metadata:
  node_type: memory
  type: project
  tier: aspect
publish-globally: false
---

# never-log-a-security-argv


^ATOM-MO8R-4CIM [desc: "The rotator's keychain argv carries the SECRET on writes and the OWNER'S EMAIL on every call — never log it raw; allowlist verb+service and digest the account", keywords: log_the_security_argv argv.join_leaked_a_token -w_flag_two_meanings macosStoreArgv_secret_on_argv keychain_account_is_an_email pm2-error.log_PII which_keychain_item_is_slow describeSecurityArgv allowlist_proves_omission_not_commission, type: project, ocd: 2026-08-26, lmd: 2026-08-26]

**Never log a `security` argv from `lib/oauth-rotator/safe-storage.ts`, raw or redacted-by-blocklist.**
Two independent sensitive things ride in it, and each was missed by a safety argument aimed at the
other. Shipped and caught twice in one hour on 2026-08-26 (TRDD-MFTDMSJY).

**1. The SECRET is on argv — for writes only.** `macosStoreArgv` builds
`security add-generic-password -U -s SVC -a ACCT -w <secret>`; the value is on the command line
*deliberately*, because the stdin form reads via `getpass()` whose buffer is a hard 128 bytes and
silently truncates (TRDD-5539cd6e). `macosRetrieveArgv`'s `-w` is a **valueless** flag meaning
"print the password to stdout". **Same flag, opposite meaning, one function apart.** Reasoning
"`-w` prints to stdout so no secret is on the command line" is true of the read builder and false
of the write builder — and writes are *more* likely to stall into a slow-path log than reads,
because a write can prompt.

**2. The ACCOUNT is PII on every call.** For a slot it is the owner's email address; for the
live/livebak family it is the macOS username (`live.ts::keychainAccount` → `$USER`). It lands in
`pm2-error.log`, whose lines get quoted into PUBLIC GitHub issues.

**Do this instead:** `describeSecurityArgv(argv)` — an ALLOWLIST emitting `verb=<argv[1]>`,
` service=<value after -s>` (a module constant, safe in clear) and ` account=#<sha256(acct)[0:8]>`.
A diagnostic log only needs to say WHICH item blocked, and that requires **distinguishability, not
identity**. A blocklist ("redact the token after `-w`") also works *today* and is the fragile shape
that broke: it depends on a per-verb fact about one flag.

**The allowlist is safe because of an ordering invariant, not by construction:** `-s` and `-a`
always PRECEDE `-w`, and `indexOf` returns the FIRST match — so a secret can never be selected even
if its own value is the literal string `-s`. A future builder that puts `-w` first breaks it in
silence. [^1]

## Notes and lessons learned

[^1]: [id: ATOM-WHZC-2XMH, status: valid, desc: "Both leaks shipped behind a safety argument scoped to the OTHER hazard — allowlisting proves omission, never commission", keywords: "safety_claim_scoped_to_the_wrong_hazard allowlist_proves_omission_not_commission test_pinned_the_leak_in_as_a_requirement my_fix_shipped_the_next_leak", ocd: 2026-08-26, lmd: 2026-08-26] DO NOT accept a safety argument that reasons only about the hazard you already had in mind, BECAUSE it proves what you did not emit and says nothing about what you deliberately DID — the token fix's own commit said "no future argv shape can leak through it" while the field it chose to emit was the owner's email. DO ask, of every field an allowlist KEEPS, "is this one sensitive too?" — and never let a test assert the sensitive value (`toContain('account=acct-y')` pinned the PII in as a requirement, so a later reader could not remove it without breaking a green test that looked deliberate).
