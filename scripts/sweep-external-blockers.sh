#!/usr/bin/env bash
# Re-runnable stale-external-blocker sweep for TRDD-8GBIQMEP.
#
# The board has no field for an external blocker, so an external wait lives only in prose and
# nothing re-checks it. This is the re-check. Read-only: greps design/tasks/*.md for issue refs in
# a BLOCKING context, resolves each with `gh issue view`, prints `card | issue | STATE`.
#
# Baseline to beat (2026-08-21): 9 of 12 CLOSED. A second run scoring ~75% means whatever fix
# landed did not work.
#
# Usage:  bash scripts_dev/sweep-external-blockers.sh [design/tasks]
# Exit:   0 = every cited blocker OPEN. 1 = at least one CLOSED (i.e. a card holds a dead claim).
#         2 = a ref could not be resolved (AMBIGUOUS / UNKNOWN-REPO / MISSING) and nothing is CLOSED.

set -uo pipefail
DIR="${1:-design/tasks}"
CACHE=$(mktemp); trap 'rm -f "$CACHE"' EXIT

# Shorthand → repo. Extend here; an unmapped prefix is reported, never guessed.
repo_for() {
  case "$1" in
    janitor|ai-maestro-janitor)              echo "Emasoft/ai-maestro-janitor" ;;
    ai-maestro|amama)                        echo "Emasoft/ai-maestro" ;;
    orch|ai-maestro-orchestrator-agent)      echo "Emasoft/ai-maestro-orchestrator-agent" ;;
    plugin|ai-maestro-plugin)                echo "Emasoft/ai-maestro-plugin" ;;
    maintainer|ai-maestro-maintainer-agent)  echo "Emasoft/ai-maestro-maintainer-agent" ;;
    *)                                       echo "" ;;
  esac
}

# gh is rate-limited and slow; ask once per issue.
state_of() {
  local repo="$1" num="$2" key hit
  key="$repo#$num"
  hit=$(grep -m1 "^$key	" "$CACHE" 2>/dev/null | cut -f2)
  if [ -n "$hit" ]; then echo "$hit"; return; fi
  local s
  s=$(gh issue view "$num" --repo "$repo" --json state --jq .state 2>/dev/null)
  [ -z "$s" ] && s="MISSING"
  printf '%s\t%s\n' "$key" "$s" >> "$CACHE"
  echo "$s"
}

# Every tracker a bare `#N` could plausibly mean. This is the whole argument for a real field in one
# number: if a bare ref routinely resolves in MORE THAN ONE tracker, then the notation the board
# actually uses cannot name a dependency — not "is hard to parse", CANNOT NAME. A human reader is in
# exactly the same position as the script here, with no extra information to break the tie.
# `23blocks-OS/ai-maestro` is `origin`; `Emasoft/ai-maestro` is `fork`. This project spans two
# remotes BY DESIGN (CLAUDE.md), so for a hub card the count is >= 2 by construction for every bare
# `#N` — a property of the layout, not a frequency. Verified 2026-08-21: `#63` is a MERGED PR in
# origin and an OPEN launch issue in fork. A sweep that guessed would have returned the opposite of
# the truth. Note also that `gh issue view` resolves PRs too, so `#N` does not even disambiguate
# issue-from-PR within ONE repo.
KNOWN_REPOS="Emasoft/ai-maestro-janitor Emasoft/ai-maestro 23blocks-OS/ai-maestro Emasoft/ai-maestro-orchestrator-agent Emasoft/ai-maestro-plugin Emasoft/ai-maestro-maintainer-agent"
KNOWN_N=6
plausible_count() {
  local num="$1" n=0 r
  for r in $KNOWN_REPOS; do
    [ "$(state_of "$r" "$num")" != "MISSING" ] && n=$((n+1))
  done
  echo "$n"
}

RESULTS=$(mktemp); trap 'rm -f "$CACHE" "$RESULTS"' EXIT

