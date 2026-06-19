// CJS stub for @/lib/governance — resolveGovernanceContext runtime-requires it.
module.exports = {
  isManager: () => false,
  isChiefOfStaffAnywhere: () => false,
  isUserAuthorityModelEnabled: () => false,
  loadGovernance: () => ({ version: 1, managerId: null, passwordHash: 'set', passwordSetAt: null }),
}
