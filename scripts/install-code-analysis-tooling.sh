#!/usr/bin/env bash
#
# install-code-analysis-tooling.sh
#
# WHY (TRDD-ZFHY7UGU): make the four code-analysis tools official ai-maestro
# dependencies — installed alongside the rest of the stack and available on
# PATH to every agent regardless of client.
#
# THE FOUR TOOLS + COEXISTENCE MODEL (ratified in TRDD-ZFHY7UGU):
#   * lean-ctx  — a GENERIC, non-discriminating INTERCEPTOR. It wraps every
#                 tool call (Read/Grep/Shell/Glob) and enforces a shell
#                 ALLOWLIST. Coexists with the deliberate tools below.
#   * distill   — a GENERIC output-compression pipe (`cmd | distill "<prompt>"`).
#                 Also non-discriminating; wraps command OUTPUT. Low conflict.
#   * tldr      — the DELIBERATE, intentionally-invoked READ instrument
#                 (tldr-code, Rust). You call it on purpose to extract only the
#                 lines that matter instead of reading whole files.
#   * fastedit  — the DELIBERATE AST WRITE companion to read-only tldr
#                 (Python; uses tldr-code internally, so tldr MUST be on PATH
#                 FIRST). 74% of edits are deterministic (0 tokens).
#
#   The three interception/tool layers coexist by design. tldr's OWN hooks stay
#   UNWIRED: NEVER wire the `tldr-read-enforcer` hook alongside lean-ctx. lean-ctx
#   is already THE single generic read/exec interception layer; a second enforcer
#   would double-gate every read. tldr is a deliberate CLI, not an interceptor.
#
# THE KEY CONFLICT this installer fixes: lean-ctx's allowlist blocks `tldr`,
# `claude`, `node`, `python3 -c`, `[`, heredoc-piped interpreters, etc. out of
# the box. If those are not allowlisted, ai-maestro's own CLI scripts and agent
# tmux shells BREAK. This installer seeds the allowlist with every tool + every
# ai-maestro CLI agents rely on.
#
# FAIL-SOFT: every tool installs independently; a failure warns and CONTINUES.
# This script NEVER aborts and always exits 0. Idempotent: a tool already on
# PATH is skipped. It downloads/installs nothing that is already present.
#
# Usage: install-code-analysis-tooling.sh [OPTIONS]
#   -y, --yes        Non-interactive (install all, no prompts, NO 3GB model)
#   --with-model     Also pull the ~3GB fastedit local merge model (opt-in)
#   --semantic       Build tldr-code from source with the `semantic` feature
#                    (requires cargo; enables `tldr semantic` NL queries)
#   -h, --help       Show this help and exit
#
# Env equivalents (flags win):
#   NONINTERACTIVE=1 | CI=1      -> -y
#   FASTEDIT_PULL_MODEL=1        -> --with-model
#   TLDR_SEMANTIC=1              -> --semantic

# NOTE: intentionally NO `set -e` — fail-soft requires that a single failing
# tool install not abort the whole run. Each step handles its own errors.

# ── Homebrew tap that ships lean-ctx (from this machine's INSTALL_RECEIPT.json)
LEANCTX_TAP="yvgude/lean-ctx"

# ── Config / flags (env defaults first, then flags override) ──────────────
NON_INTERACTIVE=false
WITH_MODEL=false
FORCE_SEMANTIC=false

case "${CI:-}" in 1|true|TRUE|yes) NON_INTERACTIVE=true ;; esac
case "${NONINTERACTIVE:-}" in 1|true|TRUE|yes) NON_INTERACTIVE=true ;; esac
[ "${FASTEDIT_PULL_MODEL:-}" = "1" ] && WITH_MODEL=true
[ "${TLDR_SEMANTIC:-}" = "1" ] && FORCE_SEMANTIC=true

