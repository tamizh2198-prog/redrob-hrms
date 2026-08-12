import { api } from '@/lib/api'
import type { Role } from '@/shared/auth/role'

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY'
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN'
export type EmployeeStatus =
  | 'INVITED'
  | 'PREBOARDING'
  | 'ACTIVE'
  | 'ACTIVE_PROBATION'
  | 'ON_LEAVE'
  | 'INACTIVE'
  | 'TERMINATED'
export type BloodGroup =
  | 'A_POSITIVE'
  | 'A_NEGATIVE'
  | 'B_POSITIVE'
  | 'B_NEGATIVE'
  | 'AB_POSITIVE'
  | 'AB_NEGATIVE'
  | 'O_POSITIVE'
  | 'O_NEGATIVE'

export interface Employee {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  dob: string | null
  gender: Gender | null
  personalEmail: string | null
  workEmail: string | null
  phone: string | null
  departmentId: string | null
  designationId: string | null
  gradeId: string | null
  locationId: string | null
  reportingManagerId: string | null
  dateOfJoining: string | null
  employmentType: EmploymentType | null
  status: EmployeeStatus
  role: Role
  pan: string | null
  aadhaar: string | null
  bankAccountNumber: string | null
  ifscCode: string | null
  bloodGroup: BloodGroup | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  country: string | null
  postalCode: string | null
}

export interface EmployeeListResponse {
  items: Employee[]
  total: number
  page: number
  pageSize: number
}

export interface OrgChartEntry {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  designationId: string | null
}

export interface OrgChartResponse {
  employee: OrgChartEntry
  managers: OrgChartEntry[]
  directReports: OrgChartEntry[]
}

export interface ChangeRequest {
  id: string
  employeeId: string
  fieldName: string
  oldValue: string | null
  newValue: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  requestedAt: string
  employee: Employee
}

export interface BulkImportRowResult {
  row: number
  success: boolean
  employeeId?: string
  errors?: string[]
}

export interface BulkImportResult {
  totalRows: number
  successCount: number
  failureCount: number
  dryRun: boolean
  results: BulkImportRowResult[]
}

export interface ReferenceOption {
  id: string
  name: string
  code: string
}

export interface ManagerOption {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
}

export interface ReferenceData {
  departments: ReferenceOption[]
  designations: ReferenceOption[]
  grades: ReferenceOption[]
  locations: ReferenceOption[]
  managers: ManagerOption[]
}

export function getReferenceData() {
  return api<ReferenceData>('/employees/reference-data')
}

export interface OrgLookup {
  departments: ReferenceOption[]
  designations: ReferenceOption[]
  locations: ReferenceOption[]
}

// Unlike getReferenceData(), this never returns the employee roster — use it
// anywhere that only needs department/designation/location names (e.g. an
// Employee's own dashboard), not an HR-facing assignment dropdown.
export function getOrgLookup() {
  return api<OrgLookup>('/employees/org-lookup')
}

export function listEmployees(params: {
  departmentId?: string
  locationId?: string
  status?: EmployeeStatus
  page?: number
  pageSize?: number
}) {
  return api<EmployeeListResponse>('/employees', {
    params: {
      departmentId: params.departmentId,
      locationId: params.locationId,
      status: params.status,
      page: params.page?.toString(),
      pageSize: params.pageSize?.toString(),
    },
  })
}

export function getEmployee(id: string) {
  return api<Employee>(`/employees/${id}`)
}

export function createEmployee(data: Partial<Employee>) {
  return api<Employee>('/employees', { method: 'POST', body: data })
}

export function updateEmployee(id: string, data: Partial<Employee>) {
  return api<Employee | { changeRequestsCreated: number }>(`/employees/${id}`, {
    method: 'PATCH',
    body: data,
  })
}

export function getOrgChart(id: string) {
  return api<OrgChartResponse>(`/employees/${id}/org-chart`)
}

export function revealSensitiveFields(id: string) {
  return api<{ pan: string | null; aadhaar: string | null; bankAccountNumber: string | null }>(
    `/employees/${id}/reveal`,
    { method: 'POST' },
  )
}

export function listChangeRequests(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  return api<ChangeRequest[]>('/employees/change-requests', {
    params: { status },
  })
}

