---
name: prompt-provenance-and-the-injection-path
description: "fleet recovery keeps deferring / it says a human is present when nobody is at the keyboard / my queued task or nudge stood recovery down / sendCommand always returns 409 Session is not idle even on a fresh session / requireIdle seems to do nothing / why does the CLI pass require_idle=false / how does the server tell an injected prompt from a typed one"
ocd: 2026-08-05
lmd: 2026-08-05
metadata:
  node_type: memory
  type: project
  tier: component
  topic: agents
---

# prompt-provenance-and-the-injection-path

When the server puts text into an agent's pane it uses tmux
`sendKeys(session, text, { literal: true, enter: true })`. Those bytes are **identical to a human's
typing**, so nothing downstream of the pane can tell them apart. That single fact causes both
problems on this page.

## An injected prompt used to report "a human is present" (ai-maestro#117)

Claude Code's `UserPromptSubmit` hook fires for **every** prompt and POSTs
`/api/sessions/me/user-input`, and `fleet-recovery-runner` reads that record as *a human is at the
keyboard, defer*. Presence is a **single global record**, so one injected prompt stood fleet
recovery down for everyone. No attacker needed — the system forged it.

The hook cannot fix this where it runs; it has no way to know. The **server** knows, because it did
the injecting. So `injectedPrompts: Map<sessionName, epochMs>` lives in `services/shared-state.ts`,
the send sites mark it, and the presence route consumes the mark and vetoes that one echo.

**Three injection surfaces, and the third is not like the other two:**

| surface | marks |
|---|---|
| `services/sessions-service.ts` `sendCommand` | always, after a successful send |
| `services/agents-core-service.ts` `sendAgentSessionCommand` | always, after a successful send |
| `services/agents-chat-service.ts` `sendChatMessage` | **only when the caller says an agent drove it** |

Chat is caller-conditional because the same function serves the **dashboard's chat box**, where a
human really is typing. The discriminator is `auth.agentId` — set for an agent Bearer, undefined for
the human/system-owner cookie — the same one the veto route uses. R42 makes `send-command`
SELF-ONLY for agents, so when it is an agent the marked pane is the caller's own.

**Two invariants that are easy to get backwards:**

- **Veto on POSITIVE evidence only.** No mark ⇒ record presence exactly as before. Inferring
  "not human" from a *missing* mark would make recovery race a live user — the failure the presence
  gate exists to prevent, and strictly worse than the bug it fixes.
- **Consume-once, not a time window.** One injection produces one hook call, so the mark is deleted
  as it is spent. The age cap only discards a mark whose echo never arrived.

**Known gaps** (both named in the code): the mark is a single scalar per session, so it loses the
second of two injections landing before either echo arrives; and the route *guesses* which pane the
echo came from (`online ?? sessions[0]`) while the marks key the pane actually written. Both
dissolve only if the hook forwards its own session name plus a hash of the prompt text — and the
hook lives in a different repo.

## The idle gate refuses everything (ai-maestro#110, #51, #60)

`sendCommand`'s `requireIdle` defaults to **true**, and the gate **can never pass**:

```
sessionActivity.set(sessionName, Date.now())          // the bump
if (requireIdle && !isSessionIdle(sessionName)) 409    // the check, immediately after
// isSessionIdle:  if (!activity) return true
//                 return (Date.now() - activity) > IDLE_THRESHOLD_MS
```

The bump writes `Date.now()` on the line before the check, so elapsed is ~0 and never exceeds the
threshold; the `!activity` early-out cannot rescue even the first call, because the bump already
wrote the entry. **Every call 409s, including the first against a completely fresh session.** Pinned
by a characterisation test that seeds no activity and asserts the map is empty first.

Consequences: the "protect a busy agent" gate protects nothing; the CLI's hardcoded
`require_idle=false` is a **workaround**, not an oversight, so "make the CLI use the server default"
would 409 every injection; and any wake or freeze-recovery path must pass `requireIdle: false` — a
frozen agent is by definition never idle.

## Headless mode has no presence route at all

`POST /api/sessions/me/user-input` exists as a Next route and in **none** of the headless router's
route-table entries, so the hook 404s there: presence is never recorded and the veto is inert. The
bug is absent in that mode too, but the *feature* is missing. Any new presence route must be added
to **both** modes — the headless router keeps its own explicit table, and a route added to one side
only is a recurring defect here.

## See also

- [[session-control-5-state-model]] — the **UI** status model and the safe-state gate (a different
  subject: that page is about what the badge shows, this one about who typed).
- [[two-server-modes-the-headless-router-reimplements-routes]] — why the two-mode split keeps
  producing this class of gap.

## Notes and lessons learned