usage() {
    cat <<'EOF'
AI Maestro — code-analysis tooling installer (tldr, fastedit, distill, lean-ctx)

Usage: install-code-analysis-tooling.sh [OPTIONS]

Options:
  -y, --yes        Non-interactive (install all, no prompts, NO 3GB model)
  --with-model     Also pull the ~3GB fastedit local merge model (opt-in)
  --semantic       Build tldr-code from source with the `semantic` feature (cargo)
  -h, --help       Show this help and exit

Fail-soft: a failure in one tool warns and continues; the script never aborts.
Idempotent: a tool already on PATH is skipped.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        -y|--yes|--non-interactive) NON_INTERACTIVE=true ;;
        --with-model)               WITH_MODEL=true ;;
        --semantic)                 FORCE_SEMANTIC=true ;;
        -h|--help)                  usage; exit 0 ;;
        *) echo "Unknown option: $1"; echo "Use --help for usage."; exit 1 ;;
    esac
    shift
done

# ── Colors + print helpers (self-contained; script may run standalone) ────
if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    GREEN=''; YELLOW=''; BLUE=''; NC=''
fi
# %b interprets the color escapes; %s prints the message verbatim (safe if it
# contains '%'); trailing %b resets the color.
print_info()    { printf '%bℹ️  %s%b\n' "$BLUE"   "$*" "$NC"; }
print_success() { printf '%b✅ %s%b\n'  "$GREEN"  "$*" "$NC"; }
print_warning() { printf '%b⚠️  %s%b\n' "$YELLOW" "$*" "$NC"; }

# ── Platform detection ────────────────────────────────────────────────────
OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
IS_MACOS_ARM=false
if [ "$OS_NAME" = "Darwin" ] && { [ "$ARCH_NAME" = "arm64" ] || [ "$ARCH_NAME" = "aarch64" ]; }; then
    IS_MACOS_ARM=true
fi

# Map (uname -s, uname -m) -> the Rust target triple used by tldr-code releases.
# Supported release triples (parcadei/tldr-code):
#   aarch64-apple-darwin, x86_64-apple-darwin,
#   aarch64-unknown-linux-gnu, x86_64-unknown-linux-gnu
detect_triple() {
    local ro ra
    case "$OS_NAME" in
        Darwin) ro="apple-darwin" ;;
        Linux)  ro="unknown-linux-gnu" ;;
        *) return 1 ;;
    esac
    case "$ARCH_NAME" in
        arm64|aarch64) ra="aarch64" ;;
        x86_64|amd64)  ra="x86_64" ;;
        *) return 1 ;;
    esac
    printf '%s-%s\n' "$ra" "$ro"
}

# sha256 tool (macOS ships `shasum`, Linux ships `sha256sum`)
if command -v shasum >/dev/null 2>&1; then
    SHA_CMD="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
    SHA_CMD="sha256sum"
else
    SHA_CMD=""
fi

# ── Ensure ~/.local/bin exists AND is on PATH for this session ────────────
# (so `command -v` can see tools we just dropped there; the parent installer
#  handles the persistent shell-rc PATH entry).
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"
case ":$PATH:" in *":$LOCAL_BIN:"*) ;; *) PATH="$LOCAL_BIN:$PATH" ;; esac
if [ -d "$HOME/.cargo/bin" ]; then
    case ":$PATH:" in *":$HOME/.cargo/bin:"*) ;; *) PATH="$HOME/.cargo/bin:$PATH" ;; esac
fi
export PATH

# ── Per-tool status tracking (present|installed|skipped|failed|conflict) ──
STATUS_TLDR=""
STATUS_FASTEDIT=""
STATUS_DISTILL=""
STATUS_LEANCTX=""

