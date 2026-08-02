#!/usr/bin/env bash
# Does a plugin tree call the ai-maestro server API directly? — the IRON RULE, made checkable.
#
# THE RULE (USER, absolute, exception-free — binds the core plugin too): no ai-maestro plugin calls
# the server API directly, ever. Plugins call ONLY the frozen CLI layer (`aimaestro-*.sh`, `amp-*.sh`,
# `aid-*.sh`), which is the one boundary allowed to know an endpoint. The API changes constantly;
# plugins must not.
#
# WHY THIS SCRIPT EXISTS. ai-maestro-plugin#11 states the end state as "`grep -rn '/api/'` returns
# nothing" — and NOTHING RUNS THAT GREP. A rule whose compliance is verified by a human remembering
# to type a command is a rule that regresses the first time nobody remembers. On 2026-08-02 the whole
# installed surface measured CLEAN; this script is what keeps that true tomorrow.
#
# ── THE THREE THINGS THAT MAKE A SCANNER LIE, AND WHAT IS DONE ABOUT EACH ────────────────────────
# (Every one of these was hit for real while writing it — none is hypothetical.)
#
#   1. SILENT SKIPPING. `rg` respects .gitignore by default, so a scanner can quietly not look at
#      files and report clean. `--no-ignore` + EXPLICIT excludes: what is skipped is stated here,
#      not inherited from a config nobody reads.
#   2. THE NEEDLE THAT MATCHES NOTHING. The janitor hit this three times in one day (a lowercase
#      severity set against a lib emitting "CRITICAL"; a `_SKIP_DIRS` entry matching only a dir
#      literally named `_dev`; the right predicate for the wrong question) — each passed lint and
#      types and was SILENT on malicious input. So this script SELF-TESTS on every run: it scans a
#      built-in positive control and ABORTS (exit 2) if its own needle fails to find a known
#      violation. A detector that cannot prove it fires is worse than no detector, because it
#      appears in the audit as coverage.
#   3. STDOUT LOST ON TIMEOUT. Two 8-minute timeouts were burned scanning a 1.2 GB tree with
#      find|xargs before switching to rg (11 s). Results stream to a FILE as they are found, so even
#      a kill leaves evidence.
#
# ── EXIT CODES: grep's own trichotomy, and `2` is the load-bearing one ───────────────────────────
#   0 = clean · 1 = findings · 2 = COULD NOT RUN (missing tool, bad path, self-test failed)
# Never write `check-decoupling || echo ok` — that collapses 2 into 1 and turns "I never looked" into
# "I looked and it was fine", which is the failure this file is built to prevent.
#
# ── SCOPE: the ai-maestro SERVER's API only ─────────────────────────────────────────────────────
# GitHub (`api.github.com`, `gh`), Anthropic (`api.anthropic.com/api/oauth/usage` — the janitor's
# rotator reads the user's OWN usage), crates.io and any other third-party API are OUT of scope and
# deliberately not matched. A rule that flags them trains everyone to ignore it.
set -uo pipefail

usage() {
  cat <<'EOF'
usage: aimaestro-check-decoupling.sh [--quiet] <plugin-dir> [<plugin-dir> ...]

Scans for DIRECT calls to the ai-maestro server API. Exit: 0 clean, 1 findings, 2 could-not-run.

  --quiet   print only the verdict line

Scans code (.sh .py .cjs .mjs .js .ts) AND prompts (.md). The .md half is not optional: a SKILL
telling an agent to `curl /api/...` is a bypass, because the agent runs it. That half was missed by
the first ecosystem sweep and had to be found later (AMAMA #16, 2026-06-15).
EOF
}

QUIET=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --quiet) QUIET=1 ;;
    -h|--help) usage; exit 0 ;;
    *) ARGS+=("$a") ;;
  esac
done
[ "${#ARGS[@]}" -gt 0 ] || { usage >&2; exit 2; }

command -v rg >/dev/null 2>&1 || {
  echo "FATAL: ripgrep (rg) not on PATH — cannot scan. Install it; do NOT fall back to a slower" >&2
  echo "       grep and quietly scan less: a partial scan reporting clean is the bug this guards." >&2
  exit 2
}

