#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# build-jsonl-reader.sh — yarn build hook
#
# Compiles the `aim-jsonl-reader` Rust binary for the current host
# platform and copies it into `scripts/aim-jsonl-reader` where the Node
# wrapper (Phase 2) expects to find it.
#
# Usage:
#   scripts/build-jsonl-reader.sh                (host default)
#   BUILD_TARGET=aarch64-apple-darwin scripts/build-jsonl-reader.sh
#
# Exit codes:
#   0 on success (binary is present at scripts/aim-jsonl-reader)
#   1 on any failure (missing cargo, compile error, unknown platform)
#
# This script is idempotent: re-running after a successful build is a
# near-no-op (cargo incremental + cp).
# ────────────────────────────────────────────────────────────────────

set -euo pipefail

# Resolve the repo root relative to this script. Avoids assumptions
# about the caller's cwd (`yarn run` sets PWD to package.json's dir
# but CI may invoke us differently).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
CRATE_DIR="$REPO_ROOT/rust-tools/aim-jsonl-reader"
OUTPUT_DIR="$REPO_ROOT/scripts"
OUTPUT_BIN="$OUTPUT_DIR/aim-jsonl-reader"

# ── 1. Prerequisite: cargo on PATH ──────────────────────────────────

if ! command -v cargo >/dev/null 2>&1; then
    cat >&2 <<EOF
[build-jsonl-reader] cargo not found on PATH.

The aim-jsonl-reader binary requires a Rust toolchain (1.75+). Install
via rustup:

    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

…then restart your shell and re-run \`yarn build\`.
EOF
    exit 1
fi

# ── 2. Resolve target triple from the host platform ─────────────────

uname_s="$(uname -s)"
uname_m="$(uname -m)"

if [[ -n "${BUILD_TARGET:-}" ]]; then
    TARGET="$BUILD_TARGET"
elif [[ "$uname_s" == "Darwin" ]]; then
    if   [[ "$uname_m" == "arm64"  ]]; then TARGET="aarch64-apple-darwin"
    elif [[ "$uname_m" == "x86_64" ]]; then TARGET="x86_64-apple-darwin"
    else
        echo "[build-jsonl-reader] unsupported macOS arch: $uname_m" >&2
        exit 1
    fi
elif [[ "$uname_s" == "Linux" ]]; then
    if   [[ "$uname_m" == "x86_64"  ]]; then TARGET="x86_64-unknown-linux-musl"
    elif [[ "$uname_m" == "aarch64" ]]; then TARGET="aarch64-unknown-linux-musl"
    else
        echo "[build-jsonl-reader] unsupported Linux arch: $uname_m" >&2
        exit 1
    fi
else
    echo "[build-jsonl-reader] unsupported host OS: $uname_s" >&2
    exit 1
fi

echo "[build-jsonl-reader] target: $TARGET"

# ── 3. Ensure target is installed (best-effort) ─────────────────────
#
# On a host missing the target, rustup add it. If rustup isn't
# installed, fall back to `cargo build` without --target (host).

if command -v rustup >/dev/null 2>&1; then
    if ! rustup target list --installed 2>/dev/null | grep -q "^$TARGET$"; then
        echo "[build-jsonl-reader] installing target $TARGET via rustup..."
        rustup target add "$TARGET" >&2
    fi
    BUILD_ARGS=( --release --target "$TARGET" )
    BIN_PATH="$CRATE_DIR/target/$TARGET/release/aim-jsonl-reader"
else
    echo "[build-jsonl-reader] rustup missing, building for host tuple" >&2
    BUILD_ARGS=( --release )
    BIN_PATH="$CRATE_DIR/target/release/aim-jsonl-reader"
fi

# ── 4. Compile ──────────────────────────────────────────────────────

pushd "$CRATE_DIR" >/dev/null
cargo build "${BUILD_ARGS[@]}"
popd >/dev/null

if [[ ! -f "$BIN_PATH" ]]; then
    echo "[build-jsonl-reader] binary missing after build: $BIN_PATH" >&2
    exit 1
fi

# ── 5. Publish into scripts/ ────────────────────────────────────────

mkdir -p "$OUTPUT_DIR"
cp "$BIN_PATH" "$OUTPUT_BIN"
chmod +x "$OUTPUT_BIN"

SIZE_BYTES="$(wc -c <"$OUTPUT_BIN" 2>/dev/null | tr -d ' ')"
echo "[build-jsonl-reader] published $OUTPUT_BIN (${SIZE_BYTES} bytes)"