# ── tldr-code (Rust READ instrument) ──────────────────────────────────────
install_tldr_prebuilt() {
    local triple="$1" tmpd tarball url expected actual found src b
    url="https://github.com/parcadei/tldr-code/releases/latest/download/tldr-cli-${triple}.tar.xz"
    tmpd="$(mktemp -d 2>/dev/null || mktemp -d -t tldr-dl)"
    [ -n "$tmpd" ] || { print_warning "could not create temp dir for tldr download"; return 1; }
    tarball="$tmpd/tldr-cli.tar.xz"

    print_info "Downloading tldr-code prebuilt (tldr-cli-${triple}.tar.xz)..."
    if ! curl -fsSL "$url" -o "$tarball"; then
        print_warning "tldr-code prebuilt download failed for triple $triple"
        rm -rf "$tmpd"; return 1
    fi

    # Checksum verify (fail-soft: mismatch refuses install; missing = unverified).
    if [ -n "$SHA_CMD" ] && curl -fsSL "${url}.sha256" -o "${tarball}.sha256" 2>/dev/null; then
        expected="$(awk '{print $1}' "${tarball}.sha256" 2>/dev/null | head -n1)"
        actual="$($SHA_CMD "$tarball" 2>/dev/null | awk '{print $1}')"
        if [ -n "$expected" ] && [ -n "$actual" ] && [ "$expected" != "$actual" ]; then
            print_warning "tldr-code checksum MISMATCH — refusing install (expected $expected, got $actual)"
            rm -rf "$tmpd"; return 1
        fi
        print_info "tldr-code checksum verified"
    else
        print_warning "tldr-code checksum unavailable — installing unverified"
    fi

    if ! tar -xf "$tarball" -C "$tmpd" 2>/dev/null; then
        print_warning "tldr-code archive extraction failed"
        rm -rf "$tmpd"; return 1
    fi

    # cargo-dist archives wrap the binaries in a per-triple subdir; find each by
    # name (one match per binary) and drop it into ~/.local/bin.
    found=0
    for b in tldr tldr-daemon tldr-mcp; do
        src="$(find "$tmpd" -type f -name "$b" 2>/dev/null | head -n1)"
        if [ -n "$src" ] && cp "$src" "$LOCAL_BIN/$b" && chmod +x "$LOCAL_BIN/$b"; then
            found=$((found + 1))
        fi
    done
    rm -rf "$tmpd"
    [ "$found" -ge 1 ]
}

install_tldr_cargo() {
    if ! command -v cargo >/dev/null 2>&1; then
        print_warning "cargo not found — cannot build tldr-code from source"
        return 1
    fi
    print_info "Building tldr-code from source (cargo, --features semantic) — may take several minutes..."
    cargo install --git https://github.com/parcadei/tldr-code tldr-cli --features semantic
}

install_tldr() {
    # Idempotent: a `tldr` already on PATH is left alone. Guard against the
    # unrelated `tldr-pages` client (same command name) by probing for a
    # tldr-code-only subcommand before declaring it satisfied.
    if command -v tldr >/dev/null 2>&1; then
        if tldr --help 2>&1 | grep -qiE '\b(structure|extract|definition|references)\b'; then
            STATUS_TLDR="present"
            print_success "tldr-code already on PATH — skipping"
            return 0
        fi
        STATUS_TLDR="conflict"
        print_warning "A different 'tldr' (likely the tldr-pages man-page client) is on PATH."
        print_warning "  NOT installing tldr-code to avoid clobbering it. Remove/rename that tldr,"
        print_warning "  or install tldr-code manually, if you need code analysis."
        return 0
    fi

    local triple
    triple="$(detect_triple)" || triple=""

    if [ "$FORCE_SEMANTIC" = true ]; then
        if install_tldr_cargo; then
            STATUS_TLDR="installed"; print_success "tldr-code (semantic) installed"
        else
            print_warning "--semantic build failed; falling back to prebuilt (non-semantic)"
            if [ -n "$triple" ] && install_tldr_prebuilt "$triple"; then
                STATUS_TLDR="installed"; print_success "tldr-code (prebuilt) installed"
            else
                STATUS_TLDR="failed"; print_warning "tldr-code install failed"
            fi
        fi
        return 0
    fi

    if [ -n "$triple" ] && install_tldr_prebuilt "$triple"; then
        STATUS_TLDR="installed"; print_success "tldr-code (prebuilt) installed"
    elif install_tldr_cargo; then
        STATUS_TLDR="installed"; print_success "tldr-code (cargo) installed"
    else
        STATUS_TLDR="failed"
        if [ -z "$triple" ]; then
            print_warning "tldr-code: unsupported platform ($OS_NAME/$ARCH_NAME) and no cargo — skipped"
        else
            print_warning "tldr-code install failed (prebuilt + cargo both unavailable)"
        fi
    fi
}

