# Verification lessons — each line cost a real debugging session

Every rule here was learned by shipping the mistake first. They are one-liners because this file is
injected into every turn; keep them that way. Add a line only when a defect actually escaped.

## Tests

- A test that passes with its guard removed pins NOTHING — never accept a new test without a recorded neuter run.
- A neuter run that does NOT fail is a finding about the TEST: mine asserted through a table-level `since` skip and never reached the branch it named, so the guard was decorative.
- Encode a guard at the granularity the BUG had — janitor#123 was COLUMN-granular and my per-table `since` could not express it, making the branch unreachable by construction, not merely untested.
- When one ladder step is all that ships, a version-skew guard cannot be exercised end-to-end — export the pure check and inject a synthetic spec, or it stays unverified until the bug recurs.
- A test that passes for an unknown reason is a failure: isolate it (`-t "<full name>"`) before believing it.
- `vi.clearAllMocks()` clears CALLS, not IMPLEMENTATIONS — a mock overridden in one test leaks into every test after it.
- Route every mock through `(...a) => mockX(...a)` and restore it in `beforeEach`; an inline `vi.fn(async () => …)` in the factory cannot be restored.
- Pinning only the SUCCESS path reads as coverage — assert what happens when the operation fails, or the suite is decorative.
- `-t "R18.1"` also matches `R18.10`; read the test NAMES and COUNT, never the exit code (vitest exits 0 when a filter matches nothing).
- Asserting only `success === false` passes on ANY earlier refusal (a missing password, a failed auth gate) — pin the REASON, e.g. the specific gate in the ops trace.
- A fixture that models the filesystem as ONE constant boolean cannot test a post-condition: an install needs `existsSync` false BEFORE and true AFTER. Model the writes, or the post-condition stays a WARN forever.
- When a guard is unreachable in a fixture, say so in the test's docstring and file it — never seed the developer's REAL `$HOME` to reach it.
- `expect(err).not.toMatch(/one specific message/)` is satisfied by EVERY OTHER error — a positive control must assert `success === true`.
- Choose a positive control to FALSIFY the failure you fear, not to prove a list is non-empty: mine asserted a nested path and stayed green while the pathspec `dir/**/*.ts` silently dropped every TOP-LEVEL file (71 matched, 0 top-level) — including the file the test existed to protect.
- A source-scanning guard needs its scan set controlled too — assert a real count AND one file of each shape it must cover, or the guard reports "clean" on a set it never built.
- A verification gate that reads a REAL path passes vacuously in every test: it inspects state the fixture never touched. Point it at the fixture's seam, then model the write.
- A test can be propped up by the very bug you are fixing: 4 here asserted a cascade that only ran because the buggy ORDER put it before the gate that was failing.
- Provoke an unreadable-input test with ENOTDIR/EISDIR, never chmod — a permissions fixture passes VACUOUSLY when the suite runs as root, and CI often does.
- When the OS will not vary the input you are testing, INJECT it: `expect(got).toEqual(got.sort())` on a real dir passes with the sort removed, so spy the readdir and name the element that must move.
- A plan can name the wrong half of the tool: "wire the SEARCH at FTS5, acceptance byte-identical" was self-contradictory because the search takes a REGEX — and it was the ACCEPTANCE CRITERION, not the code, that exposed it.

## Tools that gate

- A reader that returns `[]` on an I/O error turns its gate into one that passes because it read nothing — separate ENOENT (legal absence) from every other errno (a fault), or "clean" and "unread" are the same answer.
- A gate needs THREE exit codes: 0 clean · 1 findings · 2 could-not-run. With two, every failure to read reports success.
- The non-vacuity guard belongs in the TOOL, not only in the test that happens to exercise it — ours asserted `scanned > 100` in vitest for months while the shipped CLI certified an empty read.

## Verifying a fix

- Diagnose by dumping the actual ops/trace, not by reasoning about what the code should have done — the trace named the real cause in one run, twice, after reasoning had blamed the wrong thing.

## Measuring at scale

