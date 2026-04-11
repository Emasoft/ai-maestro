/**
 * AI Maestro State-Path Helpers (.mjs runtime copy)
 *
 * Server-only state directory helpers usable from .mjs/.cjs runtime files
 * (server.mjs, scripts/*.mjs) that cannot import .ts directly.
 *
 * Previously named ecosystem-constants.mjs — renamed to ecosystem-state-paths
 * because the old name clashed with webpack's resolution of the .ts
 * ecosystem-constants (webpack resolved `@/lib/ecosystem-constants` to the
 * .mjs file which had only 3 exports, causing TITLE_PLUGIN_MAP and every
 * other .ts-only export to appear undefined at runtime).
 *
 * Rule: STATE_DIR_NAME is duplicated here to avoid any circular import; keep
 * in sync with ecosystem-constants.ts::STATE_DIR_NAME.
 */

import { homedir } from 'os'
import { join } from 'path'

/** Name of the AI Maestro state directory (under $HOME). SOLE source of truth. */
export const STATE_DIR_NAME = '.aimaestro'

/** Absolute path to ~/.aimaestro */
export function getStateDir() {
  return join(homedir(), STATE_DIR_NAME)
}

/** Path helper for a sub-path inside the state dir */
export function statePath(...segments) {
  return join(getStateDir(), ...segments)
}
