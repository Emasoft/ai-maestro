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
"""
from __future__ import annotations

import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES_MD = ROOT / "docs" / "GOVERNANCE-RULES.md"

# Code that actually runs on the server. A citation here is evidence of enforcement.
ENFORCEMENT_DIRS = ["services", "lib", "app/api", "server.mjs"]
# Everything else a rule can be mentioned in without being enforced.
DOC_DIRS = ["docs", "rules", "tests", "design", "scripts"]

# How close a citation must be to a gate label to count as "at a gate". Gates are commonly
# 10-30 lines; 40 is generous without being meaningless.
WINDOW = 40

GATE_LABEL = re.compile(r"""ops\.push\(\s*[`'"](G\d+[a-z]?|EXE|PG\d+)""")


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


def main() -> int:
    rules = rule_headings()
    if not rules:
        print("FATAL: no rule headings parsed", file=sys.stderr)
        return 1

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