- Measure peak RSS, not just wall time: the wall here was MEMORY and it landed at ~60-70k documents — BELOW the 100k target — so the failure is a heap crash, not a slow run.
- A dependency's module-level cache defeats streaming outright — gray-matter keys a cache on each file's full text, so a reader retaining NOTHING still accumulated the whole corpus; grep the parser for `cache` before believing a streaming rewrite.
- Peak RSS is not the live set: RSS counts uncollected garbage, so measure RETENTION with `--expose-gc` + `heapUsed`, or a heap-cap sweep — mine dropped 57% while the retained set barely moved.
- A memory correlation has more than one plausible cause: identical frontmatter + 4.4x memory looked exactly like V8 sliced strings, and deep-flattening every string moved it −3%, refuting it — run the candidate fix as a PROBE before editing any source.
- Extrapolation can be wrong in KIND, not degree — a projected "~6.5 GB, 80-90 s" was in fact an OOM CRASH at 4.45 GB; generate the real 10^5 fixture, because "slow" and "dead" are different verdicts.
- When a refactor must preserve output ORDER, say which alternative you rejected for it: evaluating rules inside the stream would have moved every cross-card finding into a trailing block, and that is invisible on a corpus whose cross-card rules all pass.
- Super-linear wall time near the limit is a SYMPTOM of the memory wall (GC pressure), not a second problem to optimize.
- "Do we need an index?" is usually "is the index rebuilt in RAM every run, or persisted?" — grep for the Maps first; this linter already built one, and that in-memory index WAS the 6.5 GB.
- Cost the JOIN, not just the scan: validating references is O(N × refs × lookup), and a lookup that re-readdirs the corpus makes a linear-looking tool quadratic.
- A generated fixture of identical stubs measures filesystem throughput and nothing else — give it the real body size, the real field set, and real cross-references, or the number is theatre.
- Before generalizing over N consumers, verify they share the shape you assume — I checked all three pillars on disk and found three different document models, one of which (PRRD) has no zones and no id in any filename.
- When the repo lacks an instance of the thing you are encoding (no PRRD.md here), find a REAL one elsewhere rather than encoding the grammar from memory.
- A wall-time delta whose SIGN flips between corpus sizes is noise, not a regression — mine read +12% at 50k and −6% at 10^5 for the same change, so the honest claim was "unchanged; the win is memory".
- Isolate the variable before crediting your change: after a corpus-mutating session, re-run the SAME corpus with the change stashed — three "differences" I was about to attribute to a sort were a new card, an unblocked card, and a row pushed past a 25-row cutoff.
- `readdirSync` order is POSIX-UNDEFINED — APFS returns it sorted, ext4 with dir_index returns hash order — so a byte-identical acceptance built on it passes at home and flakes in CI; sort at the ONE owner before building any differential on top.

## Mocked modules

- Destructuring an export a module-mock does not define THROWS, even if the function is never called — import lazily, on the branch that needs it.

## All-in-one functions (R50/R51)

- A gate whose `run` is a LOOP is not atomic: register its compensation BEFORE running it, or its own partial work is the one thing nothing reverts.
- An `undo` must tolerate `run` having done none, some, or all of its work — reverse only what `run` recorded in ctx.
- Check every precondition (adapters, permissions, reachability) BEFORE the first mutation; ordering prevents states that rollback can only repair.
- The last write in a pipeline still needs a compensation — a registry write after the filesystem work leaves the two disagreeing forever.
- Swallowing a per-item failure into `console.warn` and continuing converts one bad item into an invalid system.
- Order a compensation by the CONSTRAINT graph, not by blind reversal: if the do-path removed X first to satisfy a gate, the undo must restore X first to satisfy that gate's mirror.
- A snapshot nothing reads is not a safeguard — if a gate announces an archive, point at the artifact or stop announcing it.
- "Nothing was deleted" is false the moment ANY earlier sub-step landed; a preserved parent row with its children stripped is a husk, not consistency.

## Second-hand reports (sub-agents, prior sessions, TRDD verdicts, audit findings)

