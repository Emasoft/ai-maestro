#!/usr/bin/env node
/**
 * aimaestro-settings-cli.mjs — the node entrypoint behind scripts/aimaestro-settings.sh
 * (TRDD-RYFP030K).
 *
 * Invoked DIRECTLY by the bash wrapper via `node --import <tsx-loader> <this file>` —
 * NEVER over HTTP. The installer runs with the ai-maestro server DOWN, so a CLI that
 * could only talk to `/api/settings/edit` would be useless at install time. This file
 * calls `lib/settings-gate.ts`'s `editSettings` / `readSettings` IN-PROCESS — the
 * identical function `app/api/settings/edit/route.ts` calls — so there is one gate and
 * two thin transports over it (Plugin Abstraction Principle, CLAUDE.md).
 *
 * Usage:
 *   aimaestro-settings.sh get <path>
 *   aimaestro-settings.sh set <path> --key <dot.path> --value <json-or-string> [--no-create]
 *   aimaestro-settings.sh set <path> --key-json '["a","b.with.dots"]' --value <json-or-string>
 *   aimaestro-settings.sh delete <path> --key <dot.path> [--no-create]
 *   aimaestro-settings.sh delete <path> --key-json '["a","b"]' [--no-create]
 *   aimaestro-settings.sh edit <path> --ops '<json array of {"op":"set"|"delete","keyPath":[...],"value"?:...}>' [--no-create]
 *
 * <path> must be an absolute `settings.json` or `settings.local.json` path, living
 * directly inside a ".claude" directory — anything else is refused by
 * `lib/settings-gate.ts`'s `resolveSettingsPath()` before any file is touched.
 *
 * --key <a.b.c> is convenience sugar for a dot-separated key path; a key that itself
 * contains a literal dot needs --key-json '["a","b.c"]' instead — the exact array
 * `applySettingsOps` walks, with no splitting ambiguity.
 *
 * Exit codes: 0 on success (get: only when the file read cleanly), 1 on any refusal or
 * error (message on stderr) — this is a shell-scriptable CLI, not an HTTP transport, so
 * there is no separate "structured failure with a 2xx" concept.
 */
import process from 'process'

const { editSettings, readSettings, InvalidSettingsPathError } = await import('../lib/settings-gate.ts')
const { UnreadableTargetError, ConcurrentModificationError, KeyLossRefused } = await import('../lib/json-io.ts')

/** Print to stderr and exit(1). `process.exit()` terminates the process immediately —
 *  there is no "code after this call still runs" hazard to guard against here. */
function fail(msg) {
  console.error(`Error: ${msg}`)
  process.exit(1)
}

/** CLI values arrive as strings. Prefer the JSON reading (`true` -> boolean, `42` ->
 *  number, `"foo"` -> string, `{"a":1}` -> object) and fall back to the raw string when
 *  it is not valid JSON (`foo` -> the string "foo") — this is what makes `--value true`
 *  and `--value some-plugin-name` both do the obviously-intended thing. */
function parseValue(raw) {
  try { return JSON.parse(raw) } catch { return raw }
}

function keyPathFromArgs(args) {
  if (args['key-json'] !== undefined) {
    let kp
    try { kp = JSON.parse(args['key-json']) } catch { fail('--key-json must be valid JSON') }
    if (!Array.isArray(kp) || kp.length === 0 || !kp.every(k => typeof k === 'string')) {
      fail('--key-json must be a non-empty JSON array of strings')
    }
    return kp
  }
  if (args.key !== undefined) {
    const kp = String(args.key).split('.').filter(s => s.length > 0)
    if (kp.length === 0) fail('--key must not be empty')
    return kp
  }
  fail('one of --key <dot.path> or --key-json \'["a","b"]\' is required')
}

/** A small, fixed flag set — no dependency needed. `--no-create` is the one bare flag;
 *  every other `--name` consumes the following token as its value. */
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (!tok.startsWith('--')) continue
    const name = tok.slice(2)
    if (name === 'no-create') { args['no-create'] = true; continue }
    args[name] = argv[++i]
  }
  return args
}

function showHelp() {
  console.log(`aimaestro-settings.sh — direct, in-process gated settings editor (no HTTP)

Commands:
  get <path>
  set <path> --key <dot.path> --value <json-or-string> [--no-create]
  set <path> --key-json '["a","b"]' --value <json-or-string> [--no-create]
  delete <path> --key <dot.path> [--no-create]
  delete <path> --key-json '["a","b"]' [--no-create]
  edit <path> --ops '<json array of {"op":"set"|"delete","keyPath":[...],"value"?:...}>' [--no-create]

<path> must be an absolute settings.json or settings.local.json path, living directly
inside a ".claude" directory.`)
}

async function main() {
  const [cmd, path, ...rest] = process.argv.slice(2)

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp()
    process.exit(cmd ? 0 : 1)
  }
  if (!path) fail(`${cmd} requires a <path>`)

  const args = parseArgs(rest)
  const createIfMissing = !args['no-create']

  try {
    if (cmd === 'get') {
      const result = await readSettings(path)
      console.log(JSON.stringify(result, null, 2))
      process.exit(result.ok ? 0 : 1)
      return
    }

    let ops
    if (cmd === 'set') {
      if (args.value === undefined) fail('set requires --value <json-or-string>')
      ops = [{ op: 'set', keyPath: keyPathFromArgs(args), value: parseValue(args.value) }]
    } else if (cmd === 'delete') {
      ops = [{ op: 'delete', keyPath: keyPathFromArgs(args) }]
    } else if (cmd === 'edit') {
      if (args.ops === undefined) fail('edit requires --ops \'<json array>\'')
      try { ops = JSON.parse(args.ops) } catch { fail('--ops must be valid JSON') }
    } else {
      fail(`unknown command "${cmd}" — get, set, delete, or edit`)
      return
    }

    const result = await editSettings(path, ops, { createIfMissing })
    console.log(JSON.stringify({ success: true, ...result }, null, 2))
    process.exit(0)
  } catch (err) {
    if (
      err instanceof InvalidSettingsPathError ||
      err instanceof UnreadableTargetError ||
      err instanceof ConcurrentModificationError ||
      err instanceof KeyLossRefused ||
      err instanceof TypeError
    ) {
      fail(err.message)
    }
    throw err
  }
}

await main()
