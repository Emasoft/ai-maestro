/**
 * AI Maestro Ecosystem Constants (.cjs runtime copy)
 *
 * CommonJS sibling of lib/ecosystem-constants.ts, usable from .cjs hook scripts
 * that cannot easily import ESM. All three copies (.ts, .mjs, .cjs) must agree
 * on STATE_DIR_NAME.
 */

const { homedir } = require('os')
const { join } = require('path')

/** Name of the AI Maestro state directory (under $HOME). SOLE source of truth. */
const STATE_DIR_NAME = '.aimaestro'

/** Absolute path to ~/.aimaestro */
function getStateDir() {
  return join(homedir(), STATE_DIR_NAME)
}

/** Path helper for a sub-path inside the state dir */
function statePath(...segments) {
  return join(getStateDir(), ...segments)
}

module.exports = { STATE_DIR_NAME, getStateDir, statePath }