# Counted BEFORE the loop, deliberately. Incrementing inside it does not work: the loop body is a
# pipeline, so the body runs in a SUBSHELL and every increment is discarded at the `done` — the
# count read 0 no matter how many cards were read, which is exactly the false "SWEPT NOTHING" this
# counter exists to prevent (shellcheck SC2030/SC2031 named it). `find`, never `ls "$DIR"/*.md`:
# an unmatched glob is passed through literally and `ls` then lists the CWD, returning a plausible
# non-zero count for an empty or wrong directory.
SCANNED=$(find "$DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
for f in "$DIR"/*.md; do
  [ -e "$f" ] || continue          # unmatched glob passes the pattern through literally
  [ -e "$f" ] || continue
  card=$(grep -m1 '^trdd-id:' "$f" | awk '{print $2}')
  [ -z "$card" ] && card=$(basename "$f")
  # Only lines that actually CLAIM a block. A bare mention of an issue is a citation, not a wait.
  # Strip ~~struck~~ spans FIRST: a claim already corrected must not be re-reported forever, and
  # the correction quotes the dead ref by design (the wrong claim's shape is the evidence).
  # Also drop `>` blockquotes: quoting a past claim (to correct or analyse it) is not asserting it.
  #
  # MULTI-LINE strikethrough (fixed 2026-08-21). The `ponytail:` note here used to read
  # "single-line spans only; a strikethrough wrapped across a newline still matches" — and that
  # ceiling was not theoretical, it was producing a FALSE POSITIVE on the one card that had done
  # everything right: SCLSRS6E struck its dead claim across lines 308-310 AND added a `>` note
  # explaining the correction, exactly as TRDD-8GBIQMEP's phrasing guidance instructs, and the
  # line-wise `sed` could not strip a span that spans lines, so the corrected claim was reported
  # as a live wait. A linter that reddens on correct authoring is one that gets routed around —
  # which is precisely the fate this sweep exists to avoid. `perl -0777` slurps the whole file so
  # the span matches across newlines; `.*?` stays non-greedy so two separate struck spans on one
  # line are not merged into one match that swallows the live prose between them.
  grep -v '^[[:space:]]*>' "$f" \
  | perl -0777 -pe 's/~~.*?~~//gs' \
  | perl -0777 -pe 's/\b(?:nobody|no[- ]one|not|never|no longer|instead of|without|rather than)\b[^.]{0,40}?\b(?:blocked|waiting|gated|pending)\s+(?:on|by)\b[^.]{0,80}//gis' \
  | grep -oiE '(blocked|waiting|gated|pending) (on|by)[^.]{0,80}' 2>/dev/null \
  | grep -oE '[A-Za-z0-9_.-]*#[0-9]+' | sort -u \
  | while IFS= read -r ref; do
      prefix="${ref%%#*}"; num="${ref##*#}"
      if [ -z "$prefix" ]; then
        # "waiting on #100" — resolvable only from prose context, so do not guess. Report instead
        # how many known trackers this number actually resolves in: that count IS the argument.
        printf '%s | %s | AMBIGUOUS (bare #N; resolves in %s of %s known trackers)\n' \
               "$card" "$ref" "$(plausible_count "$num")" "$KNOWN_N"; continue
      fi
      repo=$(repo_for "$prefix")
      if [ -z "$repo" ]; then
        printf '%s | %s | UNKNOWN-REPO (add %s to repo_for)\n' "$card" "$ref" "$prefix"; continue
      fi
      printf '%s | %s#%s | %s\n' "$card" "$repo" "$num" "$(state_of "$repo" "$num")"
    done
done | sort -u > "$RESULTS"

cat "$RESULTS"
o=$(grep -c '| OPEN$'   "$RESULTS" || true)
c=$(grep -c '| CLOSED$' "$RESULTS" || true)
u=$(grep -cvE '\| (OPEN|CLOSED)$' "$RESULTS" || true)
printf '\n-- %s OPEN, %s CLOSED, %s unresolved --\n' "$o" "$c" "$u"

# A sweep that read NOTHING is not a clean sweep — a typo'd path or a moved corpus would otherwise
# exit 0 and read as "no dead claims". That silent pass is the exact failure class this card is about.
#
# BUT the guard must key on CARDS SCANNED, not on FINDINGS (fixed 2026-08-21). It used to be
# `[ ! -s "$RESULTS" ]`, which fires when zero refs were found — so a board that has been fully
# cleaned is indistinguishable from a broken path, and the sweep answers a perfectly clean corpus
# with exit 2. That made TRDD-8GBIQMEP box 4's criterion ("exits 0") UNSATISFIABLE BY
# CONSTRUCTION: qualifying and clearing the last stale ref moved it 1 → 2, never to 0. It is the
# same defect the guard exists to prevent, aimed the other way — a condition written over the BAD
# items alone says nothing on an empty set, and a non-vacuity check written over findings alone
# fires on success. Scanning N>0 cards and finding no blocking-phrased ref IS a clean board.
if [ "$SCANNED" -eq 0 ]; then
  echo "SWEPT NOTHING: read 0 cards under '$DIR' — check the path." >&2
  exit 2
fi
if [ ! -s "$RESULTS" ]; then
  printf 'clean: %s cards scanned, no blocking-phrased issue ref found.\n' "$SCANNED"
fi
if [ "$c" -gt 0 ]; then exit 1; elif [ "$u" -gt 0 ]; then exit 2; fi