export function approveChangeRequest(id: string) {
  return api<void>(`/employees/change-requests/${id}/approve`, { method: 'POST' })
}

export function rejectChangeRequest(id: string, reason?: string) {
  return api<void>(`/employees/change-requests/${id}/reject`, {
    method: 'POST',
    body: { reason },
  })
}

export function bulkImportEmployees(rows: Partial<Employee>[], dryRun: boolean) {
  return api<BulkImportResult>('/employees/bulk-import', {
    method: 'POST',
    body: { rows, dryRun },
  })
}

// Auth Phase 2: invitation + activation
export interface InviteEmployeeResult {
  employee: Employee
  invitation: { expiresAt: string }
  emailSent: boolean
}

export interface PendingInvitation {
  id: string
  employeeId: string
  expiresAt: string
  usedAt: string | null
  createdAt: string
  employee: {
    id: string
    firstName: string
    lastName: string
    employeeCode: string
    workEmail: string | null
    status: EmployeeStatus
  }
}

export function inviteEmployee(data: {
  email: string
  employeeCode: string
  firstName: string
  lastName: string
  departmentId?: string
  locationId?: string
  reportingManagerId?: string
  role?: Role
}) {
  return api<InviteEmployeeResult>('/employees/invite', { method: 'POST', body: data })
}

export function resendInvitation(employeeId: string) {
  return api<{ invitation: { expiresAt: string }; emailSent: boolean }>(
    `/employees/${employeeId}/resend-invitation`,
    { method: 'POST' },
  )
}

export function listPendingInvitations() {
  return api<PendingInvitation[]>('/employees/invitations')
}

export interface ActivationIdentity {
  firstName: string
  lastName: string
  employeeCode: string
  email: string | null
  expiresAt: string
}

export function validateActivationToken(token: string) {
  return api<ActivationIdentity>(`/auth/activate/${token}`)
}

export function activateAccount(data: {
  token: string
  password: string
  confirmPassword: string
}) {
  return api<{ success: true }>('/auth/activate', { method: 'POST', body: data })
}

// Auth Phase 3: profile completion
export interface ProfileCompletion {
  completionPercentage: number
  isComplete: boolean
  requiredFields: string[]
  missingFields: string[]
}

export interface MyProfileResponse extends ProfileCompletion {
  employee: Employee
}

export function getMyProfile() {
  return api<MyProfileResponse>('/employees/me/profile')
}

// This task: admin employee-profile view — reuses the same ProfileCompletion
// shape/calculation as getMyProfile, just for an arbitrary employee id.
export function getProfileCompletion(id: string) {
  return api<ProfileCompletion>(`/employees/${id}/profile-completion`)
}

// This task: controlled dismissal/deactivation. Never deletes the record —
// sets status to TERMINATED and invalidates any pending invitation.
export function dismissEmployee(id: string) {
  return api<Employee>(`/employees/${id}/dismiss`, { method: 'POST' })
}

export interface UpdateMyProfileInput {
  dob?: string
  gender?: Gender
  phone?: string
  personalEmail?: string
  addressLine?: string
  city?: string
  state?: string
  country?: string
  postalCode?: string
  pan?: string
  aadhaar?: string
  bankAccountNumber?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
}

export function updateMyProfile(data: UpdateMyProfileInput) {
  return api<MyProfileResponse>('/employees/me/profile', { method: 'PATCH', body: data })
}

// Display-only helper for the HR Admin employee list — mirrors the
// backend's required-field checklist purely for a cosmetic badge; the
// authoritative completion value for gating/redirect decisions always
// comes from GET /employees/me/profile, never computed on the client.
const DISPLAY_REQUIRED_FIELDS: Array<keyof Employee> = [
  'dob',
  'gender',
  'phone',
  'addressLine',
  'city',
  'state',
  'postalCode',
  'pan',
  'bankAccountNumber',
  'emergencyContactName',
  'emergencyContactPhone',
]

export function computeDisplayCompletionPercentage(employee: Employee): number {
  const filled = DISPLAY_REQUIRED_FIELDS.filter((f) => {
    const v = employee[f]
    return v !== null && v !== undefined && v !== ''
  }).length
  return Math.round((filled / DISPLAY_REQUIRED_FIELDS.length) * 100)
}
