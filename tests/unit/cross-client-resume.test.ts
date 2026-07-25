/**
 * Cross-client resume syntax (TRDD-D5XDT49I / TRDD-NIU5RQ1S).
 *
 * The USER's requirement: boot-restore is the SAME mechanism for every client, but each client's
 * resume verb has its own syntax. So exactly one thing varies — WHERE the verb goes — and it is
 * pinned here per client, using the verbs the capability table actually declares.
 *
 * Verified-real syntax (lib/client-capabilities.ts):
 *   claude    --continue        FLAG
 *   gemini    -r latest         FLAG  (multi-token)
 *   codex     resume --last     SUBCOMMAND — must precede every other arg
 *   kiro      chat --resume     SUBCOMMAND — and `chat` is ALSO the prefix of its other verbs
 *   opencode  (none)            no resume verb documented
 */
import { describe, it, expect } from 'vitest'
import {
  composeLaunchWithResume,
  isSubcommandVerb,
  isPickerVerb,
  buildLaunchCommand,
  getClientCapabilities,
} from '@/lib/client-capabilities'
import { decideResume, resolveConversationProbe } from '@/lib/claude-conversation'

describe('cross-client resume — verb form classification', () => {
  it('flags are flags and subcommands are subcommands', () => {
    expect(isSubcommandVerb('--continue')).toBe(false)
    expect(isSubcommandVerb('-r latest')).toBe(false)
    expect(isSubcommandVerb('resume --last')).toBe(true)
    expect(isSubcommandVerb('chat --resume')).toBe(true)
  })
})

describe('cross-client resume — the verb lands where that client accepts it', () => {
  const args = '--agent my-persona-main-agent --dangerously-skip-permissions'

  it('claude — flag form, after the binary', () => {
    expect(composeLaunchWithResume('claude', args, '--continue')).toBe(`claude --continue ${args}`)
  })

  it('gemini — multi-token flag stays intact', () => {
    expect(composeLaunchWithResume('gemini', '-y', '-r latest')).toBe('gemini -r latest -y')
  })

  it('codex — the subcommand PRECEDES the args (appending would not run at all)', () => {
    const cmd = composeLaunchWithResume('codex', '-p work --full-auto', 'resume --last')
    expect(cmd).toBe('codex resume --last -p work --full-auto')
    // The bug this prevents: `codex -p work resume --last` is not a valid invocation.
    expect(cmd).not.toMatch(/-p work resume/)
  })

  it('kiro — the shared `chat` subcommand is emitted ONCE', () => {
    const cmd = composeLaunchWithResume('kiro-cli', 'chat --agent my-bot', 'chat --resume')
    expect(cmd).toBe('kiro-cli chat --resume --agent my-bot')
    expect(cmd.match(/\bchat\b/g)).toHaveLength(1)
  })

  it('kiro — args that do NOT repeat `chat` are left alone', () => {
    expect(composeLaunchWithResume('kiro-cli', '--verbose', 'chat --resume')).toBe(
      'kiro-cli chat --resume --verbose',
    )
  })

  it('an empty verb composes an ordinary cold-start command', () => {
    expect(composeLaunchWithResume('opencode', '--foo', '')).toBe('opencode --foo')
    expect(composeLaunchWithResume('opencode', '', '')).toBe('opencode')
  })

  it('no args — just binary and verb', () => {
    expect(composeLaunchWithResume('claude', '', '--continue')).toBe('claude --continue')
  })
})

describe('cross-client resume — driven by the REAL capability table, not fixtures', () => {
  // If someone edits a resume verb in the capability table, these break rather than drifting.
  const cases: Array<[string, string]> = [
    ['claude', 'claude --continue --agent x'],
    ['codex', 'codex resume --last --agent x'],
    ['gemini', 'gemini -r latest --agent x'],
    ['kiro', 'kiro-cli chat --resume --agent x'],
  ]
  it.each(cases)('%s composes to the documented shape', (program, expected) => {
    const verb = getClientCapabilities(program).cli.resume
    const binary = getClientCapabilities(program).cli.binary
    expect(composeLaunchWithResume(binary, '--agent x', verb)).toBe(expected)
  })

  it('opencode composes too (its verb was missing from the table until it was checked)', () => {
    expect(composeLaunchWithResume('opencode', '--foo', getClientCapabilities('opencode').cli.resume)).toBe(
      'opencode --continue --foo',
    )
  })
})

