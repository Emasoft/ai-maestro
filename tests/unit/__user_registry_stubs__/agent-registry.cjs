// CJS stub for @/lib/agent-registry used by the user-registry tests.
//
// WHY a .cjs stub instead of vi.mock: softDeleteUser() reaches the agent
// registry via a runtime `require('./agent-registry')` (so the import does not
// pull the whole agent graph at module-load and avoids a module cycle).
// vitest's `resolve.alias` only rewrites ESM `import`, NOT runtime
// `require('@/...')` / `require('./...')`, so a `vi.mock` never intercepts that
// call. Tests instead patch `Module._resolveFilename` to point the specifier at
// this stub, which Node's native require loads cleanly. `__getDeletedIds`
// records which agent ids the R39.6 cascade asked to soft-delete.
let _deletedIds = []
let _throwOnDelete = false
module.exports = {
  // deleteAgent(id, hard=false) — the soft delete the R39.6 cascade calls.
  deleteAgent: async (id, hard) => {
    if (_throwOnDelete) throw new Error('stub: deleteAgent failed')
    _deletedIds.push({ id, hard })
    return { id, hard }
  },
  __getDeletedIds: () => _deletedIds,
  __reset: () => { _deletedIds = []; _throwOnDelete = false },
  __setThrowOnDelete: (v) => { _throwOnDelete = v },
}
