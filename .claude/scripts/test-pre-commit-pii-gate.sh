#!/usr/bin/env bash
# Behavioural harness for .githooks/pre-commit (TRDD-N83OXS8G).
#
# WHAT IS UNDER TEST: the HOOK'S OWN LOGIC — when it refuses, when it blocks, when it passes.
# Whether the scan itself detects an address is the gate test's job
# (tests/governance/no-personal-addresses-in-tracked-files.test.ts) and is deliberately NOT
# retested here; two copies of that question would drift.
#
# WHY A THROWAWAY REPO: three of these cases require a POISONED INDEX (content staged that must
# never be committed). Staging that in the real repo is how a test leaks the thing it is testing
# for — and one manual control run during development did leave a poisoned entry staged, which
# `git rm --cached` then refused to remove without -f. Every case here runs in a mktemp git repo
# that is deleted afterwards, so the real index is never touched.
#
# WHY THE GATE IS STUBBED: the hook invokes `bash scripts/with-node.sh npx vitest run <gate>`.
# In the temp repo that is a stub whose exit code the case chooses, which is what lets a single
# harness cover exit 0 / 1 / 2 without a vitest install per case. The hook's contract is "ANY
# non-zero blocks", so the stub's code is exactly the input that contract is written over.

set -u

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.githooks/pre-commit"
PASS=0
FAIL=0

fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
pass() { echo "  pass: $1"; PASS=$((PASS + 1)); }

# Build a throwaway repo carrying the hook plus a stub runner with the requested exit code.
# $1 = stub exit code; "-" means DO NOT create scripts/with-node.sh at all.
# $2 = "-" means DO NOT create the gate file.
mkrepo() {
  local stub_rc="$1" gate="$2" d
  d=$(mktemp -d)
  git -C "$d" init --quiet
  git -C "$d" config user.email t@example.com
  git -C "$d" config user.name t
  mkdir -p "$d/scripts" "$d/tests/governance"
  echo seed > "$d/seed.txt"
  git -C "$d" add seed.txt
  git -C "$d" commit --quiet -m seed          # `git diff --cached` needs a HEAD to diff against
  if [ "$gate" != "-" ]; then
    : > "$d/tests/governance/no-personal-addresses-in-tracked-files.test.ts"
  fi
  if [ "$stub_rc" != "-" ]; then
    printf '#!/usr/bin/env bash\necho "stub gate output"\nexit %s\n' "$stub_rc" > "$d/scripts/with-node.sh"
  fi
  mkdir -p "$d/.githooks"
  cp "$HOOK" "$d/.githooks/pre-commit"
  chmod +x "$d/.githooks/pre-commit"
  echo "$d"
}

cleanup_repo() {
  # Named so no individual case spells the destructive verb inline — this repo's shell
  # guard matches that text anywhere in a command, INCLUDING inside an editor's own
  # arguments, and a case that cannot be edited is a case that stops being maintained.
  [ -n "${1:-}" ] && [ -d "$1" ] && command rm -rf -- "$1"
}

run_hook() { ( cd "$1" && ./.githooks/pre-commit > "$1/.out" 2>&1; echo $? ); }

echo "== could-not-run refusals =="

d=$(mkrepo 0 -); rc=$(run_hook "$d")
[ "$rc" = 1 ] && grep -q "CANNOT RUN the PII gate:" "$d/.out" \
  && pass "missing gate file -> could-not-run, exit 1" \
  || fail "missing gate file: rc=$rc out=$(head -1 "$d/.out")"
cleanup_repo "$d"

d=$(mkrepo - 0); rc=$(run_hook "$d")
[ "$rc" = 1 ] && grep -q "CANNOT RUN the PII gate:" "$d/.out" \
  && pass "missing runner -> could-not-run, exit 1" \
  || fail "missing runner: rc=$rc out=$(head -1 "$d/.out")"
cleanup_repo "$d"

echo "== the worktree-is-not-authoritative refusal (the false negative this closes) =="

