#!/usr/bin/env bash
#
# distribute-code-analysis-skill.sh
#
# WHY (TRDD-ANYCPRTX): ai-maestro drives agents on ANY CLI coding-agent client.
# The unified tldr-code + fastedit skill teaches an agent to use those tools
# INTENTIONALLY. Its per-client variant SOURCE ships in-repo at
# scripts/code-analysis-skill/<client>/. This script copies each client's variant
# into that client's GLOBAL config location so every agent of that client sees it.
#
# CONSERVATIVE + NON-INVASIVE by design:
#   * It writes ONLY into a client's own global config dir, and ONLY when that dir
#     already exists (i.e. the user actually uses that client).
#   * It NEVER writes into ~/agents/<agent> working dirs, nor any unrelated path.
#   * copilot + kilocode read PER-WORKSPACE files only (no global dir), so this
#     script does NOT auto-write them — it prints where to place the variant.
#   * Idempotent (skips a byte-identical existing copy) and FAIL-SOFT (a failure
#     warns and continues; the script always exits 0).
#
# NOTE on target paths: each client's exact skill/instructions load path is a
# documented convention that can change between client versions. Verify against
# your client's current docs; a stray file in a dir the client ignores is
# harmless, never destructive.
#
# Usage: distribute-code-analysis-skill.sh [-y|--yes] [-h|--help]

# NO `set -e` — fail-soft.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$SCRIPT_DIR/code-analysis-skill"

NON_INTERACTIVE=false
case "${CI:-}" in 1|true|TRUE|yes) NON_INTERACTIVE=true ;; esac
case "${NONINTERACTIVE:-}" in 1|true|TRUE|yes) NON_INTERACTIVE=true ;; esac

usage() {
    cat <<'EOF'
Distribute the cross-client tldr-code+fastedit skill variants (TRDD-ANYCPRTX).

Usage: distribute-code-analysis-skill.sh [OPTIONS]
  -y, --yes    Non-interactive (copy without prompting)
  -h, --help   Show this help and exit

Copies each in-repo per-client variant (scripts/code-analysis-skill/<client>/)
into that client's GLOBAL config dir — ONLY when the dir already exists.
copilot + kilocode are per-workspace only; their placement is printed, not auto-applied.
Idempotent + fail-soft; never writes into agent working dirs.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        -y|--yes|--non-interactive) NON_INTERACTIVE=true ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1"; echo "Use --help."; exit 1 ;;
    esac
    shift
done

if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    GREEN=''; YELLOW=''; BLUE=''; NC=''
fi
print_info()    { printf '%bℹ️  %s%b\n' "$BLUE"   "$*" "$NC"; }
print_success() { printf '%b✅ %s%b\n'  "$GREEN"  "$*" "$NC"; }
print_warning() { printf '%b⚠️  %s%b\n' "$YELLOW" "$*" "$NC"; }

if [ ! -d "$SRC_ROOT" ]; then
    print_warning "variant source not found: $SRC_ROOT — nothing to distribute"
    exit 0
fi

# copy_file <src> <dest> : idempotent (skip if identical), fail-soft. Returns 0 on
# copy/skip, 1 on failure. Creates the dest parent dir.
copy_file() {
    local src="$1" dest="$2"
    [ -f "$src" ] || { print_warning "missing variant: $src"; return 1; }
    if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
        print_info "up to date: $dest"
        return 0
    fi
    mkdir -p "$(dirname "$dest")" 2>/dev/null || { print_warning "cannot create $(dirname "$dest")"; return 1; }
    if cp "$src" "$dest" 2>/dev/null; then
        print_success "placed: $dest"
        return 0
    fi
    print_warning "failed to write: $dest"
    return 1
}

# place_global <label> <base-dir> <src-rel> <dest-abs>
# Copies ONLY when <base-dir> already exists (client is in use). Otherwise notes it.
place_global() {
    local label="$1" base="$2" src="$SRC_ROOT/$3" dest="$4"
    if [ -d "$base" ]; then
        copy_file "$src" "$dest"
    else
        print_info "$label not detected ($base absent) — skipping (variant: $src)"
    fi
}

echo ""
print_info "Distributing cross-client tldr-code+fastedit skill variants (TRDD-ANYCPRTX)"

if [ "$NON_INTERACTIVE" != true ] && [ -t 0 ]; then
    printf "Copy skill variants into detected client global dirs now? [Y/n]: "
    read -r ans
    case "$ans" in [Nn]*) echo "Skipped."; exit 0 ;; esac
fi

# ── Claude (canonical): the known user-global skills dir ──────────────────────
if [ -d "$HOME/.claude" ]; then
    copy_file "$SRC_ROOT/claude/SKILL.md" "$HOME/.claude/skills/tldr-code/SKILL.md"
    if [ -d "$SRC_ROOT/claude/references" ]; then
        mkdir -p "$HOME/.claude/skills/tldr-code/references" 2>/dev/null
        if cp -R "$SRC_ROOT/claude/references/." "$HOME/.claude/skills/tldr-code/references/" 2>/dev/null; then
            print_success "placed: $HOME/.claude/skills/tldr-code/references/"
        else
            print_warning "could not copy claude references/"
        fi
    fi
else
    print_info "Claude not detected (~/.claude absent) — skipping claude variant"
fi

# ── Converter-supported clients: global skills dir, only if the client exists ──
# Paths follow each client's documented per-user config convention (verify per version).
place_global "Codex"    "$HOME/.codex"           "codex/SKILL.md"    "$HOME/.codex/skills/tldr-code/SKILL.md"
place_global "Gemini"   "$HOME/.gemini"          "gemini/SKILL.md"   "$HOME/.gemini/skills/tldr-code/SKILL.md"
place_global "OpenCode" "$HOME/.config/opencode" "opencode/SKILL.md" "$HOME/.config/opencode/skills/tldr-code/SKILL.md"
place_global "Kiro"     "$HOME/.kiro"            "kiro/SKILL.md"     "$HOME/.kiro/skills/tldr-code/SKILL.md"

# ── Per-workspace-only clients: DO NOT auto-write; print placement guidance ────
echo ""
print_info "github-copilot + kilocode load PER-WORKSPACE files (no global dir) — place manually per repo:"
printf '   • GitHub Copilot: copy\n       %s\n     to  <repo>/.github/copilot-instructions.md\n' \
    "$SRC_ROOT/copilot/copilot-instructions.md"
printf '   • KiloCode: copy\n       %s\n     to  <repo>/.kilocode/rules/tldr-code.md\n' \
    "$SRC_ROOT/kilocode/rules/tldr-code.md"

echo ""
print_success "Skill-variant distribution done (source of truth stays in $SRC_ROOT)"
exit 0