- A report from a sub-agent, a prior session, or a recorded TRDD verdict is a HYPOTHESIS — demand the exact file:line, grep it YOURSELF, and only then call it a fact.
- Never propagate a citation you did not run: I copied SF4's "wakeAgent enforces the roleMissing 409 (~:1958-1973)" into a new TRDD under the word "verified" — the gate was in the ROUTE and that range holds zero `roleMissing`.
- The reporter's confidence is not evidence; a verdict labelled REFUTED / CONFIRMED / VERIFIED still needs the grep, and this one was wrong in the REFUTED direction for five weeks.
- A quoted line RANGE rots even when the claim was once true — re-resolve it against the current file before citing it forward.
- An automated alert fuses a trustworthy MAGNITUDE to a GUESSED cause — two sessions got different confident labels (`FORK_STORM` / `PREMIUM_MODEL_FANOUT`) for the same main-loop burn; act on the number, verify the attribution.
- Disprove a "storm" by the AGE spread, not the count: 29 `claude` processes all 1h+ old is standing infrastructure, and `turns × context × 0.1` already accounted for the whole spike.
- An audit naming ids you cannot find may be auditing a DIFFERENT repo — positive-control your `find` before reporting the absence as a defect (this stopped a false filing against janitor #120).
- Before exporting YOUR finding to another project, read THEIR architecture: my column-granular fix applies to an incremental-shape ladder, and memgrep runs full-current DDL on every open, so the "bug" does not exist there — checking is what stopped the second wrong filing.
- An advisor's VERDICT and its AMENDMENT need separate checking: mine was right that FTS5 cannot serve a regex search, and wrong that indexing replaces "the doctor's O(N x refs) join" — the doctor resolves via an O(1) Set over a Map it builds anyway, so the amendment would have added a native dep to buy nothing.
- A complexity claim in a comment may be hypothetical and still correct: store.ts's "O(N^2 x refs)" names a lint written on `findRecord` that NOBODY WROTE, and says so one line later — the summariser dropped the qualifier, not the comment.

## Claims about the codebase

- A comment citing a rule is NOT a guard enforcing it; the enforcement map is right more often than the comments.
- A CONTRADICTED row with no guard is not automatically a stale citation — read the RULE TEXT before "fixing" it: R9.13 says REJECT while the code QUARANTINES, so the row was correct and the citation was the lie waiting to be written.
- A guard reachable only when a flag is UNSET stays untested when every existing test sets that flag — grep the fixture for the skip flag before believing a gate is covered.
- `awk '/^func/,/^}/'` stops at the FIRST `}` at column 0 and can report a 425-line function as 11 — brace-count the span before concluding a symbol lacks a guard.
- A gate enforced in the ROUTE is absent from every non-route caller: headless routers call services directly, so a quarantine flag set by a pipeline is bypassable until the refusal lives in the SERVICE.
- Prove a guard dead by EXPERIMENT (break it, watch a named test fail), never by reading — a static read produced a confident false positive the tests already refuted.
- Verify a cited line range before writing against it: this repo's citations have been wrong roughly a third of the time.
- `grep -l '^field:'` matches the BODY too — a field inside a fenced example is not frontmatter; check where the `---` block ENDS before calling two values a conflict.
- When a green instrument contradicts your confident reading, re-check the READING: the linter ignored a body-only field and was right, twice in one session (cf. the TITLE_PLUGIN_MAP inversion).
- Scope a new lint to the SCAN SET of the consumer it mirrors — flagging cards no consumer evaluates produced 218 findings that named no broken reader, and a wall of warnings is how a linter gets routed around.
- Two `catch` arms in one function are two bugs with two fixes — I reported "the parser returns null on corrupt frontmatter" when that arm deliberately keeps the file and a DIFFERENT arm drops read errors; name the arm before writing the fix.
- Before flagging a documented invariant as violated, check what the rule's own examples mechanically ARE: the reference DAG's legal edges are all frontmatter fields, so 18 prose mentions of a TRDD id in specs were never edges and a body-scanning lint would have flagged the arbiter itself.

## Refactoring under static tooling

- A static scraper keys on code SHAPE, so a refactor that preserves runtime behaviour can still break every citation — update the scraper in the FIRST refactor, not the 26th.

## Shell

- `cmd | tee FILE | head` truncates FILE via SIGPIPE — capture to the file first, then inspect it.
- Never `pgrep`/`ps | grep` for a cmdline: the scanning shell matches itself. Snapshot `ps` to a file, then search the file.
- `ls dir/*.md | wc -l` on an unmatched glob is not 0, it is MEANINGLESS — count with `find`; mine reported 65 files in two empty dirs and the sample listing beside it was already blank.
- When two outputs of the same command block disagree, recount before building on either — the contradiction IS the finding.