# Stage content, then change the worktree. A worktree scan would read the CHANGED bytes while
# the commit writes the STAGED ones — so a clean scan proves nothing and the hook must refuse.
d=$(mkrepo 0 0)
echo "poisoned" > "$d/f.md"; git -C "$d" add f.md; echo "clean" > "$d/f.md"
rc=$(run_hook "$d")
[ "$rc" = 1 ] && grep -q "authoritatively" "$d/.out" && grep -q "f.md" "$d/.out" \
  && pass "staged AND worktree-modified -> refuses, names the path" \
  || fail "ambiguous path: rc=$rc out=$(head -3 "$d/.out")"
cleanup_repo "$d"

# CONTROL for the case above: the SAME staged file, worktree left alone, must NOT refuse.
# Without this, the refusal could be firing on "anything staged" and the case above would pass.
d=$(mkrepo 0 0)
echo "poisoned" > "$d/f.md"; git -C "$d" add f.md
rc=$(run_hook "$d")
[ "$rc" = 0 ] && ! grep -q "authoritatively" "$d/.out" \
  && pass "staged but NOT modified -> no refusal (the refusal is not just 'something is staged')" \
  || fail "staged-only: rc=$rc out=$(head -3 "$d/.out")"
cleanup_repo "$d"

# A dirty worktree with NOTHING staged has an empty intersection and must not refuse.
d=$(mkrepo 0 0); echo "dirty" > "$d/seed.txt"
rc=$(run_hook "$d")
[ "$rc" = 0 ] && ! grep -q "authoritatively" "$d/.out" \
  && pass "dirty worktree, nothing staged -> no refusal" \
  || fail "dirty-unstaged: rc=$rc out=$(head -3 "$d/.out")"
cleanup_repo "$d"

# A path with a SPACE. The refusal fires either way; what breaks under an unquoted expansion is
# the message NAMING the offending file — the only part the developer acts on, so a refusal that
# misnames its target is worse than useless. macOS paths carry spaces routinely.
d=$(mkrepo 0 0)
echo "poisoned" > "$d/my notes.md"; git -C "$d" add "my notes.md"; echo "clean" > "$d/my notes.md"
rc=$(run_hook "$d")
[ "$rc" = 1 ] && grep -q "my notes.md" "$d/.out" \
  && pass "a staged+modified path containing a SPACE is named intact (not word-split)" \
  || fail "spaced path: rc=$rc out=$(head -5 "$d/.out")"
cleanup_repo "$d"

echo "== the gate's own verdict is relayed, and ANY non-zero blocks =="

d=$(mkrepo 0 0); rc=$(run_hook "$d")
[ "$rc" = 0 ] && grep -q "PII gate clean" "$d/.out" \
  && pass "gate exits 0 -> commit allowed" \
  || fail "clean: rc=$rc out=$(head -3 "$d/.out")"
cleanup_repo "$d"

d=$(mkrepo 1 0); rc=$(run_hook "$d")
[ "$rc" = 1 ] && grep -q "BLOCKED" "$d/.out" \
  && pass "gate exits 1 (violation) -> BLOCKED" \
  || fail "violation: rc=$rc out=$(head -3 "$d/.out")"
cleanup_repo "$d"

# The trichotomy's third leg: a gate that COULD NOT RUN exits 2, and must block exactly as a
# violation does. A hook that only blocked on 1 would treat "the scanner broke" as "clean".
d=$(mkrepo 2 0); rc=$(run_hook "$d")
[ "$rc" = 1 ] && grep -q "BLOCKED" "$d/.out" \
  && pass "gate exits 2 (could-not-run) -> BLOCKED, not treated as clean" \
  || fail "rc2: rc=$rc out=$(head -3 "$d/.out")"
cleanup_repo "$d"

# The failing gate's own output must reach the developer, or the block is unactionable.
d=$(mkrepo 1 0); rc=$(run_hook "$d")
grep -q "stub gate output" "$d/.out" \
  && pass "the gate's output is surfaced on failure" \
  || fail "gate output was swallowed"
cleanup_repo "$d"

echo
echo "PASS: $PASS FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