# A call site names an ai-maestro server API PATH. Kept in ONE place so the self-test below and the
# real scan can never diverge — two copies of a needle is how one of them silently stops matching.
#
# ⚠ A BARE `:23000` IS DELIBERATELY *NOT* A VIOLATION, and this was learned by running it: the first
# version matched the port, and its first run flagged a README saying "server on
# http://localhost:23000", a docs line "access the dashboard at http://<tailscale-ip>:23000", and an
# HTML comment *documenting the decoupling itself*. All three are correct prose about a dashboard a
# human opens in a browser. A detector whose first output is three false positives is one everybody
# learns to skip, so the port alone buys nothing and costs the tool its credibility. A violation must
# name an API PATH.
NEEDLE='/api/(v1/|agents|teams|sessions|governance|statusline|settings|groups|internal|auth)'

# …and a MENTION must additionally be a CALL. The rule's own completeness criterion allows
# descriptive docs ("the CLI wraps /api/X"); what is forbidden is an executable call or an
# instruction to make one. The verb may sit up to 2 lines ABOVE the URL — the multi-line
#   curl -sS \
#     "$BASE/api/teams/$1/tasks"
# shape is normal in shell, and a needle requiring both on ONE line reported 1 hit across a corpus
# where the honest answer required a different instrument. That miss is why -B2 is here.
CALL_VERB='\b(curl|wget|urlopen|axios|urllib|xhr|XMLHttpRequest)\b|fetch\(|requests\.(get|post|put|delete|patch)|http\.client'
# ⚠ \b ON THE BARE WORDS IS LOAD-BEARING. Without it `curl` matches inside `curls`, and the
# first real run flagged an HTML comment whose text is "describe SERVER-side behaviour, not
# agent curls" — i.e. prose DOCUMENTING compliance, reported as a violation of the thing it
# documents. A detector that flags the documentation of its own rule is one nobody keeps.

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── SELF-TEST (positive control) ────────────────────────────────────────────────────────────────
# Prove the needle FIRES before trusting it to stay silent. Both shapes are real: a one-line curl,
# and the multi-line form where the verb and the URL sit on different lines — the second is what
# defeated a hand-written needle during this script's own development, reporting 1 hit where the
# truthful answer needed a different instrument entirely.
mkdir -p "$TMP/control"
cat > "$TMP/control/violation.sh" <<'CTRL'
curl -sS "http://localhost:23000/api/agents" | jq .
curl -sS \
  "$BASE/api/teams/$1/tasks"
CTRL
cat > "$TMP/control/clean.sh" <<'CTRL'
aimaestro-agent.sh list --json
gh api repos/o/r/issues            # GitHub: out of scope
curl -sS "https://api.anthropic.com/api/oauth/usage"   # Anthropic: out of scope
CTRL
CONTROL_HITS=$(rg -c --no-ignore -e "$NEEDLE" "$TMP/control/violation.sh" 2>/dev/null | tail -1)
CONTROL_CLEAN=$(rg -c --no-ignore -e "$NEEDLE" "$TMP/control/clean.sh" 2>/dev/null | tail -1)
if [ "${CONTROL_HITS:-0}" -lt 1 ]; then
  echo "FATAL self-test: the needle did not match a KNOWN violation. The scanner is blind, so a" >&2
  echo "       'clean' verdict from it would be meaningless. Fix the needle before trusting a run." >&2
  exit 2
fi
if [ -n "${CONTROL_CLEAN:-}" ] && [ "${CONTROL_CLEAN:-0}" -gt 0 ]; then
  echo "FATAL self-test: the needle matched a KNOWN-CLEAN file (GitHub/Anthropic are out of scope)." >&2
  echo "       A rule that flags third-party APIs trains everyone to ignore it." >&2
  exit 2
fi

# ── THE SCAN ────────────────────────────────────────────────────────────────────────────────────
for d in "${ARGS[@]}"; do
  [ -d "$d" ] || { echo "FATAL: not a directory: $d" >&2; exit 2; }
done

