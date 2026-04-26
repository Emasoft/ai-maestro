# TRDD-e5aae555-1090-4fbf-ab4b-1ac99f82486c — Haephestos ephemeral-session hardening

**TRDD ID:** `e5aae555-1090-4fbf-ab4b-1ac99f82486c`
**Filename:** `design/tasks/TRDD-e5aae555-1090-4fbf-ab4b-1ac99f82486c-haephestos-ephemeral.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started
**Created:** 2026-04-20
**Owner:** TBD
**Priority:** P1 — locks in guarantees that already mostly exist, gates Haephestos visibility on client availability, and removes surprise when Claude CLI is missing.

## 1. Problem statement — verbatim user directive

> "haephestos folder must be deleted and cleaned up after each session, because its ~/agents/haephestos/ folder ends being filled with artifacts and tentative plugins. only the folder can remain, but its content must be gone. Also haephestos needs no memory of previous sessions. The client must be called without the --continue option, so it is always fresh."

> "haephestos is only available for claude client for now. if claude client is not available in the system, haephestos must not appear in the helpers agents section of the left panel."

## 2. Current-state inventory (verified)

### 2.1 Session cleanup — ALREADY purges

`app/api/agents/creation-helper/cleanup/route.ts` (verified via `/tmp/investigation-ui-and-uninstall.md` Area 2):
```
POST /api/agents/creation-helper/cleanup
→ Kills tmux session '_aim-creation-helper'
→ rm ~/agents/haephestos/              (entire workdir)
→ rm ~/.claude/projects/-Users-...-agents-haephestos/    (Claude cache / history)
→ mkdir ~/agents/haephestos/           (recreate empty)
```

**Gap (minor):** this removes AND RECREATES the folder. The user says "only the folder can remain, but its content must be gone". Current behaviour is slightly different: it deletes the folder, then re-creates it empty. Net effect is the same on the filesystem (empty folder exists) — but an observer watching the folder via filesystem events sees a delete+recreate vs an in-place purge. Functionally equivalent. Keep current behaviour; no change needed.

**Gap (moderate):** no regression test. If cleanup regresses (e.g. a forgotten `preserveArtifacts` branch is added), nothing catches it.

### 2.2 Launch — already has no `--continue`

`services/creation-helper-service.ts:480-495` + grep confirmed: the launch command is `claude --agent haephestos-creation-helper --model sonnet --tools ... --permission-mode ...` — no `--continue` flag. Confirms the investigation.

**Gap (minor):** no explicit test "launch cmd must not include --continue". A contributor could add it later and break the invariant silently.

### 2.3 HELPERS rendering — no `which claude` gate

`components/AgentList.tsx:904-925` (normal mode) + `:1028-1050` (compact mode) always render the Haephestos purple card. Clicking it calls `POST /api/agents/creation-helper/session` which eventually runs `claude ...` in tmux. If `claude` isn't on PATH, the tmux window opens with a shell error.

**Gap (major from UX perspective):** no precondition check → cryptic failure on machines without Claude Code installed.

## 3. Scope — ADD vs PRESERVE vs NOT TOUCH

### ADD

**3.1 Client-availability endpoint**

- New `GET /api/system/client-availability?client=claude` (and for `codex`, `gemini`, `opencode`, `kiro` — general-purpose, not claude-specific).
- Implementation: `execFileSync('which', [client])` with `try/catch`. Returns `{ client, available: boolean, path?: string, version?: string }`.
- Cache result in a hook at the client layer for the duration of a session (one check per page load).
- Not classified strict — no sudo required.

**3.2 HELPERS gate in AgentList**

- New hook: `useClientAvailability(client: string)` → `{ available, loading }`.
- In `components/AgentList.tsx`, compute `claudeAvailable = useClientAvailability('claude')`.
- When `claudeAvailable === false`:
  - Normal mode: hide the Haephestos card (user requested "must not appear").
  - Compact mode: same.
- When loading: show skeleton/placeholder.
- When `true`: render as today.

**3.3 Launch guardrail test**

- New test `tests/haephestos-launch.test.ts`:
  - Invoke a dry-run of the launch-cmd builder (extract it into a pure function if it isn't already).
  - Assert `--continue` is NOT present in the args array.
  - Assert `--agent haephestos-creation-helper` IS present.
  - Assert `MODEL` is set to something sane.

**3.4 Cleanup regression test**

- New test `tests/haephestos-cleanup.test.ts`:
  - Pre-seed `~/agents/haephestos/fakeartifact.txt`.
  - Call the cleanup route.
  - Assert `~/agents/haephestos/` exists and is empty.
  - Assert the tmux session is gone.
  - (May need sandboxing — see §7 Risks.)

**3.5 Persona-doc update**

- Update `agents/haephestos-creation-helper.md` (or `.claude/agents/haephestos-creation-helper.md`, wherever it lives) to explicitly state:
  - "Sessions are ephemeral. Previous content is wiped at the start of every session."
  - "No --continue flag is ever used."
  - "No cross-session memory. Every session starts fresh."
- Purpose: persona reads its own .md at session start; this becomes explicit context for the model.

### PRESERVE

- Everything the cleanup route currently does (delete + recreate).
- The launch command in `creation-helper-service.ts`.
- The tmux session name `_aim-creation-helper`.
- Rule-0 Haephestos exception (SCEN-004 may legitimately touch this agent).

### NOT TOUCH

- The 8-step creation protocol in the persona.
- The embedded HaephestosEmbeddedView component.
- File-picker API routes.
- Watchdog / heartbeat machinery.

## 4. Design

### 4.1 Client-availability endpoint

```typescript
// app/api/system/client-availability/route.ts
import { execFileSync } from 'child_process'
export async function GET(req: NextRequest) {
  const client = new URL(req.url).searchParams.get('client') ?? 'claude'
  if (!/^[a-z][a-z0-9-]*$/.test(client)) {
    return NextResponse.json({ error: 'invalid client' }, { status: 400 })
  }
  try {
    const path = execFileSync('which', [client], { encoding: 'utf8' }).trim()
    let version: string | undefined
    try {
      version = execFileSync(client, ['--version'], { encoding: 'utf8', timeout: 2000 }).trim()
    } catch { /* version optional */ }
    return NextResponse.json({ client, available: true, path, version })
  } catch {
    return NextResponse.json({ client, available: false })
  }
}
```

### 4.2 Hook

```typescript
// hooks/useClientAvailability.ts
export function useClientAvailability(client: string) {
  const [state, setState] = useState<{ available: boolean | null; version?: string }>({ available: null })
  useEffect(() => {
    fetch(`/api/system/client-availability?client=${encodeURIComponent(client)}`)
      .then(r => r.json())
      .then(d => setState({ available: !!d.available, version: d.version }))
      .catch(() => setState({ available: false }))
  }, [client])
  return state
}
```

### 4.3 AgentList gate

```typescript
// components/AgentList.tsx (normal mode)
const { available: claudeAvailable } = useClientAvailability('claude')
// ...
{claudeAvailable === true && (
  <section className="helpers-section">
    <button className="purple-card" ...>Haephestos</button>
  </section>
)}
// compact mode: same conditional
```

When `null` (loading): render nothing (avoid flash). When `false`: render nothing (hide permanently for this session).

## 5. Files to change

| File | Change |
|---|---|
| `app/api/system/client-availability/route.ts` (new) | GET endpoint |
| `hooks/useClientAvailability.ts` (new) | Client-side hook |
| `components/AgentList.tsx` | Gate Haephestos card on `claudeAvailable===true` (both normal + compact) |
| `agents/haephestos-creation-helper.md` (or wherever it lives) | Doc update: ephemeral, no --continue, no cross-session memory |
| `tests/haephestos-launch.test.ts` (new) | Regression test for launch args |
| `tests/haephestos-cleanup.test.ts` (new) | Regression test for cleanup behaviour |

Estimated LOC: ~200 added + ~20 modified.

## 6. Verification

1. **Unit tests**: launch test + cleanup test per §3.3/3.4.
2. **E2E smoke** on machine WITH Claude: HELPERS section shows Haephestos card; click works.
3. **E2E smoke** on machine WITHOUT Claude: HELPERS section hides the card entirely.
4. **Regression scenario**: SCEN-004 runs as before with cleanup preserving the "purge → recreate" semantics.
5. **Persona-doc verification**: grep for "continue" in persona .md returns zero matches; grep for "ephemeral" and "fresh" returns the new doc paragraphs.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Client-availability check runs on every render | Hook caches via useEffect with `client` dep; one check per mount. |
| `execFileSync('which', ...)` triggers security hook or guard | Use `execFileSync` with explicit argv (no shell interpolation); regex-validate client name. |
| Test for cleanup requires real fs writes | Sandbox via `/tmp/haephestos-test-<pid>/` with mocked HOME; restore HOME in teardown. |
| Machine has `claude` as a user alias but not PATH | `which` handles PATH only. If alias-only, Haephestos won't appear. Acceptable trade-off. |
| Codex/Gemini/Kiro users lose Haephestos | Directive explicit: "Claude only for now". Future expansion is a separate TRDD. |
| User installs Claude mid-session | Availability is cached; user must refresh page. Document in persona + session-start message. |

## 8. Dependencies

- None. This TRDD ships independently.

## 9. Out of scope (each becomes a derived task — see §10)

- Haephestos for other clients (Codex adapter, Gemini adapter). Future TRDD when needed.
- Real-time availability refresh (websocket → UI). Cache-one-per-session is enough.
- Client-version-change detection ledger entry (covered by TRDD-7123d51a-derived #242 system-level tracker).

## 10. Derived tasks (created 2026-04-20)

- `#244` Phase 0.D-derived — Haephestos for non-Claude clients (Codex, Gemini, Kiro adapters) when future need arises.
- `#245` Phase 0.D-derived — Smarter availability: if user installs Claude mid-session, refresh HELPERS without reload (websocket push from system-level tracker).

## 11. Tracked in session todo list

Todo item `#209`. UUID `e5aae555-1090-4fbf-ab4b-1ac99f82486c` links back.
