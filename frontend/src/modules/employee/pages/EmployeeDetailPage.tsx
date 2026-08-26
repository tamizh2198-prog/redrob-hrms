import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import {
  getEmployee,
  getOrgChart,
  getReferenceData,
  getProfileCompletion,
  revealSensitiveFields,
  updateEmployee,
  resetPassword,
  resetMfa,
  type BloodGroup,
  type Employee,
  type OrgChartResponse,
  type ReferenceData,
  type ProfileCompletion,
} from '../api'
import { DismissEmployeeDialog } from '../components/DismissEmployeeDialog'
import { DeleteEmployeeDialog } from '../components/DeleteEmployeeDialog'
import {
  listGrantsForEmployee,
  grantModuleAccess,
  revokeModuleAccess,
  GRANTABLE_MODULES,
  MODULE_LABELS,
  type ModuleAccessGrant,
  type GrantableModule,
} from '@/modules/module-access/api'
import { getCalendar, ATTENDANCE_STATUS_COLOR, type CalendarDay } from '@/modules/attendance/api'
import {
  getBalances,
  getApplicationsForEmployee,
  decideLeave,
  isHalfDayApplication,
  type LeaveBalanceEntry,
  type LeaveApplication,
} from '@/modules/leave/api'

const BLOOD_GROUPS: BloodGroup[] = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
]

function toDateDisplay(value: string | null): string {
  return value ? value.slice(0, 10) : '—'
}

// This task: Half Day and Unpaid leave types (e.g. "Half Day Sick Leave",
// "Unpaid Sick Leave") are still fully tracked (applications, accrual,
// payroll) — this only hides their balance cards from this display; the
// underlying LeaveType rows/balances are untouched. Substring match (not
// exact name) since these prefixes/qualifiers combine with any base leave
// type name, not just "Half Day Leave"/"Unpaid Leave" literally.
function isHiddenBalanceLeaveType(name: string) {
  const normalized = name.trim().toLowerCase()
  return normalized.includes('half day') || normalized.includes('unpaid')
}

