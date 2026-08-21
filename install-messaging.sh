#!/usr/bin/env bash
# AI Maestro - Agent Messaging Protocol (AMP) Installer
# Installs AMP scripts and Claude Code skills for inter-agent communication
#
# Usage:
#   ./install-messaging.sh           # Interactive mode
#   ./install-messaging.sh -y        # Non-interactive (install all)
#   ./install-messaging.sh --migrate # Migrate from old messaging system

set -e

# Source ecosystem constants (single source of truth for marketplace/plugin names)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/scripts/ecosystem-config.sh" ]; then
    source "$SCRIPT_DIR/scripts/ecosystem-config.sh"
elif [ -f "$SCRIPT_DIR/ecosystem-config.sh" ]; then
    source "$SCRIPT_DIR/ecosystem-config.sh"
fi

# Parse command line arguments
NON_INTERACTIVE=false
MIGRATE_ONLY=false
SRC_REPO=""       # --repo owner/repo|url : clone+install the frozen scripts from a custom source
SRC_BRANCH=""     # --branch NAME         : branch to clone when a custom source is requested
while [[ $# -gt 0 ]]; do
    case $1 in
        -y|--yes|--non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        --migrate)
            MIGRATE_ONLY=true
            shift
            ;;
        --repo)
            if [ $# -lt 2 ] || [ -z "$2" ] || [[ "$2" == -* ]]; then
                echo "Error: --repo requires an argument (e.g., --repo Emasoft/ai-maestro, or a full git URL)"
                exit 1
            fi
            SRC_REPO="$2"; shift 2
            ;;
        --branch)
            if [ $# -lt 2 ] || [ -z "$2" ] || [[ "$2" == -* ]]; then
                echo "Error: --branch requires a branch name (e.g., --branch governance-rules)"
                exit 1
            fi
            SRC_BRANCH="$2"; shift 2
            ;;
        -h|--help)
            echo "AI Maestro - Agent Messaging Protocol (AMP) Installer"
            echo ""
            echo "Usage: ./install-messaging.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -y, --yes          Non-interactive mode (install all, assume yes)"
            echo "  --migrate          Migrate from old messaging system only"
            echo "  --repo OWNER/REPO  Install the frozen scripts from a custom git repo or URL"
            echo "                     (opt-in; default installs from this local checkout)"
            echo "  --branch NAME      Branch to clone when --repo is given"
            echo "  -h, --help         Show this help message"
            echo ""
            echo "This installer sets up the Agent Messaging Protocol (AMP) which provides:"
            echo "  - Local messaging between agents (works immediately)"
            echo "  - Federation with external providers (CrabMail, etc.)"
            echo "  - Cryptographic message signing (Ed25519)"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Icons
CHECK="✅"
CROSS="❌"
INFO="ℹ️ "
WARN="⚠️ "

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║     AI Maestro - Agent Messaging Protocol (AMP) Installer      ║"
echo "║                                                                ║"
echo "║               Email for AI Agents - Local First                ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Function to print colored messages
print_success() {
    echo -e "${GREEN}${CHECK} $1${NC}"
}

print_error() {
    echo -e "${RED}${CROSS} $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}${WARN} $1${NC}"
}

print_info() {
    echo -e "${BLUE}${INFO}$1${NC}"
}

# Derive absolute path from script location so it works when called from any CWD
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$SCRIPT_DIR/scripts"

# --repo/--branch: install the frozen scripts from a custom git source instead of this local
# tree. OPT-IN ONLY — with neither flag this installer does ZERO network I/O and installs from
# its own checked-out tree (which is already "the current branch"), preserving the
# destructive-safety property (it never silently fetches from a default/upstream repo).
if [ -n "$SRC_REPO" ] || [ -n "$SRC_BRANCH" ]; then
    if [ -z "$SRC_REPO" ]; then
        print_error "--branch requires --repo (no source repo to clone)"
        exit 1
    fi
    # Accept "owner/repo" shorthand, a full git URL, OR a local repo path (the dev default:
    # install the frozen scripts from the local governance-rules checkout). Local paths MUST be
    # matched before owner/repo, or an absolute path is wrongly rewritten into a github.com URL.
    SRC_REPO="${SRC_REPO/#\~\//$HOME/}"   # expand a quoted leading ~/ to $HOME/ (a bare ~/* case
                                          # pattern would tilde-expand and never match the literal).
    case "$SRC_REPO" in
        http://*|https://*|git@*|ssh://*|file://*) _src_url="$SRC_REPO" ;;
        /*|./*|../*) _src_url="$SRC_REPO" ;;
        */*) _src_url="https://github.com/${SRC_REPO%.git}.git" ;;
        *)
            if [ -d "$SRC_REPO" ]; then
                _src_url="$SRC_REPO"
            else
                print_error "--repo must be OWNER/REPO, a git URL, or a local repo path (got: $SRC_REPO)"
                exit 1
            fi
            ;;
    esac
    _clone_dir="$(mktemp -d "${TMPDIR:-/tmp}/aimaestro-src.XXXXXX")"
    # The clone is scratch: scripts are copied to ~/.local/bin during this run, so remove the
    # temp checkout on exit (success or failure) — nothing after this script needs it.
    trap 'rm -rf "$_clone_dir"' EXIT
    print_info "Cloning scripts source: $_src_url${SRC_BRANCH:+ @ $SRC_BRANCH}"
    _clone_args=(--depth 1)
    [ -n "$SRC_BRANCH" ] && _clone_args+=(--branch "$SRC_BRANCH")
    if ! git clone "${_clone_args[@]}" "$_src_url" "$_clone_dir"; then
        print_error "Failed to clone $_src_url"
        exit 1
    fi
    SCRIPT_DIR="$_clone_dir"
    SCRIPTS_DIR="$_clone_dir/scripts"
    print_success "Installing frozen scripts from $_clone_dir"
fi

if [ ! -d "$SCRIPTS_DIR" ]; then
    print_error "Scripts not found at $SCRIPTS_DIR"
    exit 1
fi

# Validate agent name to prevent path traversal (only alphanumeric, hyphens, underscores)
_validate_agent_name() {
    local name="$1"
    if [ -z "$name" ]; then
        return 1
    fi
    if echo "$name" | grep -qE '^[a-zA-Z0-9_-]+$'; then
        return 0
    fi
    return 1
}