# ── fastedit (Python AST WRITE companion — REQUIRES tldr on PATH first) ───
install_fastedit() {
    if command -v fastedit >/dev/null 2>&1; then
        STATUS_FASTEDIT="present"
        print_success "fastedit already on PATH — skipping"
        return 0
    fi
    if ! command -v tldr >/dev/null 2>&1; then
        STATUS_FASTEDIT="skipped"
        print_warning "fastedit requires tldr on PATH first — tldr unavailable, skipping fastedit"
        return 0
    fi
    if ! command -v uv >/dev/null 2>&1; then
        STATUS_FASTEDIT="skipped"
        print_warning "uv not found — cannot install fastedit (get uv: https://docs.astral.sh/uv/). Skipping."
        return 0
    fi

    # mlx accelerates the local merge model but is Apple-Silicon only.
    local spec
    if [ "$IS_MACOS_ARM" = true ]; then
        spec='fastedits[mlx,mcp]'
    else
        spec='fastedits[mcp]'
    fi

    print_info "Installing fastedit ($spec) via uv tool..."
    if uv tool install "$spec"; then
        STATUS_FASTEDIT="installed"; print_success "fastedit installed"
    else
        STATUS_FASTEDIT="failed"; print_warning "fastedit install failed"
        return 0
    fi

    # Model pull is OPT-IN (~3GB) and mlx-only. Never forced.
    if [ "$WITH_MODEL" = true ]; then
        if [ "$IS_MACOS_ARM" = true ]; then
            print_info "Pulling fastedit local merge model (mlx-8bit, ~3GB)..."
            fastedit pull --model mlx-8bit \
                || print_warning "fastedit model pull failed (fastedit still works; 74% of edits are deterministic)"
        else
            print_warning "fastedit mlx model is Apple-Silicon only — skipping model pull on this platform"
        fi
    fi
}

# ── distill (Node output-compression pipe) ────────────────────────────────
install_distill() {
    if command -v distill >/dev/null 2>&1; then
        STATUS_DISTILL="present"
        print_success "distill already on PATH — skipping"
        return 0
    fi
    if ! command -v npm >/dev/null 2>&1; then
        STATUS_DISTILL="skipped"
        print_warning "npm not found — cannot install distill (needs Node.js/npm). Skipping."
        return 0
    fi
    print_info "Installing distill via npm (-g @samuelfaj/distill)..."
    if npm install -g @samuelfaj/distill; then
        STATUS_DISTILL="installed"; print_success "distill installed"
    else
        STATUS_DISTILL="failed"; print_warning "distill install failed"
    fi
}

# ── lean-ctx (Homebrew interceptor) — best-effort ─────────────────────────
install_leanctx() {
    if command -v lean-ctx >/dev/null 2>&1; then
        STATUS_LEANCTX="present"
        print_success "lean-ctx already on PATH — skipping"
        return 0
    fi
    if ! command -v brew >/dev/null 2>&1; then
        STATUS_LEANCTX="skipped"
        print_warning "Homebrew not found — lean-ctx is distributed via a Homebrew tap."
        print_warning "  Install Homebrew (https://brew.sh), then: brew install ${LEANCTX_TAP}/lean-ctx"
        return 0
    fi
    print_info "Installing lean-ctx via Homebrew tap ${LEANCTX_TAP} (best-effort)..."
    if brew install "${LEANCTX_TAP}/lean-ctx"; then
        STATUS_LEANCTX="installed"; print_success "lean-ctx installed"
    else
        STATUS_LEANCTX="failed"
        print_warning "lean-ctx install failed. If the tap is unavailable in your environment, install manually:"
        print_warning "  brew tap ${LEANCTX_TAP} && brew install lean-ctx"
    fi
}

