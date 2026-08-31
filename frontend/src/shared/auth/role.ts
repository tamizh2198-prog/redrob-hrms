export type Role = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' | 'SUPER_ADMIN' | 'HR_ASSOCIATE'

// General HR access — mirrors HR_ADMIN everywhere except approve/reject/
// decide/audit/sign-off authority over a request, which HR_ASSOCIATE never
// gets (see each page's own `canApprove`-style boolean for those call
// sites). Used for Onboarding/Offboarding's general sections and anywhere
// else that just needs "is this HR staff, broadly."
export function canAccessHrOperationalModules(role: Role | undefined): boolean {
  return role === 'HR_ADMIN' || role === 'SUPER_ADMIN' || role === 'HR_ASSOCIATE'
}
