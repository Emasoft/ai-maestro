---
name: public-repo-personal-data
description: "this repo is PUBLIC and a personal email / account name reached a tracked file — how it happens without anyone deciding to, what the gate is, and why the fix is a role label not an ignore list"
ocd: 2026-08-07
lmd: 2026-08-07
metadata:
  node_type: memory
  type: project
  tier: aspect
---

# public-repo-personal-data


^ATOM-HPWV-Q73A [desc:"PUBLIC repo. A real mailbox at a real provider must never reach a tracked file — the gate is tests/governance/no-personal-addresses-in-tracked-files.ts; the fix is a role label, never an ignore list.", keywords: this_repo_is_public personal_email_in_a_tracked_file PII_leaked_into_git account_name_in_a_TRDD is_it_safe_to_write_an_account_name third_party_address_in_a_public_repo, ocd: 2026-08-07, lmd: 2026-08-07]

**`Emasoft/ai-maestro` and upstream `23blocks-OS/ai-maestro` are BOTH `visibility: PUBLIC`.** Every
tracked file is world-readable. Verify rather than assume: `gh repo view <owner>/<repo> --json
visibility`.

**HOW PERSONAL DATA GETS IN WITHOUT ANYONE DECIDING TO** (measured 2026-08-07). The OAuth-rotator
work is inherently per-account: N credential slots, each belonging to a mail account, so debugging
it means recording WHICH account was dead, WHICH held a live cookie, WHICH Chrome profile was
logged in. Every agent wrote those addresses as ordinary technical detail — each note accurate and
useful. Over ~10 days: **12 occurrences of 5 real addresses across 3 cards**, one belonging to a
**THIRD PARTY**, all pushed.

Nobody chose to publish them. No reviewer looks at a diff line about a credential slot and thinks
"PII". And note where the convention DID hold: the owner's commit identity is a `users.noreply`
address — enforced by TOOLING, not intent. **A hazard that looks like documentation is invisible to
review by construction**, which is why only an every-suite gate catches the next one.

**THE GATE:** `tests/governance/no-personal-addresses-in-tracked-files.test.ts`. The line it draws
is not "no email addresses" — the mailer / SMTP-autodetect / password-reset suites need fixtures.
It is: *a mailbox at a REAL consumer provider whose local-part is not an obvious placeholder is
presumed to be a person's.* `@example.com` (RFC 2606) always passes; `me@gmail.com` is a fixture; a
surname at gmail is a person. It scans `git ls-files` — exactly the population that gets published
— so what it checks and what GitHub shows cannot drift.

**WHEN IT TRIPS, THE FIX IS A ROLE LABEL** (`ACCOUNT-A`, `the live account`, `slot B`). The identity
has never once been load-bearing in this corpus, and the mapping stays recoverable at the host via
`rotator.py list`. For a genuinely new fixture, widen `PLACEHOLDER_LOCALS` or move it to
`@example.com`. **NEVER add a real address to an ignore list — that writes it into a tracked file,
which is the bug itself.**

**REDACTING FORWARD DOES NOT UNDO A PUSH.** Editing the file cleans what a GitHub file-view shows;
history still carries it. Removal means a purge + force-push (**RULE 0.6 — the owner's exact written
command only**), and GitHub retains orphaned commits regardless, so even that is partial. Treat the
gate as prevention, never as remediation.

The sibling leak vector is wildcard staging (`git add -A` / `git add .`), which sweeps untracked
private files into a commit; stage by name, always. That rule is a LOCAL note and is deliberately
NOT wikilinked from here — **this page is PROJECT scope and therefore PUSHED, so naming a
machine-private page from it publishes that page's existence.** Caught by `memgrep lint` as
`link-downward-cross-scope` on this page's own first draft: a privacy page whose first link was a
privacy violation. Worth remembering that the check only fires on the UNION of scopes — linting
this file alone reported clean, because a cross-scope finding is a property of the pair. [^1]

## Notes and lessons learned

[^1]: [id:ATOM-0QGQ-V8OV, status:valid, desc:"caught on this page's own first draft — a privacy page whose first link was a privacy violation", keywords:"wikilink_to_a_page_in_another_scope link-downward-cross-scope PROJECT_page_links_to_LOCAL_page memgrep_lint_clean_on_one_file_but_not_the_union is_this_wikilink_safe", ocd:2026-08-07, lmd:2026-08-07] DO NOT add a `[[wikilink]]` from a PROJECT-scope page without first checking which SCOPE the target lives in, BECAUSE PROJECT memory is git-tracked and PUSHED while LOCAL memory is machine-private, so naming a LOCAL page from a shared one publishes that page's existence — and the check that catches it (`memgrep lint … link-downward-cross-scope`) is a property of the UNION of scopes, so linting the new page ALONE reports perfectly clean. This page's own first draft did exactly that: it linked `[[never-git-add-all]]`, which resolves to a LOCAL note, from a page written to prevent leaking private data. DO resolve the target's scope first (`ls` each scope root for the slug), and when it is LOCAL, state the idea in PROSE with no wikilink — prose carries the meaning, only the link creates the published edge — then lint the UNION of all three scope roots, never the file alone.
