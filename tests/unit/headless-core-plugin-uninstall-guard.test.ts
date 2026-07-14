/**
 * R17.14 — the core ai-maestro-plugin can NEVER be uninstalled via the API, in EITHER
 * serving mode. (governance audit, 2026-07-14.)
 *
 * THE BUG: full mode enforces R17.14 in ChangePlugin G01b, but the headless
 * `DELETE /api/agents/role-plugins/install` handler deliberately bypasses ChangePlugin and
 * calls `uninstallPluginLocally(body.pluginName, …)` directly — a helper that only validates
 * the name regex and a `..` path check, with NO core-plugin guard. So an already-authorized
 * MANAGER in `MAESTRO_MODE=headless` could uninstall the core plugin and strip its key. The
 * invariant held in one serving mode and not the other — the exact class the audit exists to
 * catch: headless reimplements the handler and drops a guard the full-mode twin has.
 *
 * THE FIX: the headless handler now refuses when `isCorePlugin(pluginName, marketplaceName)`,
 * before the uninstall runs — mirroring G01b at the same "uninstall this plugin" API surface.
 * It is placed at the ROUTE, not inside `uninstallPluginLocally`, on purpose: that helper is
 * also called by ChangeClient (R18), which LEGITIMATELY uninstalls the old-client core plugin
 * while re-emitting it for the new client. An unconditional block in the helper would break
 * client conversion; the invariant belongs to the uninstall INTENT, which is this route.
 *
 * THE TEST: the guard's whole decision is `isCorePlugin(pluginName, marketplaceName)`, so this
 * pins that predicate for exactly the inputs the handler feeds it. A happy-path route test
 * would need a real cryptographic token to get past auth (the guard fires AFTER authorize),
 * and would prove less: this asserts the decision function itself, so any weakening of
 * isCorePlugin — the one thing that would silently re-open R17.14 in headless — turns red.
 */
import { describe, it, expect } from 'vitest'
import { isCorePlugin, MAIN_PLUGIN_NAME, MARKETPLACE_NAME } from '@/lib/ecosystem-constants'

describe('R17.14 headless uninstall guard — isCorePlugin, the predicate the guard fires on', () => {
  it('the core plugin, no marketplace given (the common headless body) → GUARDED', () => {
    // The DELETE handler passes body.marketplaceName, which is optional and usually absent.
    // isCorePlugin must then decide on the NAME alone — and it must say yes, or the guard
    // never fires and R17.14 is unenforced in headless again.
    expect(isCorePlugin(MAIN_PLUGIN_NAME)).toBe(true)
    expect(isCorePlugin('ai-maestro-plugin')).toBe(true)
  })

  it('the core plugin from its canonical marketplace → GUARDED', () => {
    expect(isCorePlugin(MAIN_PLUGIN_NAME, MARKETPLACE_NAME)).toBe(true)
  })

  it('a third-party plugin coincidentally named ai-maestro-plugin → NOT guarded (correctly)', () => {
    // R17.14 protects OUR core plugin, not any plugin that happens to share the name. A
    // same-named plugin from a different marketplace is a different artifact; blocking it
    // would be wrong. This is the nuance a bare string compare (G01b's `name === '…'`) misses
    // and isCorePlugin gets right — which is why the headless guard uses the helper.
    expect(isCorePlugin('ai-maestro-plugin', 'some-third-party/marketplace')).toBe(false)
  })

  it('an ordinary role-plugin → NOT guarded (a legitimate uninstall still works)', () => {
    // The guard must not become a blanket "no uninstalls" — a real MANAGER uninstalling a
    // normal role-plugin in headless must still reach uninstallPluginLocally.
    expect(isCorePlugin('ai-maestro-programmer-agent')).toBe(false)
    expect(isCorePlugin('some-custom-plugin', MARKETPLACE_NAME)).toBe(false)
  })
})
