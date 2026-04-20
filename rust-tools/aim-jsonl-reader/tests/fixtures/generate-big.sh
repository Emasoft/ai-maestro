#!/usr/bin/env bash
# Generate a synthetic ~2 GB JSONL fixture for the RSS-ceiling test.
#
# Output: /tmp/aim-big.jsonl (overwritten if exists)
# Layout: alternating user / assistant / tool_use lines so the context
#         breakdown exercises multiple buckets.
#
# We aim for ~2_000_000 lines with a predictable footprint. Each line
# is roughly 1 KB so total ≈ 2 GB.
#
# Env overrides:
#   AIM_BIG_LINES      — line count (default 2_000_000)
#   AIM_BIG_OUT        — output path (default /tmp/aim-big.jsonl)
#
# Runtime: ~30 s on an Apple Silicon dev box. Idempotent: re-running
# overwrites. The .aimidx sidecar is intentionally NOT produced here;
# the reader builds it on first open.

set -euo pipefail

LINES="${AIM_BIG_LINES:-2000000}"
OUT="${AIM_BIG_OUT:-/tmp/aim-big.jsonl}"

# Pre-build a ~900-byte filler so each line hits ~1 KB total.
FILLER=$(python3 - <<'PY'
print("x" * 900, end="")
PY
)

python3 - "$LINES" "$OUT" "$FILLER" <<'PY'
import json, sys
n = int(sys.argv[1])
out = sys.argv[2]
filler = sys.argv[3]

with open(out, "w", encoding="utf-8") as f:
    for i in range(n):
        mod = i % 5
        if mod == 0:
            rec = {
                "role":      "user",
                "content":   f"msg-{i} {filler}",
                "timestamp": f"2026-04-20T00:00:{i:02d}Z",
            }
        elif mod == 1:
            rec = {
                "role":      "assistant",
                "usage":     {"input_tokens": 12, "output_tokens": 34, "cache_read_input_tokens": 5},
                "content":   f"reply-{i} {filler}",
                "model":     "claude-sonnet-4-6",
                "timestamp": f"2026-04-20T00:00:{i:02d}Z",
            }
        elif mod == 2:
            rec = {
                "type":      "tool_use",
                "name":      "Read" if (i % 2 == 0) else "mcp__fs__stat",
                "input":     {"path": f"/tmp/x-{i} {filler[:200]}"},
                "timestamp": f"2026-04-20T00:00:{i:02d}Z",
            }
        elif mod == 3:
            rec = {
                "type":      "tool_result",
                "output":    f"ok-{i} {filler}",
                "timestamp": f"2026-04-20T00:00:{i:02d}Z",
            }
        else:
            rec = {
                "type":      "memory",
                "source":    "claude-md",
                "content":   f"CLAUDE.md snippet {i} {filler}",
                "timestamp": f"2026-04-20T00:00:{i:02d}Z",
            }
        f.write(json.dumps(rec, separators=(",", ":")) + "\n")

print(f"wrote {n} lines to {out}", file=sys.stderr)
PY

echo "$OUT"
