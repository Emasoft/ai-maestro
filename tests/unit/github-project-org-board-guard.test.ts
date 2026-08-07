// Org/user-level Projects-v2 boards have no repo (ai-maestro#133), so task CRUD —
// which files/edits backing ISSUES via `gh … -R owner/repo` — must refuse BEFORE any
// mutation instead of fabricating a target (the old UI fallback repo=owner aimed
// issue creation at a repo that may not exist). These tests drive the three exported
// CRUD functions with a repo-less config and assert the SPECIFIC browse-only message:
// a generic "it threw" would also pass on a network failure, which is not the gate.
// The guard sits at the TOP of each function (before getProjectMeta), so the refusal
// is synchronous-at-await and no `gh` process is ever spawned — which is also what
// lets these tests run without mocking the GitHub surface.
import { describe, it, expect } from 'vitest'
import { createTask, updateTask, deleteTask } from '@/lib/github-project'

const orgBoard = { owner: 'some-org', number: 7 } // no repo — org/user-level board

const BROWSE_ONLY = /org\/user-level project \(some-org\/projects\/7\) with no repo — the board is browse-only/

describe('org-level board (repo-less GitHubProjectConfig) — task CRUD refuses browse-only', () => {
  it('createTask refuses with the browse-only reason, naming the op', async () => {
    await expect(createTask(orgBoard, 'team-1', { subject: 'x' }))
      .rejects.toThrow(BROWSE_ONLY)
    await expect(createTask(orgBoard, 'team-1', { subject: 'x' }))
      .rejects.toThrow(/^createTask needs a repo/)
  })

  it('updateTask refuses before the GraphQL field updates (no half-applied update)', async () => {
    await expect(updateTask(orgBoard, 'team-1', 'ITEM_node', { status: 'dev' }))
      .rejects.toThrow(BROWSE_ONLY)
    await expect(updateTask(orgBoard, 'team-1', 'ITEM_node', { status: 'dev' }))
      .rejects.toThrow(/^updateTask needs a repo/)
  })

  it('deleteTask with closeIssue refuses before the item is removed from the board', async () => {
    await expect(deleteTask(orgBoard, 'ITEM_node', true))
      .rejects.toThrow(BROWSE_ONLY)
    await expect(deleteTask(orgBoard, 'ITEM_node', true))
      .rejects.toThrow(/^deleteTask\(closeIssue\) needs a repo/)
  })
})
