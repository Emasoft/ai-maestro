#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# SCEN-018 fake test-repo provisioner (idempotent)
#
# Creates two empty GitHub repos under Emasoft/ and populates them
# with fixtures required by SCEN-018_maintainer-lifecycle:
#   - src/buggy.py       known bug (divide returns wrong sign)
#   - tests/test_buggy.py failing test
#   - scripts/publish.py  minimal strict publish pipeline
#   - .githooks/pre-push  process-ancestry enforcement
#   - LICENSE, README.md, pyproject.toml
#
# Usage:
#   ./setup-scen018-repos.sh            # create + populate repos
#   ./setup-scen018-repos.sh --teardown # delete repos (careful!)
#
# Idempotent: if a repo already exists, the script skips creation
# and refreshes only the fixture files that have drifted.
# ──────────────────────────────────────────────────────────────

set -euo pipefail

OWNER="Emasoft"
REPOS=("scen018-test-repo-alpha" "scen018-test-repo-beta")
WORK_ROOT="/tmp/scen018-setup-$$"

log() { printf '[scen018-setup] %s\n' "$*"; }
die() { printf '[scen018-setup] ERROR: %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null 2>&1 || die "gh CLI not installed"
gh auth status >/dev/null 2>&1 || die "gh CLI not authenticated"

AUTH_USER="$(gh api user --jq .login 2>/dev/null)"
[ -n "$AUTH_USER" ] || die "gh api user returned empty login"
log "Authenticated as: $AUTH_USER"
[ "$AUTH_USER" = "$OWNER" ] || die "Expected gh user '$OWNER' but got '$AUTH_USER'"

if [ "${1:-}" = "--teardown" ]; then
  for repo in "${REPOS[@]}"; do
    if gh repo view "$OWNER/$repo" --json name >/dev/null 2>&1; then
      log "Deleting $OWNER/$repo..."
      gh repo delete "$OWNER/$repo" --yes
    else
      log "Repo $repo already gone — skipping"
    fi
  done
  exit 0
fi

mkdir -p "$WORK_ROOT"
trap 'rm -rf "$WORK_ROOT"' EXIT

for repo in "${REPOS[@]}"; do
  log "=== Processing $OWNER/$repo ==="

  if ! gh repo view "$OWNER/$repo" --json name >/dev/null 2>&1; then
    log "Creating $OWNER/$repo..."
    gh repo create "$OWNER/$repo" --public --description "SCEN-018 MAINTAINER lifecycle test fixture — safe to ignore" --add-readme
  else
    log "Repo $repo already exists — will refresh fixtures"
  fi

  local_dir="$WORK_ROOT/$repo"
  git clone --quiet "https://github.com/$OWNER/$repo.git" "$local_dir"
  cd "$local_dir"
  git config user.name "Emasoft"
  git config user.email "713559+Emasoft@users.noreply.github.com"

  mkdir -p src tests scripts .githooks

  # ── src/buggy.py ── known sign-flip bug
  cat > src/buggy.py <<'PY'
"""Intentionally buggy math helpers used by SCEN-018.

The MAINTAINER agent is expected to detect the bug from the failing
test, clone this repo, fix the function, verify the test passes,
commit, and push through publish.py.
"""

def divide(a: int, b: int) -> int:
    """Integer divide a by b.

    BUG: the current implementation flips the sign of the result when
    ``a`` is negative. Fix: return ``a // b`` without the extra negation.
    """
    if b == 0:
        raise ZeroDivisionError("division by zero")
    if a < 0:
        return -(a // b)  # ← wrong: double-negates
    return a // b
PY

  # ── tests/test_buggy.py ── failing test
  cat > tests/test_buggy.py <<'PY'
"""Failing test that exercises the divide() sign-flip bug."""

from src.buggy import divide


def test_divide_positive() -> None:
    assert divide(10, 2) == 5


def test_divide_negative_should_be_negative() -> None:
    # divide(-10, 2) should be -5, but the buggy version returns 5.
    assert divide(-10, 2) == -5


def test_divide_zero_denominator() -> None:
    import pytest
    with pytest.raises(ZeroDivisionError):
        divide(1, 0)
PY
  touch tests/__init__.py src/__init__.py

  # ── scripts/publish.py ── minimal strict pipeline
  cat > scripts/publish.py <<'PY'
#!/usr/bin/env python3
"""Strict publish pipeline for SCEN-018 fake repo.

Runs tests → version bump → commit → push. Refuses to run if the
calling process is not `publish.py` itself (process-ancestry check
is enforced by .githooks/pre-push).

Usage:
    uv run python scripts/publish.py --patch
    uv run python scripts/publish.py --minor
"""

from __future__ import annotations

import argparse
import os
import pathlib
import re
import subprocess
import sys


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PYPROJECT = REPO_ROOT / "pyproject.toml"


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    print(f"[publish] $ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=REPO_ROOT, check=check, text=True)


def read_version() -> str:
    text = PYPROJECT.read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not match:
        raise SystemExit("pyproject.toml has no version field")
    return match.group(1)


def write_version(new: str) -> None:
    text = PYPROJECT.read_text(encoding="utf-8")
    text = re.sub(r'^version\s*=\s*"[^"]+"', f'version = "{new}"', text, count=1, flags=re.MULTILINE)
    PYPROJECT.write_text(text, encoding="utf-8")


def bump(current: str, kind: str) -> str:
    major, minor, patch = (int(p) for p in current.split("."))
    if kind == "patch":
        return f"{major}.{minor}.{patch + 1}"
    if kind == "minor":
        return f"{major}.{minor + 1}.0"
    if kind == "major":
        return f"{major + 1}.0.0"
    raise SystemExit(f"unknown bump kind: {kind}")


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--patch", action="store_true")
    group.add_argument("--minor", action="store_true")
    group.add_argument("--major", action="store_true")
    args = parser.parse_args()

    # 1. Run tests — strict, no skip
    run(["uv", "run", "pytest", "-q"])

    # 2. Bump version
    kind = "patch" if args.patch else "minor" if args.minor else "major"
    old = read_version()
    new = bump(old, kind)
    write_version(new)
    print(f"[publish] Version bumped {old} → {new}")

    # 3. Commit + tag
    os.environ["PUBLISH_PY_INVOCATION"] = "1"
    run(["git", "add", "pyproject.toml"])
    run(["git", "commit", "-m", f"chore: bump to v{new}"])
    run(["git", "tag", f"v{new}"])

    # 4. Push (pre-push hook will verify PUBLISH_PY_INVOCATION)
    run(["git", "push", "origin", "HEAD"])
    run(["git", "push", "origin", f"v{new}"])
    print(f"[publish] Published v{new}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
PY
  chmod +x scripts/publish.py

  # ── .githooks/pre-push ── ancestry enforcement
  cat > .githooks/pre-push <<'SH'
#!/usr/bin/env bash
# SCEN-018 strict pre-push hook.
# Refuses any push that is not invoked from publish.py.
set -eu
if [ "${PUBLISH_PY_INVOCATION:-}" != "1" ]; then
  printf 'pre-push: direct pushes are forbidden. Run scripts/publish.py instead.\n' >&2
  exit 1
fi
exit 0
SH
  chmod +x .githooks/pre-push

  # ── pyproject.toml ──
  cat > pyproject.toml <<'TOML'
[project]
name = "scen018-test-fixture"
version = "0.1.0"
description = "SCEN-018 MAINTAINER lifecycle test fixture (safe to ignore)"
requires-python = ">=3.12"
dependencies = ["pytest>=8"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
TOML

  # ── LICENSE ──
  cat > LICENSE <<'TXT'
MIT License

Copyright (c) 2026 Emasoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
TXT

  # ── README.md ──
  cat > README.md <<MD
# $repo

**WARNING: This repository is a test fixture for AI Maestro's SCEN-018
MAINTAINER lifecycle scenario. It intentionally contains buggy code.**

Do not use the contents of this repository for anything. It exists so the
AI Maestro MAINTAINER agent can practice cloning, branching, fixing, testing,
and publishing against a real GitHub repository.

- \`src/buggy.py\` — intentionally buggy divide() function
- \`tests/test_buggy.py\` — failing test the MAINTAINER is expected to fix
- \`scripts/publish.py\` — strict publish pipeline
- \`.githooks/pre-push\` — process-ancestry enforcement

See \`https://github.com/Emasoft/ai-maestro/blob/main/tests/scenarios/SCEN-018_maintainer-lifecycle.scen.md\` for the scenario spec.
MD

  git add src tests scripts .githooks pyproject.toml LICENSE README.md
  if git diff --cached --quiet; then
    log "No fixture changes for $repo (already up to date)"
  else
    git commit -m "chore(scen018): refresh test fixtures

Provisioned by tests/scenarios/fixtures/setup-scen018-repos.sh.
Contents: buggy divide() + failing test + strict publish.py + pre-push hook."
    git push origin HEAD
    log "Pushed fixtures to $OWNER/$repo"
  fi

  cd - >/dev/null
done

log "=== Done. Both SCEN-018 fixture repos are ready. ==="
