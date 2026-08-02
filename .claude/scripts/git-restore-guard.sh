#!/usr/bin/env bash
# git-restore-guard — PreToolUse(Bash) guard. BLOCKS a path-restore that would discard
# uncommitted work, because git will not.
#
# THE FAILURE IT PREVENTS. `git checkout -- <path>` and `git restore <path>` overwrite the
# working-tree file from the index and say nothing. There is no reflog for unstaged content, so
# if the file also held edits that were never committed, they are gone with no undo. Git prompts
# before a BRANCH switch would lose changes; for the pathspec form it stays silent, because
# discarding is exactly what the command means.
#
# The case that bites is when it is not what you meant: reverting a deliberate TEMPORARY edit (a
# neutered guard, a debug print) in a file that ALSO holds real work. The revert cannot tell them
# apart. On 2026-08-02 that took four real edits in this repo, and — worse than the loss — the
# next test run then measured the ORIGINAL code and reported green, so the mistake was invisible
# in exactly the output meant to catch mistakes.
#
# The git-hook layer (.githooks/post-checkout) can only warn AFTER the fact; git has no
# pre-checkout hook. This guard is the layer that can still say no, so this is where prevention
# belongs.
#
# CONTRACT: reads the PreToolUse JSON on stdin, exit 0 = allow, exit 2 = block (stderr is shown
# as the reason). It fails OPEN on any internal error — a guard that blocks the whole Bash tool
# because it could not parse something is worse than the bug it guards.
#
# ESCAPE HATCH: `AIM_ALLOW_DIRTY_RESTORE=1 git restore <path>`, or append `# discard-ok` to the
# command. Discarding work IS sometimes exactly the intent, and a guard with no sanctioned way
# through gets disabled wholesale instead of being consulted.

set -uo pipefail

# The program is loaded into a VARIABLE and passed with `python3 -c`, deliberately. The obvious
# `python3 - <<'PY'` makes the HEREDOC python's stdin, so `json.load(sys.stdin)` reads the program
# text instead of the hook payload, fails, and takes the fail-open path — a guard that can never
# block anything, and whose test table is all-zeros in a way that reads like "nothing matched".
GUARD_PROG=$(cat <<'PY'
import json, os, re, subprocess, sys

def allow(): sys.exit(0)

try:
    payload = json.load(sys.stdin)
except Exception:
    allow()  # unparseable input is not a reason to block every Bash call

cmd = (payload.get("tool_input") or {}).get("command") or ""
if not cmd.strip():
    allow()

# Sanctioned overrides — discarding work is a legitimate intent that must stay expressible.
if "AIM_ALLOW_DIRTY_RESTORE=1" in cmd or "# discard-ok" in cmd:
    allow()

# Split on the separators that start a new command, so `foo && git restore x` is still inspected.
segments = re.split(r"(?:&&|\|\||;|\n|\|)", cmd)

def candidate_paths(seg):
    """Paths a segment would overwrite in the WORKING TREE, or [] if it would not."""
    toks = seg.split()
    if len(toks) < 2 or os.path.basename(toks[0]) != "git":
        return []
    # Skip global options (`git -C dir restore ...`) to find the subcommand.
    i = 1
    while i < len(toks) and toks[i].startswith("-"):
        i += 2 if toks[i] in ("-C", "-c", "--git-dir", "--work-tree") else 1
    if i >= len(toks):
        return []
    sub = toks[i]
    rest = toks[i + 1:]

    if sub == "restore":
        # --staged alone only unstages; the working tree is untouched. --worktree (or neither)
        # rewrites the file. --staged --worktree does both.
        if "--staged" in rest and "--worktree" not in rest and "-W" not in rest:
            return []
        return [t for t in rest if not t.startswith("-")]

    if sub == "checkout":
        # ONLY the pathspec form is silent about loss. A branch checkout (`git checkout main`,
        # `-b`, `-B`) is refused by git itself when it would clobber, so it needs no guard here.
        if "--" not in rest:
            return []
        return rest[rest.index("--") + 1:]

    return []

def dirty(path):
    """True iff `path` has changes relative to HEAD that a restore would discard."""
    try:
        r = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", path],
                           capture_output=True, timeout=10)
    except Exception:
        return False  # cannot tell → do not block
    return r.returncode == 1  # 0 clean · 1 differs · anything else = could not run

hits = []
for seg in segments:
    for p in candidate_paths(seg):
        if p not in hits and dirty(p):
            hits.append(p)

if not hits:
    allow()

listed = "\n".join(f"    {p}" for p in hits)
print(f"""BLOCKED — this would silently discard UNCOMMITTED work:

{listed}

`git checkout -- <path>` / `git restore <path>` overwrite the working tree from the index.
Unstaged content has no reflog, so there is no undo. Git warns before a branch switch loses
changes; for this form it says nothing.

If you are reverting a TEMPORARY edit (a neutered guard, a debug print) in a file that also
holds real work, the revert cannot tell them apart and takes both — and the next test run then
measures the original code and reports green, hiding the loss in the very output meant to catch it.

  Keep the work        git add -A -- <path> && git stash push -- <path>   (recover: git stash pop)
  Commit first         git add <path> && git commit -m '...'   ← then reverting is safe
  Neuter a guard       scripts/dev/neuter -f <file> -e '<perl>' -t '<tests>'
  Really discard it    AIM_ALLOW_DIRTY_RESTORE=1 <your command>     (or append `# discard-ok`)""",
      file=sys.stderr)
sys.exit(2)
PY
)
python3 -c "$GUARD_PROG"
