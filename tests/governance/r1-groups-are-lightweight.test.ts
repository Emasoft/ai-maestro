/**
 * R1.2 — "**Groups** are lightweight agent collections for broadcast messaging.
 * No governance, no COS, no kanban. Former 'open teams'."
 *
 * THIS RULE IS ENFORCED BY AN ABSENCE, and by the *widest* one in the map: its
 * Guard column is a bare `lib/group-registry.ts` with no line, because there is
 * no `if` to point at. The rule is that a whole class of machinery — the COS
 * agent, the task board, the governance fields — is simply never built for a
 * group. So the assertions are post-conditions of NON-ACTION, and the neuter has
 * to ADD the forbidden behaviour rather than remove a guard. (Same shape as
 * `r17-no-auto-register.test.ts`; that file is the precedent.)
 *
 * THE CONTRAST IS WHAT MAKES EACH ABSENCE MEAN SOMETHING. Every one of these is
 * a thing the TEAM path really does, verified first-hand:
 *   - COS      — `services/teams-service.ts:356` builds `cos-${teamSlug}` and
 *                calls `createCosAgent`, so creating a team creates an AGENT.
 *   - kanban   — `lib/task-registry.ts:66` gives every team a
 *                `tasks-<teamId>.json` task board.
 *   - governance — `types/team.ts` carries `chiefOfStaffId`, `orchestratorId`,
 *                `kanbanConfig`, `githubProject`, `blocked`. `types/group.ts`
 *                carries none of them.
 * A group that quietly grew any of those would have become an open team again,
 * which is precisely the thing R1.2 records as retired.
 *
 * THE PRESENCE HALF IS NOT DECORATION. Four absence assertions about a
 * subsystem that does nothing would all pass vacuously, so the fan-out test
 * drives the one thing a group exists FOR — a broadcast reaching every
 * subscriber — through the same real registry the absences are measured from.
 *
 * WHAT IS MOCKED, AND WHY IT IS NOT THE GUARD
 * -------------------------------------------
 * `@/lib/notification-service`'s `notifyAgent` is the DATA SINK (it shells out
 * to the real tmux — 0-IMPACT). Everything under test is REAL: `groups.json`,
 * its signed ledger, and the agent registry all live on disk in a temp state
 * dir, because "no agent record appeared" and "no task board appeared" are the
 * entire rule and a mocked store would assert nothing.
 *
 * Neuter record (2026-07-30) — three, complementary, each red ONLY its own site:
 *   A. write an agent row for `cos-<group>` inside `createGroup`
 *        -> "creates NO COS agent" reds; fan-out, board and shape stay green.
 *   B. write `tasks-<id>.json` inside `createGroup`
 *        -> "creates NO task board" reds; the other three stay green.
 *   C. add `chiefOfStaffId: null` to the new group record
 *        -> the record-shape test reds, on the NAMED-key loop (which runs first,
 *           so the exact-key-set assertion below it never executes); fan-out and
 *           board stay green.
 * One neuter alone would have certified two thirds of this file vacuous. Note
 * how narrow each red is: neuter A adds an agent at CREATE time and the DELETE
 * test still passes, because that one brackets only the delete. Granularity is
 * the point — a neuter that reddened everything would not have told the four
 * absences apart.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

const { FAKE_HOME, FAKE_STATE, NOTIFIED } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r12-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r12-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'agents'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(state, 'teams'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(home, 'agents'), { recursive: true })
  return { FAKE_HOME: home, FAKE_STATE: state, NOTIFIED: { calls: [] as string[] } }
})

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// DATA SINK, not guard: the real one drives tmux. Recording the fan-out here is
// what lets the presence half assert that a broadcast reached every subscriber.
vi.mock('@/lib/notification-service', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/notification-service')>()
  return {
    ...actual,
    notifyAgent: async (opts: { agentName: string }) => {
      NOTIFIED.calls.push(opts.agentName)
      return { success: true, notified: true }
    },
  }
})

const REGISTRY_FILE = path.join(FAKE_STATE, 'agents', 'registry.json')
const TEAMS_DIR = path.join(FAKE_STATE, 'teams')
const GROUPS_FILE = path.join(TEAMS_DIR, 'groups.json')
const OWNER = { isSystemOwner: true } as never
const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'

/** Two ordinary agents, so a broadcast has somewhere real to land. */
function seedRegistry() {
  writeFileSync(
    REGISTRY_FILE,
    JSON.stringify(
      [
        { id: ALICE, name: 'r12-alice', label: 'r12-alice', status: 'offline', sessions: [] },
        { id: BOB, name: 'r12-bob', label: 'r12-bob', status: 'offline', sessions: [] },
      ].map(a => ({
        ...a,
        workingDirectory: path.join(FAKE_HOME, 'agents', a.name),
        createdAt: new Date(0).toISOString(),
        lastActive: new Date(0).toISOString(),
      })),
    ),
    'utf-8',
  )
}

