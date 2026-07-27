# Verification lessons — each line cost a real debugging session

Every rule here was learned by shipping the mistake first. They are one-liners because this file is
injected into every turn; keep them that way. Add a line only when a defect actually escaped.

## Tests

- A test that passes with its guard removed pins NOTHING — never accept a new test without a recorded neuter run.
- A test that passes for an unknown reason is a failure: isolate it (`-t "<full name>"`) before believing it.
- `vi.clearAllMocks()` clears CALLS, not IMPLEMENTATIONS — a mock overridden in one test leaks into every test after it.
- Route every mock through `(...a) => mockX(...a)` and restore it in `beforeEach`; an inline `vi.fn(async () => …)` in the factory cannot be restored.
- Pinning only the SUCCESS path reads as coverage — assert what happens when the operation fails, or the suite is decorative.
- `-t "R18.1"` also matches `R18.10`; read the test NAMES and COUNT, never the exit code (vitest exits 0 when a filter matches nothing).
- Asserting only `success === false` passes on ANY earlier refusal (a missing password, a failed auth gate) — pin the REASON, e.g. the specific gate in the ops trace.
- A fixture that models the filesystem as ONE constant boolean cannot test a post-condition: an install needs `existsSync` false BEFORE and true AFTER. Model the writes, or the post-condition stays a WARN forever.
- When a guard is unreachable in a fixture, say so in the test's docstring and file it — never seed the developer's REAL `$HOME` to reach it.
- `expect(err).not.toMatch(/one specific message/)` is satisfied by EVERY OTHER error — a positive control must assert `success === true`.
- A verification gate that reads a REAL path passes vacuously in every test: it inspects state the fixture never touched. Point it at the fixture's seam, then model the write.
- A test can be propped up by the very bug you are fixing: 4 here asserted a cascade that only ran because the buggy ORDER put it before the gate that was failing.

## Verifying a fix

- Diagnose by dumping the actual ops/trace, not by reasoning about what the code should have done — the trace named the real cause in one run, twice, after reasoning had blamed the wrong thing.

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

## Claims about the codebase

- A comment citing a rule is NOT a guard enforcing it; the enforcement map is right more often than the comments.
- Prove a guard dead by EXPERIMENT (break it, watch a named test fail), never by reading — a static read produced a confident false positive the tests already refuted.
- Verify a cited line range before writing against it: this repo's citations have been wrong roughly a third of the time.

## Refactoring under static tooling

- A static scraper keys on code SHAPE, so a refactor that preserves runtime behaviour can still break every citation — update the scraper in the FIRST refactor, not the 26th.

## Shell

- `cmd | tee FILE | head` truncates FILE via SIGPIPE — capture to the file first, then inspect it.
- Never `pgrep`/`ps | grep` for a cmdline: the scanning shell matches itself. Snapshot `ps` to a file, then search the file.
