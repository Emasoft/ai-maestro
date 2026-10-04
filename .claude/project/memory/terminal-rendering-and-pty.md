---
name: terminal-rendering-and-pty
description: "terminal duplicating every character / convertEol true breaks PTY output / xterm.js not fitting the container / scrollback lost after switching agents / can't scroll back during Claude session / tmux alternate screen buffer capture / xterm.js addon loading order crash / WebGL canvas rendering performance"
ocd: 2026-08-02
lmd: 2026-10-04
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: architecture-and-runtime
publish-globally: false
---

# terminal-rendering-and-pty

xterm.js renders the terminal in the browser, and it must be configured very specifically to
work correctly against a node-pty-backed tmux session running Claude Code — wrong settings here
cause character duplication, broken scrollback, or a terminal that doesn't fit its container.
This page covers rendering performance, the critical PTY/tmux terminal configuration (and why
each setting must be exactly that value), fit-addon usage, and addon load order.

### Terminal Rendering Performance

^U222QZIF [desc: "xterm.js renders via Canvas or WebGL; WebGL improves high-output performance, loaded in try/catch with canvas fallback. Never read terminal content via React state - use xterm APIs.", keywords: xterm_js_webgl_addon_performance canvas_vs_webgl_rendering large_file_dump_terminal_slow never_read_terminal_via_react_state terminal_write_onData_api fallback_to_canvas_webgl_unavailable webgl_addon_try_catch high_output_terminal_performance useTerminal_hook_addon, type: reference, ocd: 2026-08-02, lmd: 2026-10-04]

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

^Z4XFVL2O [desc: "convertEol must be false for PTY: PTY and tmux already handle line endings, so convertEol true re-converts and causes every character to duplicate on a new line.", keywords: convertEol_false_required_pty character_duplication_every_character_new_line terminal_duplicating_every_character line_endings_handled_by_pty_tmux_already convertEol_true_breaks_output why_characters_duplicate_terminal xterm_eol_setting_pty most_common_terminal_bug, type: reference, ocd: 2026-08-02, lmd: 2026-10-04]

1. **`convertEol: false`** - PTY and tmux handle line endings correctly. Setting this to `true` causes character duplication and incorrect line breaks because xterm.js will convert `\n` to `\r\n`, but the PTY has already handled this.

^U0SBTB6Q [desc: "Claude Code uses tmux alternate screen buffer: separate screen from shell history, scrollback from tmux not xterm.js, windowOptions setWinLines true enables it.", keywords: alternate_screen_buffer_claude_code tmux_alternate_screen_scrollback can_t_scroll_back_during_claude_session windowOptions_setWinLines_true claude_uses_separate_screen_buffer scrollback_from_tmux_not_xterm vim_less_alternate_buffer, type: reference, ocd: 2026-08-02, lmd: 2026-10-04]
**IMPORTANT:** The following terminal settings are critical for proper Claude Code CLI behavior:

1. **`convertEol: false`** - PTY and tmux handle line endings correctly. Setting this to `true` causes character duplication and incorrect line breaks because xterm.js will convert `\n` to `\r\n`, but the PTY has already handled this.

2. **Alternate Screen Buffer Support** - Claude Code (like vim, less, etc.) uses tmux's alternate screen buffer. This means:
   - When Claude is active, it uses a separate screen that doesn't mix with your shell history
   - Scrollback must be captured from tmux's buffer, not just xterm.js's buffer
   - The `windowOptions: { setWinLines: true }` setting enables proper alternate buffer support

^9LX9REEW [desc: "Scrollback capture on connect: tmux capture-pane -S -50000 full history, fallback visible-only; lost history after switching agents = capture timeout too short, now 150ms.", keywords: scrollback_capture_strategy_initial_connection tmux_capture-pane_S_50000 lost_history_after_switching_agents history_capture_timeout_150ms scroll_xterm_vs_tmux_copy_mode shift_pageup_terminal_scroll capture_alternate_screen_content can_t_scroll_back_fix fallback_visible_content_capture, type: reference, ocd: 2026-08-02, lmd: 2026-10-04]
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

^OXMN55WW [desc: "Terminal not fitting container: after terminal.open ALWAYS call fitAddon.fit(), and again on window resize; without it dimensions mismatch and scrollbars appear.", keywords: terminal_not_fitting_container fitAddon_fit_after_open terminal_dimensions_mismatch_scrollbars resize_event_refit_terminal ugly_scrollbars_terminal xterm_fit_addon_usage terminal_size_container_mismatch, type: reference, ocd: 2026-08-02, lmd: 2026-10-04]

```typescript
// After terminal.open(container), ALWAYS call:
fitAddon.fit()

// And on window resize:
window.addEventListener('resize', () => fitAddon.fit())
```

Without this, terminal dimensions won't match the container, causing ugly scrollbars.

### xterm.js Addon Loading Order

^WKHJGMNW [desc: "Addon loading order is load-bearing: loadAddon first, then terminal.open(container), then fitAddon.fit(); wrong order crashes or breaks addons.", keywords: xterm_addon_loading_order loadAddon_before_open fit_after_open wrong_addon_order_crashes addon_sequence_fit_open webLinks_addon_load_order terminal_open_then_fit crash_from_wrong_addon_order, type: reference, ocd: 2026-08-02, lmd: 2026-10-04]

```typescript
terminal.loadAddon(fitAddon)       // 1. Load addons first
terminal.loadAddon(webLinksAddon)
terminal.open(container)           // 2. Then open
fitAddon.fit()                     // 3. Then fit
```

Wrong order causes crashes or non-functional addons.

## See also

- [[custom-server-and-websocket-pty]] — the other half of the same subsystem: how the bytes
  this page renders get from tmux to the browser over the WebSocket-PTY bridge.

## Notes and lessons learned
