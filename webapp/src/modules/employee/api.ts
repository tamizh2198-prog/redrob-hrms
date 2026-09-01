import { api, ApiError } from '@/lib/api'
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
  // Compensation — masked to null for any viewer besides HR Admin/Super
  // Admin/self, same as pan/aadhaar/bankAccountNumber above.
  ctcLpa: number | null
  bloodGroup: BloodGroup | null
  photoUrl: string | null
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
  // Additive — most consumers of getReferenceData().managers (ATS,
  // Onboarding, Performance, Assets, Helpdesk, etc.) ignore these; only the
  // Reporting Manager picker uses them to filter to eligible people.
  role: Role
  status: EmployeeStatus
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
  search?: string
  page?: number
  pageSize?: number
}) {
  return api<EmployeeListResponse>('/employees', {
    params: {
      departmentId: params.departmentId,
      locationId: params.locationId,
      status: params.status,
      search: params.search,
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

// Excel counterpart to bulkImportEmployees() above — bypasses the shared
// api() helper (which always JSON-encodes the body) since this sends a real
// file as multipart form data, same reasoning as shift/api.ts's
// bulkUploadWfoSchedule(). Relative URL now that frontend+backend are one
// Next.js app.
export async function bulkImportEmployeesFromFile(file: File, dryRun: boolean) {
  const token = localStorage.getItem('accessToken')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/v1/employees/bulk-import/upload?dryRun=${dryRun}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new ApiError(body.message ?? 'Bulk import failed', res.status)
  }
  return res.json() as Promise<BulkImportResult>
}

export async function downloadEmployeeBulkImportTemplate() {
  const token = localStorage.getItem('accessToken')
  const res = await fetch('/api/v1/employees/bulk-import/template', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError('Failed to download template', res.status)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'employee-bulk-import-template.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// Super Admin-only: Excel export of the active roster (Employee Directory).
export async function downloadActiveEmployees() {
  const token = localStorage.getItem('accessToken')
  const res = await fetch('/api/v1/employees/export/active', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError('Failed to download active employees', res.status)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'active-employees.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// Auth Phase 2: invitation + activation
export interface InviteEmployeeResult {
  employee: Employee
  invitation: { expiresAt: string }
  emailSent: boolean
  // Only present when emailSent is false — a copy-paste fallback link for
  // when email delivery isn't configured or failed.
  invitationUrl?: string
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
  firstName: string
  lastName: string
  departmentId?: string
  locationId?: string
  reportingManagerId?: string
  designationId?: string
  gradeId?: string
  employmentType?: EmploymentType
  role?: Role
  ctcLpa?: number
}) {
  return api<InviteEmployeeResult>('/employees/invite', { method: 'POST', body: data })
}

export function resendInvitation(employeeId: string) {
  return api<{ invitation: { expiresAt: string }; emailSent: boolean; invitationUrl?: string }>(
    `/employees/${employeeId}/resend-invitation`,
    { method: 'POST' },
  )
}

export function listPendingInvitations() {
  return api<PendingInvitation[]>('/employees/invitations')
}

// Admin-assisted credential recovery — there's no self-service "forgot
// password" (see ResetPasswordPage), so an HR Admin/Super Admin triggers
// these for a locked-out person instead.
export function resetPassword(employeeId: string) {
  return api<{ expiresAt: string; emailSent: boolean; resetUrl?: string }>(
    `/employees/${employeeId}/reset-password`,
    { method: 'POST' },
  )
}

export function resetMfa(employeeId: string) {
  return api<{ success: true }>(`/employees/${employeeId}/reset-mfa`, { method: 'POST' })
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

export interface PasswordResetIdentity {
  firstName: string
  lastName: string
  employeeCode: string
  expiresAt: string
}

export function validatePasswordResetToken(token: string) {
  return api<PasswordResetIdentity>(`/auth/reset-password/${token}`)
}

export function consumePasswordReset(data: {
  token: string
  password: string
  confirmPassword: string
}) {
  return api<{ success: true }>('/auth/reset-password', { method: 'POST', body: data })
}

// Interim self-service entry point — always resolves with the same generic
// message, whether or not the email matched an employee.
export function forgotPassword(email: string) {
  return api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email } })
}

export interface DepartmentColleague {
  id: string
  firstName: string
  lastName: string
  employeeCode: string
  status: EmployeeStatus
  designation: { name: string } | null
}

export function getMyDepartmentColleagues() {
  return api<DepartmentColleague[]>('/employees/me/department-colleagues')
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

// This task: Super Admin-only permanent removal, for test/development
// cleanup only — separate from and does not replace dismissEmployee above.
export function deleteEmployee(id: string) {
  return api<{ deleted: true; employeeCode: string }>(`/employees/${id}`, {
    method: 'DELETE',
  })
}

export interface UpdateMyProfileInput {
  firstName?: string
  lastName?: string
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
  ifscCode?: string
  bloodGroup?: BloodGroup
  emergencyContactName?: string
  emergencyContactPhone?: string
  photoUrl?: string
}

export function updateMyProfile(data: UpdateMyProfileInput) {
  return api<MyProfileResponse>('/employees/me/profile', { method: 'PATCH', body: data })
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
  confirmNewPassword: string
}

export function changeMyPassword(data: ChangePasswordInput) {
  return api<{ success: true }>('/employees/me/password', { method: 'PATCH', body: data })
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
