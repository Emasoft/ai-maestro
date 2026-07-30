// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PluginsTab from '@/components/agent-profile/PluginsTab'
import type { AgentLocalConfig, LocalPlugin } from '@/types/agent-local-config'

// ENVIRONMENT, not guards. `PluginsTab` calls `useRouter()` at the top of its body, which throws
// "invariant expected app router to be mounted" outside a Next.js app tree, and `useSudo()` for
// the uninstall flow. Neither participates in the branch under test — the ternary reads only
// `p.name` — and stubbing them is what lets the component render at all. The uninstall HANDLER is
// never invoked here: the rule is about whether the CONTROL is offered, not about what it does.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/contexts/SudoContext', () => ({ useSudo: () => ({ requestSudoToken: async () => null }) }))

/**
 * `components/agent-profile/PluginsTab.tsx:244-245` — R17.16.
 *
 * "The dashboard UI MUST NOT show an uninstall button (X icon) on the `ai-maestro-plugin` in the
 * Config tab's Plugins section. Instead, it MUST show a **core** label indicating the plugin is a
 * protected system component."
 *
 * TWO CLAUSES, ONE TERNARY, AND BOTH HALVES MATTER
 * ------------------------------------------------
 * The rule is a prohibition (`MUST NOT show X`) AND a requirement (`MUST show "core"`), and both
 * are decided by the same `p.name === 'ai-maestro-plugin' ? <core> : <buttons>` branch. Asserting
 * only the label would pass against a UI that showed the label AND kept the X — which is the exact
 * failure the rule forbids, since the operator would then uninstall the core plugin and break R17
 * for that agent. Asserting only the missing X would pass against a plugin row that rendered
 * nothing at all, leaving the operator unable to tell a protected plugin from a broken one.
 *
 * The ordinary-plugin case is the third leg: without it, both assertions above are satisfied by a
 * component that shows "core" and hides the uninstall for EVERY plugin — which would make the
 * whole Plugins section read-only and is a far louder bug than the one being prevented.
 *
 * WHY A `.tsx` GUARD IS CORRECT AND COMPLETE HERE
 * ----------------------------------------------
 * R17.16 is a PRESENTATION rule — it constrains what the dashboard SHOWS, not what the server
 * permits. The server-side protection is R17's own uninstall refusal in the element-management
 * pipeline and carries its own row; this rule exists so the operator is never offered an action
 * the server would refuse. "A check in a client is no check" governs AUTHORIZATION, where the
 * route is curl-able; it does not mean a rule about the UI can be pinned anywhere but the UI.
 *
 * NEUTER RECORD (2026-07-30):
 *   A. drop the `p.name === 'ai-maestro-plugin'` branch (core plugin falls through to the buttons)
 *      -> "hides the uninstall button …" AND "shows a core label …" fail (2 of 3).
 *   B. make the branch unconditional (`true ?`) so every plugin renders the core label
 *      -> ONLY "still offers uninstall on an ORDINARY plugin" fails (1 of 3).
 * B is what proves the third leg is load-bearing: A alone leaves "the section became read-only"
 * undetected.
 */

const CORE_PLUGIN_NAME = 'ai-maestro-plugin'

function makePlugin(name: string): LocalPlugin {
  return {
    name,
    key: `${name}@ai-maestro-plugins`,
    path: `/fake/plugins/${name}`,
    description: `${name} description`,
    version: '1.0.0',
    marketplace: 'ai-maestro-plugins',
    enabled: true,
  }
}

function makeConfig(plugins: LocalPlugin[]): AgentLocalConfig {
  return {
    workingDirectory: '/fake/agents/tester',
    skills: [],
    agents: [],
    hooks: [],
    rules: [],
    commands: [],
    mcpServers: [],
    lspServers: [],
    outputStyles: [],
    plugins,
    // null, deliberately: `isRole` is computed as `p.name === config.rolePlugin?.name`, and a
    // rolePlugin set to the core plugin would short-circuit the branch under test through the
    // role badge instead — proving the wrong ternary arm.
    rolePlugin: null,
    globalDependencies: null,
    settings: {},
    userGlobalSettings: null,
    keybindings: null,
    lastScanned: new Date(0).toISOString(),
  }
}

function renderTab(plugins: LocalPlugin[]) {
  // agentId is supplied so the Update button renders too — omitting it would hide one of the
  // action buttons for an unrelated reason and weaken the ordinary-plugin control.
  return render(<PluginsTab config={makeConfig(plugins)} agentId="agent-1" />)
}

afterEach(cleanup)

describe('R17.16 — the core plugin is labelled, not uninstallable', () => {
  it('hides the uninstall button on ai-maestro-plugin', () => {
    renderTab([makePlugin(CORE_PLUGIN_NAME)])

    // Queried by ACCESSIBLE NAME rather than by icon or class: the prohibition is about what the
    // operator can ACT ON, and an X that is invisible to a screen reader is still a live control.
    expect(screen.queryByLabelText(`Uninstall ${CORE_PLUGIN_NAME}`)).toBeNull()
  })

  it('shows a core label in its place', () => {
    renderTab([makePlugin(CORE_PLUGIN_NAME)])

    const label = screen.getByText('core')
    expect(label).toBeTruthy()
    // The tooltip is the half that tells the operator WHY the action is missing. Without it the
    // absent button reads as a rendering bug rather than a protection.
    expect(label.getAttribute('title')).toMatch(/cannot be uninstalled/i)
  })

  it('still offers uninstall on an ORDINARY plugin', () => {
    // The third leg. Both assertions above are also satisfied by a component that labels every
    // plugin "core" and hides every uninstall — a read-only Plugins section, which is a louder
    // bug than the one R17.16 prevents.
    renderTab([makePlugin('some-other-plugin')])

    expect(screen.getByLabelText('Uninstall some-other-plugin')).toBeTruthy()
    expect(screen.queryByText('core')).toBeNull()
  })
})
