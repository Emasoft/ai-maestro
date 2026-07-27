#!/usr/bin/env python3
"""Build the rule -> gate coverage inventory (R51.9).

R51.9: "For each governance rule there is a gate. A rule with no gate is a rule the system
does not actually enforce — it is documentation, and the state it forbids will occur."

This answers ONE question per rule, from evidence rather than memory:

    where, in code that actually runs, is this rule enforced?

Classification (deliberately conservative — it under-claims rather than over-claims):

  GATED     the rule is cited inside an all-in-one pipeline, within a gate's neighbourhood
            (<= WINDOW lines from an `ops.push('G##` / `EXE:` / `PG##` label). That is the
            strongest evidence a script can produce that a GATE enforces it.
  ENFORCED  cited in enforcement code (services/, lib/, app/api/) but not near a gate — a
            route guard, a middleware, a lib invariant. Real enforcement, wrong shape for R51.9.
  DOC-ONLY  cited only in docs/, rules/, tests/, or design/. Nothing enforces it at runtime.
  UNMAPPED  not cited anywhere outside GOVERNANCE-RULES.md itself.

A script cannot judge whether a gate is CORRECT — only whether one plausibly exists. So this
output is a worklist, not a certificate: every non-GATED row is a candidate hole, and the
GATED rows still need a human to confirm the gate checks what the rule says.

`--check` compares the verdicts computed here against the table published in Part II of
docs/GOVERNANCE-ENFORCEMENT-MAP.md and exits non-zero on any drift. Without it the published
table is a hand-copied snapshot of a script that never opens the file it feeds, so code could
change gate coverage and the doc would keep reading as accurate.
"""
from __future__ import annotations

import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES_MD = ROOT / "docs" / "GOVERNANCE-RULES.md"
MAP_MD = ROOT / "docs" / "GOVERNANCE-ENFORCEMENT-MAP.md"

VERDICTS = ("GATED", "ENFORCED", "DOC-ONLY", "UNMAPPED")
# Part II only. Part I's table is a different question with overlapping verdict words, so the
# parse is anchored on the Part II heading rather than on row shape alone.
PART_II = re.compile(r"^# Part II\b")
# `| R7 UI Robustness | **GATED** | ... |` — the trailing "Where" cell is human-curated prose,
# deliberately NOT compared: the verdict is the machine's claim, the evidence is a reader's note.
TABLE_ROW = re.compile(rf"^\|\s*(R\d+)\s+[^|]*\|\s*\*{{0,2}}({'|'.join(VERDICTS)})\*{{0,2}}\s*\|")
TALLY = re.compile(
    r"\*\*GATED (\d+) · ENFORCED (\d+) · DOC-ONLY (\d+) · UNMAPPED (\d+) · total (\d+)\.\*\*"
)

# Code that actually runs on the server. A citation here is evidence of enforcement.
ENFORCEMENT_DIRS = ["services", "lib", "app/api", "server.mjs"]
# Everything else a rule can be mentioned in without being enforced.
DOC_DIRS = ["docs", "rules", "tests", "design", "scripts"]

# How close a citation must be to a gate label to count as "at a gate". Gates are commonly
# 10-30 lines; 40 is generous without being meaningless.
WINDOW = 40

# A gate is written one of TWO ways, and both must count as a gate label:
#
#   hand-rolled   ops.push(`G09: Updated program in registry`)
#   AIO runner    { id: 'G09', what: '…', run: …, undo: … }   (lib/gate-transaction.ts)
#
# The runner emits the same `G09: …` ops string at runtime, so a rule cited next to a runner gate
# is just as gated as one cited next to a literal push — but a pattern that knows only the push
# form silently DOWNGRADES every retrofitted pipeline from GATED to ENFORCED, which reads as
# "coverage got worse" when nothing did. ChangeClient became the runner's first production caller
# in TRDD-B6NUEGMP; TRDD-DQ6XN2VP retrofits the remaining pipelines.
GATE_LABEL = re.compile(
    r"""(?:ops\.push\(\s*[`'"]|\bid:\s*[`'"])(G\d+[a-z]?|EXE|PG\d+)"""
)


def rule_headings() -> list[tuple[str, str]]:
    out = []
    for line in RULES_MD.read_text().splitlines():
        m = re.match(r"^## (R\d+)\.\s+(.*)$", line)
        if m:
            title = re.sub(r"\s*\((CRITICAL|IRON|USER-set).*$", "", m.group(2)).strip()
            out.append((m.group(1), title))
    return out


def grep(pattern: str, paths: list[str]) -> list[str]:
    """rg-less grep -rn; missing paths are skipped, not fatal."""
    existing = [p for p in paths if (ROOT / p).exists()]
    if not existing:
        return []
    proc = subprocess.run(
        ["grep", "-rnE", "--include=*.ts", "--include=*.tsx", "--include=*.mjs",
         "--include=*.md", "--include=*.sh", "--include=*.py", pattern, *existing],
        cwd=ROOT, capture_output=True, text=True,
    )
    return [ln for ln in proc.stdout.splitlines() if ln.strip()]


