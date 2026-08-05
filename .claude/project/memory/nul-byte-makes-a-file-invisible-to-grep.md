---
name: nul-byte-makes-a-file-invisible-to-grep
description: "grep returns no match for a file I KNOW contains the string / grep -c prints nothing at all / ugrep says no match but --text finds it / git diff shows Bin N -> M bytes 0 insertions for a source file / git log -p shows nothing for a .ts file / a file became binary / why is my markdown unsearchable / raw NUL byte in source / writing \\x00 through the file-write tool produced a real NUL"
ocd: 2026-08-05
lmd: 2026-08-05
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: tooling-and-testing
---

# nul-byte-makes-a-file-invisible-to-grep

**A single raw `0x00` byte anywhere in a text file makes `grep` (ugrep, the one on PATH here)
report NO MATCH for the ENTIRE file — for every pattern, silently.** Not an error. Not a warning.
The exit code is 1, "no match", exactly as if the string were absent.

Measured 2026-08-05: `grep -c "neuter" .claude/rules/lessons-verification.md` printed **nothing**
for a word occurring **65** times. `grep --text -c` printed **45** immediately. The file was fine;
the instrument had gone blind.

## How to recognise it in two seconds

```bash
grep --text -c "<pattern>" <file>     # if THIS finds it and plain grep does not, you have a NUL
python3 -c "d=open('<file>','rb').read(); print(d.count(b'\x00'), 'NUL bytes')"
```

`file` is NOT a reliable tell — it called the offending 136 KB file `Unicode text, UTF-8 text`,
because a NUL *is* valid UTF-8. `iconv -f UTF-8 -t UTF-8` also mis-reports. Only a byte count and
git's own `Bin` verdict agree with reality.

## The git half is REAL but only sometimes, which is worse than always

Git sniffs only the **first 8000 bytes**. So the same defect gives opposite symptoms depending on
where the byte landed:

| file | size | NUL at | `git diff` |
|---|---|---|---|
| three `.ts` / `.mjs` sources | ~8 KB | line 20-144 | **`Bin 8440 -> 8446 bytes, 0 insertions(+), 0 deletions(-)`** — every diff and code review of them showed NOTHING |
| `lessons-verification.md` | 136 KB | byte 103074 | normal, readable diffs |

So "my diffs look fine" does not clear a file. Check the bytes.

## The cause — you did not type it, and you cannot avoid it by being careful

**Writing the escape through an agent's file-write tool can materialize it as the raw byte.** The
guard's own first draft asked for the escape in three places and got three raw NULs, and the corpus
test caught its own test file. It is not even predictable per occurrence: in one write the one
inside a `String.raw` template came through as text while a plain string literal became a byte.

Two things that DO work, both used in the guard:

- **Build a NUL from a numeric literal** — `String.fromCharCode(0)`, `Buffer.from([0])`. No escape
  is involved, so nothing can transform it.
- **Verify by byte count, never by reading.** A NUL is invisible in every terminal and every editor
  that would otherwise show it to you.

## The guard

`tests/governance/no-nul-bytes-in-tracked-text.test.ts` — scans every tracked file whose extension
is not a known binary one (2212 of 2572 as of 2026-08-05), plus a positive control on the detector
AND on the scan set, because an empty scan set makes the corpus assertion pass over nothing.

`public/images` is its single documented exception: a 3.2 MB PNG committed with **no extension**.
Listed explicitly rather than sniffed, so a NEW extension-less binary reddens the build and gets
looked at — which is how that one was found.

## See also

- [[pillar-tooling-scale-and-index]] — `scripts/trdd-doctor.mjs`, one of the four files that
  carried a NUL and was therefore unsearchable while being a governance tool.

## Notes and lessons learned