# Migration function
# Extract the recipient agent name from a message JSON file (for inbox placement)
# Checks: toAlias, toSession, .to (plain name), envelope.to (extract name before @)
_extract_recipient() {
    local msg_file="$1"
    local recipient=""

    # Try toAlias first (old flat format)
    recipient=$(jq -r '.toAlias // empty' "$msg_file" 2>/dev/null)
    if [ -n "$recipient" ] && _validate_agent_name "$recipient"; then echo "$recipient"; return; fi

    # Try toSession (some messages have this)
    recipient=$(jq -r '.toSession // empty' "$msg_file" 2>/dev/null)
    if [ -n "$recipient" ] && _validate_agent_name "$recipient"; then echo "$recipient"; return; fi

    # Try .to as plain agent name (old format where to is a name, not UUID)
    local to_val
    to_val=$(jq -r '.to // empty' "$msg_file" 2>/dev/null)
    if [ -n "$to_val" ] && ! echo "$to_val" | grep -qE '^[0-9a-f]{8}-'; then
        # Not a UUID, treat as agent name
        # Strip @domain if present
        recipient=$(echo "$to_val" | cut -d'@' -f1)
        if [ -n "$recipient" ] && _validate_agent_name "$recipient"; then echo "$recipient"; return; fi
    fi

    # Try AMP envelope format
    local env_to
    env_to=$(jq -r '.envelope.to // empty' "$msg_file" 2>/dev/null)
    if [ -n "$env_to" ]; then
        recipient=$(echo "$env_to" | cut -d'@' -f1)
        if [ -n "$recipient" ] && _validate_agent_name "$recipient"; then echo "$recipient"; return; fi
    fi

    echo ""
}

# Extract the sender agent name from a message JSON file (for inbox subdirectory)
# Checks: fromAlias, .from (plain name), envelope.from (extract name before @)
_extract_sender() {
    local msg_file="$1"
    local sender=""

    # Try fromAlias first (old flat format)
    sender=$(jq -r '.fromAlias // empty' "$msg_file" 2>/dev/null)
    if [ -n "$sender" ] && _validate_agent_name "$sender"; then echo "$sender"; return; fi

    # Try .from as plain agent name
    local from_val
    from_val=$(jq -r '.from // empty' "$msg_file" 2>/dev/null)
    if [ -n "$from_val" ] && ! echo "$from_val" | grep -qE '^[0-9a-f]{8}-'; then
        sender=$(echo "$from_val" | cut -d'@' -f1)
        if [ -n "$sender" ] && _validate_agent_name "$sender"; then echo "$sender"; return; fi
    fi

    # Try AMP envelope format
    local env_from
    env_from=$(jq -r '.envelope.from // empty' "$msg_file" 2>/dev/null)
    if [ -n "$env_from" ]; then
        sender=$(echo "$env_from" | cut -d'@' -f1)
        if [ -n "$sender" ] && _validate_agent_name "$sender"; then echo "$sender"; return; fi
    fi

    echo ""
}

