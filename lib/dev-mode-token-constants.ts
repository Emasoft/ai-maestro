/**
 * Client-safe constants for the dev-mode login token (TRDD-A9335BZ6).
 *
 * WHY THIS FILE IS SEPARATE FROM `lib/dev-mode-token.ts`, and why moving these
 * two lines back into it breaks the production build:
 *
 * `SecuritySection.tsx` is a CLIENT component and needs the env-var NAME so the
 * panel renders the exact line the owner pastes into `.env.local` — taking it
 * from an export rather than hardcoding it is what stops the UI and the CLI
 * drifting. But importing a constant imports its whole MODULE GRAPH, and
 * `dev-mode-token.ts` → `governance.ts` → `agent-registry.ts` → `fs`,
 * `child_process`. Webpack then fails the client bundle with `Module not found:
 * Can't resolve 'fs'` and the entire settings page stops building.
 *
 * `tsc --noEmit` is GREEN on that arrangement — types resolve fine; it is the
 * bundler that objects. So a type-check is not evidence a client component's
 * imports are safe; only `yarn build` is.
 *
 * This module must therefore stay import-free. `dev-mode-token.ts` re-exports
 * both names so server callers and their tests are unchanged.
 */

/** Every dev token starts with this. Owner-facing, so it is greppable in a .env file. */
export const DEV_TOKEN_PREFIX = 'am-'

/** The name the owner writes in `.env.local`. Shared so the UI and the CLI cannot drift. */
export const DEV_TOKEN_ENV_NAME = 'AI_MAESTRO_DEV_MODE_TOKEN'
