import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

const EMPLOYMENT_TYPES: NonNullable<Employee['employmentType']>[] = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERN',
]

// ARCHIVED is deliberately excluded — it's only ever set automatically once
// Full & Final settlement is marked paid (see Offboarding), not something a
// Super Admin should be able to toggle manually here.
const EMPLOYEE_STATUSES: Employee['status'][] = [
  'INVITED',
  'PREBOARDING',
  'ACTIVE',
  'ACTIVE_PROBATION',
  'ON_LEAVE',
  'INACTIVE',
  'TERMINATED',
]

function toDateDisplay(value: string | null): string {
  return value ? value.slice(0, 10) : '—'
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
  // Direct-edit-vs-change-request routing, reveal, reset password/MFA —
  // general HR access, no approve/reject of someone else's pending request
  // involved (that's the separate ChangeRequestsPage), so HR Associate
  // mirrors HR_ADMIN here.
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'
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

  useEffect(() => {
    refresh()
    getReferenceData().then(setReference).catch(() => setReference(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

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

      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employment Information</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {isSuperAdmin
            ? 'Super Admin can edit these fields directly.'
            : 'Read-only system/employment fields — only a Super Admin can change these.'}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <ReadOnlyField label="Employee code" value={employee.employeeCode} />
          <ReadOnlyField label="Role" value={employee.role} />
          {isSuperAdmin ? (
            <>
              <ReferenceSelect
                label="Department"
                value={form.departmentId ?? ''}
                options={reference?.departments ?? []}
                onChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
              />
              <ReferenceSelect
                label="Location"
                value={form.locationId ?? ''}
                options={reference?.locations ?? []}
                onChange={(v) => setForm((f) => ({ ...f, locationId: v }))}
              />
              <ReferenceSelect
                label="Designation"
                value={form.designationId ?? ''}
                options={reference?.designations ?? []}
                onChange={(v) => setForm((f) => ({ ...f, designationId: v }))}
              />
              <ReferenceSelect
                label="Grade"
                value={form.gradeId ?? ''}
                options={reference?.grades ?? []}
                onChange={(v) => setForm((f) => ({ ...f, gradeId: v }))}
              />
              <div className="flex flex-col gap-1">
                <Label>Employment type</Label>
                <Select
                  value={form.employmentType ?? ''}
                  onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v as Employee['employmentType'] }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select employment type">
                      {(v: string) => (v ? v.replaceAll('_', ' ') : 'Select employment type')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.replaceAll('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Reporting manager</Label>
                <Select
                  value={form.reportingManagerId ?? ''}
                  onValueChange={(v) => setForm((f) => ({ ...f, reportingManagerId: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select reporting manager">
                      {(v: string) => {
                        const m = reference?.managers.find((mgr) => mgr.id === v)
                        return m ? `${m.firstName} ${m.lastName} (${m.employeeCode})` : 'Select reporting manager'
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {reference?.managers
                      .filter((m) => m.id !== employee.id)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.firstName} {m.lastName} ({m.employeeCode})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Date of joining</Label>
                <Input
                  type="date"
                  value={form.dateOfJoining ? form.dateOfJoining.slice(0, 10) : ''}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfJoining: e.target.value || null }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Status</Label>
                <Select
                  value={form.status ?? ''}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as Employee['status'] }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYEE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replaceAll('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
        </CardContent>
      </Card>

      {/* Section 7.1: PAN/Aadhaar/bank details are masked in the API response
          for anyone but a privileged viewer or the employee themselves — so
          whenever canEditSelfServiceFields is true, `form`/`employee` already
          hold the real unmasked values and an editable input is enough. A
          Manager viewing a report's profile is neither, so they get the old
          read-only + Reveal flow instead. */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Payroll / Identity</CardTitle>
            {!canEditSelfServiceFields && !isSelf && (
              <Button variant="outline" size="sm" onClick={handleReveal}>
                Reveal
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {isSuperAdmin && !isSelf && (
        <Card>
          <CardHeader>
            <CardTitle>Module Access</CardTitle>
            <p className="text-xs text-muted-foreground">
              Grant this employee access to a specific module regardless of their role — an
              exception scoped to that module only, not a role change.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
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
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Emergency Contact</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {completion && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between text-sm">
              <CardTitle>Profile Completion</CardTitle>
              <span>{completion.completionPercentage}%</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
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
          </CardContent>
        </Card>
      )}

      {canEditSelfServiceFields && (
        <Button onClick={handleSave}>{isHrAdmin ? 'Save' : 'Submit change request'}</Button>
      )}

      {orgChart && (
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Reporting chain</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Direct reports</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
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

function ReferenceSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { id: string; name: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`}>
            {(v: string) => options.find((o) => o.id === v)?.name ?? `Select ${label.toLowerCase()}`}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
