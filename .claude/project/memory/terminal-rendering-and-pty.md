---
name: terminal-rendering-and-pty
description: "terminal duplicating every character / convertEol true breaks PTY output / xterm.js not fitting the container / scrollback lost after switching agents / can't scroll back during Claude session / tmux alternate screen buffer capture / xterm.js addon loading order crash / WebGL canvas rendering performance"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: architecture-and-runtime
---

# terminal-rendering-and-pty

xterm.js renders the terminal in the browser, and it must be configured very specifically to
work correctly against a node-pty-backed tmux session running Claude Code — wrong settings here
cause character duplication, broken scrollback, or a terminal that doesn't fit its container.
This page covers rendering performance, the critical PTY/tmux terminal configuration (and why
each setting must be exactly that value), fit-addon usage, and addon load order.

### Terminal Rendering Performance

xterm.js uses **Canvas or WebGL** for rendering. The WebGL addon significantly improves performance for high-output scenarios (e.g., large file dumps).

```typescript
// In useTerminal hook
try {
  const webglAddon = new WebglAddon()
  terminal.loadAddon(webglAddon)
} catch (e) {
  // Fallback to canvas if WebGL unavailable
}
```

**Never** read terminal content via React state. Always use xterm.js APIs (`terminal.write()`, `terminal.onData()`).

### Critical Terminal Configuration for PTY/tmux

**IMPORTANT:** The following terminal settings are critical for proper Claude Code CLI behavior:

1. **`convertEol: false`** - PTY and tmux handle line endings correctly. Setting this to `true` causes character duplication and incorrect line breaks because xterm.js will convert `\n` to `\r\n`, but the PTY has already handled this.

2. **Alternate Screen Buffer Support** - Claude Code (like vim, less, etc.) uses tmux's alternate screen buffer. This means:
   - When Claude is active, it uses a separate screen that doesn't mix with your shell history
   - Scrollback must be captured from tmux's buffer, not just xterm.js's buffer
   - The `windowOptions: { setWinLines: true }` setting enables proper alternate buffer support

3. **Scrollback Capture Strategy** - On initial connection, capture both normal and alternate screen content:
   ```bash
   # Try to capture full history (50000 lines)
   tmux capture-pane -t <session> -p -S -50000 -e -1
   # Fallback to visible content only
   tmux capture-pane -t <session> -p
   ```

**Common Issues and Fixes:**

- **Every character creates a new line**: `convertEol` was set to `true` - must be `false` for PTY connections
- **Can't scroll back during Claude session**: Claude Code uses alternate screen buffer - use Shift+PageUp/Down to scroll xterm.js buffer, or tmux copy mode (Ctrl-b [) to access tmux's scrollback
- **Lost history after switching agents**: History capture timeout was too short or tmux session not fully initialized - increased timeout to 150ms

### Terminal Not Fitting Container

```typescript
// After terminal.open(container), ALWAYS call:
fitAddon.fit()

// And on window resize:
window.addEventListener('resize', () => fitAddon.fit())
```

Without this, terminal dimensions won't match the container, causing ugly scrollbars.

### xterm.js Addon Loading Order

```typescript
terminal.loadAddon(fitAddon)       // 1. Load addons first
terminal.loadAddon(webLinksAddon)
terminal.open(container)           // 2. Then open
fitAddon.fit()                     // 3. Then fit
```

Wrong order causes crashes or non-functional addons.

## Notes and lessons learned