# ── Seed the lean-ctx allowlist (THE KEY CONFLICT FIX) ────────────────────
# Runs only if lean-ctx is present (freshly installed OR pre-existing). Without
# this, lean-ctx's shell gate blocks the tools + ai-maestro CLIs and agent
# shells break. `lean-ctx allow` is additive + idempotent.
seed_leanctx_allowlist() {
    if ! command -v lean-ctx >/dev/null 2>&1; then
        print_info "lean-ctx not present — skipping allowlist seed"
        return 0
    fi
    print_info "Seeding lean-ctx allowlist (tools + ai-maestro CLIs) so agent shells don't break..."

    local base=(
        tldr tldr-daemon tldr-mcp
        fastedit fastedit-mcp fastedit-hook
        distill lean-ctx
        claude node uv npm cargo git gh jq curl openssl tmux pm2 yarn
        which command test "[" python3
    )
    local cmd n=0 f bn
    for cmd in "${base[@]}"; do
        if lean-ctx allow "$cmd" >/dev/null 2>&1; then n=$((n + 1)); fi
    done

    # Every ai-maestro CLI installed to ~/.local/bin. Unmatched globs are skipped
    # by the `-e` existence test (default bash globbing leaves the literal).
    for f in "$LOCAL_BIN"/aimaestro-*.sh "$LOCAL_BIN"/amp-*.sh "$LOCAL_BIN"/aid-*.sh \
             "$LOCAL_BIN"/docs-*.sh "$LOCAL_BIN"/graph-*.sh "$LOCAL_BIN"/memory-*.sh; do
        [ -e "$f" ] || continue
        bn="$(basename "$f")"
        if lean-ctx allow "$bn" >/dev/null 2>&1; then n=$((n + 1)); fi
    done

    print_success "lean-ctx allowlist seeded ($n entries ensured; additive + idempotent)"
}

# ── Summary table (tool | version | status) ───────────────────────────────
status_label() {
    case "$1" in
        present)   echo "PRESENT" ;;
        installed) echo "INSTALLED" ;;
        skipped)   echo "SKIPPED" ;;
        failed)    echo "FAILED" ;;
        conflict)  echo "CONFLICT" ;;
        *)         echo "UNKNOWN" ;;
    esac
}

summary_row() {
    local name="$1" status="$2" vcmd="$3" ver="-"
    if command -v "$name" >/dev/null 2>&1; then
        ver="$($vcmd 2>/dev/null | head -n1 | cut -c1-20)"
        [ -n "$ver" ] || ver="(on PATH)"
    fi
    printf "  %-12s %-22s %s\n" "$name" "$ver" "$(status_label "$status")"
}

print_summary() {
    echo ""
    echo "  Code-analysis tooling — install summary"
    printf "  %-12s %-22s %s\n" "TOOL" "VERSION" "STATUS"
    printf "  %-12s %-22s %s\n" "------------" "----------------------" "---------"
    summary_row "tldr"     "$STATUS_TLDR"     "tldr --version"
    summary_row "fastedit" "$STATUS_FASTEDIT" "fastedit --version"
    summary_row "distill"  "$STATUS_DISTILL"  "distill --version"
    summary_row "lean-ctx" "$STATUS_LEANCTX"  "lean-ctx --version"
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────
echo ""
print_info "Code-analysis tooling: tldr (read), fastedit (write), distill (compress), lean-ctx (intercept)"

if [ "$NON_INTERACTIVE" != true ]; then
    printf "Install code-analysis tooling now? [Y/n]: "
    read -r ans
    case "$ans" in
        [Nn]*) echo "Skipped."; exit 0 ;;
    esac
    if [ "$WITH_MODEL" != true ] && [ "$IS_MACOS_ARM" = true ]; then
        printf "Also download the ~3GB fastedit local merge model (mlx-8bit)? [y/N]: "
        read -r mans
        case "$mans" in
            [Yy]*) WITH_MODEL=true ;;
        esac
    fi
fi

# Order matters: tldr BEFORE fastedit (fastedit uses tldr); lean-ctx BEFORE the
# allowlist seed (which also covers a pre-existing lean-ctx).
install_tldr
install_fastedit
install_distill
install_leanctx
seed_leanctx_allowlist

# Distribute the cross-client skill variants (TRDD-ANYCPRTX) — fail-soft; never aborts.
DISTRIBUTE="$(dirname "${BASH_SOURCE[0]}")/distribute-code-analysis-skill.sh"
if [ -f "$DISTRIBUTE" ]; then
    if [ "$NON_INTERACTIVE" = true ]; then
        bash "$DISTRIBUTE" -y || print_warning "skill-variant distribution returned non-zero (continuing)"
    else
        bash "$DISTRIBUTE" || print_warning "skill-variant distribution returned non-zero (continuing)"
    fi
fi

print_summary

# Fail-soft contract: never propagate a non-zero status to the parent installer.
exit 0