describe('buildLaunchCommand — resume no longer strips the permission flag', () => {
  it('claude keeps --dangerously-skip-permissions while resuming', () => {
    // The old `else if` dropped it, quietly changing the permission posture of every resumed
    // agent — on the recovery path, where nobody is watching.
    const cmd = buildLaunchCommand('claude', { resume: true })
    expect(cmd).toContain('--continue')
    expect(cmd).toContain('--dangerously-skip-permissions')
  })

  it('kiro keeps --trust-all-tools and still says `chat` only once', () => {
    const cmd = buildLaunchCommand('kiro', { resume: true })
    expect(cmd).toContain('--resume')
    expect(cmd).toContain('--trust-all-tools')
    expect(cmd.match(/\bchat\b/g)).toHaveLength(1)
  })

  it('without resume the command is unchanged', () => {
    expect(buildLaunchCommand('claude', {})).toBe('claude --dangerously-skip-permissions')
  })
})

describe('cross-client resume — NEVER launch an interactive picker', () => {
  // The failure this guards is the worst on the whole path: a picker drawn into an unattended pane
  // waits for a human who is not there, so the agent is wedged forever while looking perfectly
  // healthy. The naming is INVERTED between clients — `--resume` is the picker on Claude and
  // resume-last on Kiro — so this cannot be reasoned about from the verb's name.
  it('flags the picker form of every client that has one', () => {
    expect(isPickerVerb('--resume')).toBe(true) // claude: no value ⇒ picker
    expect(isPickerVerb('-r')).toBe(true)
    expect(isPickerVerb('resume')).toBe(true) // codex: "picker by default"
    expect(isPickerVerb('chat --resume-picker')).toBe(true) // kiro
    expect(isPickerVerb('--resume-id abc123')).toBe(true) // kiro: pick by id
    expect(isPickerVerb('-s abc123')).toBe(true) // opencode: pick by id
    expect(isPickerVerb('--list-sessions')).toBe(true) // gemini
  })

  it('does NOT flag the resume-last form of any client', () => {
    expect(isPickerVerb('--continue')).toBe(false) // claude, opencode
    expect(isPickerVerb('resume --last')).toBe(false) // codex
    expect(isPickerVerb('-r latest')).toBe(false) // gemini
    expect(isPickerVerb('chat --resume')).toBe(false) // kiro — resume-last, unlike claude's
  })

  it('THE GUARD — no client in the capability table is configured with a picker', () => {
    // If someone "harmonizes" a verb across clients, this fails instead of shipping a fleet that
    // hangs at a menu after the next reboot.
    for (const program of ['claude', 'codex', 'gemini', 'kiro', 'opencode']) {
      const verb = getClientCapabilities(program).cli.resume
      expect(isPickerVerb(verb), `${program} resume verb "${verb}" is a PICKER`).toBe(false)
    }
  })

  it('every launchable client declares a resume-last verb', () => {
    // opencode declared '' until 2026-07-25 — never checked — which silently made it the one
    // client that always cold-started.
    for (const program of ['claude', 'codex', 'gemini', 'kiro', 'opencode']) {
      expect(getClientCapabilities(program).cli.resume, `${program} has no resume verb`).not.toBe('')
    }
  })
})

describe('cross-client resume — resume by DEFAULT, cold start only on a first launch', () => {
  it('a client with no verified transcript probe still resumes', async () => {
    // USER 2026-07-25: always include the resume verb; the ONE exception is a brand-new agent's
    // first launch, and that is decided by the CALLER (createSession never resumes), not by
    // guessing at five different transcript stores.
    expect(await decideResume('resume --last', null)).toEqual({ resume: true, verb: 'resume --last' })
  })

  it('Claude keeps its transcript guard as belt-and-braces', async () => {
    expect(resolveConversationProbe('claude')).toBeTypeOf('function')
    expect(resolveConversationProbe('claude code')).toBeTypeOf('function')
    expect(await decideResume('--continue', () => Promise.resolve(false))).toEqual({
      resume: false,
      reason: 'no-transcript',
    })
  })

  it('a subcommand verb is accepted — composition handles the ordering', async () => {
    expect(await decideResume('resume --last', () => Promise.resolve(true))).toEqual({
      resume: true,
      verb: 'resume --last',
    })
  })
})