# Results stream to a file as they are produced — a killed run still leaves evidence.
# -B2 so a multi-line `curl \` + URL is one window. --no-heading/--with-filename keep every emitted
# line self-identifying, so the awk below can tell a MATCH line from a CONTEXT line by its separator
# (`:` vs `-`) — that distinction is what lets us report the URL's own line number, not the verb's.
rg -n -B2 --no-heading --with-filename --no-ignore --hidden \
  --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!**/dist/**' --glob '!**/build/**' \
  --glob '!**/design/**' --glob '!**/tests/**' --glob '!**/test/**' --glob '!**/fixtures/**' \
  --glob '!design/**' --glob '!tests/**' --glob '!test/**' --glob '!fixtures/**' \
  --glob '*.{sh,py,cjs,mjs,js,ts,md}' \
  -e "$NEEDLE" \
  "${ARGS[@]}" > "$TMP/raw.txt" 2>/dev/null

# Keep a hit only when a CALL VERB appears in its 3-line window. Prose that merely names an endpoint
# ("**Maps to:** GET /api/agents", "the CLI wraps /api/teams") has no verb and is correctly dropped —
# that is the difference between documenting the boundary and crossing it.
# PYTHON, NOT AWK — and that is a bug fix, not a preference. The awk version of this filter matched
# NOTHING on a fixture containing three known violations, and only a positive control caught it (the
# scanner had just reported the entire installed ecosystem "CLEAN"). Two portability traps, both
# invisible in the code: `-v verb=...` runs escape processing over the value, so `fetch\(` reaches
# the matcher mangled and can invalidate the whole alternation; and whole-array `delete w` is a gawk
# extension this machine's awk does not share. Either one silently yields zero matches — which is
# indistinguishable from a clean corpus. Python's `re` has one regex dialect and raises on a bad
# pattern instead of quietly matching nothing.
CALL_VERB="$CALL_VERB" python3 -c '
import os, re, sys
verb = re.compile(os.environ["CALL_VERB"])
match_line = re.compile(r"^.*?:\d+:")     # a MATCH line; rg writes context as path-LINE-text
# Path exclusions live HERE, not in an rg --glob. `--glob '!**/tests/**'` silently fails to match an
# ABSOLUTE path (the leading `/` defeats the leading `**/`), so two hits inside a tests/ dir survived
# two rounds of glob-guessing. A regex on the printed path has no such ambiguity — and the whole
# point of this tool is not to guess about what it did or did not look at.
skip_path = re.compile(r"/(tests?|fixtures?|samples?|examples?|docs?|design|node_modules)/")
win, out = [], []
for line in sys.stdin:
    line = line.rstrip("\n")
    if line == "--":                       # rg separates context groups
        win = []
        continue
    win.append(line)
    if match_line.match(line):
        if not skip_path.search(line.split(":")[0]) and any(verb.search(w) for w in win):
            out.append(line)
        win = []
print("\n".join(out))
' < "$TMP/raw.txt" > "$TMP/hits.txt" 2>/dev/null || true

# Third-party APIs are OUT of scope by rule (GitHub, Anthropic, crates.io). Dropped LAST so the
# verb filter above never has to know about them — one concern per stage.
grep -vE 'api\.(github|anthropic)\.com|crates\.io|localhost:16686' "$TMP/hits.txt" \
  > "$TMP/final.txt" 2>/dev/null || true

N=$(wc -l < "$TMP/final.txt" | tr -d ' ')
if [ "$QUIET" -eq 0 ] && [ "$N" -gt 0 ]; then
  echo "── direct ai-maestro server API calls (the frozen CLI is the ONLY allowed caller) ──"
  cat "$TMP/final.txt"
  echo
fi

if [ "$N" -gt 0 ]; then
  echo "FINDINGS: $N direct API call site(s). Repoint each to the frozen CLI layer"
  echo "          (aimaestro-*.sh / amp-*.sh / aid-*.sh). If no CLI verb exists yet, ADD ONE to"
  echo "          ai-maestro — never reach past the boundary."
  exit 1
fi

echo "CLEAN: no direct ai-maestro server API calls (needle self-tested this run)."
exit 0
