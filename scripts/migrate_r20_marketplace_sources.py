#!/usr/bin/env python3
"""Normalise plugin `source` paths in the R20 local role-plugin marketplace manifest.

Extracted from `migrate-r20-disk-layout.sh`'s inline `python3 -c` block (TRDD-DP2HI2MP).
It lived inline, so nothing could test it, and three defects had accumulated behind that:

  1. it wrote `roles-marketplace/<base>` with NO leading `./`. Claude Code rejects that form,
     and a marketplace manifest is validated as a WHOLE — so one bad entry made every plugin
     registered in that marketplace uninstallable, with the user-visible symptom being the
     unrelated-looking "plugin not found in marketplace". Measured 2026-08-04 against the live
     manifest: `plugins.5.source: Invalid input`, `claude plugin validate` exit 1.
  2. the skip guard tested for `'/roles-marketplace/'`, a shape the write never produced (no
     `/` precedes `roles-marketplace` in `roles-marketplace/x`), so every re-run rewrote the
     file and reported "Updated source paths" on a manifest it had not meaningfully changed.
     Emitting the `./` fixes BOTH — the guard's substring then matches and a re-run skips.
  3. a non-string `source` (the `{"source": "url", "url": …}` object form that
     `services/role-plugin-service.ts` legitimately writes) hit `.rstrip` on a dict and raised
     AttributeError. The caller discarded stderr, so the whole rewrite was skipped in silence.

The write is atomic because the file it rewrites is the one whose corruption makes every plugin
in the marketplace uninstallable: a crash mid-`json.dump` would leave a truncated manifest.

Exit codes: 0 = manifest is correct (whether or not this run changed it), 1 = could not read,
parse, or write it — with the reason on stderr, so the caller can surface something actionable
instead of a contentless warning.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

# The subdirectory every Claude role-plugin lives under, and the prefix Claude Code requires on
# a relative marketplace source. The `./` is load-bearing: without it the manifest is rejected.
ROLE_SUBDIR = "roles-marketplace"
WANTED_PREFIX = f"./{ROLE_SUBDIR}/"

# What a source must CONTAIN to be considered already correct. Deliberately the same shape the
# rewrite produces — that identity is what makes a second run a genuine no-op.
ALREADY_CORRECT = f"/{ROLE_SUBDIR}/"


def normalise(manifest: dict) -> bool:
    """Rewrite every relative plugin source to `./roles-marketplace/<base>`.

    Returns True when at least one entry changed. Non-string sources (the object form) are left
    exactly as they are: this migration only knows how to normalise a relative path, and a
    manifest it does not understand must survive it untouched.
    """
    changed = False
    for plugin in manifest.get("plugins", []):
        src = plugin.get("source")
        if not isinstance(src, str):
            continue
        if ALREADY_CORRECT in src:
            continue
        base = os.path.basename(src.rstrip("/"))
        if not base:
            continue
        plugin["source"] = WANTED_PREFIX + base
        changed = True
    return changed


def write_atomically(path: str, manifest: dict) -> None:
    """Replace `path` in one step, so an interrupted run cannot truncate the manifest."""
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".marketplace-", suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(manifest, handle, indent=2)
            handle.write("\n")
        os.replace(tmp, path)
    except BaseException:
        # Leave the original intact; a half-written temp file is not the caller's problem.
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {os.path.basename(argv[0])} <marketplace.json>", file=sys.stderr)
        return 1
    path = argv[1]

    try:
        with open(path) as handle:
            manifest = json.load(handle)
    except (OSError, json.JSONDecodeError) as err:
        print(f"cannot read {path}: {err}", file=sys.stderr)
        return 1

    if not isinstance(manifest, dict):
        # json.load succeeds for a list, a string, a number — none of which is a manifest.
        print(f"cannot read {path}: top level is {type(manifest).__name__}, expected an object",
              file=sys.stderr)
        return 1

    if not normalise(manifest):
        print("  [R20] marketplace.json paths already correct")
        return 0

    try:
        write_atomically(path, manifest)
    except OSError as err:
        print(f"cannot write {path}: {err}", file=sys.stderr)
        return 1

    print("  [R20] Updated source paths in marketplace.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