def gate_lines(path: Path) -> list[int]:
    try:
        return [i for i, ln in enumerate(path.read_text().splitlines(), 1)
                if GATE_LABEL.search(ln)]
    except OSError:
        return []


def compute() -> tuple[list[tuple[str, str, str, int, str]], dict[str, int]]:
    rules = rule_headings()
    if not rules:
        raise SystemExit("FATAL: no rule headings parsed")

    gate_cache: dict[str, list[int]] = {}
    rows = []
    tally: dict[str, int] = defaultdict(int)

    for rid, title in rules:
        # \b + optional sub-number: R9 must not match R91, but must match R9.13.
        pat = rf"\b{rid}(\.\d+[a-z]?)?\b"
        code_hits = grep(pat, ENFORCEMENT_DIRS)
        doc_hits = grep(pat, DOC_DIRS)

        gated_at: list[str] = []
        for hit in code_hits:
            fname, lineno = hit.split(":", 2)[0], hit.split(":", 2)[1]
            if fname not in gate_cache:
                gate_cache[fname] = gate_lines(ROOT / fname)
            gl = gate_cache[fname]
            if gl and any(abs(int(lineno) - g) <= WINDOW for g in gl):
                gated_at.append(fname)

        if gated_at:
            verdict = "GATED"
            ev = ", ".join(sorted(set(gated_at))[:2])
        elif code_hits:
            verdict = "ENFORCED"
            ev = ", ".join(sorted({h.split(":", 1)[0] for h in code_hits})[:2])
        elif doc_hits:
            verdict = "DOC-ONLY"
            ev = ", ".join(sorted({h.split(":", 1)[0] for h in doc_hits})[:2])
        else:
            verdict = "UNMAPPED"
            ev = "—"

        tally[verdict] += 1
        rows.append((rid, title, verdict, len(code_hits), ev))

    return rows, tally


def published() -> tuple[dict[str, str], tuple[int, ...] | None]:
    """Parse Part II's table out of the enforcement map: {rule: verdict}, plus its tally line."""
    verdicts: dict[str, str] = {}
    tally: tuple[int, ...] | None = None
    in_part_ii = False
    for line in MAP_MD.read_text().splitlines():
        if PART_II.match(line):
            in_part_ii = True
            continue
        if not in_part_ii:
            continue
        if (m := TALLY.search(line)) is not None:
            tally = tuple(int(g) for g in m.groups())
        if (m := TABLE_ROW.match(line)) is not None:
            verdicts[m.group(1)] = m.group(2)
    return verdicts, tally


def check(rows: list[tuple[str, str, str, int, str]], tally: dict[str, int]) -> int:
    """Fail when the published Part II table disagrees with what the code says today."""
    doc_verdicts, doc_tally = published()
    computed = {rid: verdict for rid, _, verdict, _, _ in rows}
    drift: list[str] = []

    if not doc_verdicts:
        drift.append(f"no Part II table parsed from {MAP_MD.relative_to(ROOT)} — did its shape change?")
    for rid in sorted(computed.keys() - doc_verdicts.keys()):
        drift.append(f"{rid}: computed {computed[rid]}, but the map's Part II has no row for it")
    for rid in sorted(doc_verdicts.keys() - computed.keys()):
        drift.append(f"{rid}: the map's Part II lists it {doc_verdicts[rid]}, but no such rule heading exists")
    for rid in sorted(computed.keys() & doc_verdicts.keys()):
        if computed[rid] != doc_verdicts[rid]:
            drift.append(f"{rid}: map says {doc_verdicts[rid]}, code says {computed[rid]}")

    want = tuple(tally[k] for k in VERDICTS) + (len(rows),)
    if doc_tally is None:
        drift.append("the map's Part II carries no `**GATED n · ENFORCED n · …**` tally line")
    elif doc_tally != want:
        drift.append(f"tally line says {doc_tally}, code says {want}")

    if drift:
        print(f"DRIFT — {MAP_MD.relative_to(ROOT)} Part II no longer matches the code:", file=sys.stderr)
        for d in drift:
            print(f"  - {d}", file=sys.stderr)
        print("\nRe-run `python3 scripts/aio-gate-coverage.py` and update Part II.", file=sys.stderr)
        return 1

    print(f"OK — Part II matches the code ({len(rows)} rules).")
    return 0


def main() -> int:
    rows, tally = compute()
    if "--check" in sys.argv[1:]:
        return check(rows, tally)

    w = max(len(t) for _, t, _, _, _ in rows)
    print(f"{'RULE':<5} {'TITLE':<{w}} {'VERDICT':<9} {'CITES':>5}  EVIDENCE")
    for rid, title, verdict, n, ev in rows:
        print(f"{rid:<5} {title:<{w}} {verdict:<9} {n:>5}  {ev}")

    print()
    for k in ("GATED", "ENFORCED", "DOC-ONLY", "UNMAPPED"):
        print(f"{k:<9} {tally[k]:>3}")
    print(f"{'TOTAL':<9} {len(rows):>3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