// This task (Part 7/8): this is the ADMIN view of an employee record,
// reached from the Employee Directory. It intentionally stays separate
// from the employee's own "My Profile" (Auth Phase 3) — this page never
// lets the admin edit personal/address fields (those remain employee
// self-service); it only keeps the pre-existing admin-editable fields
// (personal email, phone, emergency contact) and adds read-only sections
// plus the Auth Phase 3 profile-completion breakdown and dismissal action.
export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isSelf = user?.id === id

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [reference, setReference] = useState<ReferenceData | null>(null)
  const [completion, setCompletion] = useState<ProfileCompletion | null>(null)
  const [orgChart, setOrgChart] = useState<OrgChartResponse | null>(null)
  const [revealed, setRevealed] = useState<{
    pan: string | null
    aadhaar: string | null
    bankAccountNumber: string | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Employee>>({})
  const [resetPasswordUrl, setResetPasswordUrl] = useState<string | null>(null)
  const [resetPasswordCopied, setResetPasswordCopied] = useState(false)
  const [resettingPassword, setResettingPassword] = useState(false)
  const [resettingMfa, setResettingMfa] = useState(false)

  const now = new Date()
  const [attYear, setAttYear] = useState(now.getFullYear())
  const [attMonth, setAttMonth] = useState(now.getMonth() + 1)
  const [attDays, setAttDays] = useState<CalendarDay[]>([])

  const [leaveBalances, setLeaveBalances] = useState<LeaveBalanceEntry[]>([])
  const [leaveApplications, setLeaveApplications] = useState<LeaveApplication[]>([])
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const [moduleGrants, setModuleGrants] = useState<ModuleAccessGrant[]>([])
  const [moduleActionError, setModuleActionError] = useState<string | null>(null)
  const [pendingModule, setPendingModule] = useState<GrantableModule | null>(null)

  function refresh() {
    if (!id) return
    setError(null)
    setRevealed(null)
    getEmployee(id)
      .then((e) => {
        setEmployee(e)
        setForm(e)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view this employee's full profile.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load')
        }
      })
    getOrgChart(id).then(setOrgChart).catch(() => setOrgChart(null))
    getProfileCompletion(id).then(setCompletion).catch(() => setCompletion(null))
  }

  function refreshLeave() {
    if (!id) return
    setLeaveError(null)
    getBalances(id).then(setLeaveBalances).catch(() => setLeaveBalances([]))
    getApplicationsForEmployee(id)
      .then(setLeaveApplications)
      .catch((err) => {
        setLeaveApplications([])
        if (!(err instanceof ApiError && err.status === 403)) {
          setLeaveError(err instanceof Error ? err.message : 'Failed to load leave history')
        }
      })
  }

  useEffect(() => {
    refresh()
    refreshLeave()
    getReferenceData().then(setReference).catch(() => setReference(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!id) return
    getCalendar(id, attYear, attMonth).then(setAttDays).catch(() => setAttDays([]))
  }, [id, attYear, attMonth])

  function refreshModuleGrants() {
    if (!id || !isSuperAdmin) return
    listGrantsForEmployee(id).then(setModuleGrants).catch(() => setModuleGrants([]))
  }

  useEffect(() => {
    refreshModuleGrants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isSuperAdmin])

  async function handleToggleModuleGrant(module: GrantableModule, currentlyGranted: boolean) {
    if (!id) return
    setModuleActionError(null)
    setPendingModule(module)
    try {
      if (currentlyGranted) {
        await revokeModuleAccess(id, module)
      } else {
        await grantModuleAccess(id, module)
      }
      refreshModuleGrants()
    } catch (err) {
      setModuleActionError(err instanceof ApiError ? err.message : 'Failed to update module access')
    } finally {
      setPendingModule(null)
    }
  }

  async function handleLeaveDecision(applicationId: string, approve: boolean) {
    setDecidingId(applicationId)
    setLeaveError(null)
    try {
      await decideLeave(applicationId, approve)
      refreshLeave()
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Failed to record decision')
    } finally {
      setDecidingId(null)
    }
  }

  async function handleReveal() {
    if (!id) return
    try {
      setRevealed(await revealSensitiveFields(id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not authorized to reveal these fields')
    }
  }

  async function handleResetPassword() {
    if (!id) return
    setError(null)
    setMessage(null)
    setResetPasswordUrl(null)
    setResettingPassword(true)
    try {
      const result = await resetPassword(id)
      setMessage(
        result.emailSent
          ? 'Password reset email sent.'
          : "Email delivery isn't configured — copy the reset link below and send it to them directly.",
      )
      setResetPasswordUrl(result.resetUrl ?? null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset password')
    } finally {
      setResettingPassword(false)
    }
  }

  async function handleResetMfa() {
    if (!id) return
    setError(null)
    setMessage(null)
    setResettingMfa(true)
    try {
      await resetMfa(id)
      setMessage('MFA has been reset. They will be asked to set it up again next time they sign in.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset MFA')
    } finally {
      setResettingMfa(false)
    }
  }

  // Only HR Admin/Super Admin reach this now (see canEditSelfServiceFields
  // below) — an employee viewing their own record manages personal/payroll
  // fields from My Profile instead, so there's no longer a second
  // self-service write path (and its change-request/approval branch) here.
  async function handleSave() {
    if (!id) return
    setError(null)
    setMessage(null)
    try {
      const res = await updateEmployee(id, form)
      if ('changeRequestsCreated' in res) {
        setMessage(
          res.changeRequestsCreated > 0
            ? `Submitted ${res.changeRequestsCreated} change request(s) for HR Admin approval.`
            : 'No changes to submit.',
        )
      } else {
        setEmployee(res)
        setMessage('Saved.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save')
    }
  }

  function handleDismissed() {
    navigate('/employee')
  }

  function handleDeleted() {
    navigate('/employee', {
      state: { message: `${employee?.firstName} ${employee?.lastName} was permanently deleted.` },
    })
  }

  if (error && !employee) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Link to="/employee" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Back to directory
        </Link>
        <p className="text-destructive">{error}</p>
      </div>
    )
  }
  if (!employee) {
    return <div className="p-6 text-muted-foreground">Loading…</div>
  }

  // This task: personal/payroll self-service fields (contact details,
  // PAN/Aadhaar/bank/IFSC, blood group, emergency contact) are now edited in
  // exactly one place — My Profile. An employee viewing their own record
  // here (isSelf, not HR) sees these fields read-only instead of a second
  // editable copy; HR Admin/Super Admin access is unchanged.
  const canEditSelfServiceFields = isHrAdmin
  const departmentName = reference?.departments.find((d) => d.id === employee.departmentId)?.name ?? '—'
  const locationName = reference?.locations.find((l) => l.id === employee.locationId)?.name ?? '—'
  const designationName = reference?.designations.find((d) => d.id === employee.designationId)?.name ?? '—'
  const gradeName = reference?.grades.find((g) => g.id === employee.gradeId)?.name ?? '—'
  const manager = reference?.managers.find((m) => m.id === employee.reportingManagerId)
  const managerName = manager ? `${manager.firstName} ${manager.lastName} (${manager.employeeCode})` : '—'

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link to="/employee" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Back to directory
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">
            {employee.firstName} {employee.lastName}
          </h1>
          <Badge variant={employee.status === 'TERMINATED' ? 'destructive' : 'outline'}>
            {employee.status}
          </Badge>
          <span className="text-sm text-muted-foreground">{employee.employeeCode}</span>
        </div>
        {(isHrAdmin || isSuperAdmin) && !isSelf && (
          <div className="flex gap-2">
            {isHrAdmin && employee.status !== 'TERMINATED' && (
              <>
                <Button size="sm" variant="outline" disabled={resettingPassword} onClick={handleResetPassword}>
                  {resettingPassword ? 'Resetting…' : 'Reset Password'}
                </Button>
                <Button size="sm" variant="outline" disabled={resettingMfa} onClick={handleResetMfa}>
                  {resettingMfa ? 'Resetting…' : 'Reset MFA'}
                </Button>
              </>
            )}
            {isSuperAdmin && employee.status !== 'TERMINATED' && (
              <DismissEmployeeDialog
                employeeId={employee.id}
                employeeName={`${employee.firstName} ${employee.lastName}`}
                onDismissed={handleDismissed}
              />
            )}
            {isSuperAdmin && (
              <DeleteEmployeeDialog
                employeeId={employee.id}
                employeeName={`${employee.firstName} ${employee.lastName}`}
                onDeleted={handleDeleted}
              />
            )}
          </div>
        )}
      </div>

      {message && <p className="text-sm text-primary">{message}</p>}
      {resetPasswordUrl && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
          <Input readOnly value={resetPasswordUrl} className="text-xs" onFocus={(e) => e.target.select()} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(resetPasswordUrl)
              setResetPasswordCopied(true)
              setTimeout(() => setResetPasswordCopied(false), 2000)
            }}
          >
            {resetPasswordCopied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Personal Information</h2>
        <p className="text-xs text-muted-foreground">
          Name, date of birth, gender, and address are employee self-service — managed by the
          employee via My Profile.{' '}
          {isSelf && !isHrAdmin
            ? 'Update your own phone and personal email from My Profile too.'
            : 'Contact details below remain admin-editable.'}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <ReadOnlyField label="First name" value={employee.firstName} />
          <ReadOnlyField label="Last name" value={employee.lastName} />
          <ReadOnlyField label="Date of birth" value={toDateDisplay(employee.dob)} />
          <ReadOnlyField label="Gender" value={employee.gender ?? '—'} />
          <Field
            label="Work email (login)"
            value={form.workEmail}
            editable={canEditSelfServiceFields}
            type="email"
            onChange={(v) => setForm((f) => ({ ...f, workEmail: v }))}
          />
          <Field
            label="Personal email"
            value={form.personalEmail}
            editable={canEditSelfServiceFields}
            onChange={(v) => setForm((f) => ({ ...f, personalEmail: v }))}
          />
          <Field
            label="Phone"
            value={form.phone}
            editable={canEditSelfServiceFields}
            onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
          />
          <ReadOnlyField
            label="Address"
            value={
              [employee.addressLine, employee.city, employee.state, employee.postalCode]
                .filter(Boolean)
                .join(', ') || '—'
            }
            className="col-span-2"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Employment Information</h2>
        <p className="text-xs text-muted-foreground">Read-only system/employment fields.</p>
        <div className="grid grid-cols-2 gap-4">
          <ReadOnlyField label="Employee code" value={employee.employeeCode} />
          <ReadOnlyField label="Role" value={employee.role} />
          <ReadOnlyField label="Department" value={departmentName} />
          <ReadOnlyField label="Location" value={locationName} />
          <ReadOnlyField label="Designation" value={designationName} />
          <ReadOnlyField label="Grade" value={gradeName} />
          <ReadOnlyField
            label="Employment type"
            value={employee.employmentType?.replaceAll('_', ' ') ?? '—'}
          />
          <ReadOnlyField label="Reporting manager" value={managerName} />
          <ReadOnlyField label="Date of joining" value={toDateDisplay(employee.dateOfJoining)} />
          <ReadOnlyField label="Status" value={employee.status} />
        </div>
      </section>

      {/* Section 7.1: PAN/Aadhaar/bank details are masked in the API response
          for anyone but a privileged viewer or the employee themselves — so
          whenever canEditSelfServiceFields is true, `form`/`employee` already
          hold the real unmasked values and an editable input is enough. A
          Manager viewing a report's profile is neither, so they get the old
          read-only + Reveal flow instead. */}
      <section className="rounded-md border p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Payroll / Identity</h2>
          {!canEditSelfServiceFields && !isSelf && (
            <Button variant="outline" size="sm" onClick={handleReveal}>
              Reveal
            </Button>
          )}
        </div>
        {isSelf && !isHrAdmin && (
          <p className="mb-2 text-xs text-muted-foreground">
            Manage PAN, Aadhaar, bank/IFSC details, and blood group from My Profile.
          </p>
        )}
        {canEditSelfServiceFields ? (
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Field label="PAN" value={form.pan} editable
              onChange={(v) => setForm((f) => ({ ...f, pan: v }))} />
            <Field label="Aadhaar" value={form.aadhaar} editable
              onChange={(v) => setForm((f) => ({ ...f, aadhaar: v }))} />
            <Field label="Bank account" value={form.bankAccountNumber} editable
              onChange={(v) => setForm((f) => ({ ...f, bankAccountNumber: v }))} />
            <Field label="IFSC code" value={form.ifscCode} editable
              onChange={(v) => setForm((f) => ({ ...f, ifscCode: v }))} />
            <div className="flex flex-col gap-1">
              <Label>Blood group</Label>
              <Select
                value={form.bloodGroup ?? ''}
                onValueChange={(v) => setForm((f) => ({ ...f, bloodGroup: v as BloodGroup }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select blood group">
                    {(v: string) => (v ? v.replaceAll('_', ' ') : 'Select blood group')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUPS.map((bg) => (
                    <SelectItem key={bg} value={bg}>
                      {bg.replaceAll('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>CTC (LPA)</Label>
              <Input
                type="number"
                min={0}
                step="0.1"
                placeholder="e.g. 12"
                value={form.ctcLpa ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ctcLpa: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Drives the Performance module's quarterly KPI reward band.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">PAN</div>
              <div>{revealed?.pan ?? employee.pan}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Aadhaar</div>
              <div>{revealed?.aadhaar ?? employee.aadhaar}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Bank account</div>
              <div>{revealed?.bankAccountNumber ?? employee.bankAccountNumber}</div>
            </div>
            <div>
              <div className="text-muted-foreground">IFSC code</div>
              <div>{employee.ifscCode ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Blood group</div>
              <div>{employee.bloodGroup?.replaceAll('_', ' ') ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">CTC (LPA)</div>
              <div>{employee.ctcLpa ?? '—'}</div>
            </div>
          </div>
        )}
      </section>

      {isSuperAdmin && !isSelf && (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <div>
            <h2 className="font-medium">Module Access</h2>
            <p className="text-xs text-muted-foreground">
              Grant this employee access to a specific module regardless of their role — an
              exception scoped to that module only, not a role change.
            </p>
          </div>
          {moduleActionError && <p className="text-sm text-destructive">{moduleActionError}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {GRANTABLE_MODULES.map((module) => {
              const granted = moduleGrants.some((g) => g.module === module)
              return (
                <Button
                  key={module}
                  size="sm"
                  variant={granted ? 'default' : 'outline'}
                  disabled={pendingModule === module}
                  onClick={() => handleToggleModuleGrant(module, granted)}
                >
                  {MODULE_LABELS[module]}
                </Button>
              )
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Emergency Contact</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Emergency contact name"
            value={form.emergencyContactName}
            editable={canEditSelfServiceFields}
            onChange={(v) => setForm((f) => ({ ...f, emergencyContactName: v }))}
          />
          <Field
            label="Emergency contact phone"
            value={form.emergencyContactPhone}
            editable={canEditSelfServiceFields}
            onChange={(v) => setForm((f) => ({ ...f, emergencyContactPhone: v }))}
          />
        </div>
      </section>

      {completion && (
        <section className="flex flex-col gap-2 rounded-md border p-4">
          <div className="flex items-center justify-between text-sm">
            <h2 className="font-medium">Profile Completion</h2>
            <span>{completion.completionPercentage}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${completion.completionPercentage}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="mb-1 text-muted-foreground">Completed fields</div>
              <ul className="flex flex-col gap-0.5">
                {completion.requiredFields
                  .filter((f) => !completion.missingFields.includes(f))
                  .map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                {completion.isComplete && completion.requiredFields.length === 0 && (
                  <li className="text-muted-foreground">—</li>
                )}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-muted-foreground">Missing fields</div>
              <ul className="flex flex-col gap-0.5">
                {completion.missingFields.map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {completion.missingFields.length === 0 && (
                  <li className="text-muted-foreground">None — profile complete</li>
                )}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Attendance</h2>
        <div className="flex items-center gap-2">
          <Label>Month</Label>
          <Input
            type="number"
            className="w-20"
            value={attMonth}
            onChange={(e) => setAttMonth(Number(e.target.value))}
          />
          <Label>Year</Label>
          <Input
            type="number"
            className="w-24"
            value={attYear}
            onChange={(e) => setAttYear(Number(e.target.value))}
          />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {attDays.map((d) => (
            <div
              key={d.date}
              className={`rounded-md p-2 text-center text-xs ${ATTENDANCE_STATUS_COLOR[d.status]}`}
              title={d.status === 'HOLIDAY' && d.holidayName ? `${d.status} — ${d.holidayName}` : d.status}
            >
              <div>{d.date.slice(-2)}</div>
              <div className="truncate">{d.status}</div>
            </div>
          ))}
          {attDays.length === 0 && (
            <p className="col-span-7 text-muted-foreground">No attendance records for this month.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Leave</h2>
        {leaveError && <p className="text-sm text-destructive">{leaveError}</p>}

        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Leave Balance / Quota</h3>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {leaveBalances
              .filter((b) => !isHiddenBalanceLeaveType(b.leaveType.name))
              .map((b) => (
                <div key={b.leaveType.id} className="rounded-md bg-muted px-3 py-2">
                  <div className="font-medium">{b.leaveType.name}</div>
                  <div className="text-muted-foreground">
                    Opening: {b.balance.openingBalance} · Accrued: {b.balance.accrued}
                  </div>
                  <div className="text-muted-foreground">
                    Used: {b.balance.used} · Carried: {b.balance.carriedForward}
                  </div>
                  <div className="font-medium">Available: {b.available}</div>
                </div>
              ))}
            {leaveBalances.filter((b) => !isHiddenBalanceLeaveType(b.leaveType.name)).length === 0 && (
              <p className="col-span-full text-muted-foreground">No leave types configured yet.</p>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Leave History / Applications</h3>
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Applied</TableHead>
                {isSuperAdmin && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaveApplications.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.leaveType?.name ?? '—'}</TableCell>
                  <TableCell>{a.startDate.slice(0, 10)}</TableCell>
                  <TableCell>{a.endDate.slice(0, 10)}</TableCell>
                  <TableCell>{isHalfDayApplication(a) ? 'Half Day' : a.daysCount}</TableCell>
                  <TableCell>{a.reason ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{a.status}</Badge>
                  </TableCell>
                  <TableCell>{a.createdAt.slice(0, 10)}</TableCell>
                  {isSuperAdmin && (
                    <TableCell className="flex gap-2">
                      {a.status === 'PENDING' && (
                        <>
                          <Button
                            size="sm"
                            disabled={decidingId === a.id}
                            onClick={() => handleLeaveDecision(a.id, true)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={decidingId === a.id}
                            onClick={() => handleLeaveDecision(a.id, false)}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {leaveApplications.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isSuperAdmin ? 8 : 7} className="text-center text-muted-foreground">
                    No leave applications yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {canEditSelfServiceFields && (
        <Button onClick={handleSave}>{isHrAdmin ? 'Save' : 'Submit change request'}</Button>
      )}

      {orgChart && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="mb-2 font-medium">Reporting chain</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {orgChart.managers.map((m) => (
                <li key={m.id}>
                  <Link to={`/employee/${m.id}`} className="underline-offset-4 hover:underline">
                    {m.firstName} {m.lastName}
                  </Link>
                </li>
              ))}
              {orgChart.managers.length === 0 && (
                <li className="text-muted-foreground">No manager</li>
              )}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 font-medium">Direct reports</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {orgChart.directReports.map((r) => (
                <li key={r.id}>
                  <Link to={`/employee/${r.id}`} className="underline-offset-4 hover:underline">
                    {r.firstName} {r.lastName}
                  </Link>
                </li>
              ))}
              {orgChart.directReports.length === 0 && <li className="text-muted-foreground">None</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  editable,
  onChange,
  type = 'text',
}: {
  label: string
  value?: string | null
  editable: boolean
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'email'
}) {
  // getEmployee() returns dob as a full ISO datetime string
  // ("1995-05-15T00:00:00.000Z") — a native date input only accepts the
  // plain YYYY-MM-DD portion.
  const displayValue = type === 'date' ? (value ?? '').slice(0, 10) : (value ?? '')
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input
        type={type}
        value={displayValue}
        disabled={!editable}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function ReadOnlyField({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <Label>{label}</Label>
      <Input value={value} disabled />
    </div>
  )
}