function registryRaw(): string {
  return existsSync(REGISTRY_FILE) ? readFileSync(REGISTRY_FILE, 'utf-8') : ''
}

function registryNames(): string[] {
  if (!existsSync(REGISTRY_FILE)) return []
  return (JSON.parse(registryRaw()) as Array<{ name: string }>).map(a => a.name)
}

/** The group exactly as it was PERSISTED — not as the service handed it back. */
function persistedGroups(): Array<Record<string, unknown>> {
  if (!existsSync(GROUPS_FILE)) return []
  return (JSON.parse(readFileSync(GROUPS_FILE, 'utf-8')) as { groups: Array<Record<string, unknown>> }).groups
}

async function makeGroup() {
  const { createNewGroup } = await import('@/services/groups-service')
  const res = await createNewGroup(
    { name: 'r12-broadcast', description: 'a lightweight collection', subscriberIds: [ALICE, BOB] },
    OWNER,
  )
  expect(res.status, `createNewGroup failed: ${res.error}`).toBe(201)
  return res.data!.group
}

beforeEach(() => {
  vi.resetModules()
  NOTIFIED.calls = []
  seedRegistry()
  // A fresh board every test — `groups.json` is real and persists between them.
  writeFileSync(GROUPS_FILE, JSON.stringify({ version: 1, groups: [] }), 'utf-8')
  // The registry's one-time open-teams→groups migration must not fire: there is
  // no teams.json here, and the marker keeps it from writing one.
  writeFileSync(path.join(TEAMS_DIR, '.groups-migrated'), new Date(0).toISOString(), 'utf-8')
})

describe('R1.2 — a group is a broadcast list, and nothing else', () => {
  it('broadcasts to EVERY subscriber (the one thing a group is for)', async () => {
    const group = await makeGroup()
    const { notifyGroupSubscribers } = await import('@/services/groups-service')

    const res = await notifyGroupSubscribers(group.id, 'ship it', 'normal', OWNER)

    // Non-vacuity for the whole file: the subsystem really works, so every
    // absence below is an absence in something that DOES something.
    expect(res.status).toBe(200)
    expect(NOTIFIED.calls.sort()).toEqual(['r12-alice', 'r12-bob'])
    expect(res.data?.results.every(r => r.success)).toBe(true)
  })

  it('creates NO COS agent — the team path creates one, the group path must not', async () => {
    const before = registryNames()
    const group = await makeGroup()

    // `services/teams-service.ts:356` would have produced `cos-<slug>` here.
    expect(registryNames()).toEqual(before)
    expect(registryNames().some(n => n.startsWith('cos-'))).toBe(false)
    expect(existsSync(path.join(FAKE_HOME, 'agents', `cos-${group.name}`))).toBe(false)
  })

  it('creates NO task board — no kanban is provisioned for a group', async () => {
    const group = await makeGroup()

    // `lib/task-registry.ts:66` names a team's board `tasks-<teamId>.json`.
    expect(existsSync(path.join(TEAMS_DIR, `tasks-${group.id}.json`))).toBe(false)
    expect(readdirSync(TEAMS_DIR).filter(f => f.startsWith('tasks-'))).toEqual([])
  })

  it('persists NO governance field — the record carries the Group shape and nothing more', async () => {
    await makeGroup()
    const [persisted] = persistedGroups()

    // Named, so the assertion reads as the rule: none of Team's governance.
    for (const forbidden of ['chiefOfStaffId', 'orchestratorId', 'kanbanConfig', 'githubProject', 'blocked', 'type']) {
      expect(Object.keys(persisted), `a group must not persist "${forbidden}"`).not.toContain(forbidden)
    }
    // Exact, so a governance field nobody thought to list here still reds this.
    // A legitimate new Group field is meant to fail this and force a re-read of
    // R1.2 — "lightweight" is the whole claim.
    expect(Object.keys(persisted).sort()).toEqual(
      ['createdAt', 'description', 'id', 'name', 'subscriberIds', 'updatedAt'],
    )
  })

  it('deleting a group touches no agent — unlike deleting a team', async () => {
    const group = await makeGroup()
    const before = registryRaw()

    const { deleteGroupById } = await import('@/services/groups-service')
    expect((await deleteGroupById(group.id, OWNER)).status).toBe(200)

    // Team deletion can cascade into agents (and demote a MANAGER). A group has
    // no members, only subscribers — dropping the list drops nothing else.
    expect(persistedGroups()).toEqual([])
    expect(registryRaw()).toBe(before)
  })
})