# Distribute messages from shared directory to per-agent directories
# This is the critical Phase 2 that ensures messages end up where agents read them
# Convert old flat-format message to AMP envelope format
# If message already has .envelope, returns it unchanged
_convert_to_amp_format() {
    local msg_file="$1"
    local now_ts
    now_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Check if already in AMP envelope format
    local has_envelope
    has_envelope=$(jq -r 'has("envelope")' "$msg_file" 2>/dev/null)
    if [ "$has_envelope" = "true" ]; then
        cat "$msg_file"
        return
    fi

    # Convert old flat format to AMP envelope
    jq --arg now "$now_ts" '
    {
        envelope: {
            version: "amp/0.1",
            id: .id,
            from: ((.fromAlias // .from // "unknown") + "@local"),
            to: ((.toAlias // .to // "unknown") + "@local"),
            subject: (.subject // ""),
            priority: (.priority // "normal"),
            timestamp: (.timestamp // $now),
            thread_id: (.inReplyTo // .id),
            in_reply_to: (.inReplyTo // null),
            expires_at: null,
            signature: null
        },
        payload: (
            if (.content | type) == "object" then
                {
                    type: (.content.type // .type // "notification"),
                    message: (.content.message // ""),
                    context: (.content.context // null)
                }
            elif (.content | type) == "string" then
                {
                    type: (.type // "notification"),
                    message: .content,
                    context: null
                }
            else
                {
                    type: (.type // "notification"),
                    message: "",
                    context: null
                }
            end
        ),
        metadata: {
            status: (.status // "unread"),
            migrated_from: "flat_format",
            migrated_at: $now
        },
        local: {
            status: (.status // "unread"),
            received_at: (.timestamp // $now)
        }
    }' "$msg_file" 2>/dev/null
}

distribute_shared_to_per_agent() {
    local SHARED_INBOX="$HOME/.agent-messaging/messages/inbox"
    local SHARED_SENT="$HOME/.agent-messaging/messages/sent"
    local AGENTS_BASE="$HOME/.agent-messaging/agents"
    local DISTRIBUTED=0
    local SKIPPED=0
    # NT-033: Declare loop-scoped variables at the top of the function.
    # Re-declaring `local` inside a while loop body is harmless but unconventional
    # and can confuse shellcheck/readers.
    local recipient sender dest_dir msg_basename

    # Distribute inbox messages
    if [ -d "$SHARED_INBOX" ]; then
        while IFS= read -r msg_file; do
            recipient=$(_extract_recipient "$msg_file")
            sender=$(_extract_sender "$msg_file")

            if [ -n "$recipient" ] && [ -n "$sender" ]; then
                dest_dir="$AGENTS_BASE/$recipient/messages/inbox/$sender"
                msg_basename=$(basename "$msg_file")

                # Skip if already exists in destination
                if [ -f "$dest_dir/$msg_basename" ]; then
                    continue
                fi

                mkdir -p "$dest_dir"
                # Convert to AMP format and write
                _convert_to_amp_format "$msg_file" > "$dest_dir/$msg_basename"
                DISTRIBUTED=$((DISTRIBUTED + 1))
            else
                SKIPPED=$((SKIPPED + 1))
            fi
        done < <(find "$SHARED_INBOX" -name "*.json" -type f 2>/dev/null)
    fi

    # Distribute sent messages
    if [ -d "$SHARED_SENT" ]; then
        while IFS= read -r msg_file; do
            sender=$(_extract_sender "$msg_file")
            recipient=$(_extract_recipient "$msg_file")

            if [ -n "$sender" ] && [ -n "$recipient" ]; then
                dest_dir="$AGENTS_BASE/$sender/messages/sent/$recipient"
                msg_basename=$(basename "$msg_file")

                if [ -f "$dest_dir/$msg_basename" ]; then
                    continue
                fi

                mkdir -p "$dest_dir"
                _convert_to_amp_format "$msg_file" > "$dest_dir/$msg_basename"
                DISTRIBUTED=$((DISTRIBUTED + 1))
            else
                SKIPPED=$((SKIPPED + 1))
            fi
        done < <(find "$SHARED_SENT" -name "*.json" -type f 2>/dev/null)
    fi

    if [ "$DISTRIBUTED" -gt 0 ]; then
        # Redirect informational output to stderr so stdout only contains the count
        print_success "Distributed $DISTRIBUTED messages to per-agent directories (AMP format)" >&2
    fi
    if [ "$SKIPPED" -gt 0 ]; then
        # Redirect informational output to stderr so stdout only contains the count
        print_warning "Skipped $SKIPPED messages (could not determine recipient/sender)" >&2
    fi

    # Only the numeric count goes to stdout for $() capture
    echo "$DISTRIBUTED"
}

migrate_old_messages() {
    echo ""
    print_info "Checking for messages to migrate..."

    local OLD_INBOX="$HOME/.aimaestro/messages/inbox"
    local OLD_SENT="$HOME/.aimaestro/messages/sent"
    local SHARED_INBOX="$HOME/.agent-messaging/messages/inbox"
    local SHARED_SENT="$HOME/.agent-messaging/messages/sent"
    local PHASE1_DONE=false

    # ── Phase 1: Migrate from old ~/.aimaestro/messages/ to shared location ──
    if [ -d "$OLD_INBOX" ] || [ -d "$OLD_SENT" ]; then
        local OLD_COUNT=0
        if [ -d "$OLD_INBOX" ]; then
            OLD_COUNT=$(find "$OLD_INBOX" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
        fi
        local OLD_SENT_COUNT=0
        if [ -d "$OLD_SENT" ]; then
            OLD_SENT_COUNT=$(find "$OLD_SENT" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
        fi

        if [ "$((OLD_COUNT + OLD_SENT_COUNT))" -gt 0 ]; then
            print_warning "Found $((OLD_COUNT + OLD_SENT_COUNT)) messages in old format (~/.aimaestro/messages/)"

            if [ "$NON_INTERACTIVE" = true ]; then
                local MIGRATE_CHOICE="y"
            else
                echo ""
                echo "  Messages will be migrated to per-agent directories."
                echo ""
                read -p "Migrate old messages? [Y/n]: " MIGRATE_CHOICE
                MIGRATE_CHOICE=${MIGRATE_CHOICE:-Y}
            fi

            if [[ "$MIGRATE_CHOICE" =~ ^[Yy]$ ]]; then
                mkdir -p "$SHARED_INBOX" "$SHARED_SENT"

                # Copy inbox messages to shared (preserving them for Phase 2)
                if [ -d "$OLD_INBOX" ]; then
                    for agent_dir in "$OLD_INBOX"/*; do
                        if [ -d "$agent_dir" ]; then
                            for msg in "$agent_dir"/*.json; do
                                if [ -f "$msg" ]; then
                                    cp -n "$msg" "$SHARED_INBOX/" 2>/dev/null || true
                                fi
                            done
                        fi
                    done
                fi

                # Copy sent messages to shared
                if [ -d "$OLD_SENT" ]; then
                    for agent_dir in "$OLD_SENT"/*; do
                        if [ -d "$agent_dir" ]; then
                            for msg in "$agent_dir"/*.json; do
                                if [ -f "$msg" ]; then
                                    cp -n "$msg" "$SHARED_SENT/" 2>/dev/null || true
                                fi
                            done
                        fi
                    done
                fi

                # Backup old messages
                local BACKUP_DIR
                BACKUP_DIR="$HOME/.aimaestro/messages.backup.$(date +%Y%m%d-%H%M%S)"
                if [ -d "$HOME/.aimaestro/messages" ]; then
                    mv "$HOME/.aimaestro/messages" "$BACKUP_DIR"
                    print_info "Old messages backed up to: $BACKUP_DIR"
                fi
                PHASE1_DONE=true
            fi
        fi
    fi

    # ── Phase 2: Distribute from shared to per-agent directories ──
    # This runs regardless of Phase 1 - catches messages that were
    # previously migrated to shared but never distributed
    local SHARED_COUNT=0
    if [ -d "$SHARED_INBOX" ]; then
        SHARED_COUNT=$(find "$SHARED_INBOX" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
    fi
    local SHARED_SENT_COUNT=0
    if [ -d "$SHARED_SENT" ]; then
        SHARED_SENT_COUNT=$(find "$SHARED_SENT" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
    fi

    if [ "$((SHARED_COUNT + SHARED_SENT_COUNT))" -gt 0 ]; then
        print_info "Distributing $((SHARED_COUNT + SHARED_SENT_COUNT)) messages to per-agent directories..."
        local result
        result=$(distribute_shared_to_per_agent)

        if [ "$result" -gt 0 ] 2>/dev/null; then
            # Backup shared messages and clean up
            local SHARED_BACKUP
            SHARED_BACKUP="$HOME/.agent-messaging/messages.backup.$(date +%Y%m%d-%H%M%S)"
            mv "$HOME/.agent-messaging/messages" "$SHARED_BACKUP"
            print_info "Shared messages backed up to: $SHARED_BACKUP"
            print_success "Messages are now in per-agent directories (~/.agent-messaging/agents/<name>/messages/)"
        fi
    else
        if [ "$PHASE1_DONE" != true ]; then
            print_info "No messages to migrate."
        fi
    fi
}

# Handle migrate-only mode
if [ "$MIGRATE_ONLY" = true ]; then
    migrate_old_messages
    echo ""
    print_success "Migration complete!"
    exit 0
fi

echo "🔍 Checking prerequisites..."
echo ""

# Track what needs to be installed
INSTALL_SCRIPTS=false
INSTALL_SKILL=false
PREREQUISITES_OK=true

# Check curl
print_info "Checking for curl..."
if command -v curl &> /dev/null; then
    print_success "curl installed"
else
    print_error "curl not found (required)"
    PREREQUISITES_OK=false
fi

# Check jq
print_info "Checking for jq..."
if command -v jq &> /dev/null; then
    print_success "jq installed"
else
    print_error "jq not found (required for AMP)"
    echo "         Install with: brew install jq"
    PREREQUISITES_OK=false
fi

# Check openssl
print_info "Checking for openssl..."
if command -v openssl &> /dev/null; then
    OPENSSL_VERSION=$(openssl version | cut -d' ' -f2)
    print_success "openssl installed (version $OPENSSL_VERSION)"
else
    print_error "openssl not found (required for cryptographic signing)"
    PREREQUISITES_OK=false
fi

# Check tmux (optional but recommended)
print_info "Checking for tmux..."
if command -v tmux &> /dev/null; then
    TMUX_VERSION=$(tmux -V | cut -d' ' -f2)
    print_success "tmux installed (version $TMUX_VERSION)"
else
    print_warning "tmux not found (optional, for terminal notifications)"
fi

# Check Claude Code (optional)
print_info "Checking for Claude Code..."
if command -v claude &> /dev/null; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null | head -n1 || echo "unknown")
    print_success "Claude Code installed ($CLAUDE_VERSION)"
    INSTALL_SKILL=true
else
    print_warning "Claude Code not found"
    echo "         Skills will not be available (CLI still works)"
    echo "         Install from: https://claude.ai/download"
fi

echo ""

if [ "$PREREQUISITES_OK" = false ]; then
    print_error "Missing required prerequisites. Please install them and try again."
    exit 1
fi

# Migrate messages: old format → shared → per-agent directories
# Runs if old messages exist OR if shared messages need distribution
if [ -d "$HOME/.aimaestro/messages" ] || [ -d "$HOME/.agent-messaging/messages/inbox" ] || [ -d "$HOME/.agent-messaging/messages/sent" ]; then
    migrate_old_messages
fi

# Ask user what to install (or auto-select in non-interactive mode)
if [ "$NON_INTERACTIVE" = true ]; then
    print_info "Non-interactive mode: installing scripts and plugin..."
    CHOICE=3
else
    echo "📦 What would you like to install?"
    echo ""
    echo "  1) AMP scripts only (amp-send, amp-inbox, etc.)"
    echo "  2) Claude Code plugin only (requires Claude Code)"
    echo "  3) Both scripts and plugin (recommended)"
    echo "  4) Cancel installation"
    echo ""
    read -p "Enter your choice (1-4): " CHOICE
fi

case $CHOICE in
    1)
        INSTALL_SCRIPTS=true
        INSTALL_SKILL=false
        ;;
    2)
        INSTALL_SCRIPTS=false
        INSTALL_SKILL=true
        if ! command -v claude &> /dev/null; then
            print_error "Claude Code not found. Cannot install plugin."
            exit 1
        fi
        ;;
    3)
        INSTALL_SCRIPTS=true
        INSTALL_SKILL=true
        if ! command -v claude &> /dev/null; then
            print_warning "Claude Code not found. Will install scripts only."
            INSTALL_SKILL=false
        fi
        ;;
    4)
        echo "Installation cancelled."
        exit 0
        ;;
    *)
        print_error "Invalid choice. Installation cancelled."
        exit 1
        ;;
esac

echo ""
echo "🚀 Starting installation..."
echo ""

# Install AMP scripts
if [ "$INSTALL_SCRIPTS" = true ]; then
    print_info "Installing AMP scripts to ~/.local/bin/..."

    # Create directory if it doesn't exist
    mkdir -p ~/.local/bin

    # Copy AMP scripts from plugin
    SCRIPT_COUNT=0
    for script in "$SCRIPTS_DIR"/amp-*.sh; do
        if [ -f "$script" ]; then
            SCRIPT_NAME=$(basename "$script")
            cp "$script" ~/.local/bin/
            chmod +x ~/.local/bin/"$SCRIPT_NAME"

            # Create symlink without .sh extension for convenience
            # e.g., amp-init -> amp-init.sh
            LINK_NAME="${SCRIPT_NAME%.sh}"
            if [ "$LINK_NAME" != "$SCRIPT_NAME" ]; then
                ln -sf "$SCRIPT_NAME" ~/.local/bin/"$LINK_NAME"
            fi

            print_success "Installed: $SCRIPT_NAME"
            SCRIPT_COUNT=$((SCRIPT_COUNT + 1))
        fi
    done

    echo ""
    print_success "Installed $SCRIPT_COUNT AMP scripts (with symlinks)"

    # TRDD-5KKO25RO fix-2 [HIGH]: migrate legacy 0644 private keys to 0600.
    # generate_keypair chmods new keys 0600, but keys created by older versions
    # were left group/other-readable — any same-UID process could read them and
    # forge signed AMP messages. amp-helper.sh's sign_message now REFUSES a
    # group/other-readable key (fail-closed), so this one-time chmod is what lets
    # existing agents keep signing. Idempotent: re-running is harmless.
    echo ""
    print_info "Securing AMP private-key permissions (0600)..."
    KEY_FIXED=0
    for _priv in "$HOME"/.agent-messaging/keys/private.pem \
                 "$HOME"/.agent-messaging/agents/*/keys/private.pem; do
        [ -f "$_priv" ] || continue
        chmod 600 "$_priv" && KEY_FIXED=$((KEY_FIXED + 1))
    done
    print_success "Ensured 0600 on $KEY_FIXED AMP private key(s)"

    # TRDD-5KKO25RO fix-3c [MEDIUM]: GC orphan per-agent AMP dirs.
    # The registry historically never pruned ~/.agent-messaging/agents/<uuid>/
    # dirs, so hundreds of stale UUID dirs accumulate vs the few actually
    # indexed in .index.json. Stale dirs feed the resolver ambiguity that trips
    # "Multiple AMP agents found". This does NOT delete: per RULE 0 it MOVES
    # each unindexed UUID dir into a timestamped, recoverable backup staging dir
    # (a single mv restores it). Fail-closed: if .index.json is missing or
    # unparseable we cannot know what is live, so we GC NOTHING. Idempotent: the
    # backup dir is not UUID-shaped, so a re-run never re-processes it.
    echo ""
    print_info "Pruning orphan AMP agent dirs (unindexed UUIDs -> recoverable backup)..."
    _amp_agents="$HOME/.agent-messaging/agents"
    _amp_index="$_amp_agents/.index.json"
    if [ -d "$_amp_agents" ] && [ -f "$_amp_index" ] && \
       command -v jq >/dev/null 2>&1 && jq -e . "$_amp_index" >/dev/null 2>&1; then
        # The .index.json VALUES are the UUIDs that ARE live; anything else is orphan.
        _indexed="$(jq -r '.[]' "$_amp_index" 2>/dev/null | tr '\n' '|')"
        _stage="$_amp_agents/.orphan-backup-$(date +%Y%m%d_%H%M%S)"
        _orphans=0
        for _d in "$_amp_agents"/*/; do
            [ -d "$_d" ] || continue
            _name="$(basename "$_d")"
            # Only UUID-shaped dirs are candidates (leave anything unexpected).
            case "$_name" in
                [0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*) : ;;
                *) continue ;;
            esac
            # Indexed UUID -> keep (substring match against the pipe-joined set).
            case "|$_indexed" in *"|$_name|"*) continue ;; esac
            mkdir -p "$_stage"
            mv "$_d" "$_stage/" && _orphans=$((_orphans + 1))
        done
        if [ "$_orphans" -gt 0 ]; then
            print_success "Backed up $_orphans orphan agent dir(s) to $_stage (restore: mv \"$_stage\"/* \"$_amp_agents\"/)"
        else
            print_success "No orphan agent dirs to prune"
        fi
    else
        print_info "Skipped orphan prune (no readable .index.json -> nothing GC'd, fail-closed)"
    fi

    # Remove old messaging scripts that have been replaced by AMP
    echo ""
    print_info "Cleaning up old messaging scripts..."
    OLD_SCRIPTS=(
        "send-aimaestro-message.sh"
        "check-aimaestro-messages.sh"
        "read-aimaestro-message.sh"
        "aimaestro-message-send.sh"
        "aimaestro-message-check.sh"
        "check-and-show-messages.sh"
        "check-new-messages-arrived.sh"
        "send-tmux-message.sh"
        "forward-aimaestro-message.sh"
        "reply-aimaestro-message.sh"
        "messaging-helper.sh"
    )
    OLD_REMOVED=0
    for old_script in "${OLD_SCRIPTS[@]}"; do
        if [ -f "$HOME/.local/bin/$old_script" ]; then
            # Safety check: only delete if script has AI Maestro header marker
            # to avoid accidentally deleting user scripts with the same name
            if head -5 "$HOME/.local/bin/$old_script" | grep -qi "AI Maestro" 2>/dev/null; then
                rm -f "$HOME/.local/bin/$old_script"
                print_success "Removed old script: $old_script"
                OLD_REMOVED=$((OLD_REMOVED + 1))
            else
                print_warning "Skipped $old_script (no AI Maestro header - may be a user script)"
            fi
        fi
    done
    if [ "$OLD_REMOVED" -gt 0 ]; then
        print_success "Removed $OLD_REMOVED old messaging script(s)"
    else
        echo "  No old scripts found"
    fi

    # Also install the rest of scripts/*.sh (the aimaestro-*/aid-* CLI + operator tools).
    # NOTE: this used to claim "graph, memory, docs" — those scripts were deleted from the
    # repo in b862c6b0 (TRDD-70a521d9, the RAG removal) and are NOT installed any more. The
    # message stayed behind and became a lie; see docs/SCRIPT-MANIFEST.md §5. Because this
    # loop only ever COPIES, a host that installed before b862c6b0 still carries the deleted
    # scripts in ~/.local/bin as residue — which is exactly why a deployed bin dir must never
    # be treated as the source of truth for what AI Maestro ships.
    echo ""
    print_info "Installing additional AI Maestro tools..."

    TOOL_COUNT=0
    for script in "$SCRIPTS_DIR"/*.sh; do
        if [ -f "$script" ]; then
            SCRIPT_NAME=$(basename "$script")
            # Skip old messaging scripts (they're replaced by AMP).
            # NOTE: this used to be a bare substring match on "aimaestro-message",
            # which also matched (and silently skipped) the current, still-shipped
            # scripts/aimaestro-message.sh — the old scripts are all
            # "aimaestro-message-<verb>.sh" (with a hyphen after "message"), so
            # anchoring the prefix on "aimaestro-message-" excludes exactly those
            # and leaves the plain aimaestro-message.sh installable (issue #147).
            if [[ "$SCRIPT_NAME" == "aimaestro-message-"* ]] || \
               [[ "$SCRIPT_NAME" == "check-and-show-messages.sh" ]] || \
               [[ "$SCRIPT_NAME" == "check-new-messages-arrived.sh" ]] || \
               [[ "$SCRIPT_NAME" == "send-tmux-message.sh" ]]; then
                continue
            fi
            cp "$script" ~/.local/bin/
            chmod +x ~/.local/bin/"$SCRIPT_NAME"
            print_success "Installed: $SCRIPT_NAME"
            TOOL_COUNT=$((TOOL_COUNT + 1))
        fi
    done

    echo ""
    print_success "Installed $TOOL_COUNT additional tools (agent management, identity, operator scripts)"

    # Install shell helpers
    echo ""
    print_info "Installing shell helpers..."
    mkdir -p ~/.local/share/aimaestro/shell-helpers
    if [ -f "$SCRIPT_DIR/scripts/shell-helpers/common.sh" ]; then
        cp "$SCRIPT_DIR/scripts/shell-helpers/common.sh" ~/.local/share/aimaestro/shell-helpers/
        chmod +x ~/.local/share/aimaestro/shell-helpers/common.sh
        print_success "Installed: shell-helpers/common.sh"
    fi

    # ── The pillar CLIs (TRDD-217AYEOT) ──────────────────────────────────────────
    #
    # These need an EXPLICIT step, unlike every other tool above. Both loops over
    # scripts/ match `*.sh`, and the USER's naming law makes these extensionless
    # (`<document type>grep`: memgrep, trddgrep, prrdgrep, specgrep) — so no glob can
    # see them. Naming the launcher `pillar-cli.sh` to ride the existing loop would
    # instead install a FOURTH name for the same tool, which is the confusion the law
    # exists to prevent.
    #
    # Record the install root FIRST: the launcher needs to find the implementation and
    # this installer's own $SCRIPT_DIR is the one place that provably knows where it is.
    # Never hardcode ~/ai-maestro — packaged installs have no such directory.
    echo ""
    print_info "Installing pillar CLIs (3-pillar corpus tools, usable in ANY project)..."
    mkdir -p ~/.local/share/aimaestro
    printf '%s\n' "$SCRIPT_DIR" > ~/.local/share/aimaestro/install-root
    print_success "Recorded install root: $SCRIPT_DIR"

    if [ -f "$SCRIPT_DIR/scripts/pillar-cli" ]; then
        PILLAR_COUNT=0
        # ONE launcher, installed under each pillar's name; it dispatches on basename.
        # A name is installed only when its implementation EXISTS — prrdgrep/specgrep
        # land with the PRRD/SPEC stores. Shipping them early as stubs that refuse would
        # be worse than their absence: an agent that finds a tool and gets an error
        # cannot tell "planned" from "broken".
        for PILLAR_TOOL in trddgrep prrdgrep specgrep; do
            if [ -f "$SCRIPT_DIR/scripts/$PILLAR_TOOL.mjs" ]; then
                cp "$SCRIPT_DIR/scripts/pillar-cli" ~/.local/bin/"$PILLAR_TOOL"
                chmod +x ~/.local/bin/"$PILLAR_TOOL"
                print_success "Installed: $PILLAR_TOOL"
                PILLAR_COUNT=$((PILLAR_COUNT + 1))
            fi
        done
        if [ "$PILLAR_COUNT" -eq 0 ]; then
            print_warning "No pillar implementations found in $SCRIPT_DIR/scripts/ — none installed"
        fi
    else
        print_warning "scripts/pillar-cli missing — pillar CLIs not installed"
    fi

    # Setup PATH
    echo ""
    print_info "Configuring PATH..."

    # Dual guard: check runtime PATH and shell config marker to avoid duplicates
    if [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
        # Already in runtime PATH - no action needed
        # shellcheck disable=SC2088  # display string, not a path
        print_info "~/.local/bin already in PATH"
    else
        # Detect shell config file
        SHELL_RC=""
        if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ]; then
            SHELL_RC="$HOME/.bashrc"
        fi

        if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
            # Check for AI Maestro marker OR existing PATH entry to prevent duplicates
            if grep -qF "# AI Maestro" "$SHELL_RC" 2>/dev/null || grep -qF '/.local/bin' "$SHELL_RC" 2>/dev/null; then
                print_info "PATH already configured in $SHELL_RC"
            else
                echo '' >> "$SHELL_RC"
                echo '# AI Maestro PATH (added by installer)' >> "$SHELL_RC"
                echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
                print_success "Added ~/.local/bin to PATH in $SHELL_RC"
            fi
        fi

        # Also add to current session
        export PATH="$HOME/.local/bin:$PATH"
    fi
fi

# Install AI Maestro plugin from marketplace (replaces standalone skill installation)
if [ "$INSTALL_SKILL" = true ]; then
    echo ""
    print_info "Installing AI Maestro plugin from marketplace..."

    MARKETPLACE_REPO="${MARKETPLACE_REPO:-Emasoft/ai-maestro-plugins}"
    PLUGIN_NAME="${MAIN_PLUGIN_NAME:-ai-maestro-plugin}"

    # Step 0: Remove deprecated 23blocks-OS marketplace (replaced by Emasoft/ai-maestro-plugins)
    claude plugin marketplace remove "23blocks-OS/ai-maestro-plugins" 2>/dev/null && \
        print_info "Removed deprecated 23blocks-OS marketplace" || true
    claude plugin marketplace remove "https://github.com/23blocks-OS/ai-maestro-plugins" 2>/dev/null || true

    # Step 1: Register the marketplace from GitHub (enables future updates via claude CLI)
    # Always use the GitHub source — local submodule copies become stale and prevent
    # Claude Code from fetching updates via `claude plugin marketplace update`.
    print_info "Registering marketplace: $MARKETPLACE_REPO"
    if claude plugin marketplace add "$MARKETPLACE_REPO" 2>/dev/null; then
        print_success "Marketplace registered: $MARKETPLACE_REPO"
    else
        # May already be registered — that's fine
        print_info "Marketplace may already be registered (continuing)"
    fi

    # Step 2: Install the ai-maestro plugin with user scope
    print_info "Installing plugin: $PLUGIN_NAME (--scope user)"
    if claude plugin install "$PLUGIN_NAME" --scope user 2>/dev/null; then
        print_success "Plugin installed: $PLUGIN_NAME"
    else
        # May already be installed — try to update
        print_warning "Install returned non-zero (may already be installed)"
        print_info "Attempting plugin update..."
        claude plugin update "$PLUGIN_NAME" 2>/dev/null && print_success "Plugin updated" || true
    fi

    # Step 3: Remove legacy standalone skills (now bundled in plugin)
    LEGACY_SKILLS=("agent-messaging" "planning" "ai-maestro-agents-management" "team-governance")
    REMOVED_COUNT=0

    for skill in "${LEGACY_SKILLS[@]}"; do
        if [ -d ~/.claude/skills/"$skill" ]; then
            # Back up before removing (safety)
            mv ~/.claude/skills/"$skill" ~/.claude/skills/"$skill".legacy-"$(date +%Y%m%d%H%M%S)" 2>/dev/null
            print_info "Migrated standalone skill to legacy backup: $skill"
            REMOVED_COUNT=$((REMOVED_COUNT + 1))
        fi
    done

    if [ "$REMOVED_COUNT" -gt 0 ]; then
        print_success "Migrated $REMOVED_COUNT standalone skills to .legacy backups"
        print_info "These skills are now provided by the $PLUGIN_NAME plugin"
        print_info "Legacy backups can be removed after verifying the plugin works"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# OPTIONAL: code-analysis tooling (TRDD-ZFHY7UGU)
#
# tldr (deliberate READ CLI) + fastedit (deliberate AST WRITE CLI) +
# distill (generic output-compression pipe). The dedicated installer is
# FAIL-SOFT (a failure here never aborts the ai-maestro install).
# ═══════════════════════════════════════════════════════════════
TOOLING_INSTALLER="$SCRIPT_DIR/scripts/install-code-analysis-tooling.sh"
if [ -f "$TOOLING_INSTALLER" ]; then
    echo ""
    INSTALL_TOOLING=false
    TOOLING_ARGS=(-y)
    if [ "$NON_INTERACTIVE" = true ]; then
        # Non-interactive: install the CLIs, but never the 3GB model, never force cargo.
        INSTALL_TOOLING=true
        print_info "Non-interactive mode: installing code-analysis tooling (no model, no source build)..."
    else
        echo "🔎 Code-analysis tooling: tldr, fastedit, distill"
        read -r -p "   Install now? (y/N): " TOOLING_CHOICE
        case "$TOOLING_CHOICE" in
            [Yy]*)
                INSTALL_TOOLING=true
                read -r -p "   Also download the ~3GB fastedit local merge model? (y/N): " TOOLING_MODEL
                case "$TOOLING_MODEL" in
                    [Yy]*) TOOLING_ARGS=(-y --with-model) ;;
                esac
                ;;
            *)
                print_info "Skipping code-analysis tooling (install later: scripts/install-code-analysis-tooling.sh)"
                ;;
        esac
    fi

    if [ "$INSTALL_TOOLING" = true ]; then
        # Fail-soft: tooling install must NEVER abort the ai-maestro install.
        bash "$TOOLING_INSTALLER" "${TOOLING_ARGS[@]}" \
            || print_warning "Code-analysis tooling install returned non-zero (continuing)"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# OPTIONAL: AgentlensPro observability CLI (TRDD-WF0UE9BC, USER mandate)
#
# `agentlenspro` npm CLI — machine-scope agent observability (burn/cost
# forensics, OTEL ingest), an official ai-maestro dependency consumed by the
# janitor (ai-maestro-janitor#78). The dedicated installer is FAIL-SOFT (a
# failure here NEVER aborts the ai-maestro install), idempotent, and no-ops
# cleanly until the pinned 2.8.0 floor is published to npm (owner-gated).
# ═══════════════════════════════════════════════════════════════
AGENTLENS_INSTALLER="$SCRIPT_DIR/scripts/install-agentlens.sh"
if [ -f "$AGENTLENS_INSTALLER" ]; then
    if [ "$NON_INTERACTIVE" = true ]; then
        bash "$AGENTLENS_INSTALLER" -y \
            || print_warning "AgentlensPro install returned non-zero (continuing)"
    else
        bash "$AGENTLENS_INSTALLER" \
            || print_warning "AgentlensPro install returned non-zero (continuing)"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# Tailscale readiness CHECK (task #84)
#
# Remote access to the dashboard is localhost + Tailscale ONLY — server.mjs
# binds :: and drops every non-loopback, non-tailnet peer at the TCP level
# (isAllowedSource in lib/tailscale-detect.mjs). So on a host that will be
# reached from a phone or an iPad, a broken Tailscale setup is not a missing
# nicety, it is the whole remote-access story failing — and until now the
# installer never mentioned Tailscale at all, leaving the user to discover
# scripts/setup-tailscale.sh on their own.
#
# This CHECKS and never installs. Installing a VPN daemon is a system-level
# change that needs the user's consent and an interactive login (macOS opens
# the Tailscale app; Linux needs `sudo tailscale up`), so doing it from an
# unattended installer would be both rude and useless — the daemon would sit
# there unauthenticated. `--check` is passed explicitly, which the script now
# honours as "make no changes".
#
# FAIL-SOFT and advisory: a host that is only ever used at the keyboard needs
# no tailnet, so a non-zero result must never abort or fail the install.
# ═══════════════════════════════════════════════════════════════
TAILSCALE_SETUP="$SCRIPT_DIR/scripts/setup-tailscale.sh"
if [ -f "$TAILSCALE_SETUP" ]; then
    echo ""
    if ! command -v tailscale &> /dev/null; then
        print_info "Tailscale not installed — the dashboard will be reachable at localhost only."
        print_info "For phone/iPad/remote access: https://tailscale.com/download, then"
        print_info "  bash scripts/setup-tailscale.sh"
    else
        # mktemp, not a $$-derived name: a predictable /tmp path can be
        # pre-created as a symlink, and `>` follows symlinks.
        TS_LOG=$(mktemp "${TMPDIR:-/tmp}/aim-tailscale-check.XXXXXX")
        if bash "$TAILSCALE_SETUP" --check > "$TS_LOG" 2>&1; then
            TS_ADDR=$(tailscale ip -4 2>/dev/null | head -1 || echo "")
            print_success "Tailscale ready — dashboard reachable at http://${TS_ADDR:-<tailscale-ip>}:23000"
        else
            print_warning "Tailscale is installed but not ready for remote access."
            # Surface the actual failing lines rather than a bare "it failed" —
            # the fix differs completely between "logged out" and "no tailnet
            # address". The log is written in full FIRST and read after, never
            # piped through head while being written.
            grep -E "ERROR|WARN" "$TS_LOG" 2>/dev/null | head -5 | sed 's/^/  /' || true
            print_info "Details: bash scripts/setup-tailscale.sh"
        fi
        rm -f "$TS_LOG"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# Set up ALL local marketplaces (R20.3 per-client layout; R20.28 patterns)
#
# Delegated to scripts/setup-local-marketplaces.sh — the same pattern this
# block already used for migrate-r20-disk-layout.sh (which that script now
# runs as its own step 0) and install-code-analysis-tooling.sh. Extracted
# 2026-07-30 so R20.28 could be PINNED: the rule is a claim about what the
# installer puts on disk, and proving it means running the code with $HOME
# redirected — which is not possible for a 1,386-line installer that also
# shells out to `claude`, cargo/npm, and ~/.local/bin.
# ═══════════════════════════════════════════════════════════════
MARKETPLACE_SETUP="$SCRIPT_DIR/scripts/setup-local-marketplaces.sh"
if [ -f "$MARKETPLACE_SETUP" ]; then
    bash "$MARKETPLACE_SETUP"
else
    print_error "Missing $MARKETPLACE_SETUP — local marketplaces NOT set up"
    exit 1
fi

echo ""
echo "🧪 Verifying installation..."
echo ""

# Verify AMP scripts
if [ "$INSTALL_SCRIPTS" = true ]; then
    print_info "Checking AMP scripts..."

    AMP_SCRIPTS=("amp-init.sh" "amp-identity.sh" "amp-send.sh" "amp-inbox.sh" "amp-read.sh" "amp-reply.sh" "amp-status.sh" "amp-register.sh" "amp-fetch.sh" "amp-delete.sh")
    SCRIPTS_OK=true

    for script in "${AMP_SCRIPTS[@]}"; do
        if [ -x ~/.local/bin/"$script" ]; then
            print_success "$script"
        else
            print_error "$script not found"
            SCRIPTS_OK=false
        fi
    done

    if [ "$SCRIPTS_OK" = false ]; then
        print_warning "Some AMP scripts were not installed correctly"
    fi

    echo ""
    if command -v amp-init.sh &> /dev/null; then
        print_success "AMP scripts accessible in PATH"
    else
        print_warning "Restart terminal or run: source ~/.zshrc (or ~/.bashrc)"
    fi

    # Verify AID scripts explicitly (they were previously only installed by the generic *.sh loop).
    echo ""
    print_info "Checking AID scripts..."

    AID_SCRIPTS=("aid-init.sh" "aid-auth.sh" "aid-token.sh" "aid-register.sh" "aid-status.sh" "aid-maestro-token.sh" "aid-helper.sh")
    AID_OK=true

    for script in "${AID_SCRIPTS[@]}"; do
        if [ -x ~/.local/bin/"$script" ]; then
            print_success "$script"
        else
            # AID scripts may not be present in every installation snapshot.
            # Distinguish "script exists in source" from "failed to install".
            if [ -f "$SCRIPTS_DIR/$script" ]; then
                print_error "$script not installed (source exists at $SCRIPTS_DIR/$script)"
                AID_OK=false
            else
                print_info "$script not in source tree — skipping"
            fi
        fi
    done

    if [ "$AID_OK" = false ]; then
        print_warning "Some AID scripts were not installed correctly"
    fi

    # Verify the control-plane scripts (TRDD-280DF70U). Like the AID scripts,
    # these ride the generic globs above (`amp-*.sh` and `*.sh`) rather than an
    # explicit copy list, so a rename or a permission failure would install
    # NOTHING and say NOTHING. These are the decoupling layer the janitor and
    # every governance agent call instead of the HTTP API — a silent miss here
    # means the agent falls back to nothing at all, so check them by name.
    echo ""
    print_info "Checking AI Maestro control-plane scripts..."

    CONTROL_SCRIPTS=(
        "aimaestro-session.sh"    # inject / slash / state / prompt / queue
        "aimaestro-panel.sh"      # dashboard HTML side panel
        "aimaestro-trdd.sh"       # TRDD search / read / edit / lifecycle
        "aimaestro-portfolio.sh"  # mint / list / VERIFY / revoke approval+mandate tokens
        "amp-kanban-get.sh"       # read one kanban task
        "amp-kanban-edit.sh"      # full-field kanban task edit
    )
    CONTROL_OK=true

    for script in "${CONTROL_SCRIPTS[@]}"; do
        if [ -x ~/.local/bin/"$script" ]; then
            print_success "$script"
        else
            if [ -f "$SCRIPTS_DIR/$script" ]; then
                print_error "$script not installed (source exists at $SCRIPTS_DIR/$script)"
                CONTROL_OK=false
            else
                print_info "$script not in source tree — skipping"
            fi
        fi
    done

    if [ "$CONTROL_OK" = false ]; then
        print_warning "Some control-plane scripts were not installed correctly"
    fi
fi

# Verify plugin installation
if [ "$INSTALL_SKILL" = true ]; then
    echo ""
    print_info "Checking AI Maestro plugin..."

    # Check if the plugin appears in claude plugin list
    if claude plugin list 2>/dev/null | grep -q "${MAIN_PLUGIN_NAME:-ai-maestro-plugin}@${MARKETPLACE_NAME:-ai-maestro-plugins}"; then
        print_success "ai-maestro-plugin installed and enabled"
    else
        print_warning "ai-maestro-plugin not found in plugin list (may need /reload-plugins)"
    fi

    # Verify no standalone skills remain (they should have been migrated)
    STANDALONE_REMAINING=0
    for skill in agent-messaging planning ai-maestro-agents-management team-governance; do
        if [ -d ~/.claude/skills/"$skill" ]; then
            print_warning "Standalone skill still exists: $skill (should use plugin version)"
            STANDALONE_REMAINING=$((STANDALONE_REMAINING + 1))
        fi
    done
    if [ "$STANDALONE_REMAINING" -eq 0 ]; then
        print_success "No standalone skill conflicts — all skills provided by plugin"
    fi
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                     Installation Complete!                     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Show next steps
echo -e "${CYAN}📚 Getting Started with AMP${NC}"
echo ""

if [ "$INSTALL_SCRIPTS" = true ]; then
    echo "1️⃣  Initialize your agent identity (first time only):"
    echo ""
    echo "   $ amp-init.sh --auto"
    echo ""
    echo "2️⃣  Send a message to another agent:"
    echo ""
    echo "   $ amp-send.sh alice \"Hello\" \"How are you?\""
    echo ""
    echo "3️⃣  Check your inbox:"
    echo ""
    echo "   $ amp-inbox.sh"
    echo ""
    echo "4️⃣  Read a message:"
    echo ""
    echo "   $ amp-read.sh <message-id>"
    echo ""
fi

if [ "$INSTALL_SKILL" = true ]; then
    echo "5️⃣  Or use slash commands and natural language with Claude Code:"
    echo ""
    echo "   > /amp-send alice \"Hello\" \"How are you?\""
    echo "   > /amp-inbox"
    echo "   > \"Check my messages\""
    echo "   > \"Send a message to backend-api about the deployment\""
    echo ""
fi

echo "📖 Documentation:"
echo ""
echo "   AMP Protocol: https://agentmessaging.org"
echo "   AI Maestro:   https://github.com/23blocks-OS/ai-maestro"
echo ""

# External provider registration (optional)
echo -e "${CYAN}🌐 Optional: Connect to External Providers${NC}"
echo ""
echo "   To send messages to agents outside your local network:"
echo ""
echo "   $ amp-register.sh --provider crabmail.ai --tenant mycompany"
echo ""

if [ "$INSTALL_SCRIPTS" = true ] && ! command -v amp-init.sh &> /dev/null; then
    echo ""
    print_warning "Remember to restart your terminal or run: source ~/.zshrc (or ~/.bashrc)"
fi

echo ""
echo "🎉 Happy agent messaging!"
echo ""
