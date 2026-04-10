/**
 * AI Maestro Ecosystem Constants (.mjs runtime copy)
 *
 * This is the runtime-JS sibling of lib/ecosystem-constants.ts, usable from
 * server.mjs and other .mjs/.cjs runtime files that cannot import .ts directly.
 *
 * Both files MUST agree on STATE_DIR_NAME. Any change to the .ts version must
 * be mirrored here and vice versa.
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
